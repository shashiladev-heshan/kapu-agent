"use client";

// Kapu's app shell — the "Kapu redesigned" spec:
//  · Desktop grows a real app shell: wide sidebar on first run → icon rail in
//    chat, plus a live basket panel; mobile gets dedicated layouts + sheets.
//  · Instant basket ops via /api/cart (no LLM round-trip).
//  · Recent wishes (multi-session) with server-side transcript rehydration.
//  · Full-screen immersive voice canvas with live captions & barge-in.
//  · Edge states with grace: connection lost, rate-limited, offline, mic ask.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BlockRenderer, CartView, OrderTimeline, ProductCard, ProductGrid, ProductHero, ProductImage, fmt, type BlockActions } from "@/components/blocks";
import {
  IconArrowRight,
  IconBasket,
  IconBell,
  IconCake,
  IconCamera,
  IconCheckCircle,
  IconLock,
  IconCapsule,
  IconCheck,
  IconChevronDown,
  IconClock,
  IconClose,
  IconFacebook,
  IconGift,
  IconGlobe,
  IconHeart,
  IconInstagram,
  IconKeyboard,
  IconList,
  IconMic,
  IconMoon,
  IconPackage,
  IconPhone,
  IconPin,
  IconPlus,
  IconRetry,
  IconSendUp,
  IconStop,
  IconSun,
  IconTelegram,
  IconTrolley,
  IconUser,
  IconWifiOff,
  IconWish,
  KapuMark,
} from "@/components/icons";
import {
  createRecognizer,
  sanitizeForSpeech,
  speechRecognitionSupported,
  VoicePlayer,
  VoiceRecorder,
  webSpeechLikelyBroken,
} from "@/lib/client/speech";
import { gsiSignOutHint, renderGoogleButton } from "@/lib/client/gsi";
import { HERO_PHRASES, LangProvider, makeT, useT, type StrKey } from "@/lib/client/i18n";
import { fileToCompressedDataUrl, scanMessage, type ScanResult } from "@/lib/client/scan";
import { nextFestival } from "@/lib/festivals";
import type { Cart, CartRequest, Currency, Language, Occasion, ProductDetail, ProductSummary, SessionSnapshot, StreamEvent, UiBlock, UiTurn } from "@/lib/types";

type VoiceState = "idle" | "listening" | "thinking" | "speaking";

type Part =
  | { kind: "text"; text: string }
  | { kind: "block"; block: UiBlock }
  | { kind: "error"; variant: "connection" | "rate_limit" | "auth" | "generic"; message: string; lastMessage: string; retryAfter?: number; attempt: number };
type ChatItem =
  | { role: "user"; text: string }
  | { role: "assistant"; parts: Part[]; streaming?: boolean; toolLabel?: string | null; steps?: string[] };

interface WishMeta {
  id: string;
  title: string;
  at: number;
}

/** product-page extras the MCP doesn't carry — parsed live from kapruka.com */
interface ProductExtras {
  rating: { value: number; count: number } | null;
  installments: { provider: string | null; monthly: number; months: number }[];
  partner: string | null;
  qa: { q: string; a: string }[];
}

/** a tracking number the user has looked up (assistant or Track sheet) */
interface TrackedOrder {
  no: string;
  status: string;
  display?: string;
  steps: number;
  at: number;
}

interface TrackAlert {
  key: string;
  no: string;
  text: string;
  at: number;
}

const TRACK_FINAL = new Set(["delivered", "cancelled"]);

/** minimal tracking payload both the SSE block and /api/track JSON satisfy */
interface TrackSnapshot {
  order_number: string;
  status: string;
  status_display?: string;
  progress: { step: string; timestamp?: string | null }[];
}

const LANGS: { code: Language; label: string; name: string; sub: string }[] = [
  { code: "si", label: "සිං", name: "Sinhala · සිංහල", sub: "Replies in Sinhala script" },
  { code: "ta", label: "த", name: "Tamil · தமிழ்", sub: "Replies in Tamil script" },
  { code: "en", label: "EN", name: "English / Tanglish", sub: "Mirrors how you write — “machan” welcome" },
];
const CURRENCIES: { code: Currency; name: string }[] = [
  { code: "LKR", name: "Sri Lankan Rupee" },
  { code: "USD", name: "US Dollar" },
  { code: "GBP", name: "British Pound" },
  { code: "AUD", name: "Australian Dollar" },
  { code: "CAD", name: "Canadian Dollar" },
  { code: "EUR", name: "Euro" },
];

const DEMO_CHIPS: { Icon: typeof IconPhone; label: StrKey; sub: StrKey; msg: string; mobile: boolean }[] = [
  { Icon: IconPhone, label: "chipPhone", sub: "chipPhoneSub", msg: "machan mata aluth phone ekak ona, 60000ට යටින් — mokakda hondama eka?", mobile: true },
  { Icon: IconTrolley, label: "chipGrocery", sub: "chipGrocerySub", msg: "I need rice 5kg, dhal 1kg, tea leaves, Panadol and soap — build me a cart", mobile: true },
  { Icon: IconCake, label: "chipCake", sub: "chipCakeSub", msg: "ammage birthday ekata Kandy walata cake ekak yawanna ona, surprise ekak 🎂", mobile: true },
  { Icon: IconCapsule, label: "chipPharmacy", sub: "chipPharmacySub", msg: "Show me pharmacy essentials for a home first-aid kit", mobile: false },
  { Icon: IconGift, label: "chipFestival", sub: "chipFestivalSub", msg: "What are good gift ideas to send my parents in Colombo for the next festival?", mobile: false },
  { Icon: IconPackage, label: "chipTrack", sub: "chipTrackSub", msg: "I want to track my order", mobile: true },
  { Icon: IconTrolley, label: "chipRecipe", sub: "chipRecipeSub", msg: "I'm making kottu for 4 people tonight — build me the full ingredient basket", mobile: false },
  { Icon: IconWish, label: "chipPirikara", sub: "chipPirikaraSub", msg: "I want to arrange a pirikara offering for the temple — help me choose respectfully", mobile: false },
  { Icon: IconGift, label: "chipFeeling", sub: "chipFeelingSub", msg: "My mother has been feeling lonely since I moved abroad — what should I send her?", mobile: false },
];

const LANG_LABEL: Record<Language, string> = { en: "English / Tanglish", si: "සිංහල", ta: "தமிழ்" };

// Google sign-in is optional: without a client id the app is guest-only and
// no Google script ever loads.
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

interface AuthProfile {
  name?: string;
  email?: string;
  picture?: string;
}

function mergeWishLists(a: WishMeta[], b: WishMeta[]): WishMeta[] {
  const byId = new Map<string, WishMeta>();
  for (const w of [...a, ...b]) {
    if (!w?.id || !w.title) continue;
    const prev = byId.get(w.id);
    if (!prev || (w.at ?? 0) > (prev.at ?? 0)) byId.set(w.id, w);
  }
  return [...byId.values()].sort((x, y) => y.at - x.at).slice(0, 12);
}

function newSessionId(): string {
  return `kapu_${crypto.randomUUID()}`;
}

function wishIcon(title: string) {
  if (/cake|birthday|upandin/i.test(title)) return IconCake;
  if (/grocer|rice|dhal|tea|pantry|soap/i.test(title)) return IconTrolley;
  if (/phone|laptop|tv|speaker|electronic/i.test(title)) return IconPhone;
  if (/pharm|panadol|medicin|first.?aid|ayurved/i.test(title)) return IconCapsule;
  if (/track|order/i.test(title)) return IconPackage;
  if (/gift|festival|amma|surprise|flower/i.test(title)) return IconGift;
  return IconWish;
}

function timeAgo(at: number): string {
  const d = Date.now() - at;
  if (d < 90_000) return "Just now";
  if (d < 3_600_000) return `${Math.round(d / 60_000)}m ago`;
  if (d < 86_400_000) return "Today";
  if (d < 2 * 86_400_000) return "Yesterday";
  if (d < 7 * 86_400_000) return new Date(at).toLocaleDateString("en-GB", { weekday: "short" });
  return "Last week";
}

function itemsFromUi(ui: UiTurn[]): ChatItem[] {
  return ui.map((t) =>
    t.role === "user"
      ? { role: "user" as const, text: t.text }
      : {
          role: "assistant" as const,
          parts: [
            ...(t.text ? [{ kind: "text" as const, text: t.text }] : []),
            ...t.blocks.filter((b) => b.type !== "speech").map((b) => ({ kind: "block" as const, block: b })),
          ],
        }
  );
}

