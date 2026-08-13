"use client";

// The public face of a Wish Bridge (/bridge/<id>): a loved one's frozen
// basket, presented as a wish to grant. Tapping GRANT claims the items into
// THIS visitor's own Kapu session (minting one if needed) and drops them into
// the chat to check out normally — sender pays, Kapruka delivers to the wish
// owner. The full delivery address never reaches this page; at most name+city.

import { useState } from "react";
import { KapuMark } from "@/components/icons";
import { LangProvider, useT } from "@/lib/client/i18n";
import type { Language } from "@/lib/types";

export interface BridgeViewItem {
  name: string;
  price: number | null;
  currency: string;
  image: string | null;
  quantity: number;
  icing_text: string | null;
}

const rs = (n: number | null | undefined) => (n == null ? "—" : `Rs ${Math.round(n).toLocaleString("en-LK")}`);

function Inner({
  id,
  title,
  message,
  items,
  recipientPublic,
  granted,
}: {
  id: string;
  title: string;
  message: string | null;
  items: BridgeViewItem[];
  recipientPublic: { name: string; city: string } | null;
  granted: boolean;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const total = items.reduce((s, i) => s + (i.price ?? 0) * i.quantity, 0);

  const grant = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      let sid = localStorage.getItem("kapu_session");
      if (!sid) {
        sid = `kapu_${crypto.randomUUID()}`;
        localStorage.setItem("kapu_session", sid);
      }
      // land straight in the chat with the basket — no welcome gate detour
      localStorage.setItem("kapu_welcome", "1");
      const res = await fetch("/api/bridge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "claim", sessionId: sid }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setErr(d.error === "already_granted" ? t("bridgeGranted") : d.error || "Something went wrong — try again?");
        setBusy(false);
        return;
      }
      window.location.href = "/?bridged=1";
    } catch {
      setErr("Something went wrong — try again?");
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh bg-cream px-4 py-8">
      <div className="mx-auto max-w-[430px]">
        <div className="mb-5 flex items-center justify-center gap-2.5">
          <KapuMark size={36} radius={12} />
          <span className="font-display text-[20px] text-leaf">Kapu · Wish Bridge</span>
        </div>

        <div className="overflow-hidden rounded-[24px] border border-line bg-card shadow-[0_24px_70px_rgba(64,41,112,0.16)]">
          <div className="bg-leaf px-6 py-6 text-center text-white dark:bg-[#402970]">
            <p className="text-[42px] leading-none">🎁</p>
            <h1 className="font-display mt-2 text-[24px] leading-tight">{title}</h1>
            {recipientPublic && (
              <p className="mt-1 text-[12px] text-white/75">{t("bridgeFor", { name: recipientPublic.name, city: recipientPublic.city })}</p>
            )}
          </div>

          {message && <p className="border-b border-line px-6 py-4 text-center text-[13.5px] italic leading-relaxed text-ink-soft">“{message}”</p>}

          <ul className="divide-y divide-line px-4">
            {items.map((i, idx) => (
              <li key={idx} className="flex items-center gap-3 py-3">
                {i.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={i.image} alt={i.name} className="h-12 w-12 shrink-0 rounded-[10px] border border-line object-cover" />
                ) : (
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[10px] bg-cream text-[18px]">🎁</span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-ink">
                    {i.name}
                    {i.quantity > 1 ? ` ×${i.quantity}` : ""}
                  </p>
                  {i.icing_text && <p className="truncate text-[11px] italic text-ink-faint">✍️ “{i.icing_text}”</p>}
                </div>
                <span className="price-serif shrink-0 text-[14px] text-ink">{rs((i.price ?? 0) * i.quantity)}</span>
              </li>
            ))}
          </ul>

          <div className="flex items-baseline justify-between border-t border-line px-6 py-3">
            <span className="text-[12.5px] text-ink-soft">Total</span>
            <span className="price-serif text-[22px] text-leaf">{rs(total)}</span>
          </div>

          <div className="px-5 pb-5">
            <p className="mb-3 text-center text-[12px] leading-relaxed text-ink-soft">{t("bridgeSub")}</p>
            {granted ? (
              <p className="rounded-[13px] bg-good-soft py-3 text-center text-[13.5px] font-bold text-good">{t("bridgeGranted")}</p>
            ) : (
              <button
                onClick={() => void grant()}
                disabled={busy}
                className="w-full rounded-[14px] bg-gold py-3.5 text-[15px] font-bold text-ink shadow-[0_8px_24px_rgba(255,184,0,0.45)] transition active:scale-[0.98] disabled:opacity-60 dark:text-[#322b45]"
              >
                {busy ? t("bridgeOpening") : t("bridgeGrant")}
              </button>
            )}
            {err && <p className="mt-2 text-center text-[12px] font-semibold text-clay">{err}</p>}
          </div>
        </div>

        <p className="mt-4 text-center text-[11px] text-ink-faint">
          🌳 <a className="font-semibold text-leaf" href="/">kapuwa.shop</a> — Sri Lanka&apos;s wish-granting shopping agent
        </p>
      </div>
    </div>
  );
}

export function BridgeView(props: {
  id: string;
  title: string;
  message: string | null;
  items: BridgeViewItem[];
  language: string;
  recipientPublic: { name: string; city: string } | null;
  granted: boolean;
}) {
  return (
    <LangProvider value={(props.language as Language) || "en"}>
      <Inner {...props} />
    </LangProvider>
  );
}
