// /share/<id> — a public, read-only view of a shared Kapu conversation.
// Server-rendered so WhatsApp/social link previews work; no agent, no chat.

import type { Metadata } from "next";
import { getShare } from "@/lib/db/mongo";
import { SharedThread } from "@/components/SharedThread";
import { KapuMark } from "@/components/icons";
import type { Language } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const share = await getShare(id.slice(0, 64));
  const title = share ? `${share.title} · shared on Kapu` : "Shared on Kapu";
  const description = "A read-only Kapu conversation — Sri Lanka's AI shopping concierge.";
  return {
    title,
    description,
    openGraph: { title, description, type: "article" },
    twitter: { card: "summary", title, description },
    robots: { index: false }, // shared links are unlisted, not for search engines
  };
}

export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const share = await getShare(id.slice(0, 64));

  if (!share) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-surface px-6 text-center">
        <KapuMark size={52} radius={16} />
        <p className="font-display text-2xl text-leaf">This shared link isn&apos;t available</p>
        <p className="max-w-sm text-[13.5px] text-ink-soft">
          It may have been removed by whoever shared it, or the link is incorrect.
        </p>
        <a
          href="/"
          className="rounded-full bg-gold px-5 py-2.5 text-[13.5px] font-bold text-ink shadow-[0_4px_14px_rgba(255,184,0,0.35)] dark:text-[#322b45]"
        >
          Go to Kapu
        </a>
      </div>
    );
  }

  return <SharedThread ui={share.ui} language={(share.language as Language) || "en"} title={share.title} />;
}
