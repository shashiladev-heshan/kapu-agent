"use client";

// Renderers for the UiBlocks the agent emits — product rails, the cake-moment
// hero, comparison duels, delivery cards, the order-summary confirm gate, the
// golden pay link, rich order timelines. Styled to the "Kapu redesigned" spec:
// Instrument Serif display, 1.6px stroke icons, purple/gold, soft cream cards.

import { useEffect, useMemo, useState } from "react";
import { useLang, useT } from "@/lib/client/i18n";
import type { Cart, OrderSummaryData, ProductDetail, ProductSummary, UiBlock } from "@/lib/types";
import { detailMeta, resizeImage } from "@/lib/kapruka/normalize";
import {
  IconArrowRight,
  IconBasket,
  IconBell,
  IconCake,
  IconCamera,
  IconCheck,
  IconCheckCircle,
  IconClock,
  IconExternal,
  IconHeart,
  IconLock,
  IconPencil,
  IconPhone,
  IconPlus,
  IconReceipt,
  IconSearchNone,
  IconTrolley,
  IconTruck,
  IconWish,
  KapuMark,
  productTint,
} from "@/components/icons";

export interface BlockActions {
  /** send a chat message (visible user turn) */
  onAction: (text: string) => void;
  /** instant basket ops — no LLM round-trip */
  onCartAdd: (p: ProductSummary, opts?: { icing?: string }) => void;
  onCartQty: (productId: string, qty: number) => void;
  onCartIcing: (productId: string, icing: string) => void;
  onPreferDate: (date: string) => void;
  onFocusComposer: () => void;
  /** open the full-detail product modal */
  onOpenProduct: (p: ProductSummary) => void;
  /** favorites (♥) */
  onToggleFav: (p: ProductSummary) => void;
  isFav: (id: string) => boolean;
}

