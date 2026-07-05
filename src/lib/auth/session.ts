// Lightweight auth for Kapu — guest-first, optional "Sign in with Google".
//
// Google ID tokens (from the GIS button) are verified server-side against
// Google's tokeninfo endpoint (officially supported for low-volume apps —
// no client secret, no extra dependencies). A signed httpOnly cookie then
// carries the identity. Without NEXT_PUBLIC_GOOGLE_CLIENT_ID the whole
// feature is dormant and the app stays guest-only.

import crypto from "crypto";

export interface AuthUser {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
}

export const AUTH_COOKIE = "kapu_auth";
const MAX_AGE_S = 30 * 24 * 3600; // 30 days

// Stable across restarts when KAPU_AUTH_SECRET is set; otherwise per-boot
// (users just tap the Google button again after a redeploy).
const SECRET = process.env.KAPU_AUTH_SECRET?.trim() || crypto.randomBytes(32).toString("hex");

const b64url = (buf: Buffer) => buf.toString("base64url");
const hmac = (payload: string) => b64url(crypto.createHmac("sha256", SECRET).update(payload).digest());

export function signAuthCookie(user: AuthUser): string {
  const payload = b64url(Buffer.from(JSON.stringify({ ...user, iat: Date.now() })));
  return `${payload}.${hmac(payload)}`;
}

export function verifyAuthCookie(value: string | undefined | null): AuthUser | null {
  if (!value) return null;
  const [payload, sig] = value.split(".");
  if (!payload || !sig) return null;
  try {
    const expected = hmac(payload);
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as AuthUser & { iat?: number };
    if (!data.sub) return null;
    if (data.iat && Date.now() - data.iat > MAX_AGE_S * 1000) return null;
    return { sub: data.sub, email: data.email, name: data.name, picture: data.picture };
  } catch {
    return null;
  }
}

/** Read the signed-in user from a request's cookies (null = guest). */
export function readUser(req: Request): AuthUser | null {
  const cookie = req.headers.get("cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${AUTH_COOKIE}=([^;]+)`));
  return verifyAuthCookie(match?.[1] ? decodeURIComponent(match[1]) : null);
}

export function authCookieHeader(value: string | null): string {
  const base = `${AUTH_COOKIE}=${value ? encodeURIComponent(value) : ""}; Path=/; HttpOnly; SameSite=Lax`;
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return value ? `${base}; Max-Age=${MAX_AGE_S}${secure}` : `${base}; Max-Age=0${secure}`;
}

/** Verify a Google ID token (GIS credential). Returns the profile or null. */
export async function verifyGoogleIdToken(credential: string): Promise<AuthUser | null> {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim();
  if (!clientId || !credential || credential.length > 4096) return null;
  try {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return null; // invalid/expired token
    const info = (await res.json()) as Record<string, string>;
    const issOk = info.iss === "accounts.google.com" || info.iss === "https://accounts.google.com";
    if (!issOk || info.aud !== clientId || !info.sub) return null;
    if (info.email && info.email_verified !== "true") return null;
    return {
      sub: info.sub,
      email: info.email,
      name: info.name || info.given_name || info.email?.split("@")[0],
      picture: info.picture,
    };
  } catch {
    return null;
  }
}
