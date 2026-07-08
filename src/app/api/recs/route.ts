// GET /api/recs?sessions=a,b,c — "Picked for you" from the taste engine.
// The client passes its recent-wish session ids (localStorage registry), so a
// guest's taste survives new-wish session rotation; signed-in users unify
// further via userSub captured at event time. Empty without OPENAI_API_KEY
// or when the user hasn't interacted enough yet.

import { hydrateReco, recommendFor, recoStats, textVectors } from "@/lib/reco/store";
import { peekSession } from "@/lib/session/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const raw = url.searchParams.get("sessions") ?? "";
  const sessionIds = raw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 16);
  if (sessionIds.length === 0) return Response.json({ products: [] });

  // include the account key when any of these sessions is signed in
  const keys = new Set<string>(sessionIds);
  for (const id of sessionIds) {
    const sub = (await peekSession(id))?.userSub;
    if (sub) keys.add(sub);
  }
  await hydrateReco([...keys]); // rebuild from Mongo after redeploys
  // ♥ favorites (client-side names) act as durable taste seeds
  const favn = (url.searchParams.get("favn") ?? "").split("|").map((s) => s.trim()).filter(Boolean).slice(0, 6);
  const seeds = favn.length ? await textVectors(favn) : [];
  const products = recommendFor([...keys], 8, seeds);
  return Response.json({ products, stats: recoStats([...keys]) });
}
