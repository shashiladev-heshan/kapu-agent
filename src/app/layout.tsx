import type { Metadata, Viewport } from "next";
import { Instrument_Sans, Instrument_Serif, Noto_Sans_Sinhala, Noto_Sans_Tamil } from "next/font/google";
import "./globals.css";

// Editorial serif for display/prices + Instrument Sans body, with Noto
// Sinhala/Tamil so සිංහල/தமிழ் render crisply on every OS (judges may be
// on Windows, whose Sinhala fallback is rough).
const display = Instrument_Serif({
  subsets: ["latin"],
  variable: "--font-display-var",
  weight: "400",
  style: ["normal", "italic"],
});
const body = Instrument_Sans({ subsets: ["latin"], variable: "--font-body-var", weight: ["400", "500", "600", "700"] });
const sinhala = Noto_Sans_Sinhala({ subsets: ["sinhala"], variable: "--font-sinhala-var", weight: ["400", "500", "600", "700"] });
const tamil = Noto_Sans_Tamil({ subsets: ["tamil"], variable: "--font-tamil-var", weight: ["400", "500", "600", "700"] });

export const metadata: Metadata = {
  title: "Kapu — Sri Lanka's AI Shopping Concierge",
  description:
    "Chat in Sinhala, Tamil, English or Tanglish and shop all of Kapruka.com — groceries, phones, medicine, cakes and gifts home. Built for the Kapruka Agent Challenge 2026.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Kapu",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/icon-192.png",
  },
  metadataBase: new URL("https://kapuwa.shop"),
  openGraph: {
    title: "Kapu (කපූ) — Sri Lanka's wish-granting shopping agent",
    description:
      "Whisper a wish in සිංහල, தமிழ், English or Tanglish — voice, photo or text — and Kapu shops all of Kapruka for you. Web · PWA · Telegram.",
    url: "https://kapuwa.shop",
    siteName: "Kapu",
    images: [{ url: "/icons/icon-512.png", width: 512, height: 512, alt: "Kapu — the wish tree" }],
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Kapu (කපූ) — Sri Lanka's wish-granting shopping agent",
    description: "Trilingual AI shopping agent for Kapruka — voice, vision, Telegram, autonomous schedules.",
    images: ["/icons/icon-512.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#f6f4fa",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} ${sinhala.variable} ${tamil.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Apply theme before first paint — Kapu defaults to DARK; an explicit
            light choice (toggle) wins. OS theme changes are followed live in
            KapuApp until the user picks one. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var t=null;try{t=localStorage.getItem("kapu_theme")}catch(e){}if(t!=="light"){document.documentElement.classList.add("dark");var m=document.querySelector('meta[name="theme-color"]');m&&m.setAttribute("content","#151022")}})()`,
          }}
        />
        {/* Chrome fires beforeinstallprompt during load — usually BEFORE React
            hydrates, so a listener added in a useEffect misses it and the
            install button never appears. Catch it here and park it on window
            for useInstallPrompt() to pick up. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){window.__kapuInstall=null;window.addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.__kapuInstall=e;window.dispatchEvent(new Event("kapu:installready"))});window.addEventListener("appinstalled",function(){window.__kapuInstall=null;window.dispatchEvent(new Event("kapu:installed"))})})()`,
          }}
        />
      </head>
      <body className="bg-cream text-ink antialiased">{children}</body>
    </html>
  );
}
