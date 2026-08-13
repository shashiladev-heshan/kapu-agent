// Cake Studio theming — shared by the design_cake tool (server picks the
// initial theme) and the CakeStudio block (client re-themes live as the user
// taps flavours). Pure data + pure functions, no imports: the model supplies
// SEMANTICS (flavour, occasion, style) and every colour comes from here, the
// same deterministic-theme-from-a-keyword pattern create_card uses — an LLM
// never invents a hex code.

export interface CakePalette {
  /** sponge / tier body */
  base: string;
  /** icing drip + caps */
  cream: string;
  /** decorations (confetti, bunting, borders) */
  accent: string;
  /** text piped on the cake, deep shadow tone */
  deep: string;
}

export interface CakeFlavour {
  key: string;
  label: string;
  /** what to search on Kapruka for real matches */
  q: string;
  palette: CakePalette;
}

export const CAKE_FLAVOURS: CakeFlavour[] = [
  {
    key: "chocolate",
    label: "Chocolate",
    q: "chocolate cake",
    palette: { base: "#6b4226", cream: "#f7e8d8", accent: "#c77b28", deep: "#2a1707" },
  },
  {
    key: "vanilla",
    label: "Vanilla",
    q: "vanilla cake",
    palette: { base: "#f0dfb9", cream: "#fff8ec", accent: "#e9b84c", deep: "#8a6420" },
  },
  {
    key: "ribbon",
    label: "Ribbon",
    q: "ribbon cake",
    palette: { base: "#f29fb6", cream: "#fde8ee", accent: "#e05780", deep: "#7e1e40" },
  },
  {
    key: "red-velvet",
    label: "Red velvet",
    q: "red velvet cake",
    palette: { base: "#8e1f2f", cream: "#fbeff1", accent: "#c9184a", deep: "#3c0a13" },
  },
  {
    key: "butterscotch",
    label: "Butterscotch",
    q: "butterscotch cake",
    palette: { base: "#e2a55a", cream: "#fdf1de", accent: "#b06f1e", deep: "#5f3a0c" },
  },
  {
    key: "coffee",
    label: "Coffee",
    q: "coffee cake",
    palette: { base: "#7d5a44", cream: "#f3e9df", accent: "#a97c50", deep: "#241608" },
  },
];

export type CakeStyle = "classic" | "playful" | "elegant" | "festive";

export const CAKE_STYLES: { key: CakeStyle; label: string; tiers: number }[] = [
  { key: "classic", label: "Classic", tiers: 2 },
  { key: "playful", label: "Playful", tiers: 1 },
  { key: "elegant", label: "Elegant", tiers: 3 },
  { key: "festive", label: "Festive", tiers: 2 },
];

/** Fuzzy flavour lookup — "choc fudge" → chocolate; unknown → ribbon (the
 *  celebration default in Kapruka's own catalog). */
export function cakeFlavour(input?: string): CakeFlavour {
  const s = (input ?? "").toLowerCase();
  const hit =
    CAKE_FLAVOURS.find((f) => s.includes(f.key.replace("-", " ")) || s.includes(f.key)) ??
    (/(choc|fudge|mocha brownie)/.test(s) ? CAKE_FLAVOURS[0] : undefined) ??
    (/velvet/.test(s) ? CAKE_FLAVOURS[3] : undefined) ??
    (/(caramel|scotch)/.test(s) ? CAKE_FLAVOURS[4] : undefined) ??
    (/(mocha|espresso)/.test(s) ? CAKE_FLAVOURS[5] : undefined);
  return hit ?? CAKE_FLAVOURS[2];
}

export function cakeStyle(input?: string): { key: CakeStyle; tiers: number } {
  const s = (input ?? "").toLowerCase() as CakeStyle;
  const hit = CAKE_STYLES.find((x) => x.key === s);
  return hit ? { key: hit.key, tiers: hit.tiers } : { key: "classic", tiers: 2 };
}

/** Occasion → topper glyph. Same ladder family as create_card's themes. */
export function occasionGlyph(occasion?: string): string {
  const occ = (occasion ?? "").toLowerCase();
  if (/(birthday|bday|උපන්දින)/.test(occ)) return "🎂";
  if (/(anniversary|wedding|විවාහ)/.test(occ)) return "💍";
  if (/(valentine|love|ආදර)/.test(occ)) return "❤️";
  if (/christmas/.test(occ)) return "🎄";
  if (/(avurudu|new year)/.test(occ)) return "🌅";
  if (/(vesak|poson)/.test(occ)) return "🏮";
  if (/(graduat|exam|convocation)/.test(occ)) return "🎓";
  if (/(baby|born|christening)/.test(occ)) return "🍼";
  if (/(congrat|promotion|win)/.test(occ)) return "🎉";
  return "🎂";
}
