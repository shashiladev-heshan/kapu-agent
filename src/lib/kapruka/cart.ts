// Shared cart mutation — used by BOTH the agent's cart_update tool and the
// instant /api/cart route (qty steppers, remove, icing edits — no LLM
// round-trip). One code path, one source of truth: the server session cart.

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
        currency: input.known.currency || session.currency,
        image: input.known.image ?? null,
        category: input.known.category ?? null,
        quantity,
      };
    } else {
      const res = parseJson(
        await kapruka("kapruka_get_product", { product_id: productId, currency: session.currency })
      );
      const p = toSummary((res.product ?? res) as Record<string, unknown>, session.currency);
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
  session.cart.currency = session.currency;
  return {};
}

export const cartSubtotal = (session: Session): number =>
  session.cart.items.reduce((sum, i) => sum + (i.price ?? 0) * i.quantity, 0);
