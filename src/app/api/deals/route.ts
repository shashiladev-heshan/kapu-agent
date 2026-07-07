// GET /api/deals — the full kapruka.com promotions list for the hero's
// standalone Hot-deals section (client chunk-reveals on scroll). Thin wrapper
// over the shared promos lib (also powering the get_hot_deals agent tool).

import { getHotDeals } from "@/lib/kapruka/promos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json({ products: await getHotDeals() });
}
