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
        {/* Apply saved theme before first paint to avoid a light flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("kapu_theme");if(t==="dark"||(!t&&matchMedia("(prefers-color-scheme: dark)").matches)){document.documentElement.classList.add("dark");var m=document.querySelector('meta[name="theme-color"]');m&&m.setAttribute("content","#151022")}}catch(e){}`,
          }}
        />
      </head>
      <body className="bg-cream text-ink antialiased">{children}</body>
    </html>
  );
}
