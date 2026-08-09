"use client";

// Read-only shared conversation — what family/friends see at /share/<id>.
// No agent, no composer, no cart: just the transcript and its shopping cards,
// rendered with the same block renderers in read-only mode.

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BlockRenderer, type BlockActions } from "@/components/blocks";
import { LangProvider } from "@/lib/client/i18n";
import { KapuMark } from "@/components/icons";
import type { Language, UiTurn } from "@/lib/types";

// Every handler is a no-op; readOnly hides the interactive controls the
// individual blocks would otherwise show (cart, fav, ask, chat).
const RO_ACTIONS: BlockActions = {
  onAction: () => {},
  onCartAdd: () => {},
  onCartQty: () => {},
  onCartIcing: () => {},
  onPreferDate: () => {},
  onFocusComposer: () => {},
  onOpenProduct: () => {},
  onDeliverTo: () => {},
  onToggleFav: () => {},
  isFav: () => false,
  readOnly: true,
};

export function SharedThread({ ui, language, title }: { ui: UiTurn[]; language: Language; title: string }) {
  return (
    <LangProvider value={language}>
      <div className="min-h-dvh bg-surface">
        {/* header */}
        <header className="sticky top-0 z-10 border-b border-cream-deep bg-surface/90 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center gap-2.5 px-4 py-3">
            <KapuMark size={30} radius={10} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-[16px] leading-tight text-leaf">{title}</p>
              <p className="text-[11px] text-ink-faint">Shared via Kapu 🌳 · view only</p>
            </div>
            <a
              href="/"
              className="shrink-0 rounded-full bg-gold px-3.5 py-2 text-[12px] font-bold text-ink shadow-[0_4px_12px_rgba(255,184,0,0.35)] transition active:scale-95 dark:text-[#322b45]"
            >
              Try Kapu
            </a>
          </div>
        </header>

        {/* transcript */}
        <main className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-5">
          {ui.map((turn, idx) =>
            turn.role === "user" ? (
              <div key={idx} className="flex flex-col items-end">
                <div className="max-w-[85%] whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-2xl rounded-br-md bg-bubble px-4 py-2.5 text-[14px] leading-relaxed text-white shadow-[0_4px_14px_rgba(64,41,112,0.25)]">
                  {turn.text}
                </div>
              </div>
            ) : (
              <div key={idx} className="flex max-w-full gap-2.5">
                <span className="mt-1 hidden shrink-0 sm:block">
                  <KapuMark size={28} radius={9} />
                </span>
                <div className="min-w-0 flex-1">
                  {turn.text.trim() && (
                    <div className="bubble-md max-w-full rounded-2xl rounded-bl-md border border-line bg-card px-4 py-2.5 text-[14px] leading-relaxed shadow-[0_2px_10px_rgba(64,41,112,0.05)]">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{turn.text}</ReactMarkdown>
                    </div>
                  )}
                  {(turn.blocks ?? []).map((block, bi) => (
                    <BlockRenderer key={bi} block={block} actions={RO_ACTIONS} />
                  ))}
                </div>
              </div>
            )
          )}
        </main>

        {/* footer */}
        <footer className="mx-auto max-w-3xl px-4 pb-10 pt-2 text-center">
          <p className="text-[11.5px] text-ink-faint">
            This is a read-only conversation shared from{" "}
            <a href="/" className="font-semibold text-leaf">
              Kapu
            </a>{" "}
            — Sri Lanka&apos;s AI shopping concierge.
          </p>
        </footer>
      </div>
    </LangProvider>
  );
}
