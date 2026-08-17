// Auto-pick a specialist Kapu from what the user actually typed, so the hats
// in the hero rail stop being a thing you must remember to tap. [[specialist-agents]]
//
// Deliberately a LEXICAL matcher, not an LLM call: routing must land before the
// first token streams, and an extra model round-trip per turn would show up as
// dead air in exactly the place Kapu is supposed to feel fast. The hats are
// lexically distinct enough that keywords do the job.
//
// Rules that keep it from being annoying:
//   - A manually pinned hat ALWAYS wins; auto only fills the empty default.
//   - No confident match ⇒ null ⇒ plain Kapu. Silence is the correct answer
//     most of the time; plain Kapu already handles everything.
//   - A tie is not a win — two hats scoring equally means we understood nothing
//     decisive, so we fall back rather than coin-flip.
//   - Switching mid-thread needs a clear margin over the incumbent, otherwise
//     one stray word flips the hat and the conversation feels unstable.

import { KAPU_PRESETS, type SpecialKapu } from "./agents";

/** STRONG terms are ones that essentially only occur in that specialist's
 *  world (poruwa, pirikara, anniversary). WEAK terms fit but are common
 *  elsewhere, so they only count as corroboration. */
interface Lexicon {
  strong: string[];
  weak: string[];
}

const STRONG_WEIGHT = 3;
const WEAK_WEIGHT = 1;
/** One strong hit, or three weak ones. Below this we say nothing. */
const ENGAGE_AT = 3;
/** A challenger must beat the hat already on by this much to take over. */
const SWITCH_MARGIN = 2;

// Sinhala/Tamil script terms are matched as substrings — these languages
// agglutinate case endings onto the stem (කේක්+එකක්, පිරිකර+ය), so anchoring
// on word boundaries would miss most real messages. Latin terms DO get
// boundaries, or "dana" would fire inside "abundant".
const LEXICONS: Record<string, Lexicon> = {
  wedding: {
    strong: [
      "wedding", "poruwa", "bridal", "bride", "groom", "homecoming", "nekath", "nekatha", "kasada", "kasaada", "mangalya",
      "පොරුව", "කසාද", "විවාහ", "මංගල", "නැකත", "නැකැත", "මනාලි", "මනාල",
      "திருமண", "மணமக", "நிச்சயதார்த்த", "கல்யாண",
    ],
    weak: ["engagement", "reception", "guests", "favors", "favours", "දෙපාර්ශ්", "අාරාධ", "விருந்து"],
  },
  diaspora: {
    strong: [
      "abroad", "overseas", "expat", "back home", "ships internationally", "international shipping", "pitarata", "videsha",
      "පිටරට", "විදේශ", "ලංකාවට", "රටින්", "வெளிநாட்", "வெளிநாட்டில்",
    ],
    weak: [
      "australia", "canada", "london", "melbourne", "sydney", "toronto", "dubai", "qatar", "kuwait", "italy", "japan", "korea",
      "send home", "to sri lanka", "ඕස්ට්‍රේලියා", "ලන්ඩන්", "කැනඩා",
    ],
  },
  pooja: {
    strong: [
      "pirikara", "pinkama", "almsgiving", "alms", "katina", "poya", "pansala", "hamuduruwo", "bodhi", "buddha pooja", "dāna", "dane",
      "පිරිකර", "පින්කම", "දාන", "පොහොය", "කඨින", "පන්සල", "හාමුදුරු", "බෝධි", "පූජා", "සංඝ",
      "பூஜை", "கோவில்", "அர்ச்சனை", "அபிஷேக", "தான",
    ],
    // "dana" is deliberately WEAK, not strong: it is also a personal name, and
    // "a gift for Dana" must not land in the almsgiving hat. Paired with poya /
    // monks / pirikara it still clears the threshold easily.
    weak: ["dana", "monk", "monks", "temple", "offering", "සිල්", "දහම්", "விரத"],
  },
  corporate: {
    strong: [
      "corporate", "b2b", "invoice", "invoicing", "our staff", "our employees", "our team", "per head", "company gift",
      "කාර්යාල", "සේවක", "සමාගම", "ආයතන", "நிறுவன", "ஊழியர்", "அலுவலக",
    ],
    weak: ["bulk", "staff", "employees", "office", "vouchers", "clients", "team", "බල්ක්", "மொத்த"],
  },
  budget: {
    strong: [
      "cheapest", "budget", "best deal", "best price", "discount", "price drop", "laabai", "wattam",
      "ලාබ", "වට්ටම්", "මිල අඩු", "අඩුම", "බජට්", "மலிவ", "தள்ளுபடி", "சலுகை", "குறைந்த விலை",
    ],
    weak: ["cheap", "deal", "deals", "offer", "affordable", "save money", "under rs", "value", "සාධාරණ", "අඩු", "விலை"],
  },
  romance: {
    strong: [
      "anniversary", "valentine", "girlfriend", "boyfriend", "propose", "proposal", "romantic", "apologise", "apologize", "apology",
      "i'm sorry", "im sorry", "say sorry", "adare", "samaawa",
      "සංවත්සර", "ආදර", "පෙම්වත", "සමාව", "වර්ෂපූර්ණ",
      "காதல", "மன்னிப்", "ஆண்டு நிறைவு", "காதலி", "காதலன்",
    ],
    weak: ["wife", "husband", "partner", "fiance", "fiancé", "love", "surprise her", "surprise him", "බිරිඳ", "සැමිය", "மனைவி", "கணவ"],
  },
  party: {
    strong: [
      "birthday party", "party panic", "balloons", "decorations", "return gifts", "kids party", "throwing a party",
      "සාද", "බැලූන", "සැරසිලි", "උපන්දින සාද",
      "பலூன்", "அலங்கார", "பிறந்தநாள் விழா",
    ],
    weak: ["party", "guests", "kids", "children", "tomorrow", "snacks", "උපන්දින", "ළමයි", "பிறந்தநாள்", "விழா"],
  },
};

