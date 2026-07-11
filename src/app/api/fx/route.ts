// GET /api/fx — USD-based exchange rates for display-currency conversion.
// Prices stay LKR at the source (MCP + cart); conversion is display-only on
// the client. Rate logic lives in src/lib/fx.ts, shared with the server-side
// legacy-cart repricer (ensureCartLkr) and the agent's turn-context hint.

import { getFx } from "@/lib/fx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json(await getFx());
}
