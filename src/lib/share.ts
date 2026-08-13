// Read-only thread sharing — turn a session transcript into a SAFE public
// snapshot. Family/friends can view the conversation; there's no agent, no
// chat, no cart. We strip anything private or transactional and keep the
// shopping content (products, comparisons, import quotes, cards).

import type { UiBlock, UiTurn } from "@/lib/types";

// Blocks safe to show in a public, read-only share. Everything else is dropped:
//  - order_summary / order_timeline → recipient name, phone, full address (PII)
//  - pay_link                       → a live checkout URL + order ref
//  - cart                           → transient personal state
//  - chips / speech / pick_update   → interactive-only, meaningless read-only
const SHAREABLE_BLOCKS: ReadonlySet<UiBlock["type"]> = new Set([
  "product_grid",
  "compare_grid",
  "delivery_card", // city + flat rate only — carries no street address
  "category_tree",
  "import_quote", // its checkout_url is a generic, shareable product quote
  "greeting_card",
  "cake_design", // deterministic palette + public products; icing is the sharer's own words
  "no_results",
]);

/** Sanitize a transcript for public sharing: keep the shareable blocks, and
 *  downgrade a single-product hero to a one-item grid so the read-only card
 *  renderer can show it without the interactive hero controls. */
export function sanitizeUiForShare(ui: UiTurn[]): UiTurn[] {
  return (ui ?? []).map((turn) => {
    if (turn.role === "user") return { role: "user", text: turn.text, at: turn.at };
    const blocks: UiBlock[] = [];
    for (const b of turn.blocks ?? []) {
      if (b.type === "product_hero") {
        blocks.push({ type: "product_grid", products: [b.product] });
      } else if (SHAREABLE_BLOCKS.has(b.type)) {
        blocks.push(b);
      }
    }
    return {
      role: "assistant",
      text: turn.text,
      at: turn.at,
      blocks,
      ...(turn.steps?.length ? { steps: turn.steps } : {}),
    };
  });
}