const hasLatin = (s: string) => /[a-z]/i.test(s);

/** Latin terms need word boundaries ("dana" must not fire inside "abundant");
 *  Sinhala/Tamil are matched raw because \b is meaningless against them. */
function hits(text: string, terms: string[]): string[] {
  const found: string[] = [];
  for (const term of terms) {
    if (hasLatin(term)) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, "i").test(text)) found.push(term);
    } else if (text.includes(term)) {
      found.push(term);
    }
  }
  return found;
}

export interface AgentMatch {
  agent: SpecialKapu;
  score: number;
  /** which terms fired — surfaced in the UI tooltip so an auto-pick is never
   *  a black box, and makes tuning the lexicons possible without a debugger */
  terms: string[];
}

/** Score every preset against one message. Custom user agents join in on their
 *  own name words — a "Baby Shower Kapu" should answer "baby shower" without
 *  anyone hand-writing a lexicon for it. */
function scoreAll(message: string, customs: SpecialKapu[]): AgentMatch[] {
  const text = message.toLowerCase();
  const matches: AgentMatch[] = [];

  for (const preset of KAPU_PRESETS) {
    const lex = LEXICONS[preset.id];
    if (!lex) continue;
    const strong = hits(text, lex.strong);
    const weak = hits(text, lex.weak);
    const score = strong.length * STRONG_WEIGHT + weak.length * WEAK_WEIGHT;
    if (score > 0) matches.push({ agent: preset, score, terms: [...strong, ...weak] });
  }

  for (const custom of customs) {
    // Name words only, and only meaty ones — "Kapu"/"my"/"the" would match
    // everything. Treated as strong: a custom hat's name IS its domain.
    const words = custom.name
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 3 && w !== "kapu");
    const found = hits(text, words);
    if (found.length) matches.push({ agent: custom, score: found.length * STRONG_WEIGHT, terms: found });
  }

  return matches.sort((a, b) => b.score - a.score);
}

/**
 * Pick a specialist for this message, or null for plain Kapu.
 *
 * @param current the hat auto-routing already turned on in this thread, if any.
 *
 * Once a hat is on it STAYS on for the thread unless a challenger clearly beats
 * it — a follow-up like "yes, that one" carries no keywords, and dropping the
 * wedding hat there would undo the routing every second message. Clearing back
 * to plain Kapu is a deliberate act, done from the picker.
 */
export function routeAgent(message: string, customs: SpecialKapu[] = [], current?: SpecialKapu | null): AgentMatch | null {
  const keep = current ? { agent: current, score: 0, terms: [] as string[] } : null;
  if (!message.trim()) return keep;
  const ranked = scoreAll(message, customs);
  const top = ranked[0];
  if (!top || top.score < ENGAGE_AT) return keep;
  // Two hats fitting equally well means nothing decisive was said.
  if (ranked[1] && ranked[1].score === top.score) return keep;
  if (current && current.id !== top.agent.id) {
    const incumbent = ranked.find((m) => m.agent.id === current.id);
    if (top.score < (incumbent?.score ?? 0) + SWITCH_MARGIN) return keep;
  }
  return top;
}
