// Display-currency conversion — module-level so blocks.tsx's fmt() can read
// it without threading props through every price render. KapuApp calls
// setFx() in its render body whenever rates or the picked currency change;
// the accompanying state change re-renders every consumer.

let rates: Record<string, number> | null = null; // USD-based, from /api/fx
let to = "LKR";

export function setFx(r: Record<string, number> | null, currency: string): void {
  rates = r;
  to = currency;
}

/** Convert an amount from its source currency to the picked display currency.
 *  Falls back to the source amount when rates are missing. */
export function fxConvert(amount: number, from: string): { n: number; c: string } {
  if (!rates || to === from || !rates[from] || !rates[to]) return { n: amount, c: from };
  return { n: (amount / rates[from]) * rates[to], c: to };
}
