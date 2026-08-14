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
	// Group wake signals. A real WhatsApp @mention carries the bot's JID in
	// contextInfo rather than any recognisable text, so keyword matching alone
	// silently misses it — which is why groups looked dead.
	Mentioned bool `json:"mentioned,omitempty"`
	ReplyToMe bool `json:"reply_to_me,omitempty"`
}

// Did this message @mention us, or reply to something we said?
func addressedToUs(msg *waE2E.Message) (mentioned, replyToMe bool) {
	if client == nil || client.Store.ID == nil {
		return
	}
	var ci *waE2E.ContextInfo
	if ext := msg.GetExtendedTextMessage(); ext != nil {
		ci = ext.GetContextInfo()
	} else if img := msg.GetImageMessage(); img != nil {
		ci = img.GetContextInfo()
	}
	if ci == nil {
		return
	}
	me := client.Store.ID.User // bare phone, no device suffix
	for _, j := range ci.GetMentionedJID() {
		if strings.HasPrefix(j, me) {
			mentioned = true
		}
	}
	// Participant is who wrote the message being replied to.
	if p := ci.GetParticipant(); p != "" && strings.HasPrefix(p, me) {
		replyToMe = true
	}
	return
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

	mentioned, replyToMe := addressedToUs(v.Message)
	// WhatsApp's LID privacy can put an anonymous alias (…@lid) in Sender and
	// the real phone JID in SenderAlt. Downstream needs the PHONE: an alias
	// bound as a user's alert number makes every send fail with
	// "no LID found for <alias>@s.whatsapp.net".
	sender := v.Info.Sender
	if sender.Server != types.DefaultUserServer && v.Info.SenderAlt.Server == types.DefaultUserServer {
		sender = v.Info.SenderAlt
	}
	in := inbound{
		From:      sender.User,
		Chat:      v.Info.Chat.String(),
		IsGroup:   v.Info.IsGroup,
		PushName:  v.Info.PushName,
		MessageID: v.Info.ID,
		Mentioned: mentioned,
		ReplyToMe: replyToMe,
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

	// Read receipts and typing only when we're actually going to answer —
	// a bot that "reads" and types at every message in a busy family group is
	// both rude and exactly the behaviour that gets a number reported.
	if !in.IsGroup || mentioned || replyToMe {
		go func() {
			_ = client.MarkRead(context.Background(), []types.MessageID{v.Info.ID}, time.Now(), v.Info.Chat, v.Info.Sender)
			startTyping(v.Info.Chat)
		}()
	}
	// Unaddressed group messages still go to Kapu — it keeps them as thread
	// context so a later "@kapu what about that one?" makes sense. Kapu owns
	// the decision to reply; the sidecar just reports what happened.
	go postToKapu(in)
}

// ── human presence ────────────────────────────────────────────────────
//
// A real person marks a chat read and shows "typing…" before answering.
// Firing a burst of identical messages with no receipts and no presence is
// the machine-shaped pattern, so we do what a person does instead — which is
// also better UX than a canned "On it…" placeholder.
//
// WhatsApp expires a composing state after ~10s, so it has to be refreshed
// for as long as the agent is still working.

var (
	typingMu   sync.Mutex
	typingStop = map[string]chan struct{}{}
)

func startTyping(jid types.JID) {
	key := jid.String()
	typingMu.Lock()
	if ch, ok := typingStop[key]; ok {
		close(ch)
	}
	stop := make(chan struct{})
	typingStop[key] = stop
	typingMu.Unlock()

	go func() {
		ctx := context.Background()
		_ = client.SendChatPresence(ctx, jid, types.ChatPresenceComposing, types.ChatPresenceMediaText)
		t := time.NewTicker(8 * time.Second)
		defer t.Stop()
		// Cap it: if a turn dies we must not type forever.
		deadline := time.After(3 * time.Minute)
		for {
			select {
			case <-stop:
				return
			case <-deadline:
				_ = client.SendChatPresence(ctx, jid, types.ChatPresencePaused, types.ChatPresenceMediaText)
				return
			case <-t.C:
				_ = client.SendChatPresence(ctx, jid, types.ChatPresenceComposing, types.ChatPresenceMediaText)
			}
		}
	}()
}

func stopTyping(jid types.JID) {
	key := jid.String()
	typingMu.Lock()
	if ch, ok := typingStop[key]; ok {
		close(ch)
		delete(typingStop, key)
	}
	typingMu.Unlock()
	_ = client.SendChatPresence(context.Background(), jid, types.ChatPresencePaused, types.ChatPresenceMediaText)
}

// ── outbound: Kapu → WhatsApp ─────────────────────────────────────────

type sendReq struct {
	To       string `json:"to"`                  // bare phone or full JID
	Text     string `json:"text,omitempty"`
	ImageURL string `json:"image_url,omitempty"` // fetched and uploaded
	Caption  string `json:"caption,omitempty"`
	// A spoken reply as a voice note: base64 OGG/Opus, sent PTT so WhatsApp
	// renders the waveform bubble. AudioSeconds is the duration hint.
	AudioB64     string `json:"audio_b64,omitempty"`
	AudioSeconds uint32 `json:"audio_seconds,omitempty"`
	// Last part of this answer — stop the typing indicator once it lands.
	Final bool `json:"final,omitempty"`
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

// sendAudio delivers a spoken reply as a WhatsApp VOICE NOTE. The bytes must
// already be OGG/Opus (what WhatsApp records natively); PTT=true makes it render
// as the round waveform bubble rather than a downloadable audio file.
func sendAudio(ctx context.Context, jid types.JID, b64 string, seconds uint32) error {
	data, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return fmt.Errorf("audio b64 decode: %w", err)
	}
	up, err := client.Upload(ctx, data, whatsmeow.MediaAudio)
	if err != nil {
		return err
	}
	_, err = client.SendMessage(ctx, jid, &waE2E.Message{
		AudioMessage: &waE2E.AudioMessage{
			Mimetype:      proto.String("audio/ogg; codecs=opus"),
			PTT:           proto.Bool(true),
			URL:           proto.String(up.URL),
			DirectPath:    proto.String(up.DirectPath),
			MediaKey:      up.MediaKey,
			FileEncSHA256: up.FileEncSHA256,
			FileSHA256:    up.FileSHA256,
			FileLength:    proto.Uint64(uint64(len(data))),
			Seconds:       proto.Uint32(seconds),
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
	// The reply is landing — drop the typing indicator. `final` lets Kapu keep
	// it up between the parts of a multi-message answer.
	if req.Final {
		defer stopTyping(jid)
	}

	if req.ImageURL != "" {
		if err := sendImage(ctx, jid, req.ImageURL, req.Caption); err != nil {
			log.Printf("[wa] send image failed: %v", err)
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
	}
	if req.AudioB64 != "" {
		if err := sendAudio(ctx, jid, req.AudioB64, req.AudioSeconds); err != nil {
			log.Printf("[wa] send audio failed: %v", err)
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
		// Between windows: the old code is dead and a new one is seconds away.
		w.Header().Set("Refresh", "3")
		w.Write([]byte("refreshing pairing code — this page reloads itself"))
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

// Unlink the current number so a different one can be paired. Logout tells
// WhatsApp to drop the linked device (so it disappears from the phone's
// Linked devices list too) and clears the local store — then we reopen
// pairing so /qr immediately serves a code for the new number.
func handleLogout(w http.ResponseWriter, r *http.Request) {
	if secret != "" && r.Header.Get("X-Kapu-Secret") != secret && r.URL.Query().Get("secret") != secret {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	if client == nil || client.Store.ID == nil {
		w.Write([]byte("not paired — /qr is already offering a code"))
		return
	}
	was := client.Store.ID.String()
	if err := client.Logout(context.Background()); err != nil {
		// Even a failed unlink usually clears the local store; report honestly
		// rather than pretending, and let the caller decide to retry.
		log.Printf("[wa] logout error: %v", err)
		http.Error(w, "logout failed: "+err.Error(), http.StatusBadGateway)
		return
	}
	qrMu.Lock()
	qrCode = ""
	qrMu.Unlock()
	log.Printf("[wa] logged out %s — reopening pairing", was)
	go pairingLoop(context.Background())
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"ok": true, "logged_out": was, "next": "open /qr?secret=… to pair a new number"})
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

// whatsmeow rotates a pairing code every ~20s and then gives up entirely after
// about 2.5 minutes, closing the socket. Left alone that means /qr only works
// in the first couple of minutes after a deploy, and serves a DEAD code
// afterwards — useless when a human pairs on their own schedule. So: whenever
// the QR channel closes unpaired, reconnect and start a fresh one, forever.
// Only ever one pairing loop at a time — /logout can otherwise start a second
// while the first is still cycling codes, and they'd fight over qrCode.
var pairingRunning sync.Mutex

func pairingLoop(ctx context.Context) {
	if !pairingRunning.TryLock() {
		return
	}
	defer pairingRunning.Unlock()
	for {
		if client.Store.ID != nil {
			log.Printf("[wa] paired as %s", client.Store.ID)
			return
		}
		qrChan, err := client.GetQRChannel(ctx)
		if err != nil {
			log.Printf("[wa] qr channel: %v — retrying", err)
			time.Sleep(5 * time.Second)
			continue
		}
		if !client.IsConnected() {
			if err := client.Connect(); err != nil {
				log.Printf("[wa] connect: %v — retrying", err)
				time.Sleep(5 * time.Second)
				continue
			}
		}
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
				log.Printf("[wa] pairing window expired — starting a fresh one")
			}
		}
		if client.Store.ID != nil {
			return // paired during that window
		}
		// Stop serving a code that no longer works.
		qrMu.Lock()
		qrCode = ""
		qrMu.Unlock()
		client.Disconnect()
		time.Sleep(2 * time.Second)
	}
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
		go pairingLoop(ctx)
	} else if err := client.Connect(); err != nil {
		log.Fatalf("connect: %v", err)
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	http.HandleFunc("/health", handleHealth)
	http.HandleFunc("/qr", handleQR)
	http.HandleFunc("/send", handleSend)
	http.HandleFunc("/logout", handleLogout)
	log.Printf("[wa] listening on :%s (webhook → %s)", port, webhookURL)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}
