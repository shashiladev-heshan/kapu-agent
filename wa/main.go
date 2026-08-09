// kapu-wa — WhatsApp transport for Kapu.
//
// Deliberately dumb: it owns the WhatsApp socket and nothing else. No AI, no
// catalog, no session state. Inbound messages are POSTed to Kapu's webhook;
// Kapu replies by calling POST /send. That is exactly the shape the Telegram
// adapter already has (webhook in, REST out), so the Next.js side stays a
// thin adapter and the agent core is untouched.
//
// Media is forwarded as base64 rather than stored — /api/scan already takes a
// data URL and /api/stt takes a raw blob, so an object store adds nothing.
//
// Env:
//   DATABASE_URL      Postgres for the whatsmeow session (REQUIRED — a
//                     container restart with ephemeral disk would otherwise
//                     lose the pairing and force a re-scan)
//   KAPU_WEBHOOK_URL  e.g. https://kapuwa.shop/api/whatsapp
//   WA_SHARED_SECRET  guards /send and /qr, and is sent to Kapu as a header
//   PORT              listen port (Railway sets this)

package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/skip2/go-qrcode"
	_ "github.com/lib/pq"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
	"google.golang.org/protobuf/proto"
)

var (
	client     *whatsmeow.Client
	webhookURL = os.Getenv("KAPU_WEBHOOK_URL")
	secret     = os.Getenv("WA_SHARED_SECRET")

	qrMu   sync.RWMutex
	qrCode string // latest pairing code; empty once logged in
)

// ── inbound → Kapu ────────────────────────────────────────────────────

type inbound struct {
	From      string `json:"from"`      // bare phone, e.g. 94771234567
	Chat      string `json:"chat"`      // full JID (group or DM)
	IsGroup   bool   `json:"is_group"`
	PushName  string `json:"push_name"`
	Text      string `json:"text,omitempty"`
	MediaKind string `json:"media_kind,omitempty"` // image | audio
	MediaB64  string `json:"media_b64,omitempty"`  // data URL for image, raw b64 for audio
	MimeType  string `json:"mime_type,omitempty"`
	MessageID string `json:"message_id"`
}

