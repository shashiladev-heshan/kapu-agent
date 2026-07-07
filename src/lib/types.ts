// Shared types: SSE stream events, UI blocks, cart, session context.

export type Currency = "LKR" | "USD" | "GBP" | "AUD" | "CAD" | "EUR";
export type Language = "en" | "si" | "ta";

export interface ProductSummary {
  id: string;
  name: string;
  price: number | null;
  compare_at_price?: number | null;
  currency: string;
  image?: string | null;
  in_stock?: boolean;
  stock_level?: string | null;
  category?: string | null;
  url?: string | null;
  summary?: string | null;
  /** kapruka.com can ship this abroad (diaspora self-orders) — hero badge */
  ships_intl?: boolean;
  /** top relevance/bestseller hit — rendered as the "KAPU'S PICK" badge */
  pick?: boolean;
  /** cheapest in this grid (when distinct from the pick) — "BEST VALUE" badge */
  value?: boolean;
}

export interface ProductDetail extends ProductSummary {
  description?: string | null;
  images?: string[];
  variants?: unknown[];
  attributes?: Record<string, unknown>;
}

export interface CartItem {
  product_id: string;
  name: string;
  price: number | null;
  currency: string;
  image?: string | null;
  quantity: number;
  icing_text?: string;
  category?: string | null;
}

export interface Cart {
  items: CartItem[];
  currency: Currency;
}

export interface OrderSummaryData {
  items: CartItem[];
  recipient: { name: string; phone: string };
  delivery: {
    address: string;
    city: string;
    location_type?: string;
    date: string;
    instructions?: string;
  };
  sender?: { name: string; anonymous?: boolean };
  gift_message?: string;
  subtotal: number;
  delivery_rate?: number | null;
  delivery_available?: boolean;
  delivery_note?: string;
  perishable_warning?: string;
  total: number;
  currency: string;
  /** e.g. "2 items · gift delivery" */
  tagline?: string;
}

// ── UI blocks the agent emits alongside text ──────────────────────────
export type UiBlock =
  | { type: "product_grid"; title?: string; products: ProductSummary[] }
  | { type: "product_hero"; product: ProductDetail }
  | { type: "compare_grid"; products: ProductDetail[]; verdict?: string }
  | { type: "delivery_card"; city: string; date?: string; available: boolean; rate?: number; currency?: string; reason?: string; next_available_date?: string; perishable_warning?: string }
  | { type: "cart"; cart: Cart }
  | { type: "order_summary"; summary: OrderSummaryData }
  | { type: "pay_link"; order_ref: string; pay_url: string; total?: number; currency?: string; created_at?: number; expires_at?: string; breakdown?: { items_total: number | null; delivery_fee: number | null; addons_total: number | null } }
  | { type: "order_timeline"; order_number: string; status: string; status_display?: string; progress: { step: string; timestamp?: string | null }[]; has_delivery_photo?: boolean; has_delivery_video?: boolean; items?: { name?: string; quantity?: number }[] }
  | { type: "greeting_card"; to: string; message: string; from?: string; glyph: string; color_from: string; color_to: string }
  | { type: "no_results"; query: string }
  | { type: "chips"; chips: string[] }
  // voice mode: the exact text the TTS should speak (may differ from the
  // displayed reply, e.g. romanized colloquial Sinhala). Never rendered.
  | { type: "speech"; text: string };

// ── persisted UI transcript (rehydrates the visible chat on reload) ───
export type UiTurn =
  | { role: "user"; text: string; at: number }
  | { role: "assistant"; text: string; blocks: UiBlock[]; at: number };

// ── SSE events streamed to the browser ────────────────────────────────
export type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; status: "start" | "end"; label?: string }
  | { type: "block"; block: UiBlock }
  | { type: "cart"; cart: Cart }
  | { type: "done" }
  | { type: "error"; message: string; kind?: "rate_limit" | "auth" | "generic"; retry_after?: number };

export interface ChatRequest {
  sessionId: string;
  message: string;
  language?: Language;
  currency?: Currency;
  /** true when the message came from the voice loop — replies are spoken */
  voice?: boolean;
  /** user's default delivery city ("Deliver to Colombo 07" chip) */
  deliverTo?: string;
  /** preferred delivery date picked on a product card (YYYY-MM-DD) */
  preferredDate?: string;
  /** the user's ♥ favorites — compact "name (id)" strings for agent context */
  favorites?: string[];
  /** "My Kapu" standing rules — the user's custom instructions */
  rules?: string;
}

/** GET /api/session response — used to rehydrate a recent wish. */
export interface SessionSnapshot {
  exists: boolean;
  /** a turn is still running server-side — poll until it lands */
  busy?: boolean;
  title?: string;
  ui: UiTurn[];
  cart: Cart;
  language: Language;
  currency: Currency;
}

/** Saved gift recipient — "send it to Amma" memory (spec D2/H1). */
export interface Recipient {
  id: string;
  name: string;
  relationship?: string;
  phone?: string;
  address?: string;
  city?: string;
  notes?: string;
}

/** Saved occasion — birthdays/anniversaries (spec H2). date: YYYY-MM-DD or MM-DD (recurring). */
export interface Occasion {
  id: string;
  recipient: string;
  type: string;
  date: string;
  recurring?: boolean;
}

/** POST /api/cart request — instant basket ops (no LLM round-trip). */
export interface CartRequest {
  sessionId: string;
  action: "add" | "set_qty" | "remove" | "set_icing";
  product_id: string;
  quantity?: number;
  icing_text?: string;
  /** product details already known client-side (avoids an MCP fetch) */
  known?: { name: string; price: number | null; currency: string; image?: string | null; category?: string | null };
}
