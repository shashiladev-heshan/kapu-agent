// The agent's visible "thinking steps" — one human line per tool call,
// shared by BOTH engines (loop.ts + engine-sdk.ts) so labels can't drift.
// TOOL_LABELS stay generic (voice-canvas pill + fallback); stepFor() folds
// the tool INPUT into a specific line for the collapsible steps timeline.

export const TOOL_LABELS: Record<string, string> = {
  search_products: "Searching Kapruka…",
  get_product: "Checking the details…",
  compare_products: "Comparing options…",
  get_recommendations: "Curating picks for you…",
  get_hot_deals: "Hunting today's deals…",
  import_product: "Checking the import cost…",
  kapruka_help: "Reading Kapruka's help pages…",
  crown_pick: "Moving my badge…",
  list_categories: "Browsing categories…",
  resolve_city: "Finding your city…",
  check_delivery: "Checking delivery…",
  cart_update: "Updating your basket…",
  view_cart: "Opening your basket…",
  propose_order: "Preparing your order summary…",
  create_order: "Placing your order…",
  track_order: "Tracking your order…",
  remember_recipient: "Remembering them…",
  get_recipients: "Checking your people…",
  forget_recipient: "Forgetting…",
  save_occasion: "Saving the date…",
  get_upcoming_occasions: "Checking your calendar…",
  get_my_orders: "Looking at your orders…",
  account_profile: "Recognising you…",
  account_orders: "Looking up your Kapruka orders…",
  account_addresses: "Finding your saved addresses…",
  render_picks: "Making a shareable card…",
  create_schedule: "Setting up your standing wish…",
  list_schedules: "Checking your schedules…",
  cancel_schedule: "Cancelling…",
  create_card: "Designing your card…",
  design_cake: "Firing up the Cake Studio…",
  suggest_replies: "…",
};

const clip = (v: unknown, max = 60): string => {
  const s = String(v ?? "").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

/** Human timeline line for a tool call, or null for silent tools (say/chips). */
export function stepFor(name: string, input: Record<string, unknown>): string | null {
  switch (name) {
    case "say":
    case "suggest_replies":
      return null;
    case "search_products": {
      const term = clip(input.q);
      const under =
        typeof input.max_price === "number" && input.max_price > 0
          ? ` under Rs ${Number(input.max_price).toLocaleString("en-LK")}`
          : "";
      return term ? `Searching Kapruka for “${term}”${under}` : "Searching Kapruka";
    }
    case "get_product":
      return "Opening the full product details";
    case "compare_products": {
      const n = Array.isArray(input.product_ids) ? input.product_ids.length : 0;
      return n >= 2 ? `Comparing ${n} options side by side` : "Comparing options";
    }
    case "crown_pick":
      return "Crowning my pick";
    case "get_hot_deals":
      return "Hunting today's live deals on kapruka.com";
    case "import_product": {
      const host = /amazon\.in/i.test(String(input.url)) ? "Amazon.in" : /ebay\./i.test(String(input.url)) ? "eBay" : "Amazon";
      return `Checking the import cost from ${host}`;
    }
    case "kapruka_help": {
      const q = clip(input.question, 60);
      return q ? `Checking Kapruka's policies for “${q}”` : "Reading Kapruka's help pages";
    }
    case "get_recommendations":
      return input.product_id ? "Finding more like this" : "Curating picks from your taste";
    case "list_categories":
      return "Browsing the category tree";
    case "resolve_city": {
      const c = clip(input.query, 40);
      return c ? `Matching “${c}” to a delivery city` : "Finding your city";
    }
    case "check_delivery": {
      const c = clip(input.city, 40);
      const d = clip(input.delivery_date, 12);
      return `Checking delivery${c ? ` to ${c}` : ""}${d ? ` for ${d}` : ""}`;
    }
    case "cart_update":
      return Number(input.quantity) === 0 ? "Removing it from your basket" : "Updating your basket";
    case "view_cart":
      return "Opening your basket";
    case "propose_order": {
      const r = clip(input.recipient_name, 30);
      return `Preparing the order summary${r ? ` for ${r}` : ""}`;
    }
    case "create_order":
      return "Placing your confirmed order";
    case "track_order": {
      const no = clip(input.order_number, 24);
      return no ? `Tracking order ${no}` : "Tracking your order";
    }
    case "remember_recipient": {
      const n = clip(input.name, 30);
      return n ? `Remembering ${n}` : "Remembering them";
    }
    case "get_recipients":
      return "Checking your saved people";
    case "forget_recipient": {
      const n = clip(input.name, 30);
      return n ? `Forgetting ${n}` : "Forgetting";
    }
    case "save_occasion": {
      const t = clip(input.type, 30);
      const r = clip(input.recipient, 30);
      return t && r ? `Saving ${r}'s ${t}` : "Saving the date";
    }
    case "get_upcoming_occasions":
      return "Checking upcoming occasions";
    case "get_my_orders":
      return "Looking through your past orders";
    case "account_profile":
      return "Recognising your Kapruka account";
    case "account_orders":
      return "Looking up your Kapruka orders";
    case "account_addresses":
      return "Finding your saved addresses";
    case "render_picks": {
      const n = Array.isArray(input.items) ? input.items.length : 0;
      return n ? `Making a shareable card of ${n} pick${n > 1 ? "s" : ""}` : "Making a shareable card";
    }
    case "create_schedule": {
      const t = clip(input.title, 44);
      return t ? `Setting up “${t}”` : "Setting up your standing wish";
    }
    case "list_schedules":
      return "Checking your standing wishes";
    case "cancel_schedule":
      return "Cancelling the schedule";
    case "create_card": {
      const to = clip(input.to, 30);
      return to ? `Designing a card for ${to}` : "Designing your card";
    }
    case "design_cake": {
      const f = clip(input.flavour, 24);
      const to = clip(input.to, 24);
      return `Designing a${f ? ` ${f}` : ""} cake${to ? ` for ${to}` : ""}`;
    }
    default:
      return TOOL_LABELS[name] ?? null;
  }
}
