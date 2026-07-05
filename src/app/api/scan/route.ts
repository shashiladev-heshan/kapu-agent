// POST /api/scan — web camera entry to Kapu's vision (see src/lib/vision/scan.ts).

import { scanImage } from "@/lib/vision/scan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  let body: { image?: string };
  try {
    body = (await req.json()) as { image?: string };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const dataUrl = String(body.image ?? "");
  if (dataUrl.length > 6_000_000) {
    return Response.json({ error: "Image too large — please retake" }, { status: 413 });
  }
  try {
    const result = await scanImage(dataUrl);
    if (!result) return Response.json({ error: "No vision provider configured" }, { status: 501 });
    return Response.json(result);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("expected")) {
      return Response.json({ error: "Expected a base64 image data URL" }, { status: 400 });
    }
    console.error("[scan] failed:", err);
    return Response.json({ error: "Aiyo, I couldn't read that photo — try again?" }, { status: 502 });
  }
}
