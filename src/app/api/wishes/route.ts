// POST /api/wishes — sync this device's recent-wish list into the signed-in
// account (merge by id, newest wins). Guests keep wishes in localStorage only.

import { readUser } from "@/lib/auth/session";
import { mergeWishes, type WishMeta } from "@/lib/auth/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const identity = readUser(req);
  if (!identity) return Response.json({ error: "Not signed in" }, { status: 401 });
  let incoming: WishMeta[] = [];
  try {
    const body = (await req.json()) as { wishes?: WishMeta[] };
    incoming = Array.isArray(body.wishes) ? body.wishes.slice(0, 30) : [];
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const wishes = await mergeWishes(identity.sub, incoming);
  return Response.json({ wishes });
}
