// GET /api/fx — USD-based exchange rates for display-currency conversion.
// exchangerate-api.com free tier (~1.5k req/month) → 12 h in-process cache
// + Mongo rail-cache fallback (7 d) keeps us at a few calls per day. Prices
// stay LKR at the source (MCP); conversion is display-only on the client.

import { loadRailCache, saveRailCache } from "@/lib/db/mongo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const g = globalThis as unknown as { __kapuFx?: { at: number; rates: Record<string, number> } };

export async function GET(): Promise<Response> {
  const key = process.env.EXCHANGE_API_KEY?.trim();
  if (!key) return Response.json({ rates: null });
  if (g.__kapuFx && Date.now() - g.__kapuFx.at < 12 * 3600_000) {
    return Response.json({ rates: g.__kapuFx.rates, at: g.__kapuFx.at });
  }
  try {
    const res = await fetch(`https://v6.exchangerate-api.com/v6/${key}/latest/USD`, {
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json()) as { result?: string; conversion_rates?: Record<string, number> };
    if (data.result === "success" && data.conversion_rates?.LKR) {
      g.__kapuFx = { at: Date.now(), rates: data.conversion_rates };
      void saveRailCache("fx", data.conversion_rates);
      return Response.json({ rates: data.conversion_rates, at: g.__kapuFx.at });
    }
    throw new Error(data.result ?? "bad response");
  } catch (err) {
    console.error("[fx] fetch failed:", err instanceof Error ? err.message : err);
    const fb = await loadRailCache<Record<string, number>>("fx", 7 * 86400_000).catch(() => null);
    if (fb) {
      g.__kapuFx = { at: Date.now() - 11 * 3600_000, rates: fb }; // serve, retry in ~1 h
      return Response.json({ rates: fb, stale: true });
    }
    return Response.json({ rates: null });
  }
}
