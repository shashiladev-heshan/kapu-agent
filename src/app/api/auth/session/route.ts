// GET /api/auth/session — who am I? Returns the signed-in profile + synced
// wishes, or {user:null} for guests. Also reports whether Google sign-in is
// configured so the client can hide the button when it isn't.

import { readUser } from "@/lib/auth/session";
import { getUser } from "@/lib/auth/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const googleEnabled = Boolean(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim());
  const identity = readUser(req);
  if (!identity) return Response.json({ user: null, wishes: [], googleEnabled });
  const user = await getUser(identity.sub);
  return Response.json({
    user: { name: user?.name ?? identity.name, email: user?.email ?? identity.email, picture: user?.picture ?? identity.picture },
    wishes: user?.wishes ?? [],
    googleEnabled,
  });
}
