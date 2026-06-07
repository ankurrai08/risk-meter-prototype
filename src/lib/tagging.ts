// Shared normalization + taxonomy-tagging logic for a single root-cause string.
//
// This is the live-server counterpart to scripts/tag-interactions.mjs (which
// builds the cached demo dataset offline). It powers the CSV-upload feature:
// when a user loads a different interaction file, each row is run through the
// same two-stage pipeline — live OpenAI (gpt-4o-mini, structured outputs) when
// OPENAI_API_KEY is configured, otherwise the deterministic keyword-overlap
// heuristic — so uploaded data is tagged consistently with the seed dataset.

import { taxonomy, taxonomyForPrompt } from "./taxonomy";
import type { NormalizedRootCause, TaxonomyTag } from "./types";

export const REVIEW_FLOOR = 0.6;

export function usingLiveLLM(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

// ---------- LLM stage (mirrors scripts/tag-interactions.mjs) ----------

const normalizationSchema = {
  type: "object",
  properties: {
    canonical_statement: { type: "string", description: "One clean sentence stating what went wrong for the customer." },
    key_phrase: { type: "string", description: "A short 2-6 word phrase capturing the core issue." },
    entities: { type: "array", items: { type: "string" }, description: "Notable entities: product, fee type, channel, etc." },
  },
  required: ["canonical_statement", "key_phrase", "entities"],
  additionalProperties: false,
};

const taggingSchema = {
  type: "object",
  properties: {
    theme: { type: "string" },
    l1: { type: "string" },
    l2: { type: "string" },
    l3: { type: ["string", "null"] },
    l4: { type: ["string", "null"] },
    confidence: { type: "number", description: "0 to 1" },
    rationale: { type: "string", description: "One sentence on why this node fits." },
  },
  required: ["theme", "l1", "l2", "l3", "l4", "confidence", "rationale"],
  additionalProperties: false,
};

async function callOpenAI<T>(messages: { role: string; content: string }[], schemaName: string, schema: object): Promise<T> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.1,
      messages,
      response_format: { type: "json_schema", json_schema: { name: schemaName, schema, strict: true } },
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${txt}`);
  }
  const json = await res.json();
  return JSON.parse(json.choices[0].message.content) as T;
}

async function normalizeLLM(rootCause: string): Promise<NormalizedRootCause> {
  return callOpenAI<NormalizedRootCause>(
    [
      {
        role: "system",
        content:
          "You normalize messy customer-service root-cause notes into a single clean canonical statement. Fix encoding artifacts, remove filler, keep it factual and short (one sentence).",
      },
      { role: "user", content: rootCause },
    ],
    "normalized_root_cause",
    normalizationSchema
  );
}

let cachedTaxonomyContext: string | null = null;
function taxonomyContext(): string {
  if (!cachedTaxonomyContext) cachedTaxonomyContext = taxonomyForPrompt();
  return cachedTaxonomyContext;
}

async function tagLLM(canonicalStatement: string): Promise<TaxonomyTag> {
  return callOpenAI<TaxonomyTag>(
    [
      {
        role: "system",
        content:
          "You classify a canonical customer root-cause statement into EXACTLY ONE node from the enterprise risk taxonomy below. " +
          "Only choose theme/l1/l2/l3/l4 values that appear together in one of the numbered rows — do not invent new categories. " +
          "If l3 or l4 is not specified for that row, return null for it. Provide a confidence (0-1) and a one-sentence rationale.\n\n" +
          "TAXONOMY:\n" + taxonomyContext(),
      },
      { role: "user", content: canonicalStatement },
    ],
    "taxonomy_tag",
    taggingSchema
  );
}

// ---------- Heuristic fallback (mirrors scripts/tag-interactions.mjs) ----------

const STOP = new Set(["the","a","an","to","of","and","or","in","on","for","was","were","with","that","this","is","are","it","as","by","at","be","not","they","their","customer","agent","due","because"]);

function tokenize(s: string | null | undefined): string[] {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

let cachedTaxonomyTokens: Set<string>[] | null = null;
function taxonomyTokens(): Set<string>[] {
  if (!cachedTaxonomyTokens) {
    cachedTaxonomyTokens = taxonomy.map((t) =>
      new Set(tokenize([t.descriptive_risk_statement, t.example_signals, t.l1, t.l2, t.l3, t.l4, t.why_it_correlates].join(" ")))
    );
  }
  return cachedTaxonomyTokens;
}

function normalizeHeuristic(rootCause: string): NormalizedRootCause {
  const clean = rootCause.replace(/\s+/g, " ").trim();
  const sentence = clean.split(/(?<=[.!?])\s/)[0] || clean;
  const tokens = tokenize(clean);
  const freq: Record<string, number> = {};
  tokens.forEach((t) => (freq[t] = (freq[t] || 0) + 1));
  const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w]) => w);
  return {
    canonical_statement: sentence.length > 220 ? sentence.slice(0, 217) + "..." : sentence,
    key_phrase: top.join(" "),
    entities: top,
  };
}

function tagHeuristic(canonicalStatement: string): TaxonomyTag {
  const qTokens = new Set(tokenize(canonicalStatement));
  const tsets = taxonomyTokens();
  let bestIdx = 0;
  let bestScore = -1;
  tsets.forEach((tset, idx) => {
    let overlap = 0;
    qTokens.forEach((tok) => { if (tset.has(tok)) overlap++; });
    const score = overlap / Math.sqrt(tset.size + 1);
    if (score > bestScore) { bestScore = score; bestIdx = idx; }
  });
  const node = taxonomy[bestIdx];
  const confidence = Math.max(0.35, Math.min(0.97, 0.5 + bestScore * 0.35));
  return {
    theme: node.theme,
    l1: node.l1,
    l2: node.l2,
    l3: node.l3,
    l4: node.l4,
    confidence: Math.round(confidence * 100) / 100,
    rationale: `Keyword overlap with "${node.l1} — ${node.l2}" signal patterns (heuristic placeholder for LLM tagging).`,
  };
}

/** Normalize + tag one root-cause string. Uses live OpenAI if OPENAI_API_KEY is set, else the heuristic fallback. */
export async function tagOne(rootCause: string): Promise<{ normalized: NormalizedRootCause; tag: TaxonomyTag; needs_review: boolean }> {
  let normalized: NormalizedRootCause;
  let tag: TaxonomyTag;
  if (usingLiveLLM()) {
    normalized = await normalizeLLM(rootCause);
    tag = await tagLLM(normalized.canonical_statement);
  } else {
    normalized = normalizeHeuristic(rootCause);
    tag = tagHeuristic(normalized.canonical_statement);
  }
  return { normalized, tag, needs_review: tag.confidence < REVIEW_FLOOR };
}