export const fmt = (n: number | null | undefined, currency = "LKR") => {
  if (n == null) return "—";
  if (currency === "LKR") return `Rs ${Math.round(n).toLocaleString("en-LK")}`;
  return new Intl.NumberFormat("en-LK", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
};

const CARD = "border border-line bg-card shadow-[0_2px_10px_rgba(64,41,112,0.05)]";

function savePercent(p: ProductSummary): number | null {
  if (p.compare_at_price == null || p.price == null || p.compare_at_price <= p.price) return null;
  return Math.round(((p.compare_at_price - p.price) / p.compare_at_price) * 100);
}

function StockBadge({ p }: { p: ProductSummary }) {
  // The catalog's stock_level is unreliable (constant "low") — only the
  // boolean in_stock is trustworthy, so no urgency theatre here.
  const t = useT();
  if (p.in_stock === false)
    return (
      <span className="rounded-full bg-clay-soft px-2 py-0.5 text-[10px] font-semibold text-clay">{t("outOfStock")}</span>
    );
  return <span className="rounded-full bg-good-soft px-2 py-0.5 text-[10px] font-semibold text-good">{t("inStock")}</span>;
}

function ValueBadge() {
  const t = useT();
  return (
    <span className="absolute left-2 top-2 z-[1] rounded-full bg-gold px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.06em] text-[#322b45]">
      {t("bestValue")}
    </span>
  );
}

function PickBadge({ small }: { small?: boolean }) {
  const t = useT();
  return (
    <span
      className={`absolute left-2 top-2 z-[1] rounded-full bg-leaf px-2 py-0.5 font-bold uppercase tracking-[0.06em] text-gold dark:bg-[#402970] ${
        small ? "text-[8px]" : "text-[9px]"
      }`}
    >
      {t("kapusPick")}
    </span>
  );
}

export function ProductImage({
  src,
  alt,
  category,
  className,
  width = 400,
  iconSize = 34,
}: {
  src?: string | null;
  alt: string;
  category?: string | null;
  className: string;
  width?: number;
  iconSize?: number;
}) {
  const [broken, setBroken] = useState(false);
  const resized = resizeImage(src, width);
  if (!resized || broken) {
    const tint = productTint(category);
    const Icon = tint.kind === "cake" ? IconCake : tint.kind === "grocery" ? IconTrolley : tint.kind === "phone" ? IconPhone : IconBasket;
    return (
      <div className={`${className} relative flex items-center justify-center`} style={{ background: tint.bg }} aria-hidden>
        <Icon size={iconSize} style={{ color: tint.fg }} />
        {width >= 200 && (
          <span className="absolute bottom-1.5 right-2 text-[9px]" style={{ color: tint.fg }}>
            product photo
          </span>
        )}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={resized}
      alt={alt}
      loading="lazy"
      onError={() => setBroken(true)}
      className={`${className} bg-cream-deep object-cover text-[0px]`}
    />
  );
}

// ── product rail ───────────────────────────────────────────────────────

function ProductCard({ p, actions }: { p: ProductSummary; actions: BlockActions }) {
  const save = savePercent(p);
  const fav = actions.isFav(p.id);
  return (
    <div className={`rise relative flex w-44 shrink-0 flex-col overflow-hidden rounded-2xl ${CARD} sm:w-52`}>
      {p.pick && <PickBadge />}
      {!p.pick && p.value && <ValueBadge />}
      <button
        onClick={(e) => {
          e.stopPropagation();
          actions.onToggleFav(p);
        }}
        aria-label={fav ? "Remove from favorites" : "Add to favorites"}
        className={`absolute right-2 top-2 z-[1] flex h-7 w-7 items-center justify-center rounded-full bg-card/90 shadow-sm backdrop-blur transition active:scale-90 ${
          fav ? "text-clay" : "text-ink-faint"
        }`}
      >
        <IconHeart size={15} filled={fav} />
      </button>
      <button onClick={() => actions.onOpenProduct(p)} className="text-left" aria-label={`View ${p.name}`}>
        <ProductImage src={p.image} alt={p.name} category={p.category} className="h-36 w-full sm:h-40" />
      </button>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <button onClick={() => actions.onOpenProduct(p)} className="text-left">
          <p className="line-clamp-2 text-[13px] font-semibold leading-snug">{p.name}</p>
        </button>
        <div className="mt-auto flex flex-wrap items-baseline gap-x-1.5">
          <span className="price-serif text-[17px] text-ink">{fmt(p.price, p.currency)}</span>
          {save != null && (
            <span className="text-[11px] text-ink-faint line-through">{fmt(p.compare_at_price, p.currency)}</span>
          )}
        </div>
        <div className="flex items-center justify-between gap-1">
          <StockBadge p={p} />
          <button
            onClick={() => actions.onCartAdd(p)}
            disabled={p.in_stock === false}
            className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-gold text-ink shadow-[0_3px_8px_rgba(255,184,0,0.4)] transition active:scale-90 disabled:opacity-40 dark:text-[#322b45]"
            aria-label={`Add ${p.name} to basket`}
          >
            <IconPlus size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function ProductGrid({ title, products, actions }: { title?: string; products: ProductSummary[]; actions: BlockActions }) {
  return (
    <div className="my-2">
      {title && <p className="mb-2 font-display text-[15px] text-ink">{title}</p>}
      <div className="rail -mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
        {products.map((p) => (
          <ProductCard key={p.id} p={p} actions={actions} />
        ))}
      </div>
    </div>
  );
}

// ── product hero — the cake moment ─────────────────────────────────────

/** "Tomorrow · Sat 5 Jul" style pills for the next three days (SL time).
 *  Weekday names are hand-mapped — some browsers ship no si-LK/ta-LK
 *  Intl data and would silently fall back to English. */
const WEEKDAYS: Record<string, string[]> = {
  si: ["ඉරිදා", "සඳුදා", "අඟහරුවාදා", "බදාදා", "බ්‍රහස්පතින්දා", "සිකුරාදා", "සෙනසුරාදා"],
  ta: ["ஞாயிறு", "திங்கள்", "செவ்வாய்", "புதன்", "வியாழன்", "வெள்ளி", "சனி"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
};

function nextDays(lang: string, tomorrow: string): { date: string; top: string; sub: string }[] {
  const out: { date: string; top: string; sub: string }[] = [];
  const now = Date.now();
  const names = WEEKDAYS[lang] ?? WEEKDAYS.en;
  for (let i = 1; i <= 3; i++) {
    const d = new Date(now + i * 86400000);
    const slDay = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Colombo" })).getDay();
    out.push({
      date: d.toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" }),
      top: i === 1 ? tomorrow : names[slDay],
      sub: d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Colombo" }),
    });
  }
  return out;
}

export function ProductHero({ product, deliverTo, actions }: { product: ProductDetail; deliverTo?: string; actions: BlockActions }) {
  const imgs = product.images?.length ? product.images : product.image ? [product.image] : [];
  const [imgIdx, setImgIdx] = useState(0);
  const isCake = /cake/i.test(product.category ?? "") || /^cake/i.test(product.id);
  const [icing, setIcing] = useState("");
  const [pickedDate, setPickedDate] = useState<string | null>(null);
  const t = useT();
  const lang = useLang();
  const days = useMemo(() => nextDays(lang, t("tomorrow")), [lang, t]);
  const save = savePercent(product);
  const meta = detailMeta(product);

  // Instant shipping quote for the user's saved city (shield-cached 5 min)
  const [ship, setShip] = useState<{ loading: boolean; available?: boolean; rate?: number | null; currency?: string; date?: string | null; next?: string | null } | null>(
    deliverTo ? { loading: true } : null
  );
  useEffect(() => {
    if (!deliverTo || !product.id) return;
    let alive = true;
    setShip({ loading: true });
    fetch(`/api/delivery?city=${encodeURIComponent(deliverTo)}&product_id=${encodeURIComponent(product.id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive) setShip(d ? { loading: false, ...d } : null);
      })
      .catch(() => alive && setShip(null));
    return () => {
      alive = false;
    };
  }, [deliverTo, product.id]);

  // Size/colour variants (S7) — only when the catalog gives real names.
  const variantOpts = useMemo(() => {
    const list = Array.isArray(product.variants) ? product.variants : [];
    const names = list
      .map((v) => {
        const o = v as { name?: unknown };
        return typeof o.name === "string" && o.name.trim() && !/default/i.test(o.name) ? o.name.trim() : null;
      })
      .filter((n): n is string => Boolean(n));
    return [...new Set(names)].slice(0, 8);
  }, [product.variants]);
  const [variant, setVariant] = useState<string | null>(null);

  return (
    <div className={`rise my-2 overflow-hidden rounded-2xl ${CARD}`}>
      <div className="flex flex-col sm:flex-row">
        {/* gallery */}
        <div className="relative sm:w-[46%] sm:shrink-0">
          {save != null && (
            <span className="absolute left-3 top-3 z-[1] rounded-full bg-card px-2.5 py-1 text-[9.5px] font-bold uppercase tracking-[0.05em] text-clay shadow-sm">
              {t("saveToday", { n: save })}
            </span>
          )}
          <ProductImage
            src={imgs[imgIdx] ?? product.image}
            alt={product.name}
            category={product.category}
            className="h-56 w-full sm:h-full sm:min-h-[300px]"
            width={800}
            iconSize={44}
          />
          {imgs.length > 1 && (
            <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1.5 sm:hidden">
              {imgs.slice(0, 5).map((_, i) => (
                <button
                  key={i}
                  onClick={() => setImgIdx(i)}
                  aria-label={`Photo ${i + 1}`}
                  className={`h-1.5 rounded-full transition-all ${i === imgIdx ? "w-4 bg-leaf" : "w-1.5 bg-ink-faint/60"}`}
                />
              ))}
            </div>
          )}
        </div>

        {/* info */}
        <div className="flex flex-1 flex-col gap-2.5 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-display text-[19px] leading-snug text-ink">{product.name}</h3>
              {meta && <p className="mt-0.5 text-[11.5px] text-ink-soft">{meta}</p>}
            </div>
            <span className="flex shrink-0 items-center gap-1.5">
              <button
                onClick={() => actions.onToggleFav(product)}
                aria-label="Favorite"
                className={`flex h-8 w-8 items-center justify-center rounded-full border border-line transition active:scale-90 ${
                  actions.isFav(product.id) ? "text-clay" : "text-ink-faint"
                }`}
              >
                <IconHeart size={16} filled={actions.isFav(product.id)} />
              </button>
              <StockBadge p={product} />
            </span>
          </div>

          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="price-serif text-[26px] text-leaf">{fmt(product.price, product.currency)}</span>
            {save != null && (
              <>
                <span className="text-[13px] text-ink-faint line-through">{fmt(product.compare_at_price, product.currency)}</span>
                <span className="rounded-md bg-gold-soft px-1.5 py-0.5 text-[10px] font-bold text-gold-deep">{t("savePct", { n: save })}</span>
              </>
            )}
          </div>

          {deliverTo && ship && (
            <p className="flex items-center gap-1.5 text-[11.5px] font-medium">
              <IconTruck size={13} className={ship.available === false ? "text-clay" : "text-leaf"} />
              {ship.loading ? (
                <span className="text-ink-faint">{t("shipCheck", { city: deliverTo })}</span>
              ) : ship.available ? (
                <span className="text-leaf">
                  {t("shipLine", { rate: fmt(ship.rate ?? null, ship.currency || "LKR"), city: deliverTo, date: ship.date ?? "" })}
                </span>
              ) : ship.next && ship.rate != null ? (
                <span className="text-leaf">
                  {t("shipFrom", { rate: fmt(ship.rate, ship.currency || "LKR"), city: deliverTo, date: ship.next })}
                </span>
              ) : (
                <span className="text-clay">{t("shipNext", { city: deliverTo, date: ship.next ?? "—" })}</span>
              )}
            </p>
          )}

          {product.summary && !isCake && <p className="text-[12.5px] leading-relaxed text-ink-soft">{product.summary}</p>}

          {variantOpts.length > 1 && (
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-faint">{t("options")}</p>
              <div className="flex flex-wrap gap-2">
                {variantOpts.map((name) => {
                  const active = variant === name;
                  return (
                    <button
                      key={name}
                      onClick={() => setVariant(active ? null : name)}
                      className={`rounded-xl border px-3 py-1.5 text-[12px] font-semibold transition active:scale-95 ${
                        active ? "border-leaf bg-leaf text-white dark:bg-[#402970]" : "border-edge bg-card text-ink"
                      }`}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {isCake && (
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-faint">{t("icingLabel")}</p>
              <label className="flex items-center gap-2.5 rounded-[13px] border-[1.5px] border-edge bg-surface px-3.5 py-2.5">
                <IconPencil size={15} className="shrink-0 text-leaf" />
                <input
                  value={icing}
                  onChange={(e) => setIcing(e.target.value.slice(0, 40))}
                  placeholder="Happy Birthday Amma!"
                  className="font-display w-full bg-transparent text-[14px] italic text-ink outline-none placeholder:text-ink-faint"
                />
                <span className="shrink-0 text-[10.5px] text-ink-faint">{icing.length} / 40</span>
              </label>
            </div>
          )}

          {isCake && (
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-faint">
                {deliverTo ? t("deliverToCityLabel", { city: deliverTo }) : t("deliverDay")}
              </p>
              <div className="flex flex-wrap gap-2">
                {days.map((d) => {
                  const active = pickedDate === d.date;
                  return (
                    <button
                      key={d.date}
                      onClick={() => {
                        setPickedDate(d.date);
                        actions.onPreferDate(d.date);
                      }}
                      className={`rounded-xl border px-3.5 py-1.5 text-center transition active:scale-95 ${
                        active ? "border-leaf bg-leaf text-white dark:bg-[#402970]" : "border-edge bg-card text-ink"
                      }`}
                    >
                      <span className="block text-[12px] font-semibold leading-tight">{d.top}</span>
                      <span className={`block text-[10px] leading-tight ${active ? "text-white/70" : "text-ink-faint"}`}>{d.sub}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mt-auto flex gap-2 pt-1.5">
            <button
              onClick={() =>
                actions.onCartAdd(
                  variant ? { ...product, name: `${product.name} — ${variant}` } : product,
                  icing.trim() ? { icing: icing.trim() } : undefined
                )
              }
              disabled={product.in_stock === false}
              className="flex flex-1 items-center justify-center gap-2 rounded-[13px] bg-gold py-2.5 text-[13.5px] font-semibold text-ink shadow-[0_6px_18px_rgba(255,184,0,0.35)] transition active:scale-[0.98] disabled:opacity-40 dark:text-[#322b45]"
            >
              <IconBasket size={15} />
              {t("addToBasket")}
            </button>
            {product.url && (
              <a
                href={product.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 rounded-[13px] border border-edge px-3.5 py-2.5 text-[12.5px] font-semibold text-ink-soft transition active:scale-[0.98]"
              >
                {t("viewOnKapruka")}
                <IconExternal size={12} />
              </a>
            )}
          </div>
        </div>
      </div>

      {/* desktop thumbnails */}
      {imgs.length > 1 && (
        <div className="hidden gap-2 border-t border-line p-3 sm:flex">
          {imgs.slice(0, 5).map((src, i) => (
            <button
              key={i}
              onClick={() => setImgIdx(i)}
              className={`overflow-hidden rounded-xl border-2 transition ${i === imgIdx ? "border-leaf" : "border-transparent opacity-70"}`}
              aria-label={`Photo ${i + 1}`}
            >
              <ProductImage src={src} alt="" category={product.category} className="h-14 w-16" width={200} iconSize={20} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── side-by-side compare — spec rows + Kapu's verdict ──────────────────

type CompareRow = { label: string; cells: (string | null)[]; winner: number };

type Tr = ReturnType<typeof useT>;

function compareRows(products: ProductDetail[], t: Tr): CompareRow[] {
  const rows: CompareRow[] = [];
  const prices = products.map((p) => p.price);
  const validPrices = prices.filter((p): p is number => p != null);
  if (validPrices.length) {
    const min = Math.min(...validPrices);
    rows.push({
      label: t("price"),
      cells: products.map((p) => fmt(p.price, p.currency)),
      winner: prices.findIndex((p) => p === min),
    });
  }
  const saves = products.map(savePercent);
  if (saves.some((s) => s != null)) {
    const best = Math.max(...saves.map((s) => s ?? 0));
    rows.push({
      label: t("deal"),
      cells: saves.map((s) => (s != null ? t("savePct", { n: s }) : "—")),
      winner: best > 0 ? saves.findIndex((s) => (s ?? 0) === best) : -1,
    });
  }
  rows.push({
    label: t("availability"),
    cells: products.map((p) => (p.in_stock === false ? t("outOfStock") : t("inStock"))),
    winner: -1,
  });
  const weights = products.map((p) => {
    const w = Number((p.attributes ?? {}).weight);
    return w > 0.5 ? `${(w * 0.4536).toFixed(1)} kg` : null;
  });
  if (weights.some(Boolean)) rows.push({ label: t("weight"), cells: weights, winner: -1 });
  const vendors = products.map((p) => {
    const v = (p.attributes ?? {}).vendor;
    return typeof v === "string" ? v.slice(0, 28) : null;
  });
  if (vendors.some(Boolean)) rows.push({ label: t("seller"), cells: vendors, winner: -1 });
  return rows;
}

export function CompareGrid({ products, verdict, actions }: { products: ProductDetail[]; verdict?: string; actions: BlockActions }) {
  const t = useT();
  const rows = useMemo(() => compareRows(products, t), [products, t]);
  const cols = products.length;
  return (
    <div className={`rise my-2 overflow-hidden rounded-2xl ${CARD}`}>
      <div className="overflow-x-auto">
        <div style={{ minWidth: cols > 2 ? cols * 190 + 90 : 0 }}>
          {/* product tiles */}
          <div className="grid" style={{ gridTemplateColumns: `minmax(64px,90px) repeat(${cols}, minmax(150px,1fr))` }}>
            <div />
            {products.map((p, i) => (
              <div key={p.id} className="relative border-l border-line p-3">
                {i === 0 && <PickBadge small />}
                <ProductImage src={p.image} alt={p.name} category={p.category} className="h-28 w-full rounded-xl" width={400} iconSize={28} />
                <p className="mt-2 line-clamp-2 text-[12.5px] font-semibold leading-snug">{p.name}</p>
                <p className="price-serif mt-1 text-[16px] text-ink">{fmt(p.price, p.currency)}</p>
              </div>
            ))}
          </div>
          {/* spec rows */}
          {rows.map((row) => (
            <div
              key={row.label}
              className="grid border-t border-line"
              style={{ gridTemplateColumns: `minmax(64px,90px) repeat(${cols}, minmax(150px,1fr))` }}
            >
              <div className="px-3 py-2.5 text-[9.5px] font-semibold uppercase tracking-[0.07em] text-ink-faint">{row.label}</div>
              {row.cells.map((cell, i) => (
                <div key={i} className="flex items-center gap-1.5 border-l border-line px-3 py-2 text-[12.5px]">
                  {row.winner === i && <IconCheckCircle size={12} />}
                  <span className={row.winner === i ? "font-bold" : "text-ink-soft"}>{cell ?? "—"}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {verdict && (
        <div className="flex items-start gap-2.5 bg-leaf px-4 py-3 dark:bg-[#402970]">
          <KapuMark size={20} radius={6} />
          <p className="text-[12.5px] leading-relaxed text-white">
            <strong className="text-gold">{t("verdict")}</strong> {verdict}
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2 p-3">
        {products.map((p, i) => (
          <button
            key={p.id}
            onClick={() => actions.onCartAdd(p)}
            disabled={p.in_stock === false}
            className={`flex-1 whitespace-nowrap rounded-[12px] px-4 py-2 text-[12.5px] font-semibold transition active:scale-[0.98] disabled:opacity-40 ${
              i === 0
                ? "bg-gold text-ink shadow-[0_4px_14px_rgba(255,184,0,0.35)] dark:text-[#322b45]"
                : "border border-edge bg-card text-ink"
            }`}
          >
            {t("add")} {p.name.split(" ").slice(0, 2).join(" ")}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── delivery card ──────────────────────────────────────────────────────

export function DeliveryCard({ block }: { block: Extract<UiBlock, { type: "delivery_card" }> }) {
  const t = useT();
  return (
    <div className={`rise my-2 rounded-2xl p-4 ${CARD}`}>
      <div className="flex items-center gap-3">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] ${
            block.available ? "bg-leaf-soft text-leaf" : "bg-clay-soft text-clay"
          }`}
        >
          <IconTruck size={19} />
        </span>
        <div className="min-w-0">
          <p className="text-[13.5px] font-semibold">
            {block.available ? t("deliversTo", { city: block.city }) : `${t("notAvailable", { city: block.city })}${block.date ? ` · ${block.date}` : ""}`}
          </p>
          <p className="text-[12px] text-ink-soft">
            {block.available
              ? `${block.date ? `${block.date} · ` : ""}${t("flatRateLine", { rate: fmt(block.rate ?? null, block.currency || "LKR") })}`
              : block.next_available_date
                ? t("nextAvailable", { date: block.next_available_date })
                : block.reason || t("tryAnother")}
          </p>
        </div>
        {block.available && <IconCheckCircle size={18} className="ml-auto shrink-0" />}
      </div>
      {block.perishable_warning && (
        <p className="mt-2.5 rounded-[11px] bg-gold-soft px-3 py-2 text-[11.5px] leading-relaxed text-gold-deep">
          {block.perishable_warning}
        </p>
      )}
    </div>
  );
}

// ── basket ─────────────────────────────────────────────────────────────

export function CartView({
  cart,
  actions,
  compact,
}: {
  cart: Cart;
  actions: BlockActions;
  /** true inside the persistent desktop panel (tighter chrome) */
  compact?: boolean;
}) {
  const subtotal = cart.items.reduce((s, i) => s + (i.price ?? 0) * i.quantity, 0);
  const t = useT();
  const [editingIcing, setEditingIcing] = useState<string | null>(null);
  const [icingDraft, setIcingDraft] = useState("");

  if (cart.items.length === 0)
    return (
      <div className={compact ? "px-4 py-8 text-center" : `rise my-2 rounded-2xl p-6 text-center ${CARD}`}>
        <IconBasket size={26} className="mx-auto text-ink-faint" />
        <p className="mt-2 text-[13px] text-ink-soft">{t("basketEmpty")}</p>
      </div>
    );

  const body = (
    <>
      <ul className="flex flex-col gap-2 px-3 pt-3">
        {cart.items.length > 0 && (
        <p className="mb-2 rounded-[12px] bg-leaf-soft px-3 py-2 text-[11.5px] font-medium leading-snug text-leaf">
          🌳 {t("basketQuip")}
        </p>
      )}
      {cart.items.map((i) => (
          <li key={i.product_id} className="rounded-[14px] border border-line bg-surface p-2.5">
            <div className="flex items-start gap-2.5">
              <ProductImage src={i.image} alt={i.name} category={i.category} className="h-11 w-11 shrink-0 rounded-[10px]" width={120} iconSize={18} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-semibold leading-snug">{i.name}</p>
                {i.icing_text && editingIcing !== i.product_id && (
                  <button
                    onClick={() => {
                      setEditingIcing(i.product_id);
                      setIcingDraft(i.icing_text ?? "");
                    }}
                    className="mt-0.5 flex items-center gap-1 text-[11px] italic text-ink-soft"
                  >
                    <IconPencil size={10} />
                    <span className="font-display truncate">&ldquo;{i.icing_text}&rdquo;</span>
                  </button>
                )}
                {editingIcing === i.product_id && (
                  <input
                    autoFocus
                    value={icingDraft}
                    onChange={(e) => setIcingDraft(e.target.value.slice(0, 40))}
                    onBlur={() => {
                      actions.onCartIcing(i.product_id, icingDraft.trim());
                      setEditingIcing(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                    className="font-display mt-1 w-full rounded-lg border border-edge bg-card px-2 py-1 text-[11.5px] italic outline-none"
                  />
                )}
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="flex items-center overflow-hidden rounded-[9px] border border-edge">
                    <button
                      onClick={() => actions.onCartQty(i.product_id, i.quantity - 1)}
                      className="px-2 py-0.5 text-[13px] font-bold text-ink-soft active:bg-cream"
                      aria-label={`Reduce ${i.name}`}
                    >
                      −
                    </button>
                    <span className="min-w-6 border-x border-edge px-1 text-center text-[12px] font-semibold">{i.quantity}</span>
                    <button
                      onClick={() => actions.onCartQty(i.product_id, i.quantity + 1)}
                      className="px-2 py-0.5 text-[13px] font-bold text-ink-soft active:bg-cream"
                      aria-label={`Increase ${i.name}`}
                    >
                      +
                    </button>
                  </div>
                  <span className="price-serif text-[14px]">{fmt((i.price ?? 0) * i.quantity, i.currency)}</span>
                  <button
                    onClick={() => actions.onCartQty(i.product_id, 0)}
                    className="ml-auto text-[11px] font-semibold text-clay"
                  >
                    {t("remove")}
                  </button>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <div className="mx-3 mt-2.5 flex items-start gap-2.5 rounded-[13px] bg-leaf-soft px-3 py-2.5">
        <IconTruck size={15} className="mt-0.5 shrink-0 text-leaf" />
        <p className="text-[11.5px] leading-snug text-leaf">{t("flatNote")}</p>
      </div>

      <div className="flex items-baseline justify-between px-4 pb-1 pt-3">
        <p className="text-[12.5px] text-ink-soft">{t("subtotal")}</p>
        <p className="price-serif text-[20px]">{fmt(subtotal, cart.currency)}</p>
      </div>
      <div className="p-3 pt-1.5">
        <button
          onClick={() => actions.onAction("Let's checkout — show me the order summary")}
          className="flex w-full items-center justify-center gap-2 rounded-[13px] bg-gold py-3 text-[13.5px] font-bold text-ink shadow-[0_6px_20px_rgba(255,184,0,0.4)] transition active:scale-[0.99] dark:text-[#322b45]"
        >
          {t("checkout")}
          <IconArrowRight size={15} />
        </button>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(`🌳 Kapu basket · ${cart.items.map((i) => `${i.name} ×${i.quantity}`).join(", ")} · ${fmt(subtotal, cart.currency)} — kapuwa.shop`)}`}
          target="_blank"
          rel="noreferrer"
          className="mt-2 flex items-center justify-center gap-2 rounded-[13px] border border-edge bg-card py-2.5 text-[12px] font-semibold text-ink-soft transition active:scale-[0.99]"
        >
          <span className="text-[#25D366]">🟢</span> {t("waBasket")}
        </a>
      </div>
    </>
  );

  if (compact) return <div>{body}</div>;
  return <div className={`rise my-2 overflow-hidden rounded-2xl pb-0.5 ${CARD}`}>{body}</div>;
}

// ── order summary — the confirm gate ───────────────────────────────────

export function OrderSummaryCard({ summary, actions }: { summary: OrderSummaryData; actions: BlockActions }) {
  const t = useT();
  return (
    <div className={`rise my-2 overflow-hidden rounded-2xl ${CARD}`}>
      <div className="flex items-center gap-2.5 border-b border-line bg-surface px-4 py-3">
        <IconReceipt size={15} className="text-leaf" />
        <p className="font-display text-[15px]">{t("orderSummary")}</p>
        {summary.tagline && <p className="ml-auto text-[11px] text-ink-faint">{summary.tagline}</p>}
      </div>

      <ul className="flex flex-col gap-2.5 px-4 py-3">
        {summary.items.map((i) => (
          <li key={i.product_id} className="flex items-center gap-3">
            <ProductImage src={i.image} alt={i.name} category={i.category} className="h-10 w-10 shrink-0 rounded-[10px]" width={120} iconSize={16} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-semibold">
                {i.name}
                {i.quantity > 1 ? ` ×${i.quantity}` : ""}
              </p>
              {i.icing_text && <p className="font-display truncate text-[11px] italic text-ink-soft">&ldquo;{i.icing_text}&rdquo;</p>}
            </div>
            <span className="price-serif shrink-0 text-[13.5px]">{fmt((i.price ?? 0) * i.quantity, i.currency)}</span>
          </li>
        ))}
      </ul>

      <div className="grid gap-2.5 px-4 pb-3 sm:grid-cols-2">
        <div className="rounded-[13px] bg-surface p-3">
          <p className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-faint">{t("deliverToUpper")}</p>
          <p className="mt-1 text-[12.5px] font-semibold">{summary.recipient.name}</p>
          <p className="text-[11.5px] leading-snug text-ink-soft">
            {summary.delivery.address}, {summary.delivery.city}
          </p>
          <p className="text-[11.5px] text-ink-soft">{summary.recipient.phone}</p>
        </div>
        <div className="rounded-[13px] bg-surface p-3">
          <p className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-faint">{t("deliveryUpper")}</p>
          <p className="mt-1 text-[12.5px] font-semibold">{summary.delivery.date}</p>
          <p className="text-[11.5px] leading-snug text-ink-soft">
            {summary.delivery_available === false
              ? t("dateUnavailable")
              : summary.delivery_rate != null
                ? t("flatRateWhole", { rate: fmt(summary.delivery_rate, summary.currency) })
                : t("rateAtPay")}
          </p>
          {summary.sender?.anonymous && <p className="text-[11.5px] text-ink-soft">{t("surpriseKept")}</p>}
          {summary.gift_message && (
            <p className="font-display mt-0.5 truncate text-[11px] italic text-ink-soft">{t("cardLabel")} &ldquo;{summary.gift_message}&rdquo;</p>
          )}
        </div>
      </div>

      {summary.perishable_warning && (
        <p className="mx-4 mb-3 rounded-[11px] bg-gold-soft px-3 py-2 text-[11.5px] leading-relaxed text-gold-deep">
          {summary.perishable_warning}
        </p>
      )}

      <div className="flex items-baseline justify-between border-t border-line px-4 pb-1.5 pt-3">
        <p className="text-[13px] font-semibold">{summary.delivery_rate != null ? t("total") : t("totalBeforeDelivery")}</p>
        <p className="price-serif text-[24px] text-leaf">{fmt(summary.total, summary.currency)}</p>
      </div>

      <div className="flex flex-col gap-2 p-3 sm:flex-row">
        <button
          onClick={() => actions.onAction("Yes — place the order.")}
          className="flex flex-1 items-center justify-center gap-2 rounded-[13px] bg-gold py-3 text-[13.5px] font-bold text-ink shadow-[0_6px_18px_rgba(255,184,0,0.35)] transition active:scale-[0.99] dark:text-[#322b45]"
        >
          <IconCheck size={14} />
          {t("placeOrder")}
        </button>
        <button
          onClick={actions.onFocusComposer}
          className="rounded-[13px] border border-edge px-5 py-3 text-[13px] font-semibold text-ink-soft transition active:scale-[0.99]"
        >
          {t("changeSomething")}
        </button>
      </div>
    </div>
  );
}

// ── pay link — wish granted ────────────────────────────────────────────

function useCountdown(expiresAt?: string, createdAt?: number): string | null {
  const target = useMemo(() => {
    if (expiresAt) {
      const t = Date.parse(expiresAt);
      if (!isNaN(t)) return t;
    }
    if (createdAt) return createdAt + 60 * 60 * 1000;
    return null;
  }, [expiresAt, createdAt]);
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!target) return;
    const tick = () => setLeft(Math.max(0, target - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [target]);
  if (left == null) return null;
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function PayLink({ block }: { block: Extract<UiBlock, { type: "pay_link" }> }) {
  const t = useT();
  const countdown = useCountdown(block.expires_at, block.created_at);
  return (
    <div className="rise relative my-2 overflow-hidden rounded-2xl bg-leaf p-4 text-white shadow-[0_10px_30px_rgba(64,41,112,0.35)] dark:bg-[#402970]">
      <span
        aria-hidden
        className="pointer-events-none absolute -right-4 -top-10 select-none text-[130px] leading-none text-white/[0.05]"
        style={{ fontFamily: "var(--font-sinhala-var), 'Noto Sans Sinhala'" }}
      >
        කපූ
      </span>
      <div className="relative flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-white/10 text-gold">
          <IconWish size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold">
            {t("orderCreated")} <span className="font-display italic text-gold">{t("wishGranted")}</span>
          </p>
          <p className="mt-0.5 text-[11.5px] leading-snug text-white/75">
            {t("refLine", { ref: block.order_ref })}
          </p>
          {block.breakdown && block.breakdown.items_total != null && (
            <p className="mt-1 text-[11px] text-white/65">
              {t("breakdown", { items: fmt(block.breakdown.items_total, block.currency), delivery: fmt(block.breakdown.delivery_fee ?? 0, block.currency) })}
              {block.breakdown.addons_total ? ` + add-ons ${fmt(block.breakdown.addons_total, block.currency)}` : ""}
            </p>
          )}
        </div>
        {countdown && (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[10.5px] font-semibold text-gold">
            <IconClock size={11} />
            {t("priceLocked")} · {countdown}
          </span>
        )}
      </div>
      <a
        href={block.pay_url}
        target="_blank"
        rel="noreferrer"
        className="relative mt-3 flex items-center justify-center gap-2 rounded-[13px] bg-gold py-3 text-[14px] font-bold text-[#322b45] shadow-[0_8px_24px_rgba(0,0,0,0.25)] transition active:scale-[0.99]"
      >
        <IconLock size={14} />
        {t("paySecurely")}{block.total != null ? ` · ${fmt(block.total, block.currency || "LKR")}` : ""}
      </a>
      <a
        href={`https://wa.me/?text=${encodeURIComponent(`🌳 Kapu order ${block.order_ref}${block.total != null ? ` · ${fmt(block.total, block.currency || "LKR")}` : ""} — pay securely: ${block.pay_url}`)}`}
        target="_blank"
        rel="noreferrer"
        className="relative mt-2 flex items-center justify-center gap-2 rounded-[13px] border border-white/20 bg-white/[0.07] py-2.5 text-[12.5px] font-semibold text-white transition active:scale-[0.99]"
      >
        <span className="text-[#25D366]">🟢</span> {t("waPay")}
      </a>
    </div>
  );
}

// ── order timeline — see it arrive ─────────────────────────────────────

const STEP_KEYS = { received: "stepReceived", confirmed: "stepConfirmed", shipped: "stepShipped", delivered: "stepDelivered" } as const;
const STEP_ORDER = ["received", "confirmed", "shipped", "delivered"] as const;

function fmtStamp(ts?: string | null): string | null {
  if (!ts) return null;
  const t = Date.parse(ts);
  if (isNaN(t)) return ts;
  return new Date(t).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Colombo",
  });
}

export function OrderTimeline({ block, actions }: { block: Extract<UiBlock, { type: "order_timeline" }>; actions: BlockActions }) {
  const t = useT();
  const status = block.status?.toLowerCase();
  const doneIdx = (STEP_ORDER as readonly string[]).indexOf(status);
  const cancelled = status === "cancelled";
  const stamps = new Map(block.progress.map((p) => [p.step.toLowerCase(), p.timestamp]));
  const delivered = status === "delivered";
  const hasProof = block.has_delivery_photo || block.has_delivery_video;

  return (
    <div className={`rise my-2 overflow-hidden rounded-2xl ${CARD}`}>
      <div className="flex items-center justify-between gap-2 border-b border-line bg-surface px-4 py-3">
        <p className="font-display text-[15px]">
          {t("order")} <span className="text-leaf">#{block.order_number}</span>
        </p>
        <span
          className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-semibold ${
            cancelled ? "bg-clay-soft text-clay" : delivered ? "bg-good-soft text-good" : "bg-leaf-soft text-leaf"
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${cancelled ? "bg-clay" : delivered ? "bg-good" : "bg-leaf"}`} />
          {block.status_display || block.status}
        </span>
      </div>

      <div className="flex flex-col gap-4 p-4 sm:flex-row">
        {/* vertical timeline */}
        <ol className="flex-1">
          {STEP_ORDER.map((step, i) => {
            const done = i <= doneIdx && !cancelled;
            // the in-flight step glows gold; a delivered order ends on a green check
            const current = i === doneIdx && !cancelled && !delivered;
            const finale = delivered && i === doneIdx;
            const stamp = fmtStamp(stamps.get(step));
            return (
              <li key={step} className="relative flex gap-3 pb-4 last:pb-0">
                {i < STEP_ORDER.length - 1 && (
                  <span
                    className={`absolute left-[13px] top-7 h-[calc(100%-1.75rem)] w-0.5 rounded ${done && i < doneIdx ? "bg-leaf" : "bg-cream-deep"}`}
                  />
                )}
                <span
                  className={`z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                    finale
                      ? "bg-good text-white shadow-[0_0_0_5px_rgba(46,158,91,0.18)]"
                      : current
                        ? "bg-gold text-ink shadow-[0_0_0_5px_rgba(255,184,0,0.2)] dark:text-[#322b45]"
                        : done
                          ? "bg-leaf text-white dark:bg-[#402970]"
                          : "border-2 border-dashed border-cream-deep text-transparent"
                  }`}
                >
                  {current ? <IconTruck size={13} /> : done ? <IconCheck size={11} /> : null}
                </span>
                <div className="min-w-0 pt-0.5">
                  <p className={`text-[12.5px] font-semibold ${done ? "" : "text-ink-faint"}`}>{t(STEP_KEYS[step])}</p>
                  <p className="text-[11px] text-ink-soft">
                    {stamp ?? (done ? "" : step === "delivered" ? t("proofAppear") : "")}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>

        {/* proof panel */}
        <div className="sm:w-[46%] sm:shrink-0">
          <p className="mb-1.5 text-[9.5px] font-semibold uppercase tracking-[0.1em] text-ink-faint">{t("seeArrive")}</p>
          {hasProof ? (
            <div className="overflow-hidden rounded-[14px] bg-leaf text-white dark:bg-[#402970]">
              <div className="flex h-28 flex-col items-center justify-center gap-1.5 px-3 text-center">
                <span className="flex items-center gap-1.5 rounded-full bg-good/90 px-2.5 py-0.5 text-[9.5px] font-bold uppercase">
                  <IconCheck size={9} /> {t("delivered")}
                </span>
                <IconCamera size={22} className="text-white/80" />
                <p className="text-[11px] leading-snug text-white/80">
                  {t("proofCaptured", { kind: block.has_delivery_video ? t("video") : t("photo") })}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex h-28 flex-col items-center justify-center gap-1.5 rounded-[14px] border-2 border-dashed border-cream-deep px-3 text-center">
              <IconCamera size={22} className="text-ink-faint" />
              <p className="text-[11px] leading-snug text-ink-faint">{t("proofWait")}</p>
            </div>
          )}
          {!delivered && !cancelled && (
            <button
              onClick={() => actions.onAction(`Watch order ${block.order_number} and send me status updates on Telegram until it's delivered`)}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-[12px] bg-leaf py-2 text-[12px] font-semibold text-white transition active:scale-[0.98] dark:bg-[#402970]"
            >
              <IconClock size={13} />
              {t("watchOrder")}
            </button>
          )}
          {!delivered && !cancelled && (
            <button
              onClick={() => actions.onAction(`Any delivery proof yet? Track order ${block.order_number} again`)}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-[12px] bg-leaf-soft py-2 text-[12px] font-semibold text-leaf transition active:scale-[0.98]"
            >
              <IconBell size={13} />
              {t("nudge")}
            </button>
          )}
        </div>
      </div>

      {block.items && block.items.length > 0 && (
        <p className="border-t border-line px-4 py-2.5 text-[11.5px] text-ink-soft">
          {block.items.map((i) => `${i.name}${(i.quantity ?? 1) > 1 ? ` ×${i.quantity}` : ""}`).join(" · ")}
        </p>
      )}
    </div>
  );
}

// ── greeting card — canvas-download festival card (perfect Sinhala) ─────

function drawCard(block: Extract<UiBlock, { type: "greeting_card" }>): HTMLCanvasElement {
  const W = 1080;
  const H = 1350;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, block.color_from);
  grad.addColorStop(1, block.color_to);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = "rgba(255,184,0,0.55)";
  g.lineWidth = 6;
  g.strokeRect(42, 42, W - 84, H - 84);
  g.textAlign = "center";
  g.font = "170px serif";
  g.fillText(block.glyph, W / 2, 330);
  g.fillStyle = "rgba(255,255,255,0.75)";
  g.font = "36px 'Instrument Sans', system-ui";
  g.fillText(`to ${block.to}`, W / 2, 450);
  g.fillStyle = "#ffffff";
  g.font = "64px 'Instrument Serif', 'Noto Sans Sinhala', 'Noto Sans Tamil', serif";
  const words = block.message.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (g.measureText(test).width > W - 220 && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  lines.slice(0, 5).forEach((l, i) => g.fillText(l, W / 2, 600 + i * 92));
  if (block.from) {
    g.fillStyle = "rgba(255,255,255,0.75)";
    g.font = "38px 'Instrument Sans', system-ui";
    g.fillText(`— ${block.from}`, W / 2, 620 + Math.min(lines.length, 5) * 92 + 40);
  }
  g.fillStyle = "#ffb800";
  g.font = "600 30px 'Instrument Sans', system-ui";
  g.fillText("🌳 sent with Kapu · kapuwa.shop", W / 2, H - 96);
  return c;
}

export function GreetingCard({ block }: { block: Extract<UiBlock, { type: "greeting_card" }> }) {
  const t = useT();
  const download = () => {
    drawCard(block).toBlob((b) => {
      if (!b) return;
      const url = URL.createObjectURL(b);
      const a = document.createElement("a");
      a.href = url;
      a.download = `kapu-card-${block.to.toLowerCase().replace(/\s+/g, "-")}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }, "image/png");
  };
  const share = () => {
    drawCard(block).toBlob(async (b) => {
      if (!b) return;
      const file = new File([b], "kapu-card.png", { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text: block.message }).catch(() => {});
      } else download();
    }, "image/png");
  };
  return (
    <div className="my-2 max-w-[330px]">
      <div
        className="rise overflow-hidden rounded-[22px] p-7 text-center text-white shadow-[0_20px_60px_rgba(0,0,0,0.35)]"
        style={{ background: `linear-gradient(180deg, ${block.color_from}, ${block.color_to})`, border: "1.5px solid rgba(255,184,0,0.4)" }}
      >
        <p className="text-[56px] leading-none">{block.glyph}</p>
        <p className="mt-3 text-[11px] uppercase tracking-[0.18em] text-white/60">to {block.to}</p>
        <p className="font-display mt-3 text-[21px] leading-snug">{block.message}</p>
        {block.from && <p className="mt-3 text-[12px] text-white/70">— {block.from}</p>}
        <p className="mt-5 text-[9.5px] font-semibold text-gold">🌳 sent with Kapu</p>
      </div>
      <div className="mt-2 flex gap-2">
        <button onClick={download} className="flex-1 rounded-[12px] bg-gold py-2.5 text-[12px] font-bold text-ink shadow-sm transition active:scale-[0.98] dark:text-[#322b45]">
          ⬇️ {t("cardDownload")}
        </button>
        <button onClick={share} className="flex-1 rounded-[12px] border border-edge bg-card py-2.5 text-[12px] font-semibold text-leaf transition active:scale-[0.98]">
          📤 {t("cardShare")}
        </button>
      </div>
    </div>
  );
}

// ── no results — always a path forward ─────────────────────────────────

export function NoResults({ query }: { query: string }) {
  const t = useT();
  return (
    <div className={`rise my-2 rounded-2xl p-4 ${CARD}`}>
      <div className="flex items-center gap-2.5">
        <IconSearchNone size={17} className="shrink-0 text-ink-soft" />
        <p className="text-[13.5px] font-semibold">{t("noMatch", { q: query })}</p>
      </div>
    </div>
  );
}

// ── chips ──────────────────────────────────────────────────────────────

export function Chips({ chips, actions }: { chips: string[]; actions: BlockActions }) {
  return (
    <div className="my-2 flex flex-wrap gap-2">
      {chips.map((c) => (
        <button
          key={c}
          onClick={() => actions.onAction(c)}
          className="rise rounded-full border border-edge bg-card px-3.5 py-1.5 text-[12.5px] font-medium text-ink shadow-[0_2px_8px_rgba(64,41,112,0.05)] transition active:scale-95"
        >
          {c}
        </button>
      ))}
    </div>
  );
}

// ── renderer ───────────────────────────────────────────────────────────

export function BlockRenderer({ block, actions, deliverTo }: { block: UiBlock; actions: BlockActions; deliverTo?: string }) {
  switch (block.type) {
    case "product_grid":
      return <ProductGrid title={block.title} products={block.products} actions={actions} />;
    case "product_hero":
      return <ProductHero product={block.product} deliverTo={deliverTo} actions={actions} />;
    case "compare_grid":
      return <CompareGrid products={block.products} verdict={block.verdict} actions={actions} />;
    case "delivery_card":
      return <DeliveryCard block={block} />;
    case "cart":
      return <CartView cart={block.cart} actions={actions} />;
    case "order_summary":
      return <OrderSummaryCard summary={block.summary} actions={actions} />;
    case "pay_link":
      return <PayLink block={block} />;
    case "order_timeline":
      return <OrderTimeline block={block} actions={actions} />;
    case "greeting_card":
      return <GreetingCard block={block} />;
    case "no_results":
      return <NoResults query={block.query} />;
    case "chips":
      return <Chips chips={block.chips} actions={actions} />;
    case "speech": // spoken only — never rendered
    default:
      return null;
  }
}
