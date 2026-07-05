"use client";

// Client-side prep for Snap-a-list: compress the camera photo before upload
// (a 12MP phone shot → ~1280px JPEG, a few hundred KB) so scans stay fast on
// Sri Lankan mobile data.

export async function fileToCompressedDataUrl(file: File, maxEdge = 1280, quality = 0.82): Promise<string> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => null);
  if (!bitmap) {
    // very old browsers: send as-is (server caps size)
    return await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error("read failed"));
      r.readAsDataURL(file);
    });
  }
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", quality);
}

export interface ScanItem {
  query: string;
  quantity: number;
  original: string;
}
export interface ScanResult {
  kind: "shopping_list" | "product" | "scene" | "unclear";
  items: ScanItem[];
  caption: string;
  error?: string;
}

/** Turn a scan result into the chat message the agent acts on. */
export function scanMessage(result: ScanResult): string | null {
  const list = result.items.map((i) => `${i.quantity > 1 ? `${i.quantity}× ` : ""}${i.query}`).join(", ");
  if (result.kind === "product" && result.items[0]) {
    return `I snapped a product photo 📸 — it looks like "${result.items[0].query}". Find it (or the closest thing) on Kapruka for me.`;
  }
  if (result.kind === "scene" && result.items.length) {
    return `I snapped a photo of a setup 📸 (${result.caption || "a celebration"}) — help me recreate it from Kapruka: ${list}.`;
  }
  if (result.kind === "shopping_list" && result.items.length) {
    return `I scanned my shopping list 📸 — ${list}. Find these on Kapruka and build my basket.`;
  }
  return null;
}
