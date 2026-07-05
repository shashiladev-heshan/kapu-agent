import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kapu — Sri Lanka's AI Shopping Concierge",
    short_name: "Kapu",
    description:
      "Kapu (කපූ) — chat in Sinhala, Tamil, English or Tanglish and shop all of Kapruka.com: groceries, phones, cakes, gifts home.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F6F4FA",
    theme_color: "#402970",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
