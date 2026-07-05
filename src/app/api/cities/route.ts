// GET /api/cities?q= — city typeahead for the "Deliver to" picker, backed by
// kapruka_list_delivery_cities (through the shield, so results are cached and
// rate-limit-safe). Every suggestion is a canonical, deliverable Kapruka city;
// aliases cover vernacular/Tanglish spellings (kolpity → Colombo 03).

import { kapruka, parseJson } from "@/lib/kapruka/shield";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 50);
  if (q.length < 2) return Response.json({ cities: [] });
  try {
    const res = parseJson(await kapruka("kapruka_list_delivery_cities", { query: q, limit: 8 }));
    const needle = q.toLowerCase();
    const cities = Array.isArray(res.cities)
      ? (res.cities as { name?: unknown; aliases?: unknown }[])
          .map((c) => {
            const name = String(c.name ?? "");
            // aliases arrive as space-joined vernacular blobs — tokenize, then
            // surface the token that actually matched as a hint ("also: kolpity")
            const tokens = Array.isArray(c.aliases)
              ? c.aliases.flatMap((a) => String(a).split(/\s+/)).filter(Boolean)
              : [];
            const hint =
              name.toLowerCase().includes(needle)
                ? null
                : (tokens.find((t) => t.toLowerCase().startsWith(needle)) ??
                   tokens.find((t) => t.toLowerCase().includes(needle)) ??
                   null);
            return { name, hint };
          })
          .filter((c) => c.name)
      : [];
    return Response.json({
      cities,
      total: typeof res.total_matched === "number" ? res.total_matched : cities.length,
    });
  } catch {
    // graceful degrade — the picker falls back to free-text entry
    return Response.json({ cities: [] });
  }
}
