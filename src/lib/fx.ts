// Server-side FX rates — USD-based, exchangerate-api.com free tier (~1.5k
// req/month) → 12 h in-process cache + Mongo rail-cache fallback (7 d).
// The server's canonical currency is LKR: the MCP is always queried in LKR
// and the cart stores LKR. These rates exist for (a) the /api/fx feed the
// client converts display prices with, (b) repricing legacy foreign-currency
// cart lines (ensureCartLkr), and (c) the agent's turn-context rate hint.

import { loadRailCache, saveRailCache } from "@/lib/db/mongo";

const g = globalThis as unknown as { __kapuFx?: { at: number; rates: Record<string, number>; stale?: boolean } };

export async function getFx(): Promise<{ rates: Record<string, number> | null; at?: number; stale?: boolean }> {
  const key = process.env.EXCHANGE_API_KEY?.trim();
  if (!key) return { rates: null };
  if (g.__kapuFx && Date.now() - g.__kapuFx.at < 12 * 3600_000) {
    return { rates: g.__kapuFx.rates, at: g.__kapuFx.at, stale: g.__kapuFx.stale };
  }
  try {
    const res = await fetch(`https://v6.exchangerate-api.com/v6/${key}/latest/USD`, {
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json()) as { result?: string; conversion_rates?: Record<string, number> };
    if (data.result === "success" && data.conversion_rates?.LKR) {
      g.__kapuFx = { at: Date.now(), rates: data.conversion_rates };
      void saveRailCache("fx", data.conversion_rates);
      return { rates: data.conversion_rates, at: g.__kapuFx.at };
    }
    throw new Error(data.result ?? "bad response");
  } catch (err) {
    console.error("[fx] fetch failed:", err instanceof Error ? err.message : err);
    const fb = await loadRailCache<Record<string, number>>("fx", 7 * 86400_000).catch(() => null);
    if (fb) {
      g.__kapuFx = { at: Date.now() - 11 * 3600_000, rates: fb, stale: true }; // serve, retry in ~1 h
      return { rates: fb, stale: true };
    }
    return { rates: null };
  }
}

/** Convert an amount to whole LKR, or null when rates are unavailable. */
export async function toLkr(amount: number, from: string): Promise<number | null> {
  if (from === "LKR") return Math.round(amount);
  const { rates } = await getFx();
  if (!rates?.[from] || !rates.LKR) return null;
  return Math.round((amount / rates[from]) * rates.LKR);
}

/** Whole LKR per one unit of `currency` — the agent's turn-context rate hint. */
export async function lkrPer(currency: string): Promise<number | null> {
  if (currency === "LKR") return 1;
  const { rates } = await getFx();
  if (!rates?.[currency] || !rates.LKR) return null;
  return Math.round(rates.LKR / rates[currency]);
}
