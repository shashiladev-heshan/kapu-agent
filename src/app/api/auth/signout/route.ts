// POST /api/auth/signout — clear the auth cookie (back to guest mode).

import { authCookieHeader } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  return Response.json({ ok: true }, { headers: { "Set-Cookie": authCookieHeader(null) } });
}
