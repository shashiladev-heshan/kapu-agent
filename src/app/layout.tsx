import type { Metadata, Viewport } from "next";
import "./globals.css";
// Fonts (Instrument Serif/Sans + Noto Sinhala/Tamil) are SELF-HOSTED:
// public/fonts.css + public/fonts/*.woff2, linked raw in <head> below.
// Two constraints force this shape: next/font/google fetches from
// fonts.gstatic.com at BUILD time and a CDN outage killed two Railway
// deploys on 14 Aug; and the app CSS pipeline's minifier strips
// variable-weight `font-weight: 400 700` @font-face rules, so the file
// must bypass it.

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
      "Whisper a wish in සිංහල, தமிழ், English or Tanglish — voice, photo or text — and Kapu shops all of Kapruka for you. Web · PWA · Telegram · WhatsApp.",
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
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* PWA links MUST be here, not left to the metadata export. This
            layout renders an explicit <head>, and Next then emits the
            metadata tags into the <body> instead — where browsers ignore
            `rel="manifest"` entirely. The manifest was therefore never
            fetched and the app was never installable in ANY browser: no
            address-bar install icon, no beforeinstallprompt. Verified via
            CDP — Page.getAppManifest returned an empty url until this. */}
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <link rel="stylesheet" href="/fonts.css?v=1" />
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