func postToKapu(in inbound) {
	if webhookURL == "" {
		log.Printf("[wa] no KAPU_WEBHOOK_URL set; dropping message from %s", in.From)
		return
	}
	body, _ := json.Marshal(in)
	req, err := http.NewRequest("POST", webhookURL, bytes.NewReader(body))
	if err != nil {
		log.Printf("[wa] webhook build failed: %v", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Kapu-Secret", secret)
	// A Kapu turn can run tools for a while; do not cut it off early.
	cl := &http.Client{Timeout: 300 * time.Second}
	resp, err := cl.Do(req)
	if err != nil {
		log.Printf("[wa] webhook post failed: %v", err)
		return
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)
	if resp.StatusCode >= 300 {
		log.Printf("[wa] webhook returned %d", resp.StatusCode)
	}
}

func handleEvent(evt any) {
	v, ok := evt.(*events.Message)
	if !ok {
		if _, isConn := evt.(*events.Connected); isConn {
			qrMu.Lock()
			qrCode = ""
			qrMu.Unlock()
			log.Printf("[wa] connected")
		}
		return
	}
	// Ignore our own echoes and status broadcasts.
	if v.Info.IsFromMe || v.Info.Chat.String() == "status@broadcast" {
		return
	}

	in := inbound{
		From:      v.Info.Sender.User,
		Chat:      v.Info.Chat.String(),
		IsGroup:   v.Info.IsGroup,
		PushName:  v.Info.PushName,
		MessageID: v.Info.ID,
	}

	msg := v.Message
	switch {
	case msg.GetConversation() != "":
		in.Text = msg.GetConversation()
	case msg.GetExtendedTextMessage() != nil:
		in.Text = msg.GetExtendedTextMessage().GetText()

	case msg.GetImageMessage() != nil:
		img := msg.GetImageMessage()
		data, err := client.Download(context.Background(), img)
		if err != nil {
			log.Printf("[wa] image download failed: %v", err)
			return
		}
		mime := img.GetMimetype()
		if mime == "" {
			mime = "image/jpeg"
		}
		in.MediaKind = "image"
		in.MimeType = mime
		// /api/scan wants a data URL, so hand it one directly.
		in.MediaB64 = "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data)
		in.Text = img.GetCaption()

	case msg.GetAudioMessage() != nil:
		aud := msg.GetAudioMessage()
		data, err := client.Download(context.Background(), aud)
		if err != nil {
			log.Printf("[wa] audio download failed: %v", err)
			return
		}
		mime := aud.GetMimetype()
		if mime == "" {
			mime = "audio/ogg"
		}
		in.MediaKind = "audio"
		in.MimeType = mime
		in.MediaB64 = base64.StdEncoding.EncodeToString(data)

	default:
		return // sticker/location/etc — nothing Kapu handles yet
	}

	go postToKapu(in)
}

// ── outbound: Kapu → WhatsApp ─────────────────────────────────────────

type sendReq struct {
	To       string `json:"to"`                  // bare phone or full JID
	Text     string `json:"text,omitempty"`
	ImageURL string `json:"image_url,omitempty"` // fetched and uploaded
	Caption  string `json:"caption,omitempty"`
}

func parseJID(s string) (types.JID, error) {
	if strings.ContainsRune(s, '@') {
		return types.ParseJID(s)
	}
	digits := strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, s)
	if digits == "" {
		return types.JID{}, fmt.Errorf("no digits in %q", s)
	}
	return types.NewJID(digits, types.DefaultUserServer), nil
}

func sendImage(ctx context.Context, jid types.JID, url, caption string) error {
	resp, err := http.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("image fetch %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 12<<20)) // 12 MB ceiling
	if err != nil {
		return err
	}
	up, err := client.Upload(ctx, data, whatsmeow.MediaImage)
	if err != nil {
		return err
	}
	mime := resp.Header.Get("Content-Type")
	if mime == "" || !strings.HasPrefix(mime, "image/") {
		mime = "image/jpeg"
	}
	_, err = client.SendMessage(ctx, jid, &waE2E.Message{
		ImageMessage: &waE2E.ImageMessage{
			Caption:       proto.String(caption),
			Mimetype:      proto.String(mime),
			URL:           proto.String(up.URL),
			DirectPath:    proto.String(up.DirectPath),
			MediaKey:      up.MediaKey,
			FileEncSHA256: up.FileEncSHA256,
			FileSHA256:    up.FileSHA256,
			FileLength:    proto.Uint64(uint64(len(data))),
		},
	})
	return err
}

func handleSend(w http.ResponseWriter, r *http.Request) {
	if secret != "" && r.Header.Get("X-Kapu-Secret") != secret {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	var req sendReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	jid, err := parseJID(req.To)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()

	if req.ImageURL != "" {
		if err := sendImage(ctx, jid, req.ImageURL, req.Caption); err != nil {
			log.Printf("[wa] send image failed: %v", err)
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
	}
	if req.Text != "" {
		if _, err := client.SendMessage(ctx, jid, &waE2E.Message{
			Conversation: proto.String(req.Text),
		}); err != nil {
			log.Printf("[wa] send text failed: %v", err)
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"ok":true}`))
}

// ── pairing + health ──────────────────────────────────────────────────

// Scanning this QR links THIS SERVER as a companion device to whoever scans
// it — so an unprotected /qr is an account takeover of the bot. Always gated.
func handleQR(w http.ResponseWriter, r *http.Request) {
	if secret != "" && r.URL.Query().Get("secret") != secret {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	qrMu.RLock()
	code := qrCode
	qrMu.RUnlock()
	if code == "" {
		if client != nil && client.Store.ID != nil {
			w.Write([]byte("already paired as " + client.Store.ID.String()))
			return
		}
		w.Write([]byte("no pairing code yet — retry in a moment"))
		return
	}
	png, err := qrcode.Encode(code, qrcode.Medium, 512)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(png)
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	paired, connected, jid := false, false, ""
	if client != nil {
		connected = client.IsConnected()
		if client.Store.ID != nil {
			paired = true
			jid = client.Store.ID.String()
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"ok": true, "paired": paired, "connected": connected, "jid": jid,
	})
}

func main() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("DATABASE_URL is required — whatsmeow needs Postgres to keep the pairing across restarts")
	}
	ctx := context.Background()
	dbLog := waLog.Stdout("db", "WARN", true)

	container, err := sqlstore.New(ctx, "postgres", dsn, dbLog)
	if err != nil {
		log.Fatalf("sqlstore: %v", err)
	}
	device, err := container.GetFirstDevice(ctx)
	if err != nil {
		log.Fatalf("device: %v", err)
	}

	client = whatsmeow.NewClient(device, waLog.Stdout("wa", "INFO", true))
	client.AddEventHandler(handleEvent)

	if client.Store.ID == nil {
		// Not paired yet — surface the QR at /qr for scanning.
		qrChan, _ := client.GetQRChannel(ctx)
		if err := client.Connect(); err != nil {
			log.Fatalf("connect: %v", err)
		}
		go func() {
			for evt := range qrChan {
				switch evt.Event {
				case "code":
					qrMu.Lock()
					qrCode = evt.Code
					qrMu.Unlock()
					log.Printf("[wa] pairing code ready — open /qr?secret=… to scan")
				case "success":
					qrMu.Lock()
					qrCode = ""
					qrMu.Unlock()
					log.Printf("[wa] paired successfully")
				case "timeout":
					log.Printf("[wa] pairing code expired; a new one will follow")
				}
			}
		}()
	} else {
		if err := client.Connect(); err != nil {
			log.Fatalf("connect: %v", err)
		}
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	http.HandleFunc("/health", handleHealth)
	http.HandleFunc("/qr", handleQR)
	http.HandleFunc("/send", handleSend)
	log.Printf("[wa] listening on :%s (webhook → %s)", port, webhookURL)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}
