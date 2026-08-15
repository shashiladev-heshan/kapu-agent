// Sri Lankan festival calendar (spec C1/N9). Only dates we can stand behind
// — lunar festivals whose exact day varies carry `approx: true` and render
// with a "~". Extend each year; the agent also gets the next festival in its
// per-turn context so seasonal suggestions stay honest.

export interface Festival {
  name: string;
  /** short label for the hero banner */
  label: string;
  date: string; // YYYY-MM-DD
  approx?: boolean;
  /** what tapping the banner asks Kapu */
  msg: string;
  /** catalog search that fills the seasonal rail */
  q: string;
  /** festive glyphs floated around the hero */
  glyphs: string;
  /** one-line seasonal greeting (English; agent localizes in chat) */
  greet: string;
}

const FESTIVALS: Festival[] = [
  {
    name: "Esala Perahera season",
    label: "Esala Perahera",
    date: "2026-08-10",
    approx: true,
    msg: "Esala season is coming — show me gift ideas and pirikara offerings for the season",
    q: "pirikara",
    glyphs: "🏮🐘✨",
    greet: "The season of lights and the great procession — pirikara & temple offerings are in demand",
  },
  { name: "Deepavali", label: "Deepavali", date: "2026-11-08", msg: "Deepavali is coming — show me sweets and gift ideas", q: "deepavali sweets", glyphs: "🪔✨🌼", greet: "Festival of lights — sweets, diyas and gold-touched gifts" },
  { name: "Christmas", label: "Christmas", date: "2026-12-25", msg: "Christmas is coming — show me hampers and gift ideas", q: "christmas hamper", glyphs: "🎄⭐🎁❄️", greet: "Cake season! Hampers and Christmas cakes book out early" },
  { name: "Thai Pongal", label: "Thai Pongal", date: "2027-01-14", msg: "Thai Pongal is coming — show me gift ideas for the celebration", q: "pongal", glyphs: "🌾🥥☀️", greet: "Harvest gratitude — pongal rice, brass and sweet treats" },
  { name: "Valentine's Day", label: "Valentine's", date: "2027-02-14", msg: "Valentine's is coming — show me romantic gift ideas", q: "valentine flowers", glyphs: "🌹💝❤️", greet: "Roses go fast — reserve early for the 14th" },
  {
    name: "Avurudu — Sinhala & Tamil New Year",
    label: "Avurudu",
    date: "2027-04-13",
    msg: "Avurudu is coming — help me build an Avurudu hamper (kavum, kokis, sweetmeats)",
    q: "avurudu",
    glyphs: "🌅🍯🎊",
    greet: "Nekath time matters — kavili hampers and auspicious-hour deliveries",
  },
  { name: "Vesak", label: "Vesak", date: "2027-05-20", approx: true, msg: "Vesak is coming — show me lanterns, dāna items and pirikara", q: "vesak", glyphs: "🏮🕊️🪷", greet: "Lanterns, dāna and white — the gentlest season of giving" },
];

/** Look a festival up by name/label fragment — powers the `?season=` preview
 *  override (e.g. `?season=christmas`) so a season can be featured off-cycle. */
export function festivalByKey(key: string): Festival | null {
  const k = key.trim().toLowerCase();
  if (!k) return null;
  return FESTIVALS.find((f) => f.name.toLowerCase().includes(k) || f.label.toLowerCase().includes(k)) ?? null;
}

/** Next festival from `now` (SL time), with whole-days-until. */
export function nextFestival(now = new Date()): (Festival & { days: number }) | null {
  const todaySL = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Colombo" }));
  todaySL.setHours(0, 0, 0, 0);
  let best: (Festival & { days: number }) | null = null;
  for (const f of FESTIVALS) {
    const d = new Date(`${f.date}T00:00:00+05:30`);
    const days = Math.round((d.getTime() - todaySL.getTime()) / 86400000);
    if (days >= 0 && (!best || days < best.days)) best = { ...f, days };
  }
  return best;
}
