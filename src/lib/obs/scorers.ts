// Deterministic scorers for a Kapu turn.
//
// These are the rails from CLAUDE.md turned into machine checks: they are
// exact, free, and instant, so they run on EVERY live turn rather than on a
// sample. LLM-as-a-judge evaluators (configured inside Langfuse) cover the
// subjective half — warmth, grounding, helpfulness.
//
// Pure functions with no Langfuse import: the eval runner and the app both
// use them, and they stay trivially testable.

import type { Language } from "@/lib/types";

export interface TurnFacts {
  /** the visible assistant reply */
  reply: string;
  /** the authoritative language toggle for this turn — [[i18n]] */
  language: Language;
  /** tool names invoked, in order */
  tools: string[];
  /** how many of those failed */
  toolErrors: number;
}

export interface DeterministicScore {
  name: string;
  value: number;
  dataType: "NUMERIC" | "BOOLEAN";
  comment?: string;
}

// ── script blocks ─────────────────────────────────────────────────────
const SINHALA = /[඀-෿]/;
const TAMIL = /[஀-௿]/;
// Scripts that should NEVER appear: small/fast models have been caught
// emitting CJK on a Tamil request (see [[gift-writer]] script gate).
const FOREIGN =
  /[一-鿿぀-ヿ가-힯Ѐ-ӿ؀-ۿऀ-ॿ]/;

/** Markdown table — the persona forbids product tables, use compare blocks. */
const TABLE_ROW = /^[ \t]*\|.*\|[ \t]*$/m;
const TABLE_RULE = /^[ \t]*\|[\s:|-]*-[\s:|-]*\|[ \t]*$/m;

/** Opaque catalog ids (EF_PC_ELEC0V701POD00603, CAKE00KA002192) must not leak. */
const IDLIKE = /\b[A-Z0-9_]{10,}\b/g;
function looksLikeCatalogId(token: string): boolean {
  const digits = (token.match(/\d/g) ?? []).length;
  const letters = (token.match(/[A-Z]/g) ?? []).length;
  return digits >= 3 && letters >= 3;
}

function pass(name: string, ok: boolean, comment?: string): DeterministicScore {
  return { name, value: ok ? 1 : 0, dataType: "BOOLEAN", ...(comment ? { comment } : {}) };
}

/**
 * Grades one turn against the hard rails. Scorers that don't apply to a turn
 * are omitted rather than scored zero — a turn with no tools should not drag
 * down the tool-success average.
 */
export function scoreTurn(facts: TurnFacts): DeterministicScore[] {
  const { reply, language, tools, toolErrors } = facts;
  const out: DeterministicScore[] = [];
  const text = reply.trim();

  out.push(pass("replied", text.length > 0, text.length === 0 ? "empty reply" : undefined));
  if (!text) return out;

  // Rail: the සිං/த/EN toggle is authoritative for reply language.
  const hasSinhala = SINHALA.test(text);
  const hasTamil = TAMIL.test(text);
  if (language === "si") {
    out.push(pass("language-adherence", hasSinhala, hasSinhala ? undefined : "toggle=si but no Sinhala script"));
  } else if (language === "ta") {
    out.push(pass("language-adherence", hasTamil, hasTamil ? undefined : "toggle=ta but no Tamil script"));
  } else {
    // English toggle allows Singlish (romanized) — but not native script.
    const clean = !hasSinhala && !hasTamil;
    out.push(pass("language-adherence", clean, clean ? undefined : "toggle=en but reply used native script"));
  }

  // Never the *other* Sri Lankan script, never a script from off the map.
  const crossed = (language === "si" && hasTamil) || (language === "ta" && hasSinhala);
  const foreign = FOREIGN.test(text);
  out.push(
    pass(
      "script-purity",
      !crossed && !foreign,
      foreign ? "foreign script (CJK/Cyrillic/Arabic/Devanagari) in reply" : crossed ? "wrong Sri Lankan script" : undefined
    )
  );

  // Rail: persona forbids product tables — compare blocks instead.
  const hasTable = TABLE_ROW.test(text) && TABLE_RULE.test(text);
  out.push(pass("no-product-table", !hasTable, hasTable ? "markdown table in reply" : undefined));

  // Opaque ids are for tools, never for shoppers.
  const leaked = (text.match(IDLIKE) ?? []).filter(looksLikeCatalogId);
  out.push(
    pass("no-raw-catalog-id", leaked.length === 0, leaked.length ? `leaked: ${leaked.slice(0, 3).join(", ")}` : undefined)
  );

  if (tools.length) {
    const ok = tools.length - toolErrors;
    out.push({
      name: "tool-success-rate",
      value: ok / tools.length,
      dataType: "NUMERIC",
      comment: `${ok}/${tools.length} tools succeeded`,
    });
  }

  return out;
}
