// POST /api/auth/google — exchange a GIS credential (Google ID token) for a
// signed Kapu session cookie. Guest → Google upgrade; wishes merge on the
// client afterwards via /api/wishes.

import { authCookieHeader, signAuthCookie, verifyGoogleIdToken } from "@/lib/auth/session";
import { upsertUser } from "@/lib/auth/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  if (!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim()) {
    return Response.json({ error: "Google sign-in is not configured" }, { status: 501 });
  }
  let credential = "";
  try {
    const body = (await req.json()) as { credential?: string };
    credential = String(body.credential ?? "");
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const profile = await verifyGoogleIdToken(credential);
  if (!profile) return Response.json({ error: "Invalid Google token" }, { status: 401 });

  const user = await upsertUser(profile);
  return Response.json(
    {
      user: { name: user.name, email: user.email, picture: user.picture },
      wishes: user.wishes,
    },
    { headers: { "Set-Cookie": authCookieHeader(signAuthCookie(profile)) } }
  );
}
