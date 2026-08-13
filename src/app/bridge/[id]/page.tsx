// /bridge/<id> — a public Wish Bridge: someone's basket, frozen as a wish a
// relative abroad can GRANT. Server-rendered so the WhatsApp/social preview
// carries the wish title; the full recipient address never reaches this page.

import type { Metadata } from "next";
import { getBridge } from "@/lib/db/mongo";
import { BridgeView } from "@/components/BridgeView";
import { KapuMark } from "@/components/icons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const bridge = await getBridge(id.slice(0, 24));
  const title = bridge ? `🎁 ${bridge.title} — grant this wish on Kapu` : "A wish on Kapu";
  const description = bridge
    ? `${bridge.items.length} thing${bridge.items.length === 1 ? "" : "s"} someone wishes for from Kapruka — open to grant it.`
    : "Grant a loved one's wish — Kapu, Sri Lanka's AI shopping concierge.";
  return {
    title,
    description,
    openGraph: { title, description, type: "article" },
    twitter: { card: "summary", title, description },
    robots: { index: false }, // unlisted, like shares
  };
}

export default async function BridgePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bridge = await getBridge(id.slice(0, 24));

  if (!bridge) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-surface px-6 text-center">
        <KapuMark size={52} radius={16} />
        <p className="font-display text-2xl text-leaf">This wish isn&apos;t available</p>
        <p className="max-w-sm text-[13.5px] text-ink-soft">It may have been granted already, or the link is incorrect.</p>
        <a
          href="/"
          className="rounded-full bg-gold px-5 py-2.5 text-[13.5px] font-bold text-ink shadow-[0_4px_14px_rgba(255,184,0,0.35)] dark:text-[#322b45]"
        >
          Go to Kapu
        </a>
      </div>
    );
  }

  return (
    <BridgeView
      id={bridge._id}
      title={bridge.title}
      message={bridge.message ?? null}
      items={bridge.items.map((i) => ({
        name: i.name,
        price: i.price,
        currency: i.currency,
        image: i.image ?? null,
        quantity: i.quantity,
        icing_text: i.icing_text ?? null,
      }))}
      language={bridge.language}
      recipientPublic={bridge.recipient ? { name: bridge.recipient.name, city: bridge.recipient.city } : null}
      granted={Boolean(bridge.granted_at)}
    />
  );
}
