// Shared cart mutation — used by BOTH the agent's cart_update tool and the
// instant /api/cart route (qty steppers, remove, icing edits — no LLM
// round-trip). One code path, one source of truth: the server session cart.

import { toLkr } from "@/lib/fx";
import { kapruka, parseJson } from "@/lib/kapruka/shield";
import { toSummary } from "@/lib/kapruka/normalize";
import { recoProductEvent } from "@/lib/reco/store";
import type { Session } from "@/lib/session/store";
import type { CartItem } from "@/lib/types";

export interface CartUpdateInput {
  product_id: string;
  /** desired TOTAL quantity; 0 removes */
  quantity: number;
  icing_text?: string;
  /** product details already known (skips the MCP fetch) */
  known?: { name: string; price: number | null; currency: string; image?: string | null; category?: string | null };
}

export async function applyCartUpdate(
  session: Session,
  input: CartUpdateInput
): Promise<{ error?: string }> {
  const productId = String(input.product_id ?? "").trim();
  if (!productId) return { error: "product_id is required." };
  const quantity = Math.max(0, Math.min(99, Math.round(Number(input.quantity) || 0)));
  const existing = session.cart.items.find(
    (i) => i.product_id.toLowerCase() === productId.toLowerCase()
  );

  if (quantity === 0) {
    session.cart.items = session.cart.items.filter((i) => i !== existing);
  } else if (existing) {
    existing.quantity = quantity;
    if (typeof input.icing_text === "string") {
      const icing = input.icing_text.slice(0, 120).trim();
      if (icing) existing.icing_text = icing;
      else delete existing.icing_text;
    }
  } else {
    if (session.cart.items.length >= 30) {
      return { error: "Cart is full (30 items max)." };
    }
    let item: CartItem | null = null;
    if (input.known?.name) {
      item = {
        product_id: productId,
        name: input.known.name,
        price: input.known.price,
        currency: input.known.currency || "LKR",
        image: input.known.image ?? null,
        category: input.known.category ?? null,
        quantity,
      };
    } else {
      const res = parseJson(
        await kapruka("kapruka_get_product", { product_id: productId, currency: "LKR" })
      );
      const p = toSummary((res.product ?? res) as Record<string, unknown>, "LKR");
      if (!p.id) return { error: `Product ${productId} not found.` };
      item = {
        product_id: p.id,
        name: p.name,
        price: p.price,
        currency: p.currency,
        image: p.image,
        category: p.category,
        quantity,
      };
    }
    if (typeof input.icing_text === "string" && input.icing_text.trim()) {
      item.icing_text = input.icing_text.slice(0, 120).trim();
    }
    session.cart.items.push(item);
    // taste engine: a cart add is the strongest signal we get
    void recoProductEvent(
      [session.userSub, session.id],
      { id: item.product_id, name: item.name, price: item.price, currency: item.currency, image: item.image, category: item.category },
      3
    ).catch(() => {});
  }
  await ensureCartLkr(session);
  return {};
}

/** The cart is canonically LKR — reprice any foreign-currency line to LKR:
 *  exact price from the MCP when the product resolves, fx-approx fallback
 *  when it doesn't (the EF_PC_* marketplace family 500s on get_product).
 *  Foreign amounts only enter via legacy sessions / stale client `known`
 *  payloads from before prices were pinned to LKR at the source — the two
 *  conversion sources (MCP vs /api/fx) drift, and a blind sum of mixed
 *  currencies is how a Rs 3,103 basket once showed "Subtotal Rs 7". */
export async function ensureCartLkr(session: Session): Promise<boolean> {
  let changed = session.cart.currency !== "LKR";
  session.cart.currency = "LKR";
  for (const item of session.cart.items) {
    if (!item.currency) item.currency = "LKR";
    if (item.currency === "LKR") continue;
    try {
      const res = parseJson(
        await kapruka("kapruka_get_product", { product_id: item.product_id, currency: "LKR" })
      );
      const p = toSummary((res.product ?? res) as Record<string, unknown>, "LKR");
      if (p.id && p.price != null) {
        item.price = p.price;
        item.currency = "LKR";
        changed = true;
        continue;
      }
    } catch {
      /* upstream 500 / non-JSON — approximate below */
    }
    const lkr = item.price != null ? await toLkr(item.price, item.currency) : null;
    if (lkr != null || item.price == null) {
      item.price = lkr ?? item.price;
      item.currency = "LKR";
      changed = true;
    }
    // no rates AND no product: leave the line as-is; the client's per-line
    // display conversion still renders it sanely
  }
  return changed;
}

export const cartSubtotal = (session: Session): number =>
  // lines are canonical LKR (ensureCartLkr) — a plain sum is safe
  session.cart.items.reduce((sum, i) => sum + (i.price ?? 0) * i.quantity, 0);
