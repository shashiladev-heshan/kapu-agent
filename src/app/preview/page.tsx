"use client";

// Dev-only visual harness: renders every UiBlock + edge-state card with
// fixture data so the whole design system can be eyeballed (and screenshot)
// without burning agent turns. Unlinked from the app; harmless if found.

import { useEffect, useState } from "react";
import { BlockRenderer, type BlockActions } from "@/components/blocks";
import { LangProvider } from "@/lib/client/i18n";
import type { Language, UiBlock } from "@/lib/types";

const actions: BlockActions = {
  onAction: (t) => console.log("action:", t),
  onDeliverTo: (city) => console.log("deliver-to:", city),
  onCartAdd: (p) => console.log("add:", p.id),
  onCartQty: (id, q) => console.log("qty:", id, q),
  onCartIcing: (id, t) => console.log("icing:", id, t),
  onPreferDate: (d) => console.log("date:", d),
  onFocusComposer: () => console.log("focus"),
  onOpenProduct: (p) => console.log("open:", p.id),
  onToggleFav: (p) => console.log("fav:", p.id),
  isFav: () => false,
};

const IMG = "https://static2.kapruka.com/product-image/width=330,quality=93,f=auto/shops/specialGifts/cake00ka002034_1.jpg";

const blocks: UiBlock[] = [
  {
    type: "product_grid",
    title: "Under Rs. 60,000 — the sweet spot",
    products: [
      { id: "p1", name: "Xiaomi Redmi Note 13 8/256GB", price: 58900, compare_at_price: 64500, currency: "LKR", image: null, category: "Electronic", in_stock: true, pick: true },
      { id: "p2", name: "Samsung Galaxy A25 5G 6/128GB", price: 56400, currency: "LKR", image: null, category: "Electronic", in_stock: true },
      { id: "p3", name: "Redmi 13C 8/256GB — Navy Blue", price: 42900, currency: "LKR", image: null, category: "Electronic", in_stock: true },
      { id: "p4", name: "Infinix Note 40 8/256GB", price: 54700, currency: "LKR", image: null, category: "Electronic", in_stock: false },
    ],
  },
  {
    type: "product_hero",
    product: {
      id: "cake00KA001685",
      name: "Ribbon Chocolate Cake — 1kg",
      price: 4850,
      compare_at_price: 5400,
      ships_intl: true,
      currency: "LKR",
      image: IMG,
      images: [IMG, IMG, IMG],
      category: "cakes",
      in_stock: true,
      summary: "Kandy's favourite ribbon cake, baked fresh.",
      attributes: { vendor: "Kapruka Signature Bakery", weight: "2.77" },
    },
  },
  {
    type: "compare_grid",
    verdict: "take the Redmi for battery life & storage; the Samsung if Amma keeps phones for 4+ years.",
    products: [
      { id: "p1", name: "Redmi Note 13 8/256GB", price: 58900, compare_at_price: 64500, currency: "LKR", image: null, category: "Electronic", in_stock: true, attributes: { vendor: "Pentra Holdings" } },
      { id: "p2", name: "Galaxy A25 5G 6/128GB", price: 56400, currency: "LKR", image: null, category: "Electronic", in_stock: true, attributes: { vendor: "Samsung LK" } },
    ],
  },
  { type: "delivery_card", city: "Kandy", date: "2026-07-05", available: true, rate: 1075, currency: "LKR", perishable_warning: "Same-day or next-day delivery is recommended; freshness on 2026-07-06 is not guaranteed." },
  { type: "delivery_card", city: "Nuwara Eliya", available: false, next_available_date: "2026-07-08" },
  {
    type: "category_tree",
    categories: [
      { name: "Chocolates", url: "https://www.kapruka.com/chocolates", children: ["Cadbury", "Anods Cocoa", "Chocolate Hampers", "5 Star Hotels"] },
      { name: "Giftset", url: "https://www.kapruka.com/giftset", children: ["Gift Sets For Mom", "Gift Sets For Him", "Gift Sets For Kids"] },
      { name: "Grocery", url: "https://www.kapruka.com/grocery", children: ["Bagged Food", "Beverages", "Frozen Food", "Seafood"] },
      { name: "pirikara", url: "https://www.kapruka.com/pirikara", children: ["Worship Items", "Religious Gifts And Offerings"] },
      { name: "Giftcert", url: "https://www.kapruka.com/giftcert", children: ["Hotels and Restaurants", "Jewellery", "Apparel Shops"] },
      { name: "Fruits", url: "https://www.kapruka.com/fruits", children: ["Fruit Basket", "Seasonal"] },
    ],
  },
  {
    type: "cart",
    cart: {
      currency: "LKR",
      items: [
        { product_id: "cake00KA001685", name: "Ribbon Chocolate Cake — 1kg", price: 4850, currency: "LKR", quantity: 1, icing_text: "Happy Birthday Amma!", category: "cakes" },
        { product_id: "p1", name: "Xiaomi Redmi Note 13 8/256GB", price: 58900, currency: "LKR", quantity: 1, category: "Electronic" },
        { product_id: "g1", name: "Basmathi Rice 5kg — Araliya", price: 3150, currency: "LKR", quantity: 2, category: "Grocery" },
      ],
    },
  },
  {
    type: "order_summary",
    summary: {
      items: [
        { product_id: "cake00KA001685", name: "Ribbon Chocolate Cake — 1kg", price: 4850, currency: "LKR", quantity: 1, icing_text: "Happy Birthday Amma!", category: "cakes" },
        { product_id: "p1", name: "Xiaomi Redmi Note 13 8/256GB", price: 58900, currency: "LKR", quantity: 1, category: "Electronic" },
      ],
      recipient: { name: "W. Kumarihamy (Amma)", phone: "077 234 5678" },
      delivery: { address: "24/3 Temple Road", city: "Kandy", date: "2026-07-05", location_type: "house" },
      sender: { name: "Heshan", anonymous: true },
      gift_message: "සුබ උපන්දිනයක් අම්මේ!",
      subtotal: 63750,
      delivery_rate: 550,
      delivery_available: true,
      total: 64300,
      currency: "LKR",
      tagline: "2 items · gift delivery",
    },
  },
  {
    type: "pay_link",
    order_ref: "KPR-2481-7736",
    pay_url: "https://www.kapruka.com",
    total: 64300,
    currency: "LKR",
    created_at: Date.now(),
    breakdown: { items_total: 63750, delivery_fee: 550, addons_total: null },
  },
  {
    // realistic MCP shape (verified live 7 Jul): free-text warehouse/courier
    // steps in shouting case, pre-formatted SL wall-clock timestamps
    type: "order_timeline",
    order_number: "440913866",
    status: "out-for-delivery",
    status_display: "Out for delivery",
    progress: [
      { step: "Order Confirmed and Awaiting preparation", timestamp: "JUL 4, 2026 9:28 PM" },
      { step: "Order Received", timestamp: "Jul 4, 2026 10:19 PM" },
      { step: "Kapruka Warehouse, Order is preparing", timestamp: "JUL 5, 2026 7:07 AM" },
      { step: "Kapruka Warehouse, Order Prepared", timestamp: "JUL 5, 2026 9:40 AM" },
      { step: "Order Has been received by our delivery agent", timestamp: "JUL 5, 2026 11:43 AM" },
      { step: "Order has been out for delivery", timestamp: "JUL 5, 2026 11:43 AM" },
    ],
    items: [{ name: "Ribbon Chocolate Cake — 1kg", quantity: 1 }],
  },
  {
    type: "order_timeline",
    order_number: "440913866",
    status: "delivered",
    status_display: "Delivered",
    progress: [
      { step: "Order Received", timestamp: "Jul 4, 2026 10:19 PM" },
      { step: "Kapruka Warehouse, Order Prepared", timestamp: "JUL 5, 2026 9:40 AM" },
      { step: "Order has been out for delivery", timestamp: "JUL 5, 2026 11:43 AM" },
      { step: "Order has been delivered", timestamp: "JUL 5, 2026 1:17 PM" },
    ],
    has_delivery_photo: true,
    has_delivery_video: true,
  },
  {
    // sparse response (fresh order, no history yet) → canonical skeleton
    type: "order_timeline",
    order_number: "440913867",
    status: "confirmed",
    status_display: "Confirmed",
    progress: [],
  },
  { type: "no_results", query: "durian cake" },
  { type: "chips", chips: ["Compare the top two", "Only Samsung", "50,000ට යටින් instead"] },
];

export default function Preview() {
  const [lang, setLang] = useState<Language>("en");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    document.documentElement.classList.toggle("dark", params.get("dark") === "1");
    const l = params.get("lang");
    if (l === "si" || l === "ta" || l === "en") setLang(l);
  }, []);
  return (
    <LangProvider value={lang}>
      <div className="mx-auto max-w-3xl px-4 py-8">
        <p className="font-display mb-4 text-2xl text-leaf">Kapu block gallery · {lang}</p>
        {blocks.map((b, i) => (
          <BlockRenderer key={i} block={b} actions={actions} deliverTo="Kandy" />
        ))}
      </div>
    </LangProvider>
  );
}