export default function KapuApp() {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [cart, setCart] = useState<Cart>({ items: [], currency: "LKR" });
  const [cartOpen, setCartOpen] = useState(false);
  const [cartPulse, setCartPulse] = useState(false);
  const [panelClosed, setPanelClosed] = useState(false);
  const [language, setLanguage] = useState<Language>("en");
  const [currency, setCurrency] = useState<Currency>("LKR");
  const [dark, setDark] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [recorderMode, setRecorderMode] = useState(false);
  const [voiceInterim, setVoiceInterim] = useState("");
  const [voiceSpoken, setVoiceSpoken] = useState("");
  const [voiceTool, setVoiceTool] = useState<string | null>(null);
  /** UiBlocks of the current voice turn — rendered as animated cards on the canvas */
  const [voiceBlocks, setVoiceBlocks] = useState<UiBlock[]>([]);
  const [micModal, setMicModal] = useState(false);
  const [recents, setRecents] = useState<WishMeta[]>([]);
  const [wishesOpen, setWishesOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  /** manual sidebar collapse (hero state) → icon rail; persisted per device */
  const [sideCollapsed, setSideCollapsed] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [deliverOpen, setDeliverOpen] = useState(false);
  const [deliverTo, setDeliverTo] = useState("");
  const [deliverDraft, setDeliverDraft] = useState("");
  const [cityOpts, setCityOpts] = useState<{ name: string; hint: string | null }[]>([]);
  const [cityLoading, setCityLoading] = useState(false);
  const [cityIdx, setCityIdx] = useState(-1);
  const cityFetchRef = useRef(0);
  const [online, setOnline] = useState(true);
  const [sessionReady, setSessionReady] = useState(false);
  const [authUser, setAuthUser] = useState<AuthProfile | null>(null);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [tourStep, setTourStep] = useState(-1); // -1 = closed
  const [tgBot, setTgBot] = useState<{ username: string; link: string } | null>(null);
  const [favs, setFavs] = useState<Record<string, ProductSummary>>({});
  const [favOpen, setFavOpen] = useState(false);
  const [productOpen, setProductOpen] = useState<ProductSummary | null>(null);
  const [productDetail, setProductDetail] = useState<ProductDetail | null>(null);
  const [productExtras, setProductExtras] = useState<ProductExtras | null>(null);
  const [productSimilar, setProductSimilar] = useState<ProductSummary[]>([]);
  const [trackOpen, setTrackOpen] = useState(false);
  const [trackPrefill, setTrackPrefill] = useState<string | null>(null);
  /** hero discovery: live trending/budget/deals rails (site-parity with kapruka.com) */
  const [discover, setDiscover] = useState<{ trending: ProductSummary[]; budget: ProductSummary[] } | null>(null);
  const [discTab, setDiscTab] = useState<"trending" | "budget">("trending");
  /** standalone Hot-deals section — full promotions list, chunk-revealed on scroll */
  const [hotDeals, setHotDeals] = useState<ProductSummary[]>([]);
  const [dealsShown, setDealsShown] = useState(8);
  const [dealsCat, setDealsCat] = useState<string>("all");
  const dealsSentinelRef = useRef<HTMLDivElement>(null);
  /** taste-engine picks (vector recs over this device's wishes) */
  const [recs, setRecs] = useState<ProductSummary[]>([]);
  /** order numbers ever tracked here (localStorage) — re-track chips + change watch */
  const [tracked, setTracked] = useState<TrackedOrder[]>([]);
  const [trackAlerts, setTrackAlerts] = useState<TrackAlert[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [occasions, setOccasions] = useState<(Occasion & { in_days: number })[]>([]);
  const [recentOrders, setRecentOrders] = useState<{ order_ref: string; pay_url: string; recipient: string | null; city: string | null; date: string | null; items: string[] }[]>([]);
  const [seasonal, setSeasonal] = useState<{
    festival: { name: string; label: string; days: number; approx: boolean; glyphs: string; greet: string; msg: string } | null;
    products: ProductSummary[];
  } | null>(null);
  const [schedFeed, setSchedFeed] = useState<{ id: string; title: string; active: boolean; next_run: number; last_result: string | null }[]>([]);
  const [notifSeen, setNotifSeen] = useState(0);
  const [rules, setRules] = useState("");
  const [rulesFlash, setRulesFlash] = useState(false);
  const [schedOpen, setSchedOpen] = useState(false);
  const [slashIdx, setSlashIdx] = useState(0);
  const [scan, setScan] = useState<{ phase: "reading" | "unclear"; preview: string; caption?: string } | null>(null);
  const scanInputRef = useRef<HTMLInputElement>(null);
  const scanSeqRef = useRef(0);

  const sessionIdRef = useRef<string>("");
  const preferredDateRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const voiceOnRef = useRef(false);
  const voiceStateRef = useRef<VoiceState>("idle");
  const languageRef = useRef<Language>("en");
  const playerRef = useRef<VoicePlayer | null>(null);
  const ackCacheRef = useRef<Record<string, Blob[]>>({});
  const recognizerRef = useRef<{ abort: () => void } | null>(null);
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const startListeningRef = useRef<() => void>(() => {});
  const refreshRecsRef = useRef<() => void>(() => {});
  const finishRecordingRef = useRef<() => Promise<void>>(async () => {});
  const sendRef = useRef<(text: string) => Promise<void>>(async () => {});
  const busyPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const authUserRef = useRef<AuthProfile | null>(null);
  /** sticky: Web Speech is broken here (Brave etc.) — use the Whisper recorder */
  const sttFallbackRef = useRef(false);
  /** consecutive recognizer runs that ended without hearing ANYTHING */
  const silentEndsRef = useRef(0);
  const gotAnySpeechRef = useRef(false);

  useEffect(() => {
    authUserRef.current = authUser;
  }, [authUser]);

  const setVoice = useCallback((s: VoiceState) => {
    voiceStateRef.current = s;
    setVoiceState(s);
  }, []);

  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  // ── boot: session, prefs, rehydration, SW, online ────────────────────
  useEffect(() => {
    const stored = localStorage.getItem("kapu_session");
    sessionIdRef.current = stored || newSessionId();
    localStorage.setItem("kapu_session", sessionIdRef.current);
    const lang = localStorage.getItem("kapu_lang") as Language | null;
    const curr = localStorage.getItem("kapu_currency") as Currency | null;
    if (lang) setLanguage(lang);
    if (curr) setCurrency(curr);
    setDeliverTo(localStorage.getItem("kapu_deliver_to") ?? "");
    setPanelClosed(localStorage.getItem("kapu_panel_closed") === "1");
    try {
      setRecents(JSON.parse(localStorage.getItem("kapu_wishes") ?? "[]") as WishMeta[]);
    } catch {
      /* fresh start */
    }
    try {
      setFavs(JSON.parse(localStorage.getItem("kapu_favs") ?? "{}") as Record<string, ProductSummary>);
    } catch {
      /* fresh */
    }
    setNotifSeen(Number(localStorage.getItem("kapu_notif_seen") ?? 0));
    setRules(localStorage.getItem("kapu_rules") ?? "");
    // notification sources: saved occasions + recent orders
    const sid = sessionIdRef.current;
    void fetch(`/api/occasions?sessionId=${encodeURIComponent(sid)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.upcoming && setOccasions(d.upcoming))
      .catch(() => {});
    void fetch("/api/seasonal")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setSeasonal(d))
      .catch(() => {});
    void fetch("/api/deals")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => Array.isArray(d?.products) && setHotDeals(d.products))
      .catch(() => {});
    void fetch("/api/discover")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d || (!d.trending?.length && !d.budget?.length)) return;
        setDiscover(d);
        if (!d.trending?.length) setDiscTab("budget");
      })
      .catch(() => {});
    try {
      const wishIds = (JSON.parse(localStorage.getItem("kapu_wishes") ?? "[]") as WishMeta[]).map((w) => w.id);
      const ids = [sid, ...wishIds].slice(0, 12);
      void fetch(`/api/recs?sessions=${encodeURIComponent(ids.join(","))}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => Array.isArray(d?.products) && d.products.length >= 4 && setRecs(d.products))
        .catch(() => {});
    } catch {
      /* fresh device */
    }
    void fetch(`/api/orders?sessionId=${encodeURIComponent(sid)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.orders && setRecentOrders(d.orders))
      .catch(() => {});
    try {
      setTracked(JSON.parse(localStorage.getItem("kapu_tracked") ?? "[]") as TrackedOrder[]);
      setTrackAlerts(JSON.parse(localStorage.getItem("kapu_track_alerts") ?? "[]") as TrackAlert[]);
    } catch {
      /* fresh */
    }
    setDark(document.documentElement.classList.contains("dark"));
    setSideCollapsed(localStorage.getItem("kapu_side_collapsed") === "1");
    // follow OS theme flips live — but only until the user explicitly picks one
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    const onScheme = (e: MediaQueryListEvent) => {
      if (localStorage.getItem("kapu_theme")) return;
      document.documentElement.classList.toggle("dark", e.matches);
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", e.matches ? "#151022" : "#f6f4fa");
      setDark(e.matches);
    };
    scheme.addEventListener("change", onScheme);
    // first visit → welcome gate (Google or guest); one tap, never again
    if (!localStorage.getItem("kapu_welcome")) setWelcomeOpen(true);
    else if (!localStorage.getItem("kapu_tour")) setTimeout(() => setTourStep(0), 900);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    setOnline(navigator.onLine);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);

    // Is the Telegram channel configured? (shows the t.me chips when yes)
    void (async () => {
      try {
        const res = await fetch("/api/telegram");
        const data = (await res.json()) as { enabled?: boolean; username?: string; link?: string };
        if (data.enabled && data.username && data.link) setTgBot({ username: data.username, link: data.link });
      } catch {
        /* stays hidden */
      }
    })();

    // Who am I? (guest by default; Google when signed in — wishes then sync)
    void (async () => {
      try {
        const res = await fetch("/api/auth/session");
        if (!res.ok) return;
        const data = (await res.json()) as { user: AuthProfile | null; wishes?: WishMeta[] };
        if (data.user) {
          setAuthUser(data.user);
          let local: WishMeta[] = [];
          try {
            local = JSON.parse(localStorage.getItem("kapu_wishes") ?? "[]") as WishMeta[];
          } catch {
            /* fresh */
          }
          const merged = mergeWishLists(local, data.wishes ?? []);
          setRecents(merged);
          localStorage.setItem("kapu_wishes", JSON.stringify(merged));
          if (merged.length) {
            void fetch("/api/wishes", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ wishes: merged }),
            });
          }
        }
      } catch {
        /* stay guest */
      }
    })();

    // Rehydrate the visible transcript + basket (refresh-proof).
    void (async () => {
      try {
        const res = await fetch(`/api/session?id=${encodeURIComponent(sessionIdRef.current)}`);
        if (res.ok) {
          const snap = (await res.json()) as SessionSnapshot;
          if (snap.exists) {
            if (snap.ui.length) setItems(itemsFromUi(snap.ui));
            setCart(snap.cart);
            if (snap.busy) watchBusySession(sessionIdRef.current);
          }
        }
      } catch {
        /* offline or cold start — begin fresh */
      } finally {
        setSessionReady(true);
      }
    })();

    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      scheme.removeEventListener("change", onScheme);
    };
  }, []);

  const persistRecents = useCallback((next: WishMeta[]) => {
    setRecents(next);
    localStorage.setItem("kapu_wishes", JSON.stringify(next.slice(0, 12)));
    // signed in → mirror to the account so wishes follow across devices
    if (authUserRef.current) {
      void fetch("/api/wishes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wishes: next.slice(0, 12) }),
      }).catch(() => {});
    }
  }, []);

  const upsertRecent = useCallback(
    (title: string) => {
      const id = sessionIdRef.current;
      const rest = recents.filter((w) => w.id !== id);
      const existing = recents.find((w) => w.id === id);
      persistRecents([{ id, title: existing?.title ?? title.slice(0, 60), at: Date.now() }, ...rest]);
    },
    [recents, persistRecents]
  );

  /** remember every order number the user tracks — chips + change watch */
  const rememberTracked = useCallback((snap: TrackSnapshot) => {
    if (!snap.order_number) return;
    setTracked((prev) => {
      const entry: TrackedOrder = {
        no: snap.order_number,
        status: snap.status.toLowerCase(),
        display: snap.status_display,
        steps: snap.progress.length,
        at: Date.now(),
      };
      const next = [entry, ...prev.filter((x) => x.no !== entry.no)].slice(0, 8);
      localStorage.setItem("kapu_tracked", JSON.stringify(next));
      return next;
    });
  }, []);

  const pushTrackAlert = useCallback((no: string, text: string) => {
    setTrackAlerts((prev) => {
      const next = [{ key: `trk-${no}-${Date.now()}`, no, text, at: Date.now() }, ...prev].slice(0, 10);
      localStorage.setItem("kapu_track_alerts", JSON.stringify(next));
      return next;
    });
    // native notification when the user opted in (button in the Track sheet)
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      try {
        new Notification("Kapu — order update", { body: text, icon: "/icons/icon-192.png" });
      } catch {
        /* some browsers require a service-worker notification — panel still shows it */
      }
    }
  }, []);

  // Watch tracked in-flight orders while the app is open: poll /api/track
  // (LLM-free) every 5 min, surface status/step changes in the notification
  // panel + native notification. Telegram watch (watch_order schedule) covers
  // the app-closed case.
  useEffect(() => {
    const tick = async () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      let list: TrackedOrder[] = [];
      try {
        list = (JSON.parse(localStorage.getItem("kapu_tracked") ?? "[]") as TrackedOrder[]).filter(
          (o) => !TRACK_FINAL.has(o.status)
        );
      } catch {
        return;
      }
      for (const o of list.slice(0, 5)) {
        try {
          const res = await fetch(`/api/track?order=${encodeURIComponent(o.no)}`);
          if (!res.ok) continue;
          const d = (await res.json()) as TrackSnapshot;
          const ns = String(d.status ?? "").toLowerCase();
          const nSteps = Array.isArray(d.progress) ? d.progress.length : 0;
          if (ns !== o.status || nSteps > o.steps) {
            rememberTracked(d);
            const latest = nSteps > 0 ? d.progress[nSteps - 1]?.step : null;
            pushTrackAlert(o.no, `#${o.no} — ${d.status_display || ns}${latest ? ` · ${latest}` : ""}`);
          }
        } catch {
          /* offline / shield busy — next tick */
        }
      }
    };
    const id = setInterval(() => void tick(), 5 * 60_000);
    const t0 = setTimeout(() => void tick(), 8_000); // catch changes since last visit
    return () => {
      clearInterval(id);
      clearTimeout(t0);
    };
  }, [rememberTracked, pushTrackAlert]);

  // Hot-deals infinite reveal: +8 cards whenever the sentinel scrolls into view
  useEffect(() => {
    const el = dealsSentinelRef.current;
    if (!el || dealsShown >= hotDeals.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) setDealsShown((n) => Math.min(n + 8, hotDeals.length));
      },
      { rootMargin: "300px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hotDeals.length, dealsShown]);

  // friendly time-of-day greeting for the hero header (SL time, user's language)
  const heroGreeting = useMemo(() => {
    const h = Number(new Date().toLocaleString("en-US", { timeZone: "Asia/Colombo", hour: "numeric", hour12: false })) % 24;
    const slot = h < 5 ? 2 : h < 12 ? 0 : h < 17 ? 1 : 2;
    const G: Record<Language, string[]> = {
      en: ["good morning ☀️", "good afternoon 🌤️", "good evening 🌙"],
      si: ["සුබ උදෑසනක් ☀️", "සුබ දහවලක් 🌤️", "සුබ සැන්දෑවක් 🌙"],
      ta: ["காலை வணக்கம் ☀️", "மதிய வணக்கம் 🌤️", "மாலை வணக்கம் 🌙"],
    };
    return G[language][slot];
  }, [language]);

  const toggleTheme = useCallback(() => {
    setDark((d) => {
      const next = !d;
      document.documentElement.classList.toggle("dark", next);
      localStorage.setItem("kapu_theme", next ? "dark" : "light");
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", next ? "#151022" : "#f6f4fa");
      return next;
    });
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [items, busy]);

  // ── send a turn ───────────────────────────────────────────────────────
  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || busy) return;
      setBusy(true);
      setInput("");
      setCartOpen(false);
      setWishesOpen(false);
      setProductOpen(null);
      setFavOpen(false);
      setTrackOpen(false);
      setNotifOpen(false);
      setSchedOpen(false);
      upsertRecent(message);
      let speakBuffer = "";
      let spokenOverride = "";
      if (voiceOnRef.current) {
        setVoice("thinking");
        setVoiceTool(null);
        setVoiceBlocks([]); // fresh canvas — this turn's cards replace the last
        // instant spoken ack while the agent works (prefetched at mic tap)
        const acks = ackCacheRef.current[languageRef.current];
        if (acks?.length) void playerRef.current?.playAck(acks[Math.floor(acks.length * ((Date.now() % 97) / 97))]);
      }
      setItems((prev) => [
        ...prev,
        { role: "user", text: message },
        { role: "assistant", parts: [], streaming: true, toolLabel: null },
      ]);

      const patchAssistant = (fn: (a: Extract<ChatItem, { role: "assistant" }>) => void) =>
        setItems((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant") {
            const copy = { ...last, parts: [...last.parts] };
            fn(copy);
            next[next.length - 1] = copy;
          }
          return next;
        });

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: sessionIdRef.current,
            message,
            language: languageRef.current,
            currency,
            voice: voiceOnRef.current,
            ...(deliverTo ? { deliverTo } : {}),
            ...(preferredDateRef.current ? { preferredDate: preferredDateRef.current } : {}),
            ...(Object.keys(favs).length
              ? { favorites: Object.values(favs).slice(0, 8).map((f) => `${f.name} (${f.id})`) }
              : {}),
            ...(rules.trim() ? { rules: rules.trim() } : {}),
          }),
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        const handle = (event: StreamEvent) => {
          switch (event.type) {
            case "text":
              if (voiceOnRef.current) speakBuffer += event.delta;
              patchAssistant((a) => {
                a.toolLabel = null;
                const last = a.parts[a.parts.length - 1];
                if (last?.kind === "text") {
                  a.parts[a.parts.length - 1] = { kind: "text", text: last.text + event.delta };
                } else {
                  a.parts.push({ kind: "text", text: event.delta });
                }
              });
              break;
            case "tool":
              setVoiceTool(event.status === "start" ? event.label ?? null : null);
              patchAssistant((a) => {
                a.toolLabel = event.status === "start" ? event.label || "Working…" : null;
                if (event.status === "start" && event.label && event.label !== "…") {
                  a.steps = a.steps ?? [];
                  if (a.steps[a.steps.length - 1] !== event.label) a.steps.push(event.label);
                }
              });
              break;
            case "block":
              if (event.block.type === "speech") {
                // voice-optimized text from the say() tool — spoken, not shown
                spokenOverride = event.block.text;
                break;
              }
              if (event.block.type === "pick_update") {
                // crown_pick: the model's verdict moves the KAPU'S PICK badge
                // on the already-rendered grid — badge and words never disagree
                const pid = event.block.product_id.toLowerCase();
                const crown = (ps: ProductSummary[]) =>
                  ps.map((p) => ({ ...p, pick: p.id.toLowerCase() === pid, value: p.id.toLowerCase() === pid ? false : p.value }));
                patchAssistant((a) => {
                  for (let i = a.parts.length - 1; i >= 0; i--) {
                    const part = a.parts[i];
                    if (
                      part.kind === "block" &&
                      part.block.type === "product_grid" &&
                      part.block.products.some((p) => p.id.toLowerCase() === pid)
                    ) {
                      a.parts[i] = { kind: "block", block: { ...part.block, products: crown(part.block.products) } };
                      break;
                    }
                  }
                });
                setVoiceBlocks((prev) =>
                  prev.map((b) =>
                    b.type === "product_grid" && b.products.some((p) => p.id.toLowerCase() === pid)
                      ? { ...b, products: crown(b.products) }
                      : b
                  )
                );
                break;
              }
              if (event.block.type === "cart") setCart(event.block.cart);
              if (event.block.type === "order_timeline") rememberTracked(event.block);
              patchAssistant((a) => a.parts.push({ kind: "block", block: event.block }));
              if (voiceOnRef.current) {
                const b = event.block;
                setVoiceBlocks((prev) => [...prev, b]);
              }
              break;
            case "cart":
              setCart(event.cart);
              break;
            case "error":
              patchAssistant((a) =>
                a.parts.push({
                  kind: "error",
                  variant: event.kind === "rate_limit" ? "rate_limit" : event.kind === "auth" ? "auth" : "generic",
                  message: event.message,
                  lastMessage: message,
                  retryAfter: event.retry_after,
                  attempt: 0,
                })
              );
              break;
            case "done":
              patchAssistant((a) => {
                a.streaming = false;
                a.toolLabel = null;
              });
              break;
          }
        };

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const data = line.replace(/^data:\s*/, "").trim();
            if (!data) continue;
            try {
              handle(JSON.parse(data) as StreamEvent);
            } catch {
              /* ignore malformed frame */
            }
          }
        }
      } catch {
        patchAssistant((a) => {
          a.parts.push({ kind: "error", variant: "connection", message: "", lastMessage: message, attempt: 0 });
          a.streaming = false;
        });
      } finally {
        patchAssistant((a) => {
          a.streaming = false;
          a.toolLabel = null;
        });
        setBusy(false);
        setVoiceTool(null);
        if (!voiceOnRef.current) inputRef.current?.focus();
        // taste signal just accrued — refresh the "Picked for you" rail
        setTimeout(() => refreshRecsRef.current(), 1500);
      }

      // ── voice loop continuation: speak the reply, then listen again ──
      const toSpeak = spokenOverride.trim() || speakBuffer.trim();
      if (voiceOnRef.current && toSpeak) {
        setVoiceSpoken(sanitizeForSpeech(spokenOverride.trim() || toSpeak));
        setVoice("speaking");
        playerRef.current ??= new VoicePlayer();
        await playerRef.current.speak(toSpeak, languageRef.current);
      }
      if (voiceOnRef.current) startListeningRef.current();
    },
    [busy, currency, deliverTo, favs, rules, setVoice, upsertRecent, rememberTracked]
  );

  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  // ── retry helpers (connection-lost / rate-limited cards) ─────────────
  const retryLast = useCallback(
    (lastMessage: string) => {
      if (busy) return;
      setItems((prev) => {
        // the failed exchange is always the trailing user+assistant pair
        const next = [...prev];
        if (next.length >= 2 && next[next.length - 1].role === "assistant" && next[next.length - 2].role === "user") {
          next.splice(next.length - 2, 2);
        }
        return next;
      });
      // let state settle before re-sending
      setTimeout(() => void sendRef.current(lastMessage), 30);
    },
    [busy]
  );

  // ── instant basket ops (no LLM round-trip) ───────────────────────────
  const cartOp = useCallback(async (payload: Omit<CartRequest, "sessionId">) => {
    try {
      const res = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, sessionId: sessionIdRef.current }),
      });
      if (res.ok) {
        const data = (await res.json()) as { cart: Cart };
        setCart(data.cart);
        setCartPulse(true);
        setTimeout(() => setCartPulse(false), 600);
      }
    } catch {
      /* silent — basket ops are retryable by tapping again */
    }
  }, []);

  const t = useMemo(() => makeT(language), [language]);
  const festival = useMemo(() => nextFestival(), []);

  useEffect(() => {
    if (!authUser) return;
    void fetch("/api/schedules")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.schedules && setSchedFeed(d.schedules))
      .catch(() => {});
  }, [authUser, schedOpen]); // refresh after managing the sheet

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setLangOpen(false);
      setCartOpen(false);
      setNavOpen(false);
      setProductOpen(null);
      setFavOpen(false);
      setTrackOpen(false);
      setNotifOpen(false);
      setSchedOpen(false);
      setWishesOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** A turn was still running server-side when this tab (re)loaded or the
   *  wish was reopened — keep the typing indicator on and poll until the
   *  finished reply is in the transcript, then paint it. */
  const watchBusySession = useCallback((id: string) => {
    if (busyPollRef.current) clearInterval(busyPollRef.current);
    setBusy(true);
    const startedAt = Date.now();
    busyPollRef.current = setInterval(async () => {
      if (sessionIdRef.current !== id || Date.now() - startedAt > 150_000) {
        if (busyPollRef.current) clearInterval(busyPollRef.current);
        busyPollRef.current = null;
        if (sessionIdRef.current === id) setBusy(false);
        return;
      }
      try {
        const res = await fetch(`/api/session?id=${encodeURIComponent(id)}`);
        if (!res.ok) return;
        const snap = (await res.json()) as SessionSnapshot;
        if (sessionIdRef.current !== id) return;
        if (!snap.busy) {
          if (busyPollRef.current) clearInterval(busyPollRef.current);
          busyPollRef.current = null;
          if (snap.ui.length) setItems(itemsFromUi(snap.ui));
          setCart(snap.cart);
          setBusy(false);
        }
      } catch {
        /* transient — keep polling */
      }
    }, 2500);
  }, []);

  const toggleFav = useCallback((p: ProductSummary) => {
    setFavs((prev) => {
      const next = { ...prev };
      if (next[p.id]) delete next[p.id];
      else next[p.id] = { id: p.id, name: p.name, price: p.price, currency: p.currency, image: p.image ?? null, category: p.category ?? null };
      localStorage.setItem("kapu_favs", JSON.stringify(next));
      return next;
    });
  }, []);

  const openProduct = useCallback(
    (p: ProductSummary) => {
      setProductOpen(p);
      setProductDetail(null);
      setProductExtras(null);
      // detail can 500 upstream (EF_PC_* family) — degrade to the summary
      // we already hold instead of a forever-skeleton
      const fallback: ProductDetail = { ...p, description: null, images: p.image ? [p.image] : [], variants: [], attributes: {} };
      void fetch(`/api/product?id=${encodeURIComponent(p.id)}&currency=${currency}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setProductDetail(d?.product ?? fallback))
        .catch(() => setProductDetail(fallback));
      // page extras (rating · instalments · partner · Q&A) — hydrate when ready
      if (p.url) {
        void fetch(`/api/extras?id=${encodeURIComponent(p.id)}&url=${encodeURIComponent(p.url)}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => d && !d.error && setProductExtras(d as ProductExtras))
          .catch(() => {});
      }
      // "more like this" — vector neighbors + distilled keyword search
      setProductSimilar([]);
      void fetch(
        `/api/similar?id=${encodeURIComponent(p.id)}&name=${encodeURIComponent(p.name)}${p.category ? `&category=${encodeURIComponent(p.category)}` : ""}`
      )
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => Array.isArray(d?.products) && d.products.length >= 3 && setProductSimilar(d.products))
        .catch(() => {});
    },
    [currency]
  );

  const notifItems = useMemo(() => {
    const items: { key: string; icon: "cake" | "gift" | "package"; text: string; actionLabel: string; run: () => void }[] = [];
    // order-movement alerts first — the most timely thing we know
    for (const a of trackAlerts.slice(0, 3)) {
      items.push({
        key: a.key,
        icon: "package",
        text: `📦 ${a.text}`,
        actionLabel: t("trackBtn"),
        run: () => {
          setTrackPrefill(a.no);
          setTrackOpen(true);
        },
      });
    }
    for (const o of occasions.slice(0, 4)) {
      items.push({
        key: `occ-${o.id}`,
        icon: "cake",
        text: t("occLine", { who: o.recipient, type: o.type, d: o.in_days }),
        actionLabel: t("planGift"),
        run: () => void sendRef.current(`${o.recipient}'s ${o.type} is in ${o.in_days} days — help me plan a gift`),
      });
    }
    if (festival && festival.days <= 60) {
      items.push({
        key: "fest",
        icon: "gift",
        text: `${festival.approx ? "~" : ""}${festival.days}d — ${festival.name}`,
        actionLabel: t("giftIdeas").replace("· ", ""),
        run: () => void sendRef.current(festival.msg),
      });
    }
    for (const sc of schedFeed.filter((x) => x.last_result).slice(0, 2)) {
      items.push({
        key: `sched-${sc.id}`,
        icon: "gift",
        text: `⏰ ${t("schedRan", { title: sc.title, result: (sc.last_result ?? "").slice(0, 60) })}`,
        actionLabel: t("open"),
        run: () => setSchedOpen(true),
      });
    }
    const nextSched = schedFeed.filter((x) => x.active && !x.last_result).sort((a, b) => a.next_run - b.next_run)[0];
    if (nextSched) {
      items.push({
        key: `sched-next-${nextSched.id}`,
        icon: "gift",
        text: `⏰ ${t("schedUpcoming", { title: nextSched.title, when: new Date(nextSched.next_run).toLocaleString("en-GB", { timeZone: "Asia/Colombo", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) })}`,
        actionLabel: t("open"),
        run: () => setSchedOpen(true),
      });
    }
    for (const o of recentOrders.slice(0, 2)) {
      items.push({
        key: `ord-${o.order_ref}`,
        icon: "package",
        text: t("orderLine", { ref: o.order_ref }),
        actionLabel: t("openPay"),
        run: () => window.open(o.pay_url, "_blank"),
      });
    }
    return items;
  }, [occasions, festival, recentOrders, schedFeed, trackAlerts, t]);

  const notifUnread = Math.max(0, notifItems.length - notifSeen);
  const openNotifs = useCallback(() => {
    setNotifOpen((v) => !v);
    setNotifSeen(notifItems.length);
    localStorage.setItem("kapu_notif_seen", String(notifItems.length));
  }, [notifItems.length]);

  const buildFromFavs = useCallback(() => {
    const list = Object.values(favs);
    if (!list.length) return;
    setFavOpen(false);
    void sendRef.current(
      `Add my favorites to the basket: ${list.map((f) => `${f.name} (${f.id})`).join(", ")}`
    );
  }, [favs]);

  const actions: BlockActions = useMemo(
    () => ({
      onAction: (t) => void sendRef.current(t),
      onCartAdd: (p: ProductSummary, opts) =>
        void cartOp({
          action: "add",
          product_id: p.id,
          quantity: 1,
          ...(opts?.icing ? { icing_text: opts.icing } : {}),
          known: { name: p.name, price: p.price, currency: p.currency, image: p.image ?? null, category: p.category ?? null },
        }).then(() => {
          // visible feedback: slide the basket open with the fresh item in it
          setPanelClosed(false);
          localStorage.setItem("kapu_panel_closed", "0");
          setCartOpen(true);
        }),
      onCartQty: (id, qty) => void cartOp({ action: "set_qty", product_id: id, quantity: qty }),
      onCartIcing: (id, icing) => void cartOp({ action: "set_icing", product_id: id, icing_text: icing }),
      onPreferDate: (date) => {
        preferredDateRef.current = date;
      },
      onFocusComposer: () => inputRef.current?.focus(),
      onOpenProduct: (p) => openProduct(p),
      onDeliverTo: (city) => {
        const v = city.trim().slice(0, 40);
        if (!v) return;
        setDeliverTo(v);
        localStorage.setItem("kapu_deliver_to", v);
      },
      onToggleFav: (p) => toggleFav(p),
      isFav: (id) => Boolean(favs[id]),
    }),
    [cartOp, openProduct, toggleFav, favs]
  );

  // ── voice mode ────────────────────────────────────────────────────────
  const startListening = useCallback(() => {
    if (!voiceOnRef.current) return;
    setVoiceInterim("");
    setVoiceSpoken("");

    // Whisper recorder path — browsers without Web Speech (Firefox, some
    // Safari) AND Chromium forks whose recognition backend is blocked
    // (Brave): the API exists but never hears anything.
    if (!speechRecognitionSupported() || sttFallbackRef.current) {
      setRecorderMode(true);
      recognizerRef.current?.abort();
      recorderRef.current?.cancel();
      recorderRef.current ??= new VoiceRecorder();
      recorderRef.current
        // VAD endpointing: the pause after a sentence auto-sends — hands-free
        // on iOS too, where ✓ Done is only the manual backup.
        .start({ onAutoStop: () => void finishRecordingRef.current() })
        .then(() => setVoice("listening"))
        .catch(() => {
          voiceOnRef.current = false;
          setVoice("idle");
          setMicModal(true);
        });
      return;
    }

    setRecorderMode(false);
    recognizerRef.current?.abort();
    let cancelled = false;
    let gotFinal = false;
    const r = createRecognizer(languageRef.current, {
      onInterim: (t) => {
        gotAnySpeechRef.current = true;
        silentEndsRef.current = 0;
        setVoiceInterim(t);
      },
      onFinal: (t) => {
        gotFinal = true;
        gotAnySpeechRef.current = true;
        silentEndsRef.current = 0;
        setVoiceInterim("");
        void sendRef.current(t);
      },
      onError: (e) => {
        if (e === "not-allowed") {
          // real permission problem → gentle mic ask
          voiceOnRef.current = false;
          setVoice("idle");
          setMicModal(true);
          return;
        }
        if (e === "network" || e === "service-not-allowed" || e === "audio-capture" || e === "language-not-supported" || e === "hung") {
          // recognition backend unavailable (Brave & friends) — switch to
          // the Whisper recorder and keep the conversation going
          cancelled = true;
          sttFallbackRef.current = true;
          recognizerRef.current?.abort();
          setTimeout(() => {
            if (voiceOnRef.current) startListeningRef.current();
          }, 100);
        }
      },
      onEnd: () => {
        if (cancelled || gotFinal || !voiceOnRef.current) return;
        // Ended without a word. A few silent runs is normal (user thinking);
        // MANY silent runs with zero interim EVER = broken backend → fallback.
        silentEndsRef.current += 1;
        if (silentEndsRef.current >= 3 && !gotAnySpeechRef.current) {
          sttFallbackRef.current = true;
        }
        setTimeout(() => {
          if (voiceOnRef.current && voiceStateRef.current === "listening") startListeningRef.current();
        }, 250);
      },
    });
    if (!r) {
      sttFallbackRef.current = true;
      startListeningRef.current();
      return;
    }
    recognizerRef.current = {
      abort: () => {
        cancelled = true;
        r.abort();
      },
    };
    setVoice("listening");
    try {
      r.start();
    } catch {
      /* recognizer already running */
    }
  }, [setVoice]);

  useEffect(() => {
    startListeningRef.current = startListening;
  }, [startListening]);

  const stopVoice = useCallback(() => {
    voiceOnRef.current = false;
    recognizerRef.current?.abort();
    recorderRef.current?.cancel();
    playerRef.current?.stop();
    setVoice("idle");
    setVoiceInterim("");
    setVoiceSpoken("");
    setVoiceTool(null);
    setVoiceBlocks([]);
  }, [setVoice]);

  const beginVoice = useCallback(() => {
    voiceOnRef.current = true;
    playerRef.current ??= new VoicePlayer();
    silentEndsRef.current = 0;
    gotAnySpeechRef.current = false;
    // Brave & co: Web Speech exists but its backend is blocked — go straight
    // to the Whisper recorder instead of "listening" into the void.
    void webSpeechLikelyBroken().then((broken) => {
      if (broken) sttFallbackRef.current = true;
      if (voiceOnRef.current) startListening();
    });
  }, [startListening]);

  const toggleVoice = useCallback(() => {
    if (voiceOnRef.current) {
      stopVoice();
      return;
    }
    // iOS: unlock the shared audio element while we're inside the tap gesture
    playerRef.current ??= new VoicePlayer();
    playerRef.current.unlock();
    // prefetch instant-ack audio for this language (plays the moment the
    // user stops talking, while the agent thinks — kills perceived latency)
    const ackLang = languageRef.current;
    if (!ackCacheRef.current[ackLang]?.length) {
      const ACKS: Record<string, string[]> = {
        si: ["හරි, බලන්නම්!", "මං check කරන්නම්!"],
        ta: ["சரி, பார்க்கிறேன்!", "ஒரு நிமிடம்!"],
        en: ["On it — let me check!", "Give me a second!"],
      };
      void Promise.all(
        (ACKS[ackLang] ?? ACKS.en).map((text) =>
          fetch("/api/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, language: ackLang }),
          })
            .then((r) => (r.ok && r.status !== 204 ? r.blob() : null))
            .catch(() => null)
        )
      ).then((blobs) => {
        ackCacheRef.current[ackLang] = blobs.filter(Boolean) as Blob[];
      });
    }
    if (!localStorage.getItem("kapu_mic_ok")) {
      setMicModal(true);
      return;
    }
    beginVoice();
  }, [beginVoice, stopVoice]);

  // Recorder mode (Whisper): VAD auto-fires this on the pause after speech;
  // the "✓ Done" button is the manual backup.
  const finishRecording = useCallback(async () => {
    if (!recorderRef.current || voiceStateRef.current !== "listening") return;
    setVoice("thinking");
    const text = await recorderRef.current.stopAndTranscribe(languageRef.current);
    if (!voiceOnRef.current) return;
    if (text) void sendRef.current(text);
    else startListeningRef.current(); // heard nothing — listen again
  }, [setVoice]);

  useEffect(() => {
    finishRecordingRef.current = finishRecording;
  }, [finishRecording]);

  const interruptSpeech = useCallback(() => {
    // Barge-in: stop playback; the voice loop continues to listening.
    playerRef.current?.stop();
  }, []);

  // ── recent wishes / sessions ──────────────────────────────────────────
  /** taste-engine rail refresh — mount-only fetching left the hero rail
   *  permanently empty (signal accrues DURING the session) */
  const refreshRecs = useCallback(() => {
    try {
      const wishIds = (JSON.parse(localStorage.getItem("kapu_wishes") ?? "[]") as WishMeta[]).map((w) => w.id);
      const ids = [sessionIdRef.current, ...wishIds].slice(0, 12);
      void fetch(`/api/recs?sessions=${encodeURIComponent(ids.join(","))}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => Array.isArray(d?.products) && d.products.length >= 3 && setRecs(d.products))
        .catch(() => {});
    } catch {
      /* fresh device */
    }
  }, []);

  /** the basket is GLOBAL — copy it (server-side) into the session we're entering */
  const carryCart = useCallback((from: string) => {
    void fetch("/api/cart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "import", from, sessionId: sessionIdRef.current }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.cart && setCart(d.cart))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshRecsRef.current = refreshRecs;
  }, [refreshRecs]);

  const newWish = useCallback(() => {
    setNavOpen(false);
    stopVoice();
    const prev = sessionIdRef.current;
    sessionIdRef.current = newSessionId();
    localStorage.setItem("kapu_session", sessionIdRef.current);
    preferredDateRef.current = null;
    setItems([]);
    setCartOpen(false);
    setWishesOpen(false);
    // basket follows the user into the fresh wish
    if (cart.items.length > 0) carryCart(prev);
    else setCart({ items: [], currency });
    refreshRecs();
  }, [currency, stopVoice, cart.items.length, carryCart, refreshRecs]);

  const openWish = useCallback(
    async (id: string) => {
      if (id === sessionIdRef.current) {
        setWishesOpen(false);
        return;
      }
      stopVoice();
      try {
        const res = await fetch(`/api/session?id=${encodeURIComponent(id)}`);
        const snap = (await res.json()) as SessionSnapshot;
        if (!snap.exists || snap.ui.length === 0) {
          // faded (server restarted without Mongo) — drop it honestly
          persistRecents(recents.filter((w) => w.id !== id));
          return;
        }
        const prev = sessionIdRef.current;
        sessionIdRef.current = id;
        localStorage.setItem("kapu_session", id);
        preferredDateRef.current = null;
        setItems(itemsFromUi(snap.ui));
        // global basket: a non-empty current basket follows into this wish;
        // otherwise adopt whatever this wish had
        if (cart.items.length > 0) carryCart(prev);
        else setCart(snap.cart);
        refreshRecs();
        setCartOpen(false);
        setWishesOpen(false);
        setNavOpen(false);
        if (snap.busy) watchBusySession(id);
        else {
          if (busyPollRef.current) clearInterval(busyPollRef.current);
          setBusy(false);
        }
      } catch {
        /* network hiccup — stay on current wish */
      }
    },
    [persistRecents, recents, stopVoice, watchBusySession]
  );

  // ── account (guest ↔ Google) ─────────────────────────────────────────
  const closeWelcome = useCallback(() => {
    localStorage.setItem("kapu_welcome", "1");
    if (!localStorage.getItem("kapu_tour")) setTimeout(() => setTourStep(0), 700);
    setWelcomeOpen(false);
  }, []);

  /** landing CTA: enter the app straight into a real order's live journey
   *  (tour stays unconsumed — it plays on the next visit) */
  const openTrackDemo = useCallback(() => {
    localStorage.setItem("kapu_welcome", "1");
    setWelcomeOpen(false);
    setTrackPrefill("VIMP34456CB2");
    setTrackOpen(true);
  }, []);

  const handleGoogleCredential = useCallback(
    async (credential: string) => {
      try {
        const res = await fetch("/api/auth/google", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ credential }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as { user: AuthProfile; wishes: WishMeta[] };
        setAuthUser(data.user);
        authUserRef.current = data.user;
        localStorage.setItem("kapu_welcome", "1");
        setWelcomeOpen(false);
        let local: WishMeta[] = [];
        try {
          local = JSON.parse(localStorage.getItem("kapu_wishes") ?? "[]") as WishMeta[];
        } catch {
          /* fresh */
        }
        persistRecents(mergeWishLists(local, data.wishes ?? []));
      } catch {
        /* stay guest — the button remains */
      }
    },
    [persistRecents]
  );

  const googleBtnRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el || !GOOGLE_CLIENT_ID) return;
      void renderGoogleButton(el, GOOGLE_CLIENT_ID, (c) => void handleGoogleCredential(c)).catch(() => {});
    },
    [handleGoogleCredential]
  );

  const signOut = useCallback(async () => {
    try {
      await fetch("/api/auth/signout", { method: "POST" });
    } catch {
      /* cookie clear is best-effort */
    }
    gsiSignOutHint();
    setAuthUser(null);
  }, []);

  const avatar = (size: number) =>
    authUser?.picture ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={authUser.picture}
        alt=""
        referrerPolicy="no-referrer"
        className="rounded-full"
        style={{ width: size, height: size }}
      />
    ) : (
      <span
        className="flex items-center justify-center rounded-full bg-leaf-soft text-leaf"
        style={{ width: size, height: size }}
      >
        {authUser?.name ? (
          <span className="text-[12px] font-bold">{authUser.name[0]?.toUpperCase()}</span>
        ) : (
          <IconUser size={Math.round(size * 0.55)} />
        )}
      </span>
    );

  // ── Snap-a-list: camera photo → vision OCR → the agent builds the basket
  const handleScanFile = useCallback(async (file: File) => {
    const seq = ++scanSeqRef.current;
    let preview = "";
    try {
      preview = await fileToCompressedDataUrl(file);
    } catch {
      return;
    }
    if (seq !== scanSeqRef.current) return;
    setScan({ phase: "reading", preview });
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: preview }),
      });
      if (seq !== scanSeqRef.current) return; // cancelled
      const result = (await res.json()) as ScanResult;
      if (!res.ok) {
        setScan({ phase: "unclear", preview, caption: result.error ?? "Aiyo, I couldn't read that — try again?" });
        return;
      }
      const msg = scanMessage(result);
      if (msg) {
        setScan(null);
        void sendRef.current(msg);
      } else {
        setScan({
          phase: "unclear",
          preview,
          caption: result.caption || "අනේ, I couldn't make out a list or product there — try a clearer photo.",
        });
      }
    } catch {
      if (seq === scanSeqRef.current) {
        setScan({ phase: "unclear", preview, caption: "Aiyo, the photo didn't reach me — check your signal and retake." });
      }
    }
  }, []);

  const cancelScan = useCallback(() => {
    scanSeqRef.current++;
    setScan(null);
  }, []);

  const cartCount = cart.items.reduce((n, i) => n + i.quantity, 0);
  const cartSubtotal = cart.items.reduce((s, i) => s + (i.price ?? 0) * i.quantity, 0);
  const empty = items.length === 0;
  const currentTitle = recents.find((w) => w.id === sessionIdRef.current)?.title;
  const todayLabel = useMemo(
    () => new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: "Asia/Colombo" }),
    []
  );

  const saveDeliverTo = useCallback(
    (value?: string) => {
      const v = (value ?? deliverDraft).trim().slice(0, 40);
      setDeliverTo(v);
      localStorage.setItem("kapu_deliver_to", v);
      setDeliverOpen(false);
      setCityOpts([]);
      setCityIdx(-1);
    },
    [deliverDraft]
  );

  // City typeahead — live suggestions from kapruka_list_delivery_cities
  // (canonical deliverable cities + vernacular aliases), debounced 250ms.
  useEffect(() => {
    if (!deliverOpen) return;
    const q = deliverDraft.trim();
    if (q.length < 2) {
      setCityOpts([]);
      setCityIdx(-1);
      return;
    }
    setCityLoading(true);
    const seq = ++cityFetchRef.current;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/cities?q=${encodeURIComponent(q)}`);
        if (seq !== cityFetchRef.current) return; // a newer keystroke superseded us
        const data = (await res.json()) as { cities?: { name: string; hint: string | null }[] };
        setCityOpts(data.cities ?? []);
        setCityIdx(data.cities?.length ? 0 : -1);
      } catch {
        if (seq === cityFetchRef.current) setCityOpts([]);
      } finally {
        if (seq === cityFetchRef.current) setCityLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [deliverDraft, deliverOpen]);

  // ── shared bits ───────────────────────────────────────────────────────

  const langSegment = (size: "sm" | "md" = "md") => (
    <div data-tour="lang" className={`flex rounded-[10px] bg-cream p-[3px] dark:bg-cream-deep ${size === "sm" ? "" : "flex-1"}`}>
      {LANGS.map((l) => (
        <button
          key={l.code}
          onClick={() => {
            setLanguage(l.code);
            localStorage.setItem("kapu_lang", l.code);
          }}
          className={`flex-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition sm:px-2.5 ${
            language === l.code ? "bg-leaf text-white shadow-sm dark:bg-[#402970]" : "text-ink-soft"
          }`}
        >
          {l.label}
        </button>
      ))}
    </div>
  );

  // ── slash commands — type "/" in the composer ──────────────────────
  const setLang = (code: Language) => {
    setLanguage(code);
    localStorage.setItem("kapu_lang", code);
  };
  const slashCommands: { cmd: string; hint: string; run: (arg: string) => void }[] = [
    { cmd: "/new", hint: "New wish · අලුත් පැතුමක්", run: () => newWish() },
    { cmd: "/basket", hint: "Open your basket · බාස්කට් එක", run: () => { setInput(""); setCartOpen(true); } },
    { cmd: "/track", hint: "Track an order · order එක බලන්න", run: () => { setInput(""); setTrackOpen(true); } },
    { cmd: "/fav", hint: "Your favorites ♥ · ප්‍රියතම", run: () => { setInput(""); setFavOpen(true); } },
    { cmd: "/schedule", hint: "Standing wishes — Kapu runs them for you", run: (arg) => { if (arg) { void send(`Schedule this for me: ${arg}`); } else { setInput(""); setSchedOpen(true); } } },
    { cmd: "/deals", hint: "Today's best discounts · අද deals", run: () => void send("Show me today's best discounts and deals — what's worth grabbing?") },
    { cmd: "/gift", hint: "Gift by feeling · හැඟීමට තෑග්ගක්", run: (arg) => void send(arg ? `Help me find a gift: ${arg}` : "Help me pick a thoughtful gift — ask me who it's for and how they're feeling") },
    { cmd: "/voice", hint: "Talk to Kapu 🎙 · කතා කරන්න", run: () => { setInput(""); toggleVoice(); } },
    { cmd: "/scan", hint: "Snap a list or product 📸", run: () => { setInput(""); scanInputRef.current?.click(); } },
    { cmd: "/si", hint: "සිංහලෙන් කතා කරමු", run: () => { setInput(""); setLang("si"); } },
    { cmd: "/ta", hint: "தமிழில் பேசுவோம்", run: () => { setInput(""); setLang("ta"); } },
    { cmd: "/en", hint: "Switch to English", run: () => { setInput(""); setLang("en"); } },
    { cmd: "/dark", hint: "Toggle dark mode 🌙", run: () => { setInput(""); toggleTheme(); } },
    { cmd: "/telegram", hint: tgBot ? `Open @${tgBot.username} on Telegram` : "Kapu on Telegram", run: () => { setInput(""); if (tgBot) window.open(tgBot.link, "_blank"); } },
    { cmd: "/tour", hint: "Replay the welcome tour ✨", run: () => { setInput(""); setTourStep(0); } },
    { cmd: "/help", hint: "What can Kapu do? · Kapu ට මොනවද පුළුවන්?", run: () => void send("What can you do? Give me the quick tour with examples") },
  ];
  const slashActive = /^\/[a-z]*$/i.test(input);
  const slashMatches = slashActive ? slashCommands.filter((c) => c.cmd.startsWith(input.toLowerCase())) : [];
  const submitComposer = () => {
    const v = input.trim();
    if (slashMatches.length > 0) {
      slashMatches[Math.min(slashIdx, slashMatches.length - 1)].run("");
      return;
    }
    if (v.startsWith("/")) {
      const [head, ...rest] = v.split(/\s+/);
      const c = slashCommands.find((x) => x.cmd === head.toLowerCase());
      if (c) {
        c.run(rest.join(" "));
        return;
      }
    }
    void send(input);
  };

  const composer = (opts?: { hero?: boolean }) => (
    <form
      {...(opts?.hero ? { "data-tour": "ask" } : {})}
      className={`relative flex items-center gap-2 rounded-[20px] border-[1.5px] border-edge bg-card p-2 pl-4 ${
        opts?.hero ? "mx-auto w-full max-w-[620px] shadow-[0_12px_40px_rgba(64,41,112,0.1)]" : "shadow-[0_2px_10px_rgba(64,41,112,0.05)]"
      }`}
      onSubmit={(e) => {
        e.preventDefault();
        submitComposer();
      }}
    >
      {slashMatches.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 z-20 mb-2 max-h-[290px] overflow-y-auto overscroll-contain rounded-2xl border border-line bg-card p-1.5 shadow-[0_16px_50px_rgba(64,41,112,0.18)]">
          <p className="px-3 pb-1 pt-1.5 text-[9.5px] font-semibold uppercase tracking-[0.1em] text-ink-faint">Kapu commands</p>
          {slashMatches.map((c, i) => (
            <button
              type="button"
              key={c.cmd}
              onMouseEnter={() => setSlashIdx(i)}
              onClick={() => c.run("")}
              className={`flex w-full items-center gap-3 rounded-[11px] px-3 py-2 text-left transition ${i === slashIdx ? "bg-cream" : ""}`}
            >
              <span className="w-20 shrink-0 font-mono text-[12.5px] font-bold text-leaf">{c.cmd}</span>
              <span className="truncate text-[11.5px] text-ink-soft">{c.hint}</span>
            </button>
          ))}
        </div>
      )}
      <textarea
        ref={opts?.hero ? undefined : inputRef}
        value={input}
        onChange={(e) => {
          setInput(e.target.value);
          setSlashIdx(0);
        }}
        onKeyDown={(e) => {
          if (slashMatches.length > 0) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSlashIdx((i) => (i + 1) % slashMatches.length);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setSlashIdx((i) => (i - 1 + slashMatches.length) % slashMatches.length);
              return;
            }
            if (e.key === "Tab") {
              e.preventDefault();
              setInput(slashMatches[Math.min(slashIdx, slashMatches.length - 1)].cmd + " ");
              return;
            }
            if (e.key === "Escape") {
              setInput("");
              return;
            }
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submitComposer();
          }
        }}
        rows={1}
        disabled={!online}
        placeholder={!online ? t("offlinePlaceholder") : empty ? t("askAnything") : t("replyToKapu")}
        className="max-h-32 flex-1 resize-none bg-transparent py-1.5 text-[14.5px] leading-relaxed outline-none placeholder:text-ink-faint disabled:opacity-50"
      />
      <button
        type="button"
        onClick={() => scanInputRef.current?.click()}
        disabled={!online || busy || scan?.phase === "reading"}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] border-[1.5px] border-cream-deep text-leaf transition active:scale-90 disabled:opacity-40"
        aria-label="Snap a shopping list or product"
        title="Snap a list — Kapu reads it and shops"
        data-tour="scan"
      >
        <IconCamera size={18} />
      </button>
      <button
        type="button"
        onClick={toggleVoice}
        disabled={!online}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] border-[1.5px] border-cream-deep text-leaf transition active:scale-90 disabled:opacity-40"
        aria-label="Talk to Kapu"
        title="Talk to Kapu"
        data-tour="voice"
      >
        <IconMic size={18} />
      </button>
      <button
        type="submit"
        disabled={busy || !input.trim() || !online}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-gold text-ink shadow-[0_4px_12px_rgba(255,184,0,0.4)] transition active:scale-90 disabled:opacity-40 dark:text-[#322b45]"
        aria-label="Send"
      >
        <IconSendUp size={17} />
      </button>
    </form>
  );

  const basketButton = (cls = "") => (
    <button
      onClick={() => setCartOpen((v) => !v)}
      className={`relative flex h-10 w-10 items-center justify-center rounded-full border border-cream-deep bg-card text-ink-soft transition hover:bg-cream hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf/40 active:scale-90 ${cls} ${
        cartPulse ? "scale-110 border-gold" : ""
      }`}
      aria-label="Open basket"
    >
      <IconBasket size={18} />
      {cartCount > 0 && (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[9px] font-bold text-[#322b45]">
          {cartCount}
        </span>
      )}
    </button>
  );

  const recentList = (onPick: (id: string) => void) => (
    <div className="flex flex-col gap-0.5 px-2.5">
      {recents.slice(0, 8).map((w) => {
        const Icon = wishIcon(w.title);
        const active = w.id === sessionIdRef.current;
        return (
          <button
            key={w.id}
            onClick={() => void onPick(w.id)}
            className={`flex items-center gap-2.5 rounded-[11px] px-2.5 py-2 text-left transition ${
              active ? "bg-leaf-soft" : "hover:bg-cream"
            }`}
          >
            <Icon size={17} className={active ? "text-leaf" : "text-ink-soft"} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-medium">{w.title}</span>
              <span className="mt-0.5 block text-[10.5px] text-ink-faint">{timeAgo(w.at)}</span>
            </span>
          </button>
        );
      })}
      {recents.length === 0 && <p className="px-2.5 py-2 text-[11.5px] text-ink-faint">{t("wishesEmpty")}</p>}
    </div>
  );

  // ── render ────────────────────────────────────────────────────────────

  return (
    <LangProvider value={language}>
    <div className="flex h-dvh overflow-hidden">
      {/* ══ Desktop sidebar (first run, collapsible) ══ */}
      {empty && !sideCollapsed && (
        <aside className="hidden w-[264px] shrink-0 flex-col border-r border-cream-deep bg-surface lg:flex">
          <div className="flex items-center gap-2.5 px-5 pb-4 pt-5">
            <KapuMark size={38} radius={12} />
            <div className="min-w-0 flex-1">
              <p className="font-display text-[21px] leading-none text-leaf">Kapu</p>
              <p className="mt-1 text-[10.5px] tracking-[0.02em] text-ink-soft">කපූ · {t("yourWishTree")}</p>
            </div>
            <button
              onClick={() => {
                setSideCollapsed(true);
                localStorage.setItem("kapu_side_collapsed", "1");
              }}
              title={t("collapseSide")}
              aria-label={t("collapseSide")}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] text-ink-faint transition hover:bg-cream hover:text-leaf"
            >
              <IconChevronDown size={9} className="rotate-90" />
            </button>
          </div>
          <div className="px-4">
            <button
              onClick={newWish}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-[14px] bg-gold text-[13.5px] font-semibold text-ink shadow-[0_4px_14px_rgba(255,184,0,0.35)] transition active:scale-[0.98] dark:text-[#322b45]"
            >
              <IconPlus size={14} />
              {t("newWish")}
            </button>
          </div>
          <p className="px-5 pb-2 pt-5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-faint">{t("recentWishes")}</p>
          <div className="flex-1 overflow-y-auto">{recentList((id) => void openWish(id))}</div>
          <div className="flex flex-col gap-0.5 px-2.5 pb-1">
            <button onClick={() => setFavOpen(true)} className="flex items-center gap-2.5 rounded-[11px] px-2.5 py-2 text-left hover:bg-cream">
              <IconHeart size={16} className="text-clay" filled={Object.keys(favs).length > 0} />
              <span className="flex-1 text-[12.5px] font-medium">{t("favorites")}</span>
              {Object.keys(favs).length > 0 && <span className="text-[10.5px] text-ink-faint">{Object.keys(favs).length}</span>}
            </button>
            <button onClick={() => setTrackOpen(true)} className="flex items-center gap-2.5 rounded-[11px] px-2.5 py-2 text-left hover:bg-cream">
              <IconPackage size={16} className="text-ink-soft" />
              <span className="flex-1 text-[12.5px] font-medium">{t("trackOrder")}</span>
            </button>
            <button onClick={() => setSchedOpen(true)} className="flex items-center gap-2.5 rounded-[11px] px-2.5 py-2 text-left hover:bg-cream">
              <IconClock size={16} className="text-ink-soft" />
              <span className="flex-1 text-[12.5px] font-medium">{t("schedules")}</span>
            </button>
          </div>
          <div className="flex flex-col gap-2.5 border-t border-line px-4 py-3.5">
            <button onClick={() => setLangOpen(true)} className="flex items-center gap-2.5 rounded-[11px] text-left">
              {avatar(28)}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-semibold">{authUser?.name ?? t("guest")}</span>
                <span className="block truncate text-[10px] text-ink-faint">
                  {authUser ? t("syncOn") : GOOGLE_CLIENT_ID ? t("syncCta") : t("deviceOnly")}
                </span>
              </span>
              <IconChevronDown size={8} className="shrink-0 -rotate-90 text-ink-faint" />
            </button>
            <div className="flex gap-2">
              {langSegment()}
              <button
                onClick={() => setLangOpen(true)}
                className="flex items-center gap-1.5 rounded-[10px] bg-cream px-3 text-[11px] font-semibold text-leaf dark:bg-cream-deep"
              >
                {currency}
                <IconChevronDown size={8} />
              </button>
            </div>
            <button onClick={toggleTheme} className="flex items-center gap-2 text-[11.5px] font-medium text-ink-soft">
              {dark ? <IconSun size={15} /> : <IconMoon size={15} />}
              {dark ? t("lightMode") : t("darkMode")}
              <span className={`ml-auto h-[18px] w-8 rounded-full p-[2px] transition ${dark ? "bg-leaf" : "bg-edge"}`}>
                <span className={`block h-3.5 w-3.5 rounded-full bg-white shadow transition ${dark ? "translate-x-[14px]" : ""}`} />
              </span>
            </button>
          </div>
        </aside>
      )}

      {/* ══ Desktop icon rail (in conversation, or manually collapsed) ══ */}
      {(!empty || sideCollapsed) && (
        <aside className="hidden w-[68px] shrink-0 flex-col items-center gap-2 border-r border-cream-deep bg-surface py-4 lg:flex">
          <button onClick={newWish} aria-label="Home" className="mb-1">
            <KapuMark size={38} radius={12} />
          </button>
          {empty && (
            <button
              onClick={() => {
                setSideCollapsed(false);
                localStorage.setItem("kapu_side_collapsed", "0");
              }}
              title={t("expandSide")}
              aria-label={t("expandSide")}
              className="flex h-[42px] w-[42px] items-center justify-center rounded-[13px] text-ink-faint transition hover:bg-cream hover:text-leaf active:scale-90"
            >
              <IconChevronDown size={9} className="-rotate-90" />
            </button>
          )}
          <button
            onClick={newWish}
            title="New wish"
            className="flex h-[42px] w-[42px] items-center justify-center rounded-[13px] bg-gold text-ink shadow-[0_4px_12px_rgba(255,184,0,0.35)] transition active:scale-90 dark:text-[#322b45]"
          >
            <IconPlus size={15} />
          </button>
          <button
            onClick={() => setWishesOpen((v) => !v)}
            title="Recent wishes"
            className={`flex h-[42px] w-[42px] items-center justify-center rounded-[13px] transition active:scale-90 ${
              wishesOpen ? "bg-leaf-soft text-leaf" : "text-ink-soft hover:bg-cream"
            }`}
          >
            <IconList size={18} />
          </button>
          <button
            onClick={() => {
              setPanelClosed(false);
              localStorage.setItem("kapu_panel_closed", "0");
              setCartOpen((v) => !v);
            }}
            title="Basket"
            className={`relative flex h-[42px] w-[42px] items-center justify-center rounded-[13px] text-ink-soft transition hover:bg-cream active:scale-90 ${
              cartPulse ? "text-gold" : ""
            }`}
          >
            <IconBasket size={18} />
            {cartCount > 0 && (
              <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[9px] font-bold text-[#322b45]">
                {cartCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setFavOpen(true)}
            title={t("favorites")}
            className="relative flex h-[42px] w-[42px] items-center justify-center rounded-[13px] text-ink-soft transition hover:bg-cream active:scale-90"
          >
            <IconHeart size={17} className="text-clay" filled={Object.keys(favs).length > 0} />
            {Object.keys(favs).length > 0 && (
              <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-clay px-1 text-[9px] font-bold text-white">
                {Object.keys(favs).length}
              </span>
            )}
          </button>
          <button
            onClick={() => setTrackOpen(true)}
            title={t("trackOrder")}
            className="flex h-[42px] w-[42px] items-center justify-center rounded-[13px] text-ink-soft transition hover:bg-cream active:scale-90"
          >
            <IconPackage size={17} />
          </button>
          <button
            onClick={() => setSchedOpen(true)}
            title={t("schedules")}
            className="flex h-[42px] w-[42px] items-center justify-center rounded-[13px] text-ink-soft transition hover:bg-cream active:scale-90"
          >
            <IconClock size={17} />
          </button>
          <div className="flex-1" />
          <button
            onClick={() => setLangOpen(true)}
            title="Language & currency"
            className="flex h-[42px] w-[42px] items-center justify-center rounded-[13px] text-ink-soft transition hover:bg-cream active:scale-90"
          >
            <IconGlobe size={18} />
          </button>
          <button
            onClick={toggleTheme}
            title="Toggle theme"
            className="flex h-[42px] w-[42px] items-center justify-center rounded-[13px] text-ink-soft transition hover:bg-cream active:scale-90"
          >
            {dark ? <IconSun size={17} /> : <IconMoon size={17} />}
          </button>
        </aside>
      )}

      {/* wishes flyout (rail) */}
      {wishesOpen && (!empty || sideCollapsed) && (
        <div className="hidden w-[250px] shrink-0 flex-col border-r border-cream-deep bg-surface py-4 lg:flex">
          <div className="mb-2 flex items-center justify-between px-4">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-faint">{t("recentWishes")}</p>
            <button onClick={() => setWishesOpen(false)} className="text-ink-faint" aria-label="Close">
              <IconClose size={13} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">{recentList((id) => void openWish(id))}</div>
        </div>
      )}

      {/* ══ Main column ══ */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* mobile / desktop headers */}
        <header
          className="sticky top-0 z-20 flex items-center gap-2.5 border-b border-line bg-surface/90 px-4 py-2.5 backdrop-blur"
          style={{ paddingTop: "max(0.625rem, env(safe-area-inset-top))" }}
        >
          <button onClick={() => setNavOpen(true)} className="flex items-center gap-2.5 lg:hidden" aria-label="Menu">
            <KapuMark size={34} radius={11} />
            <span className="text-left leading-tight">
              <span className="font-display block text-[17px] leading-none text-leaf">Kapu</span>
              <span className="mt-0.5 block max-w-[6.5rem] truncate text-[10px] text-ink-soft sm:max-w-40">
                {empty ? `කපූ · ${t("yourWishTree")}` : currentTitle ?? t("yourWishTree")}
              </span>
            </span>
          </button>

          {/* desktop topbar (chat) */}
          <div className="hidden min-w-0 lg:block">
            {!empty ? (
              <>
                <p className="font-display truncate text-[17px] leading-tight">{currentTitle ?? "New wish"}</p>
                <p className="text-[11px] text-ink-soft">
                  {todayLabel} · {LANG_LABEL[language]}
                </p>
              </>
            ) : (
              <>
                <p className="font-display text-[17px] leading-tight">
                  <span className="text-leaf">Kapu</span>{" "}
                  <span className="italic text-ink-soft">— {heroGreeting}</span>
                </p>
                <p className="text-[11px] text-ink-soft">
                  {todayLabel} · {LANG_LABEL[language]}
                </p>
              </>
            )}
          </div>

          <div className="ml-auto flex items-center gap-2">
            {tgBot && (
              <a
                href={tgBot.link}
                target="_blank"
                rel="noreferrer"
                title={`${t("onTelegram")} — @${tgBot.username}`}
                className="flex h-10 items-center gap-1.5 rounded-full bg-gold px-3.5 text-[11.5px] font-bold text-ink shadow-[0_3px_10px_rgba(255,184,0,0.3)] transition hover:-translate-y-0.5 active:scale-95 dark:text-[#322b45]"
              >
                <IconTelegram size={14} />
                <span className="hidden lg:inline">@{tgBot.username}</span>
              </a>
            )}
            {/* deliver-to chip (hidden on small screens until a chat starts) */}
            <div className={`relative ${empty ? "hidden sm:block" : ""}`}>
              <button
                onClick={() => {
                  setDeliverDraft(deliverTo);
                  setDeliverOpen((v) => !v);
                }}
                className="flex h-10 items-center gap-1.5 rounded-full border border-cream-deep bg-card px-3.5 text-[11.5px] font-semibold text-leaf transition hover:bg-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf/40"
              >
                <IconPin size={13} />
                <span className="max-w-28 truncate sm:max-w-40">{deliverTo ? t("deliverToChip", { city: deliverTo }) : t("setCity")}</span>
                <IconChevronDown size={8} />
              </button>
              {deliverOpen && (
                <div className="rise absolute right-0 top-11 z-40 w-72 rounded-2xl border border-line bg-card p-3 shadow-[0_16px_50px_rgba(64,41,112,0.18)]">
                  <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-faint">{t("deliverToLabel")}</p>
                  <div className="flex items-center gap-2 rounded-xl border-[1.5px] border-edge bg-surface px-3 focus-within:border-leaf">
                    <IconPin size={14} className="shrink-0 text-ink-faint" />
                    <input
                      autoFocus
                      value={deliverDraft}
                      onChange={(e) => setDeliverDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "ArrowDown") {
                          e.preventDefault();
                          setCityIdx((i) => (cityOpts.length ? (i + 1) % cityOpts.length : -1));
                        } else if (e.key === "ArrowUp") {
                          e.preventDefault();
                          setCityIdx((i) => (cityOpts.length ? (i - 1 + cityOpts.length) % cityOpts.length : -1));
                        } else if (e.key === "Enter") {
                          e.preventDefault();
                          if (cityIdx >= 0 && cityOpts[cityIdx]) saveDeliverTo(cityOpts[cityIdx].name);
                          else saveDeliverTo();
                        } else if (e.key === "Escape") {
                          setDeliverOpen(false);
                        }
                      }}
                      placeholder={t("cityPlaceholder")}
                      role="combobox"
                      aria-expanded={cityOpts.length > 0}
                      aria-autocomplete="list"
                      className="w-full bg-transparent py-2 text-[13px] outline-none placeholder:text-ink-faint"
                    />
                    {cityLoading && (
                      <span className="flex shrink-0 gap-0.5">
                        <span className="dot h-1 w-1 rounded-full bg-leaf-bright" />
                        <span className="dot h-1 w-1 rounded-full bg-leaf-bright" />
                        <span className="dot h-1 w-1 rounded-full bg-leaf-bright" />
                      </span>
                    )}
                  </div>

                  {/* live Kapruka-deliverable suggestions (canonical + aliases) */}
                  {cityOpts.length > 0 && (
                    <ul className="mt-1.5 max-h-56 overflow-y-auto rounded-xl border border-line bg-surface" role="listbox">
                      {cityOpts.map((c, i) => (
                        <li key={c.name}>
                          <button
                            role="option"
                            aria-selected={i === cityIdx}
                            onMouseEnter={() => setCityIdx(i)}
                            onClick={() => saveDeliverTo(c.name)}
                            className={`flex w-full items-center gap-2.5 px-3 py-2 text-left ${
                              i === cityIdx ? "bg-leaf-soft" : ""
                            }`}
                          >
                            <IconPin size={13} className={i === cityIdx ? "text-leaf" : "text-ink-faint"} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[12.5px] font-semibold">{c.name}</span>
                              {c.hint && <span className="block truncate text-[10.5px] text-ink-faint">also “{c.hint}”</span>}
                            </span>
                            {i === cityIdx && <IconCheck size={12} className="shrink-0 text-leaf" />}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {!cityLoading && deliverDraft.trim().length >= 2 && cityOpts.length === 0 && (
                    <p className="mt-1.5 rounded-xl bg-surface px-3 py-2 text-[11px] text-ink-faint">
                      {t("cityNoMatch")}
                    </p>
                  )}

                  <div className="mt-2 flex items-center justify-end gap-2">
                    {deliverTo && (
                      <button
                        onClick={() => {
                          setDeliverDraft("");
                          setDeliverTo("");
                          localStorage.setItem("kapu_deliver_to", "");
                          setDeliverOpen(false);
                        }}
                        className="rounded-lg px-3 py-1.5 text-[12px] font-semibold text-ink-soft"
                      >
                        {t("clear")}
                      </button>
                    )}
                    <button
                      onClick={() => saveDeliverTo()}
                      className="rounded-lg bg-leaf px-3.5 py-1.5 text-[12px] font-semibold text-white dark:bg-[#402970]"
                    >
                      {t("save")}
                    </button>
                  </div>
                  <p className="mt-2 text-[10.5px] leading-snug text-ink-faint">
                    {t("deliverHelper")}
                  </p>
                </div>
              )}
            </div>

            <button
              onClick={() => {
                setPanelClosed(false);
                localStorage.setItem("kapu_panel_closed", "0");
                setCartOpen((v) => !v);
              }}
              className={`relative flex h-10 w-10 items-center justify-center rounded-full border border-cream-deep bg-card text-ink-soft transition hover:bg-cream hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf/40 active:scale-90 ${
                cartPulse ? "scale-110 border-gold text-gold" : ""
              }`}
              aria-label={t("yourBasket")}
              title={t("yourBasket")}
            >
              <IconBasket size={17} />
              {cartCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[9px] font-bold text-[#322b45]">
                  {cartCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setTrackOpen(true)}
              className="relative flex h-10 w-10 items-center justify-center rounded-full border border-cream-deep bg-card text-ink-soft transition hover:bg-cream hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf/40 active:scale-90 hidden sm:flex"
              aria-label={t("trackOrder")}
              title={t("trackOrder")}
            >
              <IconPackage size={17} />
            </button>
            <button
              onClick={openNotifs}
              className="relative flex h-10 w-10 items-center justify-center rounded-full border border-cream-deep bg-card text-ink-soft transition hover:bg-cream hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf/40 active:scale-90 hidden sm:flex"
              aria-label={t("notifications")}
              title={t("notifications")}
            >
              <IconBell size={17} />
              {notifUnread > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-clay px-1 text-[9px] font-bold text-white">
                  {notifUnread}
                </span>
              )}
            </button>
            <button
              onClick={() => setLangOpen(true)}
              className="hidden h-10 items-center gap-1.5 rounded-full border border-cream-deep bg-card px-3.5 text-[11.5px] font-semibold text-leaf transition hover:bg-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf/40 sm:flex"
              title={t("pricesIn")}
            >
              {currency}
              <IconChevronDown size={8} />
            </button>

            {/* mobile lang pills on first run */}
            {empty && <span className="sm:hidden">{langSegment("sm")}</span>}
            {/* mobile account/sheet entry (language · currency · account) */}
            <button
              onClick={() => setLangOpen(true)}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-cream-deep bg-card transition hover:bg-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf/40 active:scale-90 lg:hidden"
              aria-label="Account, language & currency"
            >
              {avatar(24)}
            </button>
            {basketButton("xl:hidden")}
          </div>
        </header>

        {/* ══ Messages / hero ══ */}
        <main ref={scrollRef} className="relative flex-1 overflow-y-auto">
          {empty ? (
            <div className="relative flex min-h-full flex-col items-center justify-center overflow-hidden px-5 py-8">
              {/* watermark + decorative ring */}
              <span
                aria-hidden
                className="pointer-events-none absolute -right-8 -top-16 select-none text-[210px] font-semibold leading-none text-leaf/[0.045] sm:text-[340px]"
                style={{ fontFamily: "var(--font-sinhala-var), 'Noto Sans Sinhala'" }}
              >
                කපූ
              </span>
              <span aria-hidden className="pointer-events-none absolute -bottom-24 -left-10 h-[380px] w-[380px] rounded-full border-[1.5px] border-leaf/[0.07]" />
              <span aria-hidden className="pointer-events-none absolute left-1/2 top-6 h-[300px] w-[620px] -translate-x-1/2 rounded-full bg-leaf/[0.09] blur-[100px]" />
              <span aria-hidden className="floaty pointer-events-none absolute left-[8%] top-[40%] h-40 w-40 rounded-full bg-gold/[0.05] blur-[60px]" style={{ "--tilt": "0deg", animationDuration: "9s" } as React.CSSProperties} />
              <span aria-hidden className="floaty pointer-events-none absolute right-[10%] top-[18%] h-52 w-52 rounded-full bg-leaf/[0.08] blur-[70px]" style={{ "--tilt": "0deg", animationDuration: "11s", animationDelay: "1.4s" } as React.CSSProperties} />

              <div className="relative w-full max-w-[880px] text-center">
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <span className="inline-flex items-center gap-2 rounded-full bg-leaf-soft px-3.5 py-1.5 text-[10.5px] font-semibold tracking-[0.04em] text-leaf">
                    <span className="h-1.5 w-1.5 rounded-full bg-good" />
                    {t("badgeLive")}
                  </span>
                  {festival && festival.days <= 60 && (
                    <button
                      onClick={() => void send(festival.msg)}
                      className="inline-flex items-center gap-1.5 rounded-full bg-gold-soft px-3.5 py-1.5 text-[10.5px] font-bold tracking-[0.03em] text-gold-deep transition active:scale-95"
                    >
                      <IconGift size={12} />
                      {festival.days === 0
                        ? t("festToday", { name: festival.label })
                        : t("daysTo", { n: `${festival.approx ? "~" : ""}${festival.days}`, name: festival.label.toUpperCase() })}
                      <span className="opacity-70">{t("giftIdeas")}</span>
                    </button>
                  )}
                </div>
                {/* pt + looser leading: Sinhala ascenders overflow the em box
                    and the scroll container clips them at leading-[1.08] */}
                <h1 className="font-display mt-4 pt-2 text-[34px] leading-[1.18] text-ink sm:text-[56px]">
                  <span className="font-semibold text-leaf" style={{ fontFamily: "var(--font-sinhala-var), 'Noto Sans Sinhala'" }}>
                    ආයුබෝවන්
                  </span>
                  , I&apos;m <span className="italic text-leaf">Kapu.</span>
                </h1>
                {seasonal?.festival && seasonal.festival.days <= 45 && (
                  <span aria-hidden className="pointer-events-none absolute inset-x-0 -top-2 mx-auto block h-0 max-w-[860px]">
                    {[...seasonal.festival.glyphs].slice(0, 2).map((g, i) => (
                      <span
                        key={i}
                        className="spark absolute text-[22px] opacity-40"
                        style={{ left: i === 0 ? "2%" : "94%", top: `${i * 26 - 34}px`, animationDelay: `${i * 0.7}s` }}
                      >
                        {g}
                      </span>
                    ))}
                  </span>
                )}
                {seasonal?.festival && (
                  <button
                    onClick={() => void send(seasonal.festival!.msg)}
                    className="rise mx-auto mt-3 block max-w-[560px] rounded-full border border-gold/30 bg-gold-soft px-4 py-1.5 text-[12px] font-semibold text-gold-deep transition hover:-translate-y-0.5"
                  >
                    {t("seasonalIn", { glyph: seasonal.festival.glyphs.slice(0, 2), greet: seasonal.festival.greet, d: `${seasonal.festival.approx ? "~" : ""}${seasonal.festival.days}` })}
                  </button>
                )}
                <HeroTicker
                  language={language}
                  onRun={(ph) => {
                    if (ph.kind === "voice") toggleVoice();
                    else if (ph.kind === "camera") scanInputRef.current?.click();
                    else if (ph.msg) void send(ph.msg);
                  }}
                />

                <div className="mt-7 hidden sm:block">
                  <div className="composer-halo mx-auto max-w-[640px] rounded-[23px] p-[1.5px]">{composer({ hero: true })}</div>
                </div>

                <div data-tour="wishes" className="mt-6 grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3">
                  {DEMO_CHIPS.map((c, i) => (
                    <button
                      key={c.label}
                      onClick={() => void send(c.msg)}
                      className={`group rise relative overflow-hidden rounded-2xl border border-line bg-card p-3.5 text-left shadow-[0_2px_8px_rgba(64,41,112,0.05)] transition-all duration-300 hover:-translate-y-1 hover:border-leaf/40 hover:shadow-[0_14px_36px_rgba(64,41,112,0.16)] active:scale-95 sm:p-4 ${
                        c.mobile ? "" : "hidden sm:block"
                      }`}
                    >
                      <span aria-hidden className="pointer-events-none absolute -right-8 -top-8 h-20 w-20 rounded-full bg-leaf-soft opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-70" />
                      <span className="absolute right-3 top-3.5 translate-x-2 text-leaf opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:opacity-100">
                        <IconArrowRight size={14} />
                      </span>
                      <span
                        className={`flex h-9 w-9 items-center justify-center rounded-[11px] transition-transform duration-300 group-hover:scale-110 ${
                          // diagonal tint pattern — (row+col)%3 so no column ends up monochrome
                          ["bg-leaf-soft text-leaf", "bg-gold-soft text-gold-deep", "bg-clay-soft text-clay"][(i + Math.floor(i / 3)) % 3]
                        }`}
                      >
                        <c.Icon size={18} />
                      </span>
                      <p className="mt-2.5 text-[12.5px] font-semibold leading-snug transition-colors group-hover:text-leaf">{t(c.label)}</p>
                      <p className="mt-0.5 hidden text-[10.5px] text-ink-faint sm:block">{t(c.sub)}</p>
                    </button>
                  ))}
                </div>

                {seasonal && seasonal.products.length > 0 && seasonal.festival && (
                  <div className="mx-auto mt-8 w-full max-w-[1020px] text-left">
                    <ProductGrid
                      title={`${seasonal.festival.glyphs.slice(0, 2)} ${t("seasonalPicks", { name: seasonal.festival.label })}`}
                      products={seasonal.products}
                      actions={actions}
                    />
                  </div>
                )}

                {/* taste-engine picks — appears once this device has real signal */}
                {recs.length >= 4 && (
                  <div className="mx-auto mt-8 w-full max-w-[1020px] text-left">
                    <ProductGrid title={`💜 ${t("forYouT")}`} products={recs} actions={actions} />
                  </div>
                )}

                {/* discover tabs — live bestseller/newest/deals, like kapruka.com's rails */}
                {discover && (
                  <div className="mx-auto mt-8 w-full max-w-[1020px] text-left">
                    <div className="mb-2.5 flex flex-wrap gap-1.5">
                      {(
                        [
                          ["trending", `🔥 ${t("discTrend")}`],
                          ["budget", `💸 ${t("discBudget")}`],
                        ] as const
                      ).map(([k, label]) => (
                        <button
                          key={k}
                          onClick={() => setDiscTab(k)}
                          disabled={discover[k].length === 0}
                          className={`rounded-full px-3.5 py-1.5 text-[11.5px] font-semibold transition active:scale-95 disabled:hidden ${
                            discTab === k ? "bg-leaf text-white dark:bg-[#402970]" : "border border-line bg-card text-ink-soft"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {discover[discTab].length > 0 && <ProductGrid products={discover[discTab]} actions={actions} />}
                  </div>
                )}

                {/* 🏷️ HOT DEALS — the live kapruka.com promotions page, given its own stage */}
                {hotDeals.length >= 4 && (
                  <div className="mx-auto mt-8 w-full max-w-[1020px] rounded-[26px] border border-gold/30 bg-gold-soft/[0.14] p-4 text-left sm:p-5">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <span className="flex h-9 w-9 items-center justify-center rounded-[11px] bg-gold text-ink shadow-[0_4px_12px_rgba(255,184,0,0.35)] dark:text-[#322b45]">
                        🏷️
                      </span>
                      <p className="font-display text-[19px] text-ink">{t("discDeals")}</p>
                      <span className="flex items-center gap-1.5 rounded-full bg-good-soft px-2.5 py-1 text-[9.5px] font-bold uppercase tracking-[0.06em] text-good">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-good" /> {t("dealsLive")}
                      </span>
                      <span className="ml-auto text-[10.5px] text-ink-faint">{hotDeals.length} {t("dealsCount")}</span>
                    </div>
                    {(() => {
                      const cats = [...new Set(hotDeals.map((p) => p.category ?? "More"))].sort();
                      const filtered = dealsCat === "all" ? hotDeals : hotDeals.filter((p) => (p.category ?? "More") === dealsCat);
                      return (
                        <>
                          {cats.length > 1 && (
                            <div className="mb-3 flex flex-wrap gap-1.5">
                              {["all", ...cats].map((c) => (
                                <button
                                  key={c}
                                  onClick={() => {
                                    setDealsCat(c);
                                    setDealsShown(8);
                                  }}
                                  className={`rounded-full px-3 py-1.5 text-[10.5px] font-semibold transition active:scale-95 ${
                                    dealsCat === c
                                      ? "bg-gold text-ink shadow-[0_3px_10px_rgba(255,184,0,0.3)] dark:text-[#322b45]"
                                      : "border border-gold/25 bg-card text-ink-soft"
                                  }`}
                                >
                                  {c === "all" ? t("allDeals") : c}
                                  {c !== "all" && (
                                    <span className="ml-1 opacity-60">{hotDeals.filter((p) => (p.category ?? "More") === c).length}</span>
                                  )}
                                </button>
                              ))}
                            </div>
                          )}
                          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(175px,1fr))]">
                            {filtered.slice(0, dealsShown).map((p) => (
                              <ProductCard key={p.id} p={p} actions={actions} fluid />
                            ))}
                          </div>
                          {dealsShown < filtered.length && (
                            <div ref={dealsSentinelRef} className="flex justify-center py-4">
                              <span className="flex gap-1">
                                <span className="dot h-1.5 w-1.5 rounded-full bg-gold" />
                                <span className="dot h-1.5 w-1.5 rounded-full bg-gold" />
                                <span className="dot h-1.5 w-1.5 rounded-full bg-gold" />
                              </span>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}
                <div className="mt-7 flex flex-col items-center gap-2.5">
                  {tgBot && (
                    <span className="group relative inline-block" data-tour="tg">
                      {/* hover/focus guide — how to start & what Kapu can do in Telegram */}
                      <span className="rise pointer-events-none absolute bottom-full left-1/2 z-30 mb-3 hidden w-[340px] max-w-[86vw] -translate-x-1/2 rounded-[20px] p-4 text-left text-white shadow-[0_24px_70px_rgba(0,0,0,0.5)] group-hover:block group-focus-within:block"
                        style={{ background: "radial-gradient(340px 240px at 50% 0%, #3A2868, #241740)" }}
                      >
                        <span className="flex items-center gap-2.5">
                          <KapuMark size={30} radius={9} />
                          <span>
                            <span className="font-display block text-[16px] leading-tight">
                              {t("tgGuideTitle")} <span className="italic text-gold">@{tgBot.username}</span>
                            </span>
                            <span className="block text-[10.5px] text-white/60">{t("tgGuideTag")}</span>
                          </span>
                        </span>
                        <span className="mt-3 block space-y-1.5 text-[11.5px] leading-snug text-white/85">
                          <span className="block"><span className="text-gold">1.</span> {t("tgStep1")} <b>t.me/{tgBot.username}</b></span>
                          <span className="block"><span className="text-gold">2.</span> {t("tgStep2")} — <i>“machan mata phone ekak ona 60000ට යටින්”</i></span>
                        </span>
                        <span className="mt-3 block space-y-1 border-t border-white/10 pt-2.5 text-[11.5px] leading-snug text-white/85">
                          <span className="block">🎙 {t("tgCanVoice")}</span>
                          <span className="block">📸 {t("tgCanSnap")}</span>
                          <span className="block">👨‍👩‍👧 {t("tgCanGroup")}</span>
                          <span className="block">🎁 {t("tgCanBday")}</span>
                        </span>
                        <span className="mt-3 block rounded-lg bg-white/[0.07] px-2.5 py-1.5 text-[10px] text-white/55">{t("tgFoot")}</span>
                      </span>
                      <a
                        href={tgBot.link}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 rounded-full bg-gold px-4 py-2 text-[12.5px] font-bold text-ink shadow-[0_4px_14px_rgba(255,184,0,0.35)] transition hover:-translate-y-0.5 active:scale-95 dark:text-[#322b45]"
                      >
                        <IconTelegram size={15} />
                        {t("onTelegram")} — @{tgBot.username}
                      </a>
                    </span>
                  )}
                  <p className="text-[11px] text-ink-faint">
                    {t("speaks")}{" "}
                    <strong className="font-semibold text-ink-soft">සිංහල · தமிழ் · English · Tanglish</strong>{" "}
                    {t("poweredBy")}
                  </p>
                  <div className="flex items-center gap-2">
                    <a
                      href="https://www.facebook.com/people/Kapuwashop/61591846257452/"
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Kapu on Facebook"
                      className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-card text-ink-faint transition hover:-translate-y-0.5 hover:text-leaf"
                    >
                      <IconFacebook size={14} />
                    </a>
                    <a
                      href="https://www.instagram.com/kapuwashop"
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Kapu on Instagram"
                      className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-card text-ink-faint transition hover:-translate-y-0.5 hover:text-leaf"
                    >
                      <IconInstagram size={14} />
                    </a>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-4">
              {items.map((item, idx) =>
                item.role === "user" ? (
                  <div
                    key={idx}
                    className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-bubble px-4 py-2.5 text-[14px] leading-relaxed text-white shadow-[0_4px_14px_rgba(64,41,112,0.25)]"
                  >
                    {item.text}
                  </div>
                ) : (
                  <div key={idx} className="flex max-w-full gap-2.5">
                    <span className="mt-1 hidden shrink-0 sm:block">
                      <KapuMark size={28} radius={9} />
                    </span>
                    <div className="min-w-0 flex-1">
                      {item.parts.map((part, pi) =>
                        part.kind === "text" ? (
                          <div
                            key={pi}
                            className={`bubble-md max-w-[95%] rounded-2xl rounded-bl-md border border-line bg-card px-4 py-2.5 text-[14px] leading-relaxed shadow-[0_2px_10px_rgba(64,41,112,0.05)] ${
                              item.streaming && pi === item.parts.length - 1 ? "caret" : ""
                            } ${pi > 0 ? "mt-2" : ""}`}
                          >
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
                          </div>
                        ) : part.kind === "block" ? (
                          <BlockRenderer key={pi} block={part.block} actions={actions} deliverTo={deliverTo || undefined} />
                        ) : (
                          <ErrorCard key={pi} part={part} onRetry={retryLast} busy={busy} />
                        )
                      )}
                      {item.streaming && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {(item.steps ?? []).slice(0, -1).slice(-4).map((st, si) => (
                            <span key={si} className="rise inline-flex items-center gap-1 rounded-full bg-good-soft px-2.5 py-1 text-[10.5px] font-medium text-good">
                              <IconCheck size={8} />
                              {st.replace(/…$/, "")}
                            </span>
                          ))}
                          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-3.5 py-1.5 text-[12px] text-ink-soft shadow-[0_2px_8px_rgba(64,41,112,0.05)]">
                            <span className="flex gap-1">
                              <span className="dot h-1.5 w-1.5 rounded-full bg-leaf-bright" />
                              <span className="dot h-1.5 w-1.5 rounded-full bg-leaf-bright" />
                              <span className="dot h-1.5 w-1.5 rounded-full bg-leaf-bright" />
                            </span>
                            <span>{item.toolLabel ?? (item.steps?.length ? item.steps[item.steps.length - 1] : "Kapu is thinking…")}</span>
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )
              )}
            </div>
          )}

          {/* offline veil */}
          {!online && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-cream/95 px-6 backdrop-blur-sm">
              <div className="w-full max-w-sm overflow-hidden rounded-3xl border border-line bg-card text-center shadow-[0_20px_60px_rgba(64,41,112,0.15)]">
                <div className="px-6 pb-5 pt-8">
                  <div className="relative mx-auto w-fit opacity-90 grayscale">
                    <KapuMark size={64} radius={20} />
                    <span className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full border border-line bg-card text-clay shadow">
                      <IconWifiOff size={13} />
                    </span>
                  </div>
                  <p className="font-display mt-4 text-[22px]">
                    {t("napping")} <span className="italic text-leaf">{t("offline")}</span>
                  </p>
                  <p className="mt-2 text-[12.5px] leading-relaxed text-ink-soft">
                    <span style={{ fontFamily: "var(--font-sinhala-var), 'Noto Sans Sinhala'" }}>{t("noWorries")}</span>{" "}
                    {t("offlineBody")}
                  </p>
                </div>
                {cartCount > 0 && (
                  <div className="border-t border-line bg-surface px-5 py-3.5">
                    <div className="flex items-center gap-2.5 rounded-[13px] border border-line bg-card px-3.5 py-2.5">
                      <IconBasket size={15} className="text-leaf" />
                      <p className="text-[12px] font-semibold">
                        {t("itemsWaiting", { n: cartCount === 1 ? t("item1") : t("itemsN", { n: cartCount }), total: fmt(cartSubtotal, cart.currency) })}
                      </p>
                      <span className="ml-auto rounded-md bg-cream px-2 py-0.5 text-[9px] font-bold tracking-[0.06em] text-ink-faint">
                        {t("savedTag")}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </main>

        {/* ══ Composer ══ */}
        <footer
          className="sticky bottom-0 z-20 border-t border-line bg-cream/90 px-4 py-3 backdrop-blur"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          <div className={`mx-auto w-full max-w-3xl ${empty ? "sm:hidden" : ""}`}>{composer()}</div>
        </footer>
      </div>

      {/* ══ Live basket panel (desktop xl, in conversation, only with items) ══ */}
      {!empty && cartCount > 0 && !panelClosed && (
        <aside className="hidden w-[300px] shrink-0 flex-col border-l border-cream-deep bg-surface xl:flex">
          <div className="flex items-center gap-2.5 border-b border-line px-4 py-3.5">
            <IconBasket size={16} className="text-leaf" />
            <p className="font-display text-[16px]">{t("yourBasket")}</p>
            <span className="ml-auto rounded-full bg-leaf-soft px-2.5 py-0.5 text-[10.5px] font-semibold text-leaf">
              {cartCount === 1 ? t("item1") : t("itemsN", { n: cartCount })}
            </span>
            <button
              onClick={() => {
                setPanelClosed(true);
                localStorage.setItem("kapu_panel_closed", "1");
              }}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-line bg-card text-ink-soft"
              aria-label="Collapse basket panel"
            >
              <IconClose size={11} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto pb-3">
            <CartView cart={cart} actions={actions} compact deliverTo={deliverTo || undefined} />
            {cartCount > 0 && (
              <div className="mt-1 flex flex-wrap gap-2 px-3">
                <button
                  onClick={() => void send("Anything I forgot for this basket?")}
                  className="rounded-full border border-edge bg-card px-3 py-1.5 text-[11.5px] font-medium text-ink"
                >
                  {t("forgotChip")}
                </button>
              </div>
            )}
          </div>
        </aside>
      )}

      {/* ══ Mobile nav drawer — the collapsed sidebar ══ */}
      {navOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setNavOpen(false)}>
          <div className="absolute inset-0 bg-[#1d1233]/40 backdrop-blur-[2px]" />
          <div
            className="drawer-in-l absolute bottom-0 left-0 top-0 flex w-[290px] max-w-[85vw] flex-col bg-surface shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
          >
            <div className="flex items-center gap-2.5 px-4 pb-3">
              <KapuMark size={34} radius={11} />
              <div className="min-w-0 flex-1">
                <p className="font-display text-[18px] leading-none text-leaf">Kapu</p>
                <p className="mt-1 truncate text-[10px] text-ink-soft">කපූ · {t("yourWishTree")}</p>
              </div>
              <button
                onClick={() => setNavOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-card text-ink-soft"
                aria-label="Close menu"
              >
                <IconClose size={12} />
              </button>
            </div>
            <div className="px-3.5">
              <button
                onClick={newWish}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-[14px] bg-gold text-[13.5px] font-semibold text-ink shadow-[0_4px_14px_rgba(255,184,0,0.35)] transition active:scale-[0.98] dark:text-[#322b45]"
              >
                <IconPlus size={14} />
                {t("newWish")}
              </button>
            </div>
            <p className="px-4 pb-2 pt-5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-faint">{t("recentWishes")}</p>
            <div className="flex-1 overflow-y-auto">{recentList((id) => void openWish(id))}</div>
            <div className="flex flex-col gap-0.5 px-2.5 pb-1">
              <button onClick={() => { setNavOpen(false); setFavOpen(true); }} className="flex items-center gap-2.5 rounded-[11px] px-2.5 py-2 text-left">
                <IconHeart size={16} className="text-clay" filled={Object.keys(favs).length > 0} />
                <span className="flex-1 text-[12.5px] font-medium">{t("favorites")}</span>
                {Object.keys(favs).length > 0 && <span className="text-[10.5px] text-ink-faint">{Object.keys(favs).length}</span>}
              </button>
              <button onClick={() => { setNavOpen(false); setTrackOpen(true); }} className="flex items-center gap-2.5 rounded-[11px] px-2.5 py-2 text-left">
                <IconPackage size={16} className="text-ink-soft" />
                <span className="flex-1 text-[12.5px] font-medium">{t("trackOrder")}</span>
              </button>
              <button onClick={() => { setNavOpen(false); setSchedOpen(true); }} className="flex items-center gap-2.5 rounded-[11px] px-2.5 py-2 text-left">
                <IconClock size={16} className="text-ink-soft" />
                <span className="flex-1 text-[12.5px] font-medium">{t("schedules")}</span>
              </button>
              <button onClick={() => { setNavOpen(false); openNotifs(); }} className="flex items-center gap-2.5 rounded-[11px] px-2.5 py-2 text-left">
                <IconBell size={16} className="text-ink-soft" />
                <span className="flex-1 text-[12.5px] font-medium">{t("notifications")}</span>
                {notifUnread > 0 && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-clay px-1 text-[9px] font-bold text-white">{notifUnread}</span>
                )}
              </button>
            </div>
            <div
              className="flex flex-col gap-2.5 border-t border-line px-4 py-3.5"
              style={{ paddingBottom: "max(0.875rem, env(safe-area-inset-bottom))" }}
            >
              <button
                onClick={() => {
                  setNavOpen(false);
                  setLangOpen(true);
                }}
                className="flex items-center gap-2.5 text-left"
              >
                {avatar(28)}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-semibold">{authUser?.name ?? t("guest")}</span>
                  <span className="block truncate text-[10px] text-ink-faint">
                    {authUser ? t("syncOn") : GOOGLE_CLIENT_ID ? t("syncCta") : t("deviceOnly")}
                  </span>
                </span>
                <IconChevronDown size={8} className="shrink-0 -rotate-90 text-ink-faint" />
              </button>
              <div className="flex gap-2">
                {langSegment()}
                <button
                  onClick={() => {
                    setNavOpen(false);
                    setLangOpen(true);
                  }}
                  className="flex items-center gap-1.5 rounded-[10px] bg-cream px-3 text-[11px] font-semibold text-leaf dark:bg-cream-deep"
                >
                  {currency}
                  <IconChevronDown size={8} />
                </button>
              </div>
              <button onClick={toggleTheme} className="flex items-center gap-2 text-[11.5px] font-medium text-ink-soft">
                {dark ? <IconSun size={15} /> : <IconMoon size={15} />}
                {dark ? t("lightMode") : t("darkMode")}
                <span className={`ml-auto h-[18px] w-8 rounded-full p-[2px] transition ${dark ? "bg-leaf" : "bg-edge"}`}>
                  <span className={`block h-3.5 w-3.5 rounded-full bg-white shadow transition ${dark ? "translate-x-[14px]" : ""}`} />
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ Basket drawer / bottom sheet ══ */}
      {cartOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setCartOpen(false)}>
          <div className="absolute inset-0 bg-[#1d1233]/40 backdrop-blur-[2px]" />
          {/* desktop slide-over */}
          <div
            className="drawer-in absolute bottom-0 right-0 top-0 hidden w-full max-w-[400px] flex-col bg-surface shadow-2xl sm:flex"
            onClick={(e) => e.stopPropagation()}
            style={{ paddingTop: "max(0px, env(safe-area-inset-top))" }}
          >
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 px-5 py-4">
              <p className="font-display text-[20px]">{t("yourBasket")}</p>
              {cartCount > 0 && (
                <span className="rounded-full bg-leaf-soft px-2.5 py-0.5 text-[10.5px] font-semibold text-leaf">{cartCount === 1 ? t("item1") : t("itemsN", { n: cartCount })}</span>
              )}
              <button
                onClick={() => setCartOpen(false)}
                className="ml-auto flex h-9 w-9 items-center justify-center rounded-full border border-line bg-card text-ink-soft"
                aria-label="Close basket"
              >
                <IconClose size={13} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto pb-4">
              <CartView cart={cart} actions={actions} compact deliverTo={deliverTo || undefined} />
              {cartCount > 0 && (
                <div className="mt-1 flex flex-wrap gap-2 px-3">
                  <button
                    onClick={() => void send("Anything I forgot for this basket?")}
                    className="rounded-full border border-edge bg-card px-3 py-1.5 text-[11.5px] font-medium text-ink"
                  >
                    {t("forgotChip")}
                  </button>
                </div>
              )}
            </div>
          </div>
          {/* mobile bottom sheet */}
          <div
            className="sheet-in absolute bottom-0 left-0 right-0 flex max-h-[82dvh] flex-col rounded-t-[24px] bg-surface shadow-2xl sm:hidden"
            onClick={(e) => e.stopPropagation()}
            style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
          >
            <span className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-cream-deep" />
            <div className="flex items-center gap-2.5 px-5 py-3">
              <p className="font-display text-[19px]">{t("yourBasket")}</p>
              {cartCount > 0 && (
                <span className="rounded-full bg-leaf-soft px-2.5 py-0.5 text-[10.5px] font-semibold text-leaf">{cartCount === 1 ? t("item1") : t("itemsN", { n: cartCount })}</span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto pb-2">
              <CartView cart={cart} actions={actions} compact deliverTo={deliverTo || undefined} />
            </div>
          </div>
        </div>
      )}

      {/* ══ Language & currency popover / sheet ══ */}
      {langOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setLangOpen(false)}>
          <div className="absolute inset-0 bg-[#1d1233]/40 backdrop-blur-[2px]" />
          <div
            className="sheet-in absolute bottom-0 left-0 right-0 max-h-[86dvh] overflow-y-auto rounded-t-[24px] bg-surface p-4 shadow-2xl sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[640px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[24px]"
            onClick={(e) => e.stopPropagation()}
            style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
          >
            <span className="mx-auto mb-2 block h-1 w-10 rounded-full bg-cream-deep sm:hidden" />
            <div className="sticky -top-4 z-10 -mx-4 -mt-2 mb-1 flex justify-end bg-gradient-to-b from-surface via-surface/90 to-transparent px-3 pb-2 pt-2">
              <button
                onClick={() => setLangOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-card text-ink-soft shadow-sm"
                aria-label="Close"
              >
                <IconClose size={12} />
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-line bg-card p-4">
                <p className="font-display text-[17px]">{t("repliesIn")}</p>
                <div className="mt-3 flex flex-col gap-2">
                  {LANGS.map((l) => {
                    const active = language === l.code;
                    return (
                      <button
                        key={l.code}
                        onClick={() => {
                          setLanguage(l.code);
                          localStorage.setItem("kapu_lang", l.code);
                        }}
                        className={`flex items-center gap-3 rounded-[14px] border p-3 text-left transition ${
                          active ? "border-leaf bg-leaf-soft/60" : "border-line bg-surface"
                        }`}
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-leaf text-[12px] font-bold text-white dark:bg-[#402970]">
                          {l.label}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-semibold">{l.name}</span>
                          <span className="block text-[11px] text-ink-soft">{l.sub}</span>
                        </span>
                        {active && <IconCheck size={14} className="shrink-0 text-leaf" />}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-3 border-t border-line pt-2.5 text-[11px] leading-snug text-ink-faint">
                  {t("voiceNote")} <em className="font-display">&ldquo;reply in Tamil&rdquo;</em> {t("switchInstant")}
                </p>
              </div>
              <div className="rounded-2xl border border-line bg-card p-4">
                <p className="font-display text-[17px]">{t("pricesIn")}</p>
                <div className="mt-3 flex flex-col">
                  {CURRENCIES.map((c) => {
                    const active = currency === c.code;
                    return (
                      <button
                        key={c.code}
                        onClick={() => {
                          setCurrency(c.code);
                          localStorage.setItem("kapu_currency", c.code);
                        }}
                        className={`flex items-center gap-3 border-b border-line px-2 py-2.5 text-left last:border-b-0 ${
                          active ? "rounded-xl bg-leaf-soft/60" : ""
                        }`}
                      >
                        <span className="w-10 text-[12px] font-bold text-leaf">{c.code}</span>
                        <span className="flex-1 text-[13px] font-semibold">{c.name}</span>
                        {active && <IconCheck size={14} className="text-leaf" />}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-3 border-t border-line pt-2.5 text-[11px] leading-snug text-ink-faint">
                  {t("sendingAbroad")}
                </p>
              </div>
            </div>

            {/* Kapu on Telegram — chat, voice notes, family groups */}
            {tgBot && (
              <div className="mt-3 flex items-center gap-3 rounded-2xl border border-line bg-card p-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-leaf-soft text-leaf">
                  <IconTelegram size={19} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-semibold">{t("tgTitle")} · @{tgBot.username}</p>
                  <p className="mt-0.5 text-[11px] leading-snug text-ink-soft">{t("tgBlurb")}</p>
                </div>
                <a
                  href={tgBot.link}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 rounded-[11px] bg-leaf px-4 py-2 text-[12px] font-semibold text-white transition active:scale-95 dark:bg-[#402970]"
                >
                  {t("open")}
                </a>
              </div>
            )}

            {/* My Kapu — standing rules (the honest "make your own agent") */}
            <div className="mt-3 rounded-2xl border border-line bg-card p-4">
              <p className="font-display text-[17px]">{t("myKapu")}</p>
              <textarea
                value={rules}
                onChange={(e) => setRules(e.target.value.slice(0, 300))}
                onBlur={() => {
                  localStorage.setItem("kapu_rules", rules.trim());
                  setRulesFlash(true);
                  setTimeout(() => setRulesFlash(false), 1500);
                }}
                rows={2}
                placeholder={t("rulesPlaceholder")}
                className="mt-2.5 w-full resize-none rounded-[13px] border-[1.5px] border-edge bg-surface px-3.5 py-2.5 text-[13px] leading-relaxed outline-none focus:border-leaf"
              />
              <div className="mt-1.5 flex items-center justify-between">
                <p className="text-[10.5px] leading-snug text-ink-faint">{t("rulesHint")}</p>
                <span className={`shrink-0 text-[10.5px] font-semibold text-good transition-opacity ${rulesFlash ? "opacity-100" : "opacity-0"}`}>
                  ✓ {t("rulesSaved")}
                </span>
              </div>
            </div>

            {/* continue on your phone — QR handoff */}
            <div className="mt-3 flex items-center gap-4 rounded-2xl border border-line bg-card p-4">
              <QrTile size={104} />
              <div className="min-w-0 flex-1">
                <p className="font-display text-[16px]">📱 {t("qrTitle")}</p>
                <p className="mt-1.5 text-[11px] leading-relaxed text-ink-soft">{t("qrHint")}</p>
              </div>
            </div>

            {/* account — guest by default, Google to sync wishes */}
            <div className="mt-3 rounded-2xl border border-line bg-card p-4">
              {authUser ? (
                <div className="flex items-center gap-3">
                  {avatar(40)}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold">{authUser.name ?? "Kapruka shopper"}</p>
                    {authUser.email && <p className="truncate text-[11.5px] text-ink-soft">{authUser.email}</p>}
                    <p className="mt-0.5 flex items-center gap-1.5 text-[11px] font-medium text-good">
                      <IconCheck size={10} />
                      {t("syncOn")}
                    </p>
                  </div>
                  <button
                    onClick={() => void signOut()}
                    className="shrink-0 rounded-[11px] border border-edge px-3.5 py-2 text-[12px] font-semibold text-ink-soft transition active:scale-95"
                  >
                    {t("signOut")}
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-display text-[17px]">{t("wishesEverywhere")}</p>
                    <p className="mt-0.5 text-[11.5px] leading-snug text-ink-soft">
                      {t("guestBrowsing")}
                    </p>
                  </div>
                  {GOOGLE_CLIENT_ID ? (
                    <div ref={googleBtnRef} className="min-h-[44px] shrink-0" />
                  ) : process.env.NODE_ENV !== "production" ? (
                    <p className="shrink-0 rounded-[11px] bg-gold-soft px-3 py-2 text-[11px] leading-snug text-gold-deep">
                      Paste NEXT_PUBLIC_GOOGLE_CLIENT_ID into .env
                      <br />
                      and restart — the Google button appears here.
                    </p>
                  ) : (
                    <p className="shrink-0 rounded-[11px] bg-surface px-3 py-2 text-[11px] text-ink-faint">
                      {t("guestModeNote")}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══ Product detail modal ══ */}
      {productOpen && (
        <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center" onClick={() => setProductOpen(null)}>
          <div className="absolute inset-0 bg-[#1d1233]/50 backdrop-blur-[2px]" />
          <div
            className="sheet-in relative max-h-[90dvh] w-full overflow-y-auto rounded-t-[24px] bg-cream p-3 sm:max-w-2xl sm:rounded-[24px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 flex items-center justify-between px-1">
              <p className="font-display text-[17px]">{productOpen.name.slice(0, 40)}</p>
              <button
                onClick={() => setProductOpen(null)}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-card text-ink-soft"
                aria-label="Close"
              >
                <IconClose size={12} />
              </button>
            </div>
            {productDetail ? (
              <ProductHero product={productDetail} deliverTo={deliverTo || undefined} actions={actions} />
            ) : (
              <div className="skeleton my-2 h-72 rounded-2xl" />
            )}
            {productExtras && (productExtras.rating || productExtras.installments.length > 0 || productExtras.qa.length > 0) && (
              <div className="mt-1 rounded-2xl border border-line bg-card p-3.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  {productExtras.rating && (
                    <span className="flex items-center gap-1 text-[13.5px] font-semibold text-ink">
                      <span className="text-gold">★</span> {productExtras.rating.value.toFixed(1)}
                      {productExtras.rating.count > 0 && (
                        <span className="font-normal text-ink-faint">· {t("reviewsN", { n: productExtras.rating.count })}</span>
                      )}
                    </span>
                  )}
                  {productExtras.partner && (
                    <span className="text-[11.5px] text-ink-soft">
                      🤝 Kapruka Partner: <b>{productExtras.partner}</b>
                    </span>
                  )}
                  <span className="ml-auto text-[9px] uppercase tracking-[0.1em] text-ink-faint">{t("extrasSrc")}</span>
                </div>
                {productExtras.installments.length > 0 && (
                  <>
                    <p className="mt-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-faint">{t("extrasPay")}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {productExtras.installments.map((ins, ii) => (
                        <span key={ii} className="rounded-[11px] border border-line bg-surface px-2.5 py-1.5 text-[11px]">
                          <b className="price-serif text-[13.5px]">{fmt(ins.monthly, "LKR")}</b>
                          <span className="text-ink-soft">/mo × {ins.months}</span>
                          {ins.provider && <span className="ml-1.5 text-[9.5px] font-bold uppercase text-leaf">{ins.provider}</span>}
                        </span>
                      ))}
                    </div>
                  </>
                )}
                {productExtras.qa.length > 0 && (
                  <details className="mt-2.5">
                    <summary className="cursor-pointer text-[11.5px] font-semibold text-leaf">
                      {t("extrasQA")} ({productExtras.qa.length})
                    </summary>
                    <div className="mt-1.5 space-y-1.5">
                      {productExtras.qa.map((x) => (
                        <div key={x.q} className="rounded-[10px] bg-surface p-2.5">
                          <p className="text-[11.5px] font-semibold leading-snug">{x.q}</p>
                          <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">{x.a}</p>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
            {productSimilar.length >= 3 && (
              <div className="mt-2">
                <ProductGrid title={`✨ ${t("moreLikeThis")}`} products={productSimilar} actions={actions} />
              </div>
            )}
            <button
              onClick={() => void send(`Tell me more about "${productOpen.name}" (${productOpen.id}) — is it a good pick?`)}
              className="mt-1 w-full rounded-[13px] border border-edge bg-card py-2.5 text-[13px] font-semibold text-leaf transition active:scale-[0.99]"
            >
              🌳 {t("askKapu")}
            </button>
          </div>
        </div>
      )}

      {/* ══ Favorites sheet ══ */}
      {favOpen && (
        <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center" onClick={() => setFavOpen(false)}>
          <div className="absolute inset-0 bg-[#1d1233]/50 backdrop-blur-[2px]" />
          <div className="sheet-in relative max-h-[85dvh] w-full overflow-y-auto rounded-t-[24px] bg-surface p-4 sm:max-w-md sm:rounded-[24px]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center gap-2">
              <IconHeart size={17} className="text-clay" filled />
              <p className="font-display text-[18px]">{t("favorites")}</p>
              <button onClick={() => setFavOpen(false)} className="ml-auto flex h-8 w-8 items-center justify-center rounded-full border border-line bg-card text-ink-soft" aria-label="Close">
                <IconClose size={12} />
              </button>
            </div>
            {Object.keys(favs).length === 0 ? (
              <p className="py-8 text-center text-[13px] text-ink-soft">{t("favEmpty")}</p>
            ) : (
              <>
                <ul className="flex flex-col gap-2">
                  {Object.values(favs).map((f) => (
                    <li key={f.id} className="flex items-center gap-3 rounded-[14px] border border-line bg-card p-2.5">
                      <button onClick={() => { setFavOpen(false); openProduct(f); }} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                        <ProductImage src={f.image} alt={f.name} category={f.category} className="h-11 w-11 shrink-0 rounded-[10px]" width={120} iconSize={18} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] font-semibold">{f.name}</span>
                          <span className="price-serif block text-[13px]">{fmt(f.price, f.currency)}</span>
                        </span>
                      </button>
                      <button
                        onClick={() => actions.onCartAdd(f)}
                        className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-gold text-ink shadow-sm active:scale-90 dark:text-[#322b45]"
                        aria-label={`Add ${f.name}`}
                      >
                        <IconPlus size={13} />
                      </button>
                      <button onClick={() => toggleFav(f)} className="text-clay" aria-label="Remove favorite">
                        <IconHeart size={16} filled />
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  onClick={buildFromFavs}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-[13px] bg-gold py-3 text-[13.5px] font-bold text-ink shadow-[0_6px_18px_rgba(255,184,0,0.35)] transition active:scale-[0.99] dark:text-[#322b45]"
                >
                  🧺 {t("buildFromFavs")}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ══ Track order modal ══ */}
      {trackOpen && (
        <TrackModal
          onClose={() => {
            setTrackOpen(false);
            setTrackPrefill(null);
          }}
          actions={actions}
          recentOrders={recentOrders}
          tracked={tracked}
          onTracked={rememberTracked}
          initial={trackPrefill}
        />
      )}

      {/* ══ Schedules — standing wishes (auth-gated) ══ */}
      {schedOpen && (
        <SchedulesSheet
          onClose={() => setSchedOpen(false)}
          signedIn={Boolean(authUser)}
          tgBot={tgBot?.username ?? null}
          onAsk={(msg) => void send(msg)}
          onSignIn={() => {
            setSchedOpen(false);
            setLangOpen(true);
          }}
        />
      )}

      {/* ══ Notification panel ══ */}
      {notifOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setNotifOpen(false)}>
          <div className="absolute inset-0 bg-[#1d1233]/30" />
          <div
            className="sheet-in absolute bottom-0 left-0 right-0 max-h-[70dvh] overflow-y-auto rounded-t-[24px] bg-surface p-4 sm:bottom-auto sm:left-auto sm:right-6 sm:top-16 sm:w-[380px] sm:rounded-[20px] sm:shadow-[0_20px_60px_rgba(64,41,112,0.25)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center gap-2">
              <IconBell size={16} className="text-leaf" />
              <p className="font-display text-[17px]">{t("notifTitle")}</p>
              <button onClick={() => setNotifOpen(false)} className="ml-auto flex h-7 w-7 items-center justify-center rounded-full border border-line bg-card text-ink-soft" aria-label="Close">
                <IconClose size={11} />
              </button>
            </div>
            {notifItems.length === 0 ? (
              <p className="py-6 text-center text-[12.5px] text-ink-soft">{t("notifEmpty")}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {notifItems.map((n) => (
                  <li key={n.key} className="flex items-center gap-3 rounded-[14px] border border-line bg-card p-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-leaf-soft text-leaf">
                      {n.icon === "cake" ? <IconCake size={17} /> : n.icon === "gift" ? <IconGift size={17} /> : <IconPackage size={17} />}
                    </span>
                    <p className="min-w-0 flex-1 text-[12.5px] font-medium leading-snug">{n.text}</p>
                    <button
                      onClick={() => {
                        setNotifOpen(false);
                        n.run();
                      }}
                      className="shrink-0 rounded-[10px] bg-leaf px-3 py-1.5 text-[11.5px] font-semibold text-white active:scale-95 dark:bg-[#402970]"
                    >
                      {n.actionLabel}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* hidden camera input — native capture sheet, zero permission drama */}
      <input
        ref={scanInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = ""; // allow re-choosing the same photo
          if (f) void handleScanFile(f);
        }}
      />

      {/* ══ Snap-a-list overlay — reading / unclear states ══ */}
      {scan && (
        <div className="fixed inset-x-0 bottom-24 z-40 flex justify-center px-4">
          <div className="sheet-in flex w-full max-w-sm items-center gap-3 rounded-2xl border border-line bg-card p-3 shadow-[0_16px_50px_rgba(64,41,112,0.25)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={scan.preview} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
            <div className="min-w-0 flex-1">
              {scan.phase === "reading" ? (
                <>
                  <p className="flex items-center gap-2 text-[13px] font-semibold">
                    <IconCamera size={14} className="text-leaf" />
                    {t("readingPhoto")}
                  </p>
                  <p className="mt-0.5 flex items-center gap-2 text-[11.5px] text-ink-soft">
                    <span className="flex gap-1">
                      <span className="dot h-1 w-1 rounded-full bg-leaf-bright" />
                      <span className="dot h-1 w-1 rounded-full bg-leaf-bright" />
                      <span className="dot h-1 w-1 rounded-full bg-leaf-bright" />
                    </span>
                    {t("holdOn")}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-[13px] font-semibold text-clay">{t("cantRead")}</p>
                  <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-ink-soft">{scan.caption}</p>
                </>
              )}
            </div>
            {scan.phase === "reading" ? (
              <button onClick={cancelScan} className="shrink-0 rounded-[11px] border border-edge px-3 py-1.5 text-[12px] font-semibold text-ink-soft">
                {t("cancel")}
              </button>
            ) : (
              <div className="flex shrink-0 flex-col gap-1.5">
                <button
                  onClick={() => {
                    cancelScan();
                    scanInputRef.current?.click();
                  }}
                  className="rounded-[11px] bg-leaf px-3 py-1.5 text-[12px] font-semibold text-white dark:bg-[#402970]"
                >
                  {t("retake")}
                </button>
                <button onClick={cancelScan} className="rounded-[11px] border border-edge px-3 py-1.5 text-[12px] font-semibold text-ink-soft">
                  {t("close")}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ Welcome gate — first visit only: Google or guest, one tap ══ */}
      {tourStep >= 0 && !welcomeOpen && (
        <TourOverlay
          step={tourStep}
          onStep={setTourStep}
          onClose={() => {
            setTourStep(-1);
            localStorage.setItem("kapu_tour", "1");
          }}
        />
      )}

      {welcomeOpen && sessionReady && (
        <div className="fixed inset-0 z-[55] overflow-y-auto bg-cream">
          <button
            onClick={toggleTheme}
            title={dark ? t("lightMode") : t("darkMode")}
            aria-label={dark ? t("lightMode") : t("darkMode")}
            className="fixed right-4 top-4 z-[2] flex h-10 w-10 items-center justify-center rounded-full border border-edge bg-card text-ink-soft shadow-sm transition hover:-translate-y-0.5 hover:text-leaf"
            style={{ top: "max(1rem, env(safe-area-inset-top))" }}
          >
            {dark ? <IconSun size={16} /> : <IconMoon size={16} />}
          </button>
          <span
            aria-hidden
            className="pointer-events-none absolute -right-10 -top-16 select-none text-[240px] font-semibold leading-none text-leaf/[0.05] sm:text-[340px]"
            style={{ fontFamily: "var(--font-sinhala-var), 'Noto Sans Sinhala'" }}
          >
            කපූ
          </span>
          <div className="relative flex min-h-[94dvh] items-center px-6 py-12">
            <div className="mx-auto grid w-full max-w-6xl items-center gap-10 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
            <KapuMark size={64} radius={20} />
            <h1 className="font-display mt-5 text-[30px] leading-tight text-ink sm:text-[42px]">
              <span className="font-semibold text-leaf" style={{ fontFamily: "var(--font-sinhala-var), 'Noto Sans Sinhala'" }}>
                ආයුබෝවන්!
              </span>{" "}
              I&apos;m <span className="italic text-leaf">Kapu.</span>
            </h1>
            <p className="mx-auto mt-3 max-w-[400px] text-[13.5px] leading-relaxed text-ink-soft">
              {t("welcomeSub")}{" "}
              <strong className="font-semibold text-ink">සිංහල · தமிழ் · English · Tanglish.</strong>
            </p>

            <LandingTicker language={language} />
            <div className="mt-6 flex w-full max-w-[320px] flex-col items-stretch gap-3">
              {GOOGLE_CLIENT_ID ? (
                <div className="w-full overflow-hidden rounded-full" style={{ colorScheme: "light" }}>
                  <div ref={googleBtnRef} className="flex min-h-[44px] justify-center" />
                </div>
              ) : process.env.NODE_ENV !== "production" ? (
                <div>
                  <button
                    disabled
                    className="flex w-full items-center justify-center gap-2.5 rounded-full border border-edge bg-card py-3 text-[13.5px] font-semibold text-ink-faint"
                  >
                    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden>
                      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92a8.78 8.78 0 0 0 2.68-6.62Z" />
                      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
                      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3-2.33Z" />
                      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59A9 9 0 0 0 .96 4.95l3 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
                    </svg>
                    Continue with Google
                  </button>
                  <p className="mt-1.5 text-[10.5px] text-clay">
                    dev note: set NEXT_PUBLIC_GOOGLE_CLIENT_ID to enable (see .env.example)
                  </p>
                </div>
              ) : null}
              <button
                onClick={closeWelcome}
                className="flex items-center justify-center gap-2 rounded-full bg-gold py-3 text-[14px] font-bold text-ink shadow-[0_6px_20px_rgba(255,184,0,0.35)] transition active:scale-[0.98] dark:text-[#322b45]"
              >
                {t("continueGuest")}
                <IconArrowRight size={15} />
              </button>
            </div>

            <p className="mt-4 max-w-[320px] text-[11px] leading-snug text-ink-faint">
              {t("guestKeep")}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2 lg:justify-start">
              {["🎙 voice", "📸 snap-a-list", "💜 taste recs", "⚖️ compare", "🔒 confirm gate", "📦 live tracking", "🔔 order alerts", "⏰ schedules"].map((c) => (
                <span key={c} className="rounded-full border border-edge bg-card px-3 py-1.5 text-[11px] font-semibold text-ink-soft">
                  {c}
                </span>
              ))}
            </div>
            <p className="mt-5 text-[11px] font-semibold tracking-wide text-ink-faint">
              26 agent tools · Web + PWA + Telegram · <span className="text-leaf">voice in සිංහල</span> · islandwide 🇱🇰
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2 lg:justify-start">
              {tgBot && (
                <a
                  href={tgBot.link}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 rounded-full bg-gold px-3.5 py-2 text-[11.5px] font-bold text-ink shadow-[0_4px_14px_rgba(255,184,0,0.35)] transition hover:-translate-y-0.5 dark:text-[#322b45]"
                >
                  <IconTelegram size={13} />
                  @{tgBot.username}
                </a>
              )}
              <a
                href="#land-film"
                className="flex items-center gap-1.5 rounded-full border border-gold/50 bg-gold-soft px-3.5 py-2 text-[11.5px] font-bold text-gold-deep transition hover:-translate-y-0.5"
              >
                ▶ 75-sec film
              </a>
              {[
                { href: "#land-pwa", label: "📱 In your pocket" },
                { href: "#land-pick", label: "🏅 Kapu's Pick" },
                { href: "#land-taste", label: "💜 Picked for you" },
                { href: "#land-seasonal", label: "🎉 Seasonal" },
                { href: "#land-voice", label: "🎙 Voice agent" },
                { href: "#land-track", label: "📦 Live tracking" },
                { href: "#land-tg", label: "✈️ Telegram bot" },
                { href: "#land-tech", label: "🏗 Stack" },
              ].map((n) => (
                <a
                  key={n.href}
                  href={n.href}
                  className="rounded-full border border-edge bg-card px-3.5 py-2 text-[11.5px] font-semibold text-ink-soft transition hover:-translate-y-0.5 hover:border-leaf/40 hover:text-leaf"
                >
                  {n.label}
                </a>
              ))}
            </div>
            <a href="#kapu-show" className="mt-5 flex flex-col items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint transition hover:text-leaf lg:items-start">
              {t("landSee")}
              <IconChevronDown size={10} className="animate-bounce" />
            </a>
            </div>
            <div className="w-full max-w-[500px] justify-self-center lg:justify-self-end">
              <p className="font-display mb-3 text-center text-[17px] italic text-leaf lg:text-left">{t("landChatTitle")}</p>
              <LiveWishDemo />
              <VoiceTeaser onStart={closeWelcome} />
            </div>
            </div>
          </div>
          <LandingShowcase onStart={closeWelcome} onTrack={openTrackDemo} tgBot={tgBot} />
          <KnowToast />
        </div>
      )}

      {/* ══ Mic permission — gentle ask ══ */}
      {micModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1d1233]/60 px-6 backdrop-blur-sm" onClick={() => setMicModal(false)}>
          <div
            className="sheet-in w-full max-w-sm rounded-[24px] p-7 text-center text-white shadow-2xl"
            style={{ background: "radial-gradient(360px 260px at 50% 0%, #3A2868, #241740)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gold/[0.12] text-gold">
              <IconMic size={26} />
            </span>
            <p className="font-display mt-4 text-[24px]">
              Kapu needs your <span className="italic text-gold">voice</span>
            </p>
            <p className="mx-auto mt-2 max-w-[260px] text-[12.5px] leading-relaxed text-white/70">
              Allow the microphone so we can talk — your audio is used only to hear your wish, never stored.
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <button
                onClick={() => {
                  localStorage.setItem("kapu_mic_ok", "1");
                  setMicModal(false);
                  beginVoice();
                }}
                className="rounded-[13px] bg-gold py-3 text-[13.5px] font-bold text-[#322b45] shadow-[0_6px_20px_rgba(255,184,0,0.35)] transition active:scale-[0.98]"
              >
                Allow microphone
              </button>
              <button
                onClick={() => setMicModal(false)}
                className="rounded-[13px] border border-white/20 py-3 text-[13px] font-semibold text-white/85 transition active:scale-[0.98]"
              >
                I&apos;ll type instead
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ Voice mode — immersive canvas ══ */}
      {voiceState !== "idle" && (
        <VoiceOverlay
          onCycleLang={() => {
            const order: Language[] = ["si", "ta", "en"];
            const next = order[(order.indexOf(language) + 1) % order.length];
            setLanguage(next);
            localStorage.setItem("kapu_lang", next);
            // restart the recognizer so it listens in the new language
            recognizerRef.current?.abort();
            setTimeout(() => {
              if (voiceOnRef.current) startListeningRef.current();
            }, 150);
          }}
          state={voiceState}
          language={language}
          interim={voiceInterim}
          spoken={voiceSpoken}
          toolLabel={voiceTool}
          blocks={voiceBlocks}
          actions={actions}
          deliverTo={deliverTo || undefined}
          recorderMode={recorderMode}
          onEnd={stopVoice}
          onInterrupt={interruptSpeech}
          onDone={() => void finishRecording()}
          onKeyboard={() => {
            stopVoice();
            setTimeout(() => inputRef.current?.focus(), 50);
          }}
        />
      )}

      {/* boot shimmer avoids a flash of the hero before rehydration */}
      {!sessionReady && <div className="fixed inset-0 z-[60] bg-cream" aria-hidden />}
    </div>
    </LangProvider>
  );
}

// ── schedules sheet — standing wishes management (auth-gated) ───────────

interface SchedRow {
  id: string;
  title: string;
  kind: string;
  cadence: { kind: string; at: string; date?: string; weekday?: number; day?: number };
  allow_order: boolean;
  active: boolean;
  next_run: number;
  last_result: string | null;
}

function SchedulesSheet({
  onClose,
  signedIn,
  tgBot,
  onAsk,
  onSignIn,
}: {
  onClose: () => void;
  signedIn: boolean;
  tgBot: string | null;
  onAsk: (msg: string) => void;
  onSignIn: () => void;
}) {
  const t = useT();
  const [data, setData] = useState<{ telegram_linked: boolean; schedules: SchedRow[] } | null>(null);
  const [code, setCode] = useState("");
  const [linkErr, setLinkErr] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);

  const refresh = useCallback(() => {
    void fetch("/api/schedules")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setData(d))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (signedIn) refresh();
  }, [signedIn, refresh]);

  const act = (id: string, action: "toggle" | "delete") =>
    void fetch("/api/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action }),
    }).then(refresh);

  const link = async () => {
    if (code.trim().length < 4 || linking) return;
    setLinking(true);
    setLinkErr(null);
    const res = await fetch("/api/telegram-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code.trim() }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) setLinkErr(d.error ?? "Failed");
    else {
      setCode("");
      refresh();
    }
    setLinking(false);
  };

  const cadenceLabel = (c: SchedRow["cadence"]) =>
    c.kind === "once"
      ? `${c.date ?? ""} ${c.at}`
      : c.kind === "weekly"
        ? `weekly · ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][c.weekday ?? 1]} ${c.at}`
        : c.kind === "monthly"
          ? `monthly · day ${c.day ?? 1} · ${c.at}`
          : c.kind === "yearly"
            ? `yearly · ${c.date ?? ""} · ${c.at}`
            : `daily · ${c.at}`;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center" onClick={onClose}>
      <div className="absolute inset-0 bg-[#1d1233]/50 backdrop-blur-[2px]" />
      <div className="sheet-in relative max-h-[88dvh] w-full overflow-y-auto rounded-t-[24px] bg-surface p-4 sm:max-w-lg sm:rounded-[24px]" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center gap-2">
          <IconClock size={17} className="text-leaf" />
          <p className="font-display text-[18px]">{t("schedTitle")}</p>
          <button onClick={onClose} className="ml-auto flex h-8 w-8 items-center justify-center rounded-full border border-line bg-card text-ink-soft" aria-label="Close">
            <IconClose size={12} />
          </button>
        </div>
        <p className="text-[11.5px] leading-snug text-ink-soft">{t("schedBlurb")}</p>

        {!signedIn ? (
          <div className="mt-4 rounded-2xl border border-line bg-card p-4 text-center">
            <p className="text-[12.5px] text-ink-soft">{t("schedSignIn")}</p>
            <button onClick={onSignIn} className="mt-3 rounded-[13px] bg-gold px-5 py-2.5 text-[13px] font-bold text-ink shadow-[0_4px_14px_rgba(255,184,0,0.35)] dark:text-[#322b45]">
              {t("signIn")}
            </button>
          </div>
        ) : (
          <>
            {data && !data.telegram_linked && tgBot && (
              <div className="mt-3 rounded-2xl border border-line bg-card p-3.5">
                <p className="text-[12px] font-semibold">{t("linkTg")}</p>
                <p className="mt-1 text-[11px] text-ink-soft">{t("linkTgHint", { bot: tgBot })}</p>
                <div className="mt-2 flex gap-2">
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="123456"
                    inputMode="numeric"
                    className="w-28 rounded-[11px] border-[1.5px] border-edge bg-surface px-3 py-2 text-center text-[14px] font-bold tracking-[0.2em] outline-none focus:border-leaf"
                  />
                  <button onClick={() => void link()} disabled={code.length < 6 || linking} className="rounded-[11px] bg-leaf px-4 text-[12px] font-semibold text-white disabled:opacity-40 dark:bg-[#402970]">
                    {linking ? "…" : t("open")}
                  </button>
                </div>
                {linkErr && <p className="mt-1.5 text-[11px] text-clay">{linkErr}</p>}
              </div>
            )}
            {data?.telegram_linked && <p className="mt-3 rounded-[12px] bg-good-soft px-3 py-2 text-[11.5px] font-medium text-good">{t("linkTgDone")}</p>}

            {!data ? (
              <div className="skeleton mt-3 h-20 rounded-2xl" />
            ) : data.schedules.length === 0 ? (
              <div className="mt-3 rounded-2xl border border-dashed border-edge p-4 text-center">
                <p className="text-[12.5px] text-ink-soft">{t("schedEmpty")}</p>
                <button
                  onClick={() => onAsk("Every month-end, pick fresh flowers under Rs 5,000 for Amma and schedule it — send me the pay link on Telegram")}
                  className="mt-2.5 rounded-full border border-edge bg-card px-3.5 py-2 text-[11.5px] font-medium text-leaf"
                >
                  {t("tryIt")}“flowers for Amma — every month-end”
                </button>
              </div>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {data.schedules.map((x) => (
                  <li key={x.id} className={`rounded-[16px] border border-line bg-card p-3 ${x.active ? "" : "opacity-60"}`}>
                    <div className="flex items-center gap-2">
                      <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">{x.title}</p>
                      <button onClick={() => act(x.id, "toggle")} className={`h-[18px] w-8 rounded-full p-[2px] transition ${x.active ? "bg-good" : "bg-edge"}`} aria-label="Toggle">
                        <span className={`block h-3.5 w-3.5 rounded-full bg-white shadow transition ${x.active ? "translate-x-[14px]" : ""}`} />
                      </button>
                      <button onClick={() => act(x.id, "delete")} className="text-ink-faint hover:text-clay" aria-label="Delete">
                        <IconClose size={13} />
                      </button>
                    </div>
                    <p className="mt-1 text-[11px] text-ink-soft">
                      {cadenceLabel(x.cadence)} · {x.allow_order ? t("schedOrderOk") : t("schedProposeOnly")}
                      {!x.active && ` · ${t("schedPaused")}`}
                    </p>
                    <p className="mt-0.5 text-[10.5px] text-ink-faint">
                      {x.active && t("schedNext", { when: new Date(x.next_run).toLocaleString("en-GB", { timeZone: "Asia/Colombo", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) })}
                      {x.last_result ? ` · ${x.last_result.slice(0, 60)}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── track order modal — direct MCP tracking, no LLM round-trip ──────────

function TrackModal({
  onClose,
  actions,
  recentOrders,
  tracked,
  onTracked,
  initial,
}: {
  onClose: () => void;
  actions: BlockActions;
  recentOrders: { order_ref: string; pay_url: string; recipient: string | null; city: string | null; date: string | null; items: string[] }[];
  tracked: TrackedOrder[];
  onTracked: (snap: TrackSnapshot) => void;
  initial?: string | null;
}) {
  const t = useT();
  const [value, setValue] = useState(initial ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Extract<UiBlock, { type: "order_timeline" }> | null>(null);
  const [notifPerm, setNotifPerm] = useState<NotificationPermission>(() =>
    typeof Notification !== "undefined" ? Notification.permission : "denied"
  );

  const track = async (orderArg?: string) => {
    const order = (orderArg ?? value).trim();
    if (order.length < 4 || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/track?order=${encodeURIComponent(order)}`);
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Not found");
      else {
        setResult({ type: "order_timeline", ...data });
        onTracked(data as TrackSnapshot); // persist for chips + change watch
      }
    } catch {
      setError("Tracking is unavailable right now — try again shortly.");
    } finally {
      setLoading(false);
    }
  };

  // opened from a notification — track that order straight away
  useEffect(() => {
    if (initial) void track(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center" onClick={onClose}>
      <div className="absolute inset-0 bg-[#1d1233]/50 backdrop-blur-[2px]" />
      <div className="sheet-in relative max-h-[88dvh] w-full overflow-y-auto rounded-t-[24px] bg-surface p-4 sm:max-w-lg sm:rounded-[24px]" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center gap-2">
          <IconPackage size={17} className="text-leaf" />
          <p className="font-display text-[18px]">{t("trackOrder")}</p>
          <button onClick={onClose} className="ml-auto flex h-8 w-8 items-center justify-center rounded-full border border-line bg-card text-ink-soft" aria-label="Close">
            <IconClose size={12} />
          </button>
        </div>
        <div className="flex gap-2">
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void track()}
            placeholder={t("trackPlaceholder")}
            className="min-w-0 flex-1 rounded-[13px] border-[1.5px] border-edge bg-card px-3.5 py-2.5 text-[13.5px] outline-none focus:border-leaf"
          />
          <button
            onClick={() => void track()}
            disabled={loading || value.trim().length < 4}
            className="rounded-[13px] bg-gold px-5 text-[13px] font-bold text-ink shadow-[0_4px_14px_rgba(255,184,0,0.35)] transition active:scale-95 disabled:opacity-40 dark:text-[#322b45]"
          >
            {loading ? "…" : t("trackBtn")}
          </button>
        </div>
        <p className="mt-2 text-[10.5px] leading-snug text-ink-faint">{t("trackHint")}</p>
        {tracked.length > 0 && !result && !loading && (
          <>
            <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-faint">{t("trackedT")}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {tracked.map((o) => (
                <button
                  key={o.no}
                  onClick={() => {
                    setValue(o.no);
                    void track(o.no);
                  }}
                  className="flex items-center gap-1.5 rounded-full border border-edge bg-card px-3 py-1.5 text-[11px] font-semibold text-ink-soft transition active:scale-95"
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      o.status === "delivered" ? "bg-good" : o.status === "cancelled" ? "bg-clay" : "bg-gold"
                    }`}
                  />
                  {o.no}
                  {o.display && <span className="font-normal text-ink-faint">· {o.display}</span>}
                </button>
              ))}
            </div>
          </>
        )}
        {error && <p className="mt-3 rounded-[12px] bg-clay-soft px-3 py-2 text-[12px] text-clay">{error}</p>}
        {result && <OrderTimeline block={result} actions={actions} />}
        {result && !TRACK_FINAL.has(result.status.toLowerCase()) && (
          <>
            <button
              onClick={() => actions.onAction(`Watch order ${result.order_number} and send me status updates on Telegram until it's delivered`)}
              className="mt-1 flex w-full items-center justify-center gap-2 rounded-[13px] bg-leaf py-2.5 text-[12.5px] font-semibold text-white transition active:scale-[0.99] dark:bg-[#402970]"
            >
              <IconBell size={14} />
              {t("watchOrder")}
            </button>
            {typeof Notification !== "undefined" && notifPerm !== "denied" && (
              <button
                disabled={notifPerm === "granted"}
                onClick={() => void Notification.requestPermission().then(setNotifPerm)}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-[13px] border border-edge bg-card py-2.5 text-[12.5px] font-semibold text-ink-soft transition active:scale-[0.99] disabled:opacity-80"
              >
                <IconBell size={14} className="text-leaf" />
                {notifPerm === "granted" ? t("notifDeviceOn") : t("notifDevice")}
              </button>
            )}
          </>
        )}
        {recentOrders.length > 0 && (
          <>
            <p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-faint">{t("recentOrdersT")}</p>
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {recentOrders.map((o) => (
                <li key={o.order_ref} className="flex items-center gap-2.5 rounded-[13px] border border-line bg-card px-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-semibold">
                      {o.order_ref}
                      {o.recipient ? ` → ${o.recipient}` : ""}
                      {o.city ? ` · ${o.city}` : ""}
                    </span>
                    <span className="block truncate text-[10.5px] text-ink-faint">{o.items.join(", ")}</span>
                  </span>
                  <a href={o.pay_url} target="_blank" rel="noreferrer" className="shrink-0 rounded-[10px] bg-leaf px-3 py-1.5 text-[11px] font-semibold text-white dark:bg-[#402970]">
                    {t("openPay")}
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

// ── QR handoff — desktop → phone in one scan ────────────────────────────

function QrTile({ size = 132 }: { size?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    let alive = true;
    void import("qrcode").then((QR) => {
      if (alive && ref.current) {
        void QR.toCanvas(ref.current, "https://kapuwa.shop/?src=qr", {
          width: size,
          margin: 1,
          color: { dark: "#241740", light: "#ffffff" },
        });
      }
    });
    return () => {
      alive = false;
    };
  }, [size]);
  return (
    <span className="inline-block rounded-[14px] bg-white p-2 shadow-[0_10px_30px_rgba(0,0,0,0.25)]">
      <canvas ref={ref} width={size} height={size} className="block rounded-[6px]" />
    </span>
  );
}

// ── landing voice teaser — animated waveform strip under the demo ───────

const VOICE_LINES = ["මට කේක් එකක් ඕන…", "machan phone ekak hoyala denna…", "அம்மாவுக்கு பூக்கள்…"];

function VoiceTeaser({ onStart }: { onStart: () => void }) {
  const t = useT();
  const [li, setLi] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setLi((x) => (x + 1) % VOICE_LINES.length), 2600);
    return () => clearInterval(id);
  }, []);
  return (
    <button
      onClick={onStart}
      className="mt-3 flex w-full items-center gap-3 rounded-[18px] p-3.5 text-left text-white shadow-[0_16px_44px_rgba(64,41,112,0.35)] transition hover:-translate-y-0.5"
      style={{ background: "radial-gradient(280px 160px at 20% 0%, #3A2868, #241740)" }}
    >
      <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10">
        <span className="voicering absolute inset-0 rounded-full border border-gold/60" />
        <IconMic size={18} className="text-gold" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[12.5px] font-bold">
          Kapu <i className="font-display font-normal text-gold">voice</i>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[8.5px] font-bold uppercase tracking-wide text-white/70">hands-free · sinhala</span>
        </span>
        <span className="mt-0.5 block truncate text-[11.5px] italic text-white/70">“{VOICE_LINES[li]}”</span>
      </span>
      <span className="flex h-6 items-end gap-[2.5px] pr-1">
        {[0.5, 0.9, 0.6, 1, 0.7, 0.85, 0.45].map((h, i) => (
          <span key={i} className="wavebar w-[3px] rounded-full bg-gold" style={{ height: `${h * 22}px`, animationDelay: `${i * 0.12}s` }} />
        ))}
      </span>
    </button>
  );
}

// ── did-you-know toast — honest capability facts, competitor-style corner ──

const KNOW_FACTS = [
  "🔮 Kapu can book a real horoscope reading for auspicious timing",
  "🧺 “Avurudu hamper under Rs 8,000” — one box, one flat delivery",
  "⏰ “Flowers for Amma every month-end” — runs itself, pays by your tap",
  "📦 Delivery comes with photo proof — watch it arrive",
  "👨‍👩‍👧 Add Kapu to the family Telegram group — one shared basket",
];

function KnowToast() {
  const [i, setI] = useState(0);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const id = setInterval(() => setI((x) => (x + 1) % KNOW_FACTS.length), 5200);
    return () => clearInterval(id);
  }, []);
  if (hidden) return null;
  return (
    <div className="rise fixed bottom-5 left-5 z-[56] hidden max-w-[300px] items-start gap-2.5 rounded-[16px] border border-line bg-card p-3.5 shadow-[0_18px_50px_rgba(0,0,0,0.35)] md:flex">
      <KapuMark size={26} radius={8} />
      <div className="min-w-0 flex-1">
        <p key={i} className="rise text-[11.5px] leading-snug text-ink-soft">{KNOW_FACTS[i]}</p>
        <p className="mt-1 text-[9px] font-semibold uppercase tracking-wide text-ink-faint">real capabilities · not simulated</p>
      </div>
      <button onClick={() => setHidden(true)} className="text-ink-faint hover:text-ink-soft" aria-label="Dismiss">
        <IconClose size={11} />
      </button>
    </div>
  );
}

// ── landing typewriter — capability lines under the hero headline ───────

function LandingTicker({ language }: { language: Language }) {
  const phrases = HERO_PHRASES[language];
  const [idx, setIdx] = useState(0);
  const [chars, setChars] = useState(0);
  const phrase = phrases[idx % phrases.length].text;
  useEffect(() => {
    const full = [...phrase];
    const delay = chars < full.length ? 30 : 2100;
    const id = setTimeout(() => {
      if (chars < full.length) setChars(chars + 1);
      else {
        setChars(0);
        setIdx((i) => i + 1);
      }
    }, delay);
    return () => clearTimeout(id);
  }, [chars, phrase]);
  return (
    <p className="mt-4 min-h-[2.6rem] max-w-[430px] text-[14px] font-medium leading-snug text-leaf-bright">
      {[...phrase].slice(0, chars).join("")}
      <span className="ml-0.5 inline-block h-[1em] w-[2.5px] animate-pulse rounded bg-gold align-middle" />
    </p>
  );
}

// ── live wish demo — the auto-playing hero chat ─────────────────────────

function LiveWishDemo() {
  const [beat, setBeat] = useState(1);
  useEffect(() => {
    const id = setInterval(() => setBeat((b) => (b % 8) + 1), 1700);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="rounded-[26px] border border-line bg-card p-4 text-left shadow-[0_30px_80px_rgba(64,41,112,0.2)]">
      <div className="mb-3 flex items-center gap-2 border-b border-line pb-3">
        <KapuMark size={26} radius={8} />
        <p className="font-display text-[14px]">Kapu</p>
        <span className="ml-auto flex items-center gap-1 rounded-full bg-good-soft px-2 py-0.5 text-[9px] font-bold uppercase text-good">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-good" /> live demo
        </span>
      </div>
      <div className="flex min-h-[300px] flex-col justify-end gap-2.5">
        {beat >= 1 && (
          <p className="rise self-end rounded-[16px] rounded-br-[5px] bg-bubble px-3.5 py-2 text-[12.5px] text-white">
            ammata cake ekak yawanna one 🎂
          </p>
        )}
        {beat === 2 && (
          <span className="rise flex gap-1 self-start rounded-[16px] bg-cream px-3.5 py-2.5 dark:bg-cream-deep">
            <span className="dot h-1.5 w-1.5 rounded-full bg-leaf" />
            <span className="dot h-1.5 w-1.5 rounded-full bg-leaf" />
            <span className="dot h-1.5 w-1.5 rounded-full bg-leaf" />
          </span>
        )}
        {beat >= 3 && (
          <p className="rise self-start rounded-[16px] rounded-bl-[5px] bg-cream px-3.5 py-2 text-[12.5px] text-ink dark:bg-cream-deep">
            හරි! Kandy වලට <b>same-day</b> පුළුවන් 🚚 — මේක අම්මට perfect:
          </p>
        )}
        {beat >= 4 && (
          <div className="rise flex items-center gap-3 self-start rounded-[16px] border border-line bg-card p-2.5 shadow-sm">
            <span className="flex h-12 w-12 items-center justify-center rounded-[12px]" style={{ background: "#F3E8FA" }}>
              <IconCake size={22} style={{ color: "#8A5CB8" }} />
            </span>
            <span>
              <span className="block text-[12px] font-semibold">Ribbon Chocolate Cake — 1kg</span>
              <span className="price-serif block text-[14px]">Rs 4,850</span>
            </span>
            <span className="ml-2 flex h-8 w-8 items-center justify-center rounded-[10px] bg-gold text-ink shadow-sm dark:text-[#322b45]">
              <IconPlus size={13} />
            </span>
          </div>
        )}
        {beat >= 5 && (
          <p className="rise self-end rounded-[16px] rounded-br-[5px] bg-bubble px-3.5 py-2 text-[12.5px] text-white">
            icing eke "සුබ උපන්දිනයක් අම්මේ!" liyanna ✍️
          </p>
        )}
        {beat >= 6 && (
          <div className="rise flex items-center gap-2.5 self-start rounded-[16px] border border-gold/40 bg-gold-soft px-3.5 py-2.5">
            <IconLock size={14} className="text-gold-deep" />
            <span className="text-[12px] font-semibold text-ink">Pay link · Rs 5,925 incl. delivery</span>
            <span className="rounded-full bg-gold px-2 py-0.5 text-[9.5px] font-bold text-ink dark:text-[#322b45]">59:46</span>
          </div>
        )}
        {beat >= 7 && (
          <p className="rise flex items-center gap-2 self-start rounded-[16px] bg-good-soft px-3.5 py-2 text-[12px] font-semibold text-good">
            <IconCheckCircle size={15} /> Delivered — photo proof 📸🎉
          </p>
        )}
      </div>
    </div>
  );
}

// ── pick duel — the recommendation engine, played live ──────────────────

function PickDuel() {
  const [beat, setBeat] = useState(1);
  useEffect(() => {
    const id = setInterval(() => setBeat((b) => (b % 7) + 1), 1500);
    return () => clearInterval(id);
  }, []);
  const rows = [
    { label: "මිල / Price", a: "Rs 58,900", b: "Rs 56,400", win: "b", at: 2 },
    { label: "RAM · storage", a: "8 · 256GB", b: "6 · 128GB", win: "a", at: 3 },
    { label: "Battery", a: "5000 mAh", b: "5000 mAh", win: "tie", at: 4 },
  ];
  return (
    <div className="rounded-[26px] border border-line bg-card p-4 shadow-[0_30px_80px_rgba(64,41,112,0.2)]">
      <div className="grid grid-cols-2 gap-2.5">
        {[
          { n: "Redmi Note 13", sub: "8/256GB", picked: beat >= 5 },
          { n: "Galaxy A25 5G", sub: "6/128GB", picked: false },
        ].map((p, i) => (
          <div key={p.n} className={`relative rounded-[16px] border p-3 transition-all duration-300 ${p.picked ? "border-gold shadow-[0_0_0_2px_rgba(255,184,0,0.35)]" : "border-line"}`}>
            {p.picked && (
              <span className="rise absolute -top-2 left-2 rounded-full bg-leaf px-2 py-0.5 text-[8px] font-bold uppercase tracking-wide text-gold dark:bg-[#402970]">
                Kapu's pick
              </span>
            )}
            <div className="flex h-16 items-center justify-center rounded-[10px]" style={{ background: i === 0 ? "#E8EDF7" : "#F3E8FA" }}>
              <IconPhone size={24} style={{ color: i === 0 ? "#4A6FA5" : "#8A5CB8" }} />
            </div>
            <p className="mt-2 text-[11.5px] font-semibold leading-tight">{p.n}</p>
            <p className="text-[9.5px] text-ink-faint">{p.sub}</p>
          </div>
        ))}
      </div>
      <div className="mt-2.5 space-y-1">
        {rows.map((r) => (
          <div key={r.label} className={`grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-[10.5px] transition ${beat >= r.at ? "bg-cream dark:bg-cream-deep" : "opacity-30"}`}>
            <span className={`flex items-center gap-1 ${beat >= r.at && r.win === "a" ? "font-bold text-good" : "text-ink-soft"}`}>
              {beat >= r.at && r.win === "a" && <IconCheck size={9} />}
              {r.a}
            </span>
            <span className="text-[8.5px] font-semibold uppercase tracking-wide text-ink-faint">{r.label}</span>
            <span className={`flex items-center justify-end gap-1 text-right ${beat >= r.at && r.win === "b" ? "font-bold text-good" : "text-ink-soft"}`}>
              {r.b}
              {beat >= r.at && r.win === "b" && <IconCheck size={9} />}
            </span>
          </div>
        ))}
      </div>
      {beat >= 6 && (
        <div className="rise mt-2.5 flex items-start gap-2 rounded-[13px] bg-leaf px-3.5 py-2.5 text-white dark:bg-[#402970]">
          <KapuMark size={18} radius={6} />
          <p className="text-[11px] leading-snug">
            <b className="text-gold">Kapu's verdict:</b> <i>battery එක සමානයි — storage වලට Redmi. Amma phone එක අවුරුදු 4+ තියාගන්නවා නම් Samsung.</i>
          </p>
        </div>
      )}
    </div>
  );
}

// ── landing showcase — the welcome gate's below-the-fold marketing ──────

function LandingShowcase({
  onStart,
  onTrack,
  tgBot,
}: {
  onStart: () => void;
  onTrack: () => void;
  tgBot: { username: string; link: string } | null;
}) {
  const t = useT();

  const FEATURES: { Icon: typeof IconGlobe; tt: StrKey; bb: StrKey }[] = [
    { Icon: IconGlobe, tt: "landF1t", bb: "landF1b" },
    { Icon: IconCamera, tt: "landF2t", bb: "landF2b" },
    { Icon: IconClock, tt: "landF3t", bb: "landF3b" },
    { Icon: IconUser, tt: "landF4t", bb: "landF4b" },
    { Icon: IconLock, tt: "landF5t", bb: "landF5b" },
    { Icon: IconGift, tt: "landF6t", bb: "landF6b" },
  ];

  return (
    <div id="kapu-show" className="relative mx-auto max-w-5xl px-6 pb-20 text-left">
      {/* ── act −1: the film ── */}
      <section id="land-film" className="py-14">
        <h2 className="font-display text-center text-[26px] text-ink sm:text-[32px]">
          ▶ Kapu in <span className="italic text-leaf">75 seconds</span>
        </h2>
        <div className="mx-auto mt-7 max-w-4xl overflow-hidden rounded-[26px] border border-line bg-card shadow-[0_40px_100px_rgba(64,41,112,0.3)]">
          <div className="relative w-full" style={{ paddingTop: "56.25%" }}>
            <iframe
              src="https://www.youtube-nocookie.com/embed/zQyPcT_V1_A?rel=0&modestbranding=1"
              title="Kapu — Sri Lanka's wish-granting shopping agent"
              loading="lazy"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              className="absolute inset-0 h-full w-full"
            />
          </div>
        </div>
      </section>

      {/* ── act 0: in your pocket (PWA) ── */}
      <section id="land-pwa" className="grid items-center gap-10 py-14 md:grid-cols-2">
        <div>
          <h2 className="font-display text-[30px] italic leading-tight text-ink sm:text-[40px]">{t("landPwaTitle")}</h2>
          <p className="mt-4 max-w-[420px] text-[14px] leading-relaxed text-ink-soft">{t("landPwaSub")}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              onClick={onStart}
              className="rounded-full bg-gold px-6 py-3 text-[13.5px] font-bold text-ink shadow-[0_8px_24px_rgba(255,184,0,0.35)] transition hover:-translate-y-0.5 dark:text-[#322b45]"
            >
              {t("landPwaBtn")}
            </button>
            <span className="flex items-center rounded-full border border-edge bg-card px-5 py-3 text-[13px] font-semibold text-leaf">{t("landPwaTag")}</span>
          </div>
          <div className="mt-6 flex items-center gap-4">
            <QrTile size={116} />
            <p className="max-w-[220px] text-[11.5px] leading-relaxed text-ink-soft">📱 {t("qrHint")}</p>
          </div>
        </div>
        <div className="relative mx-auto flex h-[420px] w-full max-w-[430px] items-center justify-center">
          {/* phone A — the app shell drawer */}
          <div className="floaty absolute left-0 top-6 w-[205px] rounded-[30px] border-[7px] border-[#0e0a1c] bg-surface p-3 shadow-[0_30px_70px_rgba(0,0,0,0.5)]" style={{ "--tilt": "-4deg" } as React.CSSProperties}>
            <div className="flex items-center gap-1.5">
              <KapuMark size={20} radius={6} />
              <span className="font-display text-[11px] text-leaf">Kapu</span>
            </div>
            <div className="mt-2 rounded-[10px] bg-gold py-2 text-center text-[10px] font-bold text-ink dark:text-[#322b45]">+ New wish</div>
            <p className="mt-2.5 text-[7px] font-bold uppercase tracking-[0.1em] text-ink-faint">Recent wishes</p>
            {["මට කේක් එකක් one, හාල් 5kg…", "pirikara offering for the temple", "Esala season — gift ideas"].map((w) => (
              <div key={w} className="mt-1.5 truncate rounded-[8px] bg-cream px-2 py-1.5 text-[8.5px] text-ink-soft dark:bg-cream-deep">
                {w}
              </div>
            ))}
            <div className="mt-2.5 space-y-1.5 border-t border-line pt-2">
              <p className="flex items-center gap-1.5 text-[9px] font-semibold"><IconHeart size={10} className="text-clay" filled /> Favorites <span className="ml-auto text-ink-faint">3</span></p>
              <p className="flex items-center gap-1.5 text-[9px] font-semibold"><IconPackage size={10} /> Track an order</p>
              <p className="flex items-center gap-1.5 text-[9px] font-semibold"><IconClock size={10} /> Schedules</p>
            </div>
            <p className="mt-2 flex items-center gap-1 rounded-[8px] bg-good-soft px-2 py-1.5 text-[7.5px] font-semibold text-good">✓ Wishes synced across devices</p>
          </div>
          {/* phone B — chat with product cards */}
          <div className="floaty absolute right-0 top-0 z-[1] w-[225px] rounded-[30px] border-[7px] border-[#0e0a1c] bg-cream p-3 shadow-[0_36px_80px_rgba(0,0,0,0.55)]" style={{ "--tilt": "3.5deg", animationDelay: "0.9s" } as React.CSSProperties}>
            <div className="flex items-center gap-1.5">
              <KapuMark size={20} radius={6} />
              <span className="font-display text-[11px]">Kapu</span>
              <span className="ml-auto rounded-full bg-leaf-soft px-1.5 py-0.5 text-[7px] font-bold text-leaf">LKR</span>
            </div>
            <p className="ml-auto mt-2.5 w-fit rounded-[10px] rounded-br-[3px] bg-bubble px-2 py-1 text-[9px] text-white">mata ala 1kg one 🥔</p>
            <p className="mt-1.5 w-fit rounded-[10px] rounded-bl-[3px] bg-card px-2 py-1 text-[9px] text-ink shadow-sm">අල / Potatoes — මේ දෙක බලන්න:</p>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {[
                { n: "1KG Potatoes — Bagged", p: "Rs 520", pick: true },
                { n: "Potato Ricer — Steel", p: "Rs 2,000", pick: false },
              ].map((x) => (
                <div key={x.n} className="relative overflow-hidden rounded-[10px] border border-line bg-card">
                  {x.pick && <span className="absolute left-1 top-1 z-[1] rounded-full bg-leaf px-1 py-0.5 text-[5.5px] font-bold uppercase text-gold dark:bg-[#402970]">Kapu's pick</span>}
                  <div className="flex h-12 items-center justify-center" style={{ background: "#EDF3E8" }}>
                    <IconTrolley size={16} style={{ color: "#5B8C51" }} />
                  </div>
                  <div className="p-1.5">
                    <p className="truncate text-[7.5px] font-semibold">{x.n}</p>
                    <div className="flex items-center justify-between">
                      <span className="price-serif text-[9px]">{x.p}</span>
                      <span className="flex h-4 w-4 items-center justify-center rounded-[5px] bg-gold text-ink dark:text-[#322b45]"><IconPlus size={7} /></span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-1">
              <span className="rounded-full border border-edge bg-card px-2 py-1 text-[7.5px] font-semibold text-ink-soft">Add 1kg to basket</span>
              <span className="rounded-full border border-edge bg-card px-2 py-1 text-[7.5px] font-semibold text-ink-soft">More veggies</span>
            </div>
            <div className="mt-2 flex items-center gap-1.5 rounded-[10px] border border-edge bg-card px-2 py-1.5">
              <span className="flex-1 text-[8px] text-ink-faint">Reply to Kapu…</span>
              <IconCamera size={9} className="text-leaf" />
              <IconMic size={9} className="text-leaf" />
              <span className="flex h-4 w-4 items-center justify-center rounded-[5px] bg-gold"><IconSendUp size={7} className="text-ink dark:text-[#322b45]" /></span>
            </div>
          </div>
        </div>
      </section>
      {/* ── act 1: the recommendation engine ── */}
      <section id="land-pick" className="grid items-center gap-8 py-12 md:grid-cols-2">
        <div className="order-2 md:order-1">
          <PickDuel />
        </div>
        <div className="order-1 md:order-2">
          <span className="rounded-full bg-leaf px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.08em] text-gold dark:bg-[#402970]">Kapu's pick</span>
          <h2 className="font-display mt-3 text-[26px] leading-tight text-ink sm:text-[32px]">{t("landPickTitle")}</h2>
          <p className="mt-3 max-w-[420px] text-[13.5px] leading-relaxed text-ink-soft">{t("landPickSub")}</p>
          <p className="mt-3 max-w-[420px] rounded-[13px] border border-dashed border-edge px-3.5 py-2.5 text-[12px] italic text-ink-soft">
            🤝 {t("landPickHonest")}
          </p>
        </div>
      </section>

      {/* ── act 1.7: taste engine — vector recs + discover rails ── */}
      <section id="land-taste" className="grid items-center gap-8 py-12 md:grid-cols-2">
        <div>
          <span className="rounded-full bg-leaf px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.08em] text-gold dark:bg-[#402970]">💜 taste engine</span>
          <h2 className="font-display mt-3 text-[26px] leading-tight text-ink sm:text-[32px]">{t("landTasteTitle")}</h2>
          <p className="mt-3 max-w-[420px] text-[13.5px] leading-relaxed text-ink-soft">{t("landTasteSub")}</p>
          <ul className="mt-4 space-y-2 text-[12.5px] text-ink-soft">
            <li>💜 {t("landTasteB1")}</li>
            <li>🎁 {t("landTasteB2")}</li>
            <li>📈 {t("landTasteB3")}</li>
          </ul>
        </div>
        <div className="mx-auto w-full max-w-[380px] rounded-[26px] border border-line bg-card p-5 shadow-[0_30px_80px_rgba(64,41,112,0.2)]">
          <div className="mb-3 flex flex-wrap gap-1.5">
            <span className="rounded-full bg-leaf px-3 py-1.5 text-[10.5px] font-semibold text-white dark:bg-[#402970]">🔥 {t("discTrend")}</span>
            <span className="rounded-full border border-line bg-surface px-3 py-1.5 text-[10.5px] font-semibold text-ink-soft">💸 {t("discBudget")}</span>
            <span className="rounded-full border border-line bg-surface px-3 py-1.5 text-[10.5px] font-semibold text-ink-soft">🏷️ {t("discDeals")}</span>
          </div>
          <p className="font-display mb-2 text-[14px]">💜 {t("forYouT")}</p>
          {(
            [
              ["Ultimate Chocolate Indulgence Gift Box", "Rs 6,950", true],
              ["Red Heart Arrangement With Chocolates", "Rs 8,400", false],
              ["Royal Chocolate Drizzle Tower Cake", "Rs 5,200", false],
            ] as const
          ).map(([name, price, pick]) => (
            <div key={name} className="mb-1.5 flex items-center gap-2.5 rounded-[13px] border border-line bg-surface px-3 py-2.5">
              {pick ? (
                <span className="shrink-0 rounded-full bg-leaf px-2 py-0.5 text-[7.5px] font-bold uppercase text-gold dark:bg-[#402970]">Kapu's pick</span>
              ) : (
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-leaf/40" />
              )}
              <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium">{name}</span>
              <span className="price-serif shrink-0 text-[12px] text-leaf">{price}</span>
            </div>
          ))}
          <p className="mt-2.5 text-center text-[9.5px] uppercase tracking-[0.1em] text-ink-faint">
            vector embeddings · cosine · your device's wishes only
          </p>
        </div>
      </section>

      {/* ── act 1.8: seasonal intelligence ── */}
      <section id="land-seasonal" className="grid items-center gap-8 py-12 md:grid-cols-2">
        <div>
          <span className="rounded-full bg-gold-soft px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.08em] text-gold-deep">🎉 seasonal</span>
          <h2 className="font-display mt-3 text-[26px] leading-tight text-ink sm:text-[32px]">{t("landSeasonTitle")}</h2>
          <p className="mt-3 max-w-[420px] text-[13.5px] leading-relaxed text-ink-soft">{t("landSeasonSub")}</p>
          <ul className="mt-4 space-y-2 text-[12.5px] text-ink-soft">
            <li>🛍 {t("landSeasonB1")}</li>
            <li>🙏 {t("landSeasonB2")}</li>
            <li>📉 {t("landSeasonB3")}</li>
            <li>💌 {t("landSeasonB4")}</li>
          </ul>
        </div>
        <div className="relative mx-auto flex min-h-[360px] w-full max-w-[420px] items-center justify-center">
          {/* festival countdown chip */}
          <span className="floaty absolute left-2 top-2 z-[2] rounded-full border border-gold/40 bg-gold-soft px-4 py-2 text-[11.5px] font-bold text-gold-deep shadow-lg" style={{ "--tilt": "-2deg" } as React.CSSProperties}>
            🏮 ~36 DAYS TO ESALA PERAHERA · gift ideas
          </span>
          {/* mini greeting card */}
          <div
            className="floaty absolute bottom-4 left-0 w-[190px] rounded-[18px] p-5 text-center text-white shadow-[0_24px_60px_rgba(0,0,0,0.45)]"
            style={{ background: "linear-gradient(180deg, #3A2868, #1c1236)", border: "1.5px solid rgba(255,184,0,0.4)", "--tilt": "-4deg", animationDelay: "0.6s" } as React.CSSProperties}
          >
            <p className="text-[34px] leading-none">🐘</p>
            <p className="mt-2 text-[8px] uppercase tracking-[0.16em] text-white/60">to Amma</p>
            <p className="font-display mt-1.5 text-[13.5px] leading-snug">සුබ පැතුම්! ඔයාට සෙත් පතනවා 🙏</p>
            <p className="mt-3 text-[7px] font-semibold text-gold">🌳 sent with Kapu</p>
          </div>
          {/* TG price-drop alert */}
          <div
            className="floaty absolute right-0 top-24 z-[1] w-[230px] rounded-[16px] bg-[#1c2733] p-3.5 shadow-[0_24px_60px_rgba(0,0,0,0.5)]"
            style={{ "--tilt": "3deg", animationDelay: "1.2s" } as React.CSSProperties}
          >
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#2AABEE] text-white"><IconTelegram size={13} /></span>
              <span className="text-[11px] font-bold text-white">Kapu</span>
              <span className="ml-auto text-[8px] text-white/40">now</span>
            </div>
            <p className="mt-2 text-[11px] leading-snug text-white/90">
              📉 <b>Price drop!</b> Avurudu Hamper
              <br />
              <s className="text-white/50">Rs 7,800</s> → <b className="text-[#6ab3f3]">Rs 7,200</b> (−8%)
            </p>
            <p className="mt-1.5 text-[9px] text-white/50">Grab it in Kapu before it climbs back 🌳</p>
          </div>
        </div>
      </section>

      {/* ── act 2: capabilities grid ── */}
      <section className="py-10">
        <h2 className="font-display text-center text-[26px] text-ink sm:text-[32px]">{t("landFeatTitle")}</h2>
        <div className="mt-8 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <div
              key={f.tt}
              className="rise rounded-[20px] border border-line bg-card p-5 transition hover:-translate-y-1 hover:shadow-[0_16px_40px_rgba(64,41,112,0.12)]"
              style={{ animationDelay: `${i * 90}ms` }}
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-[13px] bg-leaf-soft text-leaf">
                <f.Icon size={20} />
              </span>
              <p className="mt-3.5 text-[14.5px] font-semibold">{t(f.tt)}</p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-ink-soft">{t(f.bb)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── act 2.5: the voice agent ── */}
      <section id="land-voice" className="grid items-center gap-8 py-12 md:grid-cols-2">
        <div>
          <h2 className="font-display text-[26px] leading-tight text-ink sm:text-[32px]">{t("landVoiceTitle")}</h2>
          <p className="mt-3 max-w-[420px] text-[13.5px] leading-relaxed text-ink-soft">{t("landVoiceSub")}</p>
          <ul className="mt-4 space-y-2 text-[12.5px] text-ink-soft">
            <li>🎙 {t("landVoiceB1")}</li>
            <li>⚡ {t("landVoiceB2")}</li>
            <li>✋ {t("landVoiceB3")}</li>
            <li>🃏 {t("landVoiceB4")}</li>
          </ul>
          <button
            onClick={onStart}
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-gold px-5 py-2.5 text-[13px] font-bold text-ink shadow-[0_6px_18px_rgba(255,184,0,0.35)] transition hover:-translate-y-0.5 dark:text-[#322b45]"
          >
            <IconMic size={15} />
            {t("landVoiceCta")}
          </button>
        </div>
        <div
          className="mx-auto flex w-full max-w-[380px] flex-col items-center gap-5 rounded-[28px] p-10 text-center text-white shadow-[0_30px_80px_rgba(64,41,112,0.35)]"
          style={{ background: "radial-gradient(320px 240px at 50% 0%, #3A2868, #241740)" }}
        >
          <div className="relative">
            <span className="voicering absolute inset-0 rounded-[30px] border-2 border-gold/50" />
            <span className="voicering absolute inset-0 rounded-[30px] border-2 border-gold/30" style={{ animationDelay: "0.7s" }} />
            <span className="relative flex h-24 w-24 items-center justify-center rounded-[30px] bg-white/[0.07]">
              <KapuMark size={52} radius={16} />
            </span>
          </div>
          <span className="flex h-8 items-end gap-[3px]">
            {[0.4, 0.75, 0.55, 1, 0.65, 0.9, 0.5, 0.8, 0.45].map((h, i) => (
              <span key={i} className="wavebar w-[3.5px] rounded-full bg-gold" style={{ height: `${h * 30}px`, animationDelay: `${i * 0.11}s` }} />
            ))}
          </span>
          <p className="font-display text-[17px] italic leading-snug text-white/90">“ammata cake ekak yawanna one…”</p>
          <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[10.5px] font-semibold text-gold">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold" /> Listening — speak now!
          </span>
        </div>
      </section>

      {/* ── live order tracking — the whole journey, not four vague dots ── */}
      <section id="land-track" className="grid items-center gap-8 py-12 md:grid-cols-2">
        <div className="order-2 mx-auto w-full max-w-[380px] rounded-[26px] border border-line bg-card p-5 shadow-[0_30px_80px_rgba(64,41,112,0.2)] md:order-1">
          <div className="mb-4 flex items-center justify-between gap-2 border-b border-line pb-3">
            <p className="font-display text-[14px]">
              Order <span className="text-leaf">#VIMP34456CB2</span>
            </p>
            <span className="flex items-center gap-1.5 rounded-full bg-good-soft px-2 py-0.5 text-[9.5px] font-bold uppercase text-good">
              <span className="h-1.5 w-1.5 rounded-full bg-good" /> Delivered
            </span>
          </div>
          <ol>
            {(
              [
                ["Order Received", "May 22, 10:19 AM"],
                ["Kapruka Warehouse, Order Prepared", "May 22, 7:07 PM"],
                ["Received by our delivery agent", "May 23, 8:43 AM"],
                ["Order has been out for delivery", "May 23, 8:43 AM"],
                ["Order has been delivered 📸", "May 23, 1:17 PM"],
              ] as const
            ).map(([step, ts], i, arr) => {
              const finale = i === arr.length - 1;
              return (
                <li key={step} className="relative flex gap-3 pb-3.5 last:pb-0">
                  {!finale && <span className="absolute left-[11px] top-6 h-[calc(100%-1.5rem)] w-0.5 rounded bg-leaf" />}
                  <span
                    className={`z-[1] flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white ${
                      finale ? "bg-good shadow-[0_0_0_4px_rgba(46,158,91,0.18)]" : "bg-leaf dark:bg-[#402970]"
                    }`}
                  >
                    <IconCheck size={10} />
                  </span>
                  <div className="min-w-0 pt-0.5">
                    <p className="text-[12px] font-semibold leading-snug">{step}</p>
                    <p className="text-[10.5px] text-ink-soft">{ts}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
        <div className="order-1 md:order-2">
          <h2 className="font-display text-[26px] leading-tight text-ink sm:text-[32px]">{t("landTrackTitle")}</h2>
          <p className="mt-3 max-w-[420px] text-[13.5px] leading-relaxed text-ink-soft">{t("landTrackSub")}</p>
          <ul className="mt-4 space-y-2 text-[12.5px] text-ink-soft">
            <li>📦 {t("landTrackB1")}</li>
            <li>🔔 {t("landTrackB2")}</li>
            <li>📸 {t("landTrackB3")}</li>
          </ul>
          <button
            onClick={onTrack}
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-gold px-5 py-2.5 text-[13px] font-bold text-ink shadow-[0_6px_18px_rgba(255,184,0,0.35)] transition hover:-translate-y-0.5 dark:text-[#322b45]"
          >
            <IconPackage size={15} />
            {t("landTrackCta")}
          </button>
        </div>
      </section>

      {/* ── act 3: telegram ── */}
      <section id="land-tg" className="grid items-center gap-8 py-12 md:grid-cols-2">
        <div className="order-2 md:order-1">
          <div className="mx-auto max-w-[360px] rounded-[26px] border border-line bg-[#1c2733] p-4 shadow-[0_30px_80px_rgba(0,0,0,0.35)]">
            <div className="mb-3 flex items-center gap-2.5 border-b border-white/10 pb-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#2AABEE] text-white">
                <IconTelegram size={17} />
              </span>
              <span>
                <span className="block text-[13px] font-bold text-white">Family Group 🏠</span>
                <span className="block text-[10px] text-white/50">Amma, Akki, Malli +2</span>
              </span>
            </div>
            <div className="flex flex-col gap-2">
              <p className="self-end rounded-[14px] rounded-br-[4px] bg-[#2b5278] px-3 py-1.5 text-[12px] text-white">
                @{tgBot?.username ?? "KapuLKBot"} avurudu hamper ekak? 🧺
              </p>
              <div className="self-start rounded-[14px] rounded-bl-[4px] bg-[#182533] px-3 py-2 text-[12px] text-white/90">
                <span className="mb-1 block text-[10px] font-bold text-[#6ab3f3]">Kapu</span>
                Avurudu Hamper Pack 03 — <b>Rs 7,800</b> · one flat delivery 🚚
                <span className="mt-2 flex gap-1.5">
                  <span className="rounded-[8px] bg-white/10 px-2.5 py-1 text-[10.5px] font-semibold">➕ Add</span>
                  <span className="rounded-[8px] bg-white/10 px-2.5 py-1 text-[10.5px] font-semibold">💳 Pay link</span>
                </span>
              </div>
              <p className="self-start rounded-[14px] bg-[#182533] px-3 py-1.5 text-[11px] italic text-white/50">
                ⏳ Comparing options… <s>Searching Kapruka ✓</s>
              </p>
            </div>
          </div>
        </div>
        <div className="order-1 md:order-2">
          <h2 className="font-display text-[26px] leading-tight text-ink sm:text-[32px]">{t("landTgTitle")}</h2>
          <p className="mt-3 max-w-[400px] text-[13.5px] leading-relaxed text-ink-soft">{t("landTgSub")}</p>
          <ul className="mt-4 space-y-2 text-[12.5px] text-ink-soft">
            <li>🎙 {t("tgCanVoice")}</li>
            <li>📸 {t("tgCanSnap")}</li>
            <li>👨‍👩‍👧 {t("tgCanGroup")}</li>
            <li>⏰ {t("landF3b")}</li>
          </ul>
          {tgBot && (
            <a
              href={tgBot.link}
              target="_blank"
              rel="noreferrer"
              className="mt-5 inline-flex items-center gap-2 rounded-full bg-gold px-5 py-2.5 text-[13px] font-bold text-ink shadow-[0_6px_18px_rgba(255,184,0,0.35)] transition hover:-translate-y-0.5 dark:text-[#322b45]"
            >
              <IconTelegram size={15} />
              @{tgBot.username}
            </a>
          )}
        </div>
      </section>

      {/* ── act 3.5: tech stack + architecture ── */}
      <section id="land-tech" className="py-12">
        <h2 className="font-display text-center text-[26px] text-ink sm:text-[32px]">{t("landTechTitle")}</h2>
        <p className="mx-auto mt-3 max-w-[560px] text-center text-[13px] leading-relaxed text-ink-soft">{t("landTechSub")}</p>
        <div className="mx-auto mt-6 flex max-w-3xl flex-wrap justify-center gap-2">
          {[
            "Next.js 15", "React 19 · TypeScript", "Tailwind v4", "Claude — tool use + prompt caching",
            "Claude Agent SDK — dual-engine orchestrator", "Kapruka MCP", "kapruka.com live promos · ratings · Q&A",
            "OpenAI — Whisper · TTS · embeddings", "Vector taste engine", "MongoDB", "Railway · kapuwa.shop", "Web Speech API", "Telegram Bot API", "Google Identity", "PWA",
          ].map((x) => (
            <span key={x} className="rounded-full border border-edge bg-card px-3.5 py-1.5 text-[11.5px] font-semibold text-ink-soft">
              {x}
            </span>
          ))}
        </div>
        <a href="/architecture.html" target="_blank" rel="noreferrer" className="mx-auto mt-7 block max-w-4xl overflow-hidden rounded-[24px] border border-line shadow-[0_30px_80px_rgba(64,41,112,0.25)] transition hover:-translate-y-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/architecture.svg" alt="Kapu architecture — channels → agent core → MCP shield → Kapruka MCP" className="w-full" loading="lazy" />
        </a>
        <p className="mt-3 text-center text-[11px] text-ink-faint">tap the diagram for the full page ↗</p>
      </section>

      {/* ── act 4: stats + CTA ── */}
      <section className="py-10 text-center">
        <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-center gap-2">
          {["26 agent tools", "Web · PWA · Telegram", "සිංහල · தமிழ் · English", "islandwide delivery", "voice + vision", "autonomous schedules"].map((x) => (
            <span key={x} className="rounded-full border border-edge bg-card px-3.5 py-1.5 text-[11.5px] font-semibold text-ink-soft">
              {x}
            </span>
          ))}
        </div>
        <button
          onClick={onStart}
          className="mt-8 inline-flex items-center gap-2.5 rounded-full bg-gold px-8 py-4 text-[15px] font-bold text-ink shadow-[0_10px_30px_rgba(255,184,0,0.4)] transition hover:-translate-y-0.5 active:scale-[0.98] dark:text-[#322b45]"
        >
          {t("landStart")}
          <IconArrowRight size={16} />
        </button>
        <a href="https://youtu.be/zQyPcT_V1_A" target="_blank" rel="noreferrer" className="mt-5 inline-flex items-center gap-2 text-[12px] font-semibold text-leaf transition hover:text-leaf-bright">
          ▶ Watch the 75-second film
        </a>
        <div className="mt-5 flex items-center justify-center gap-2.5">
          <a
            href="https://www.facebook.com/people/Kapuwashop/61591846257452/"
            target="_blank"
            rel="noreferrer"
            aria-label="Kapu on Facebook"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-card text-ink-soft transition hover:-translate-y-0.5 hover:text-leaf"
          >
            <IconFacebook size={16} />
          </a>
          <a
            href="https://www.instagram.com/kapuwashop"
            target="_blank"
            rel="noreferrer"
            aria-label="Kapu on Instagram"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-card text-ink-soft transition hover:-translate-y-0.5 hover:text-leaf"
          >
            <IconInstagram size={16} />
          </a>
        </div>
        <p className="mt-4 text-[11px] text-ink-faint">Kapu speaks සිංහල · தமிழ் · English · Tanglish — powered by the Kapruka MCP + Claude</p>
      </section>
    </div>
  );
}

// ── first-run guided tour — spotlight + tooltip coach marks ─────────────

const TOUR_STEPS: { key: string; selectors: string[]; t: StrKey; b: StrKey }[] = [
  { key: "ask", selectors: ['[data-tour="ask"]'], t: "tourT1", b: "tourB1" },
  { key: "scan", selectors: ['[data-tour="scan"]'], t: "tourT2", b: "tourB2" },
  { key: "voice", selectors: ['[data-tour="voice"]'], t: "tourT3", b: "tourB3" },
  { key: "wishes", selectors: ['[data-tour="wishes"]'], t: "tourT4", b: "tourB4" },
  { key: "tg", selectors: ['[data-tour="tg"]'], t: "tourT5", b: "tourB5" },
  { key: "lang", selectors: ['[data-tour="lang"]'], t: "tourT6", b: "tourB6" },
];

function TourOverlay({ step, onStep, onClose }: { step: number; onStep: (n: number) => void; onClose: () => void }) {
  const t = useT();
  const [rect, setRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);

  // resolve the current step's target — skip steps whose target isn't on screen
  useEffect(() => {
    let idx = step;
    let el: Element | null = null;
    while (idx < TOUR_STEPS.length) {
      el = TOUR_STEPS[idx].selectors.map((sel) => document.querySelector(sel)).find((e) => e && (e as HTMLElement).offsetParent !== null) ?? null;
      if (el) break;
      idx++;
    }
    if (!el) {
      onClose();
      return;
    }
    if (idx !== step) {
      onStep(idx);
      return;
    }
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    const measure = () => {
      const r = (el as HTMLElement).getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    const t1 = setTimeout(measure, 260); // after smooth scroll settles
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      clearTimeout(t1);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step, onStep, onClose]);

  if (!rect) return null;
  const last = step >= TOUR_STEPS.length - 1;
  const pad = 8;
  const below = rect.top + rect.height + 190 < window.innerHeight;
  const cardTop = below ? rect.top + rect.height + pad + 10 : undefined;
  const cardBottom = below ? undefined : window.innerHeight - rect.top + pad + 10;
  const cardLeft = Math.min(Math.max(rect.left + rect.width / 2 - 150, 12), window.innerWidth - 312);

  return (
    <div className="fixed inset-0 z-[60]" onClick={onClose}>
      {/* spotlight hole — one element, the shadow dims everything else */}
      <div
        className="absolute rounded-[18px] transition-all duration-300 ease-out"
        style={{
          top: rect.top - pad,
          left: rect.left - pad,
          width: rect.width + pad * 2,
          height: rect.height + pad * 2,
          boxShadow: "0 0 0 9999px rgba(21, 13, 40, 0.72), 0 0 0 3px rgba(255,184,0,0.9), 0 0 24px 4px rgba(255,184,0,0.35)",
        }}
      />
      <div
        className="rise absolute w-[300px] rounded-[18px] bg-card p-4 shadow-[0_24px_70px_rgba(0,0,0,0.45)]"
        style={{ top: cardTop, bottom: cardBottom, left: cardLeft }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <KapuMark size={22} radius={7} />
          <p className="font-display text-[16px] leading-tight">{t(TOUR_STEPS[step].t)}</p>
          <span className="ml-auto text-[10px] font-semibold text-ink-faint">{t("tourOf", { a: step + 1, b: TOUR_STEPS.length })}</span>
        </div>
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-soft">{t(TOUR_STEPS[step].b)}</p>
        <div className="mt-3.5 flex items-center gap-2">
          <div className="flex flex-1 gap-1">
            {TOUR_STEPS.map((x, i) => (
              <span key={x.key} className={`h-1 flex-1 rounded-full ${i <= step ? "bg-gold" : "bg-cream-deep"}`} />
            ))}
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <button onClick={onClose} className="text-[11.5px] font-medium text-ink-faint hover:text-ink-soft">
            {t("tourSkip")}
          </button>
          <button
            onClick={() => (last ? onClose() : onStep(step + 1))}
            className="rounded-full bg-gold px-4 py-2 text-[12px] font-bold text-ink shadow-[0_4px_12px_rgba(255,184,0,0.4)] transition active:scale-95 dark:text-[#322b45]"
          >
            {last ? t("tourDone") : t("tourNext")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── hero ticker — Kapu demonstrates itself, one typed phrase at a time ──

function HeroTicker({
  language,
  onRun,
}: {
  language: Language;
  onRun: (ph: (typeof HERO_PHRASES)["en"][number]) => void;
}) {
  const phrases = HERO_PHRASES[language];
  const [idx, setIdx] = useState(0);
  const [chars, setChars] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const reduced = useMemo(
    () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    []
  );
  const phrase = phrases[idx % phrases.length];

  useEffect(() => {
    setChars(0);
    setDeleting(false);
  }, [language]);

  useEffect(() => {
    if (reduced) {
      const id = setTimeout(() => setIdx((i) => i + 1), 3500);
      return () => clearTimeout(id);
    }
    const full = [...phrase.text]; // grapheme-ish via code points
    let delay: number;
    if (!deleting && chars < full.length) delay = 26 + Math.random() * 24;
    else if (!deleting) delay = 1800; // hold complete phrase
    else if (chars > 0) delay = 10;
    else delay = 250;
    const id = setTimeout(() => {
      if (!deleting && chars < full.length) setChars(chars + 1);
      else if (!deleting) setDeleting(true);
      else if (chars > 0) setChars(chars - 1);
      else {
        setDeleting(false);
        setIdx((i) => i + 1);
      }
    }, delay);
    return () => clearTimeout(id);
  }, [chars, deleting, phrase.text, reduced]);

  const shown = reduced ? phrase.text : [...phrase.text].slice(0, chars).join("");

  return (
    <button
      onClick={() => onRun(phrase)}
      className="mx-auto mt-4 block min-h-[3.4rem] max-w-[560px] text-center text-[15px] leading-relaxed text-ink-soft transition hover:text-ink sm:min-h-[2.2rem] sm:text-[16.5px]"
      title="Tap to try it"
    >
      <span className="font-medium">{shown}</span>
      {!reduced && <span className="ml-0.5 inline-block h-[1.05em] w-[2.5px] animate-pulse rounded bg-gold align-middle" />}
    </button>
  );
}

// ── error cards — every failure with grace (and "Aiyo!") ────────────────

function ErrorCard({
  part,
  onRetry,
  busy,
}: {
  part: Extract<Part, { kind: "error" }>;
  onRetry: (lastMessage: string) => void;
  busy: boolean;
}) {
  const t = useT();
  const [secondsLeft, setSecondsLeft] = useState(part.retryAfter ?? 12);
  const isRate = part.variant === "rate_limit";

  useEffect(() => {
    if (!isRate) return;
    if (secondsLeft <= 0) return;
    const id = setInterval(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, [isRate, secondsLeft]);

  useEffect(() => {
    // auto-retry once when the countdown lands
    if (isRate && secondsLeft === 0 && part.attempt === 0 && !busy) {
      part.attempt = 1;
      onRetry(part.lastMessage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft]);

  if (isRate) {
    const total = part.retryAfter ?? 12;
    return (
      <div className="rise my-2 max-w-md rounded-2xl border border-line bg-card p-4 shadow-[0_2px_10px_rgba(64,41,112,0.05)]">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-gold-soft text-gold-deep">
            <IconClock size={16} />
          </span>
          <div>
            <p className="text-[13.5px] font-semibold">{t("gatesBusy")}</p>
            <p className="text-[12px] text-ink-soft">{t("retryingIn", { s: Math.max(0, secondsLeft) })}</p>
          </div>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-cream-deep">
          <div
            className="h-full rounded-full bg-gold transition-[width] duration-1000 ease-linear"
            style={{ width: `${(1 - Math.max(0, secondsLeft) / total) * 100}%` }}
          />
        </div>
        <p className="mt-2 text-[11px] text-ink-faint">{t("placeHeld")}</p>
      </div>
    );
  }

  if (part.variant === "connection") {
    return (
      <div className="rise my-2 max-w-md rounded-2xl border border-line bg-card p-4 shadow-[0_2px_10px_rgba(64,41,112,0.05)]">
        <div className="flex items-start gap-2.5">
          <IconWifiOff size={17} className="mt-0.5 shrink-0 text-clay" />
          <div>
            <p className="text-[13.5px] font-bold text-clay">{t("aiyoLost")}</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-soft">{t("basketSafe")}</p>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => onRetry(part.lastMessage)}
            disabled={busy}
            className="flex items-center gap-2 rounded-[11px] bg-leaf px-4 py-2 text-[12.5px] font-semibold text-white transition active:scale-95 disabled:opacity-50 dark:bg-[#402970]"
          >
            <IconRetry size={13} />
            {t("tryAgain")}
          </button>
          <button
            onClick={() => void navigator.clipboard?.writeText(part.lastMessage)}
            className="rounded-[11px] border border-edge px-4 py-2 text-[12.5px] font-semibold text-ink-soft transition active:scale-95"
          >
            {t("copyMsg")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rise my-2 max-w-md rounded-2xl border border-line bg-card p-4 shadow-[0_2px_10px_rgba(64,41,112,0.05)]">
      <p className="text-[13px] leading-relaxed text-ink-soft">{part.message}</p>
      {part.variant === "generic" && (
        <button
          onClick={() => onRetry(part.lastMessage)}
          disabled={busy}
          className="mt-2.5 flex items-center gap-2 rounded-[11px] bg-leaf px-4 py-2 text-[12.5px] font-semibold text-white transition active:scale-95 disabled:opacity-50 dark:bg-[#402970]"
        >
          <IconRetry size={13} />
          {t("tryAgain")}
        </button>
      )}
    </div>
  );
}

// ── the immersive voice canvas ──────────────────────────────────────────

const VOICE_BARS = [0.35, 0.6, 0.85, 0.5, 1, 0.7, 0.9, 0.45, 0.75, 0.55, 0.4];

// Rotating "thinking" lines — waiting feels shorter when Kapu mutters.
const THINK_QUIPS: Record<Language, string[]> = {
  en: ["Hmm, let me check…", "Searching the Kapruka shelves…", "Poddak inna — almost there…", "Picking only the good ones…"],
  si: ["හ්ම්, බලන්නම්කෝ…", "Kapruka රාක්ක බලනවා…", "පොඩ්ඩක් ඉන්න — ළඟයි…", "හොඳම ටික තෝරනවා…"],
  ta: ["ம்ம், பார்க்கிறேன்…", "Kapruka-வில் தேடுகிறேன்…", "கொஞ்சம் பொறுங்கள் — கிட்டத்தட்ட…", "நல்லவற்றைத் தேர்கிறேன்…"],
};

function VoiceOverlay({
  state,
  language,
  interim,
  spoken,
  toolLabel,
  blocks,
  actions,
  deliverTo,
  recorderMode,
  onEnd,
  onInterrupt,
  onDone,
  onKeyboard,
  onCycleLang,
}: {
  state: VoiceState;
  language: Language;
  interim: string;
  spoken: string;
  toolLabel: string | null;
  blocks: UiBlock[];
  actions: BlockActions;
  deliverTo?: string;
  recorderMode: boolean;
  onEnd: () => void;
  onInterrupt: () => void;
  onDone: () => void;
  onKeyboard: () => void;
  onCycleLang: () => void;
}) {
  const listening = state === "listening";
  const thinking = state === "thinking";
  const speaking = state === "speaking";
  const hasBlocks = blocks.length > 0;
  const t = makeT(language);

  const [quip, setQuip] = useState(0);
  useEffect(() => {
    if (!thinking) return;
    setQuip(0);
    const id = setInterval(() => setQuip((q) => q + 1), 2600);
    return () => clearInterval(id);
  }, [thinking]);

  // keep the newest card in view as results stream in
  const blocksRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    blocksRef.current?.scrollTo({ top: blocksRef.current.scrollHeight, behavior: "smooth" });
  }, [blocks.length]);

  const caption = listening
    ? interim ||
      (recorderMode
        ? language === "si"
          ? "කතා කරන්න — නැවතුනාම මං යවන්නම්"
          : language === "ta"
            ? "பேசுங்கள் — நிறுத்தியதும் அனுப்புகிறேன்"
            : "Speak — I'll send it when you pause"
        : language === "si"
          ? "අහගෙන ඉන්නවා…"
          : language === "ta"
            ? "கேட்டுக்கொண்டிருக்கிறேன்…"
            : "I'm listening…")
    : speaking
      ? spoken
      : THINK_QUIPS[language][quip % THINK_QUIPS[language].length];

  const statusPill = listening ? (
    <span className="flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-[12px] font-semibold text-gold">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold" />
      {t("listeningPill")}
    </span>
  ) : thinking ? (
    <span className="flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-[12px] font-semibold text-white/80">
      <span className="flex gap-1">
        <span className="dot h-1.5 w-1.5 rounded-full bg-[#C4B0FF]" />
        <span className="dot h-1.5 w-1.5 rounded-full bg-[#C4B0FF]" />
        <span className="dot h-1.5 w-1.5 rounded-full bg-[#C4B0FF]" />
      </span>
      {toolLabel ?? t("thinkingPill")}
    </span>
  ) : (
    <button onClick={onInterrupt} className="flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-[12px] font-semibold text-white/80">
      🔊 {t("tapInterrupt")}
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col overflow-hidden text-white"
      style={{ background: "radial-gradient(900px 600px at 50% 38%, #4A3180 0%, #2A1A4E 55%, #1D1233 100%)" }}
      onClick={speaking ? onInterrupt : undefined}
    >
      {/* brand watermark (assets/images/bg-voice.svg) */}
      <span
        aria-hidden
        className="pointer-events-none absolute -bottom-24 left-1/2 -translate-x-1/2 select-none text-[300px] leading-none text-white/[0.025]"
        style={{ fontFamily: "var(--font-sinhala-var), 'Noto Sans Sinhala'" }}
      >
        කපූ
      </span>
      <header
        className="flex items-center gap-2.5 px-5 py-4"
        style={{ paddingTop: "max(1rem, env(safe-area-inset-top))" }}
      >
        <KapuMark size={30} radius={9} />
        <p className="font-display text-[17px]">
          Kapu <span className="italic text-gold">voice</span>
        </p>
        <button
          onClick={onCycleLang}
          className="ml-auto flex items-center gap-1.5 rounded-full bg-white/[0.08] px-3 py-1.5 text-[11px] font-semibold text-white/80 transition active:scale-95"
          title="Tap to switch the language I listen in"
        >
          <IconGlobe size={12} />
          {LANG_LABEL[language]}
          <span className="text-white/40">▸</span>
        </button>
      </header>

      <div
        className={`flex min-h-0 flex-1 flex-col items-center px-4 text-center sm:px-6 ${
          hasBlocks ? "justify-start gap-3 pt-1" : "justify-center gap-6"
        }`}
      >
        {/* orb — compact once cards arrive */}
        <div className="relative shrink-0">
          {(listening || speaking) && (
            <>
              <span className={`voicering absolute inset-0 border border-gold/40 ${hasBlocks ? "rounded-[16px]" : "rounded-[28px]"}`} />
              <span
                className={`voicering absolute inset-0 border border-gold/25 ${hasBlocks ? "rounded-[16px]" : "rounded-[28px]"}`}
                style={{ animationDelay: "1.1s" }}
              />
            </>
          )}
          {thinking && (
            <>
              <span className="spark absolute -left-7 top-2 h-1.5 w-1.5 rounded-full bg-gold" />
              <span className="spark absolute -right-8 top-8 h-2 w-2 rounded-full bg-gold" style={{ animationDelay: "0.5s" }} />
              <span className="spark absolute -top-5 right-2 h-1 w-1 rounded-full bg-gold" style={{ animationDelay: "0.9s" }} />
            </>
          )}
          <span className={`block shadow-[0_18px_50px_rgba(0,0,0,0.4)] ${hasBlocks ? "rounded-[16px]" : "rounded-[28px]"}`}>
            <KapuMark size={hasBlocks ? 52 : 88} radius={hasBlocks ? 15 : 24} />
          </span>
        </div>

        {/* waveform */}
        <div className={`flex shrink-0 items-center gap-[3px] ${hasBlocks ? "h-5" : "h-9"}`}>
          {VOICE_BARS.map((h, i) => (
            <span
              key={i}
              className={`wavebar w-[3.5px] rounded-full ${listening ? "bg-gold" : speaking ? "bg-[#A78BFA]" : "bg-white/25"}`}
              style={{
                height: `${h * (hasBlocks ? 18 : 34)}px`,
                animationDelay: `${i * 0.08}s`,
                animationPlayState: thinking ? "paused" : "running",
              }}
            />
          ))}
        </div>

        {/* live caption */}
        <p
          className={`font-display max-w-[640px] shrink-0 leading-snug ${
            hasBlocks ? "line-clamp-2 text-[16px] sm:text-[19px]" : "text-[24px] sm:text-[30px]"
          } ${thinking ? "italic text-white/75" : ""}`}
          style={{ overflowWrap: "anywhere" }}
        >
          {caption}
          {listening && <span className="ml-1 inline-block h-6 w-[3px] animate-pulse rounded bg-gold align-middle" />}
        </p>

        <span className="shrink-0">{statusPill}</span>

        {/* this turn's cards — stream in as the agent works */}
        {hasBlocks && (
          <div ref={blocksRef} className="min-h-0 w-full max-w-2xl flex-1 overflow-y-auto overscroll-contain text-left">
            <div className="flex flex-col gap-3 pb-3">
              {blocks.map((b, i) => (
                <div key={i} className="voiceblock" style={{ animationDelay: `${Math.min(i, 4) * 80}ms` }}>
                  <BlockRenderer block={b} actions={actions} deliverTo={deliverTo} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <footer
        className="flex items-center justify-center gap-4 pb-8"
        style={{ paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }}
      >
        {recorderMode && listening ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDone();
            }}
            className="flex h-12 items-center gap-2 rounded-full bg-gold px-5 text-[13.5px] font-bold text-[#322b45] shadow-[0_10px_26px_rgba(255,184,0,0.4)] transition active:scale-95"
          >
            <IconCheck size={14} />
            {t("doneSend")}
          </button>
        ) : (
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.08] text-white/85">
            <IconMic size={19} />
          </span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEnd();
          }}
          className="flex h-[52px] items-center gap-2.5 rounded-full bg-clay px-7 text-[14px] font-bold text-white shadow-[0_10px_30px_rgba(192,86,33,0.4)] transition active:scale-95"
        >
          <IconStop size={15} />
          {t("endVoice")}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onKeyboard();
          }}
          title="Type instead"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.08] text-white/85 transition active:scale-95"
        >
          <IconKeyboard size={19} />
        </button>
      </footer>
    </div>
  );
}
