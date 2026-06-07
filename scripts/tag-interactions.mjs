#!/usr/bin/env node
/**
 * Two-stage tagging pipeline:
 *   Stage 1 (Normalization): raw root-cause text -> { canonical_statement, key_phrase, entities }
 *   Stage 2 (Taxonomy tagging): canonical_statement -> { theme, l1, l2, l3, l4, confidence, rationale }
 *
 * Run with OPENAI_API_KEY set to use the real LLM pipeline (gpt-4o-mini, structured outputs).
 * Without a key, falls back to a deterministic heuristic tagger so the demo cache always exists
 * (keyword overlap against taxonomy descriptive fields — a stand-in, not a replacement, for the LLM stage).
 *
 * Output: src/data/tagged_interactions.json  (cached — the app reads this, never calls the LLM live)
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... node scripts/tag-interactions.mjs [--limit 400]
 *   node scripts/tag-interactions.mjs --heuristic   # force heuristic mode
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "src", "data");

const args = process.argv.slice(2);
const limitArg = args.indexOf("--limit");
const LIMIT = limitArg >= 0 ? parseInt(args[limitArg + 1], 10) : Infinity;
const FORCE_HEURISTIC = args.includes("--heuristic");

const taxonomy = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "taxonomy.json"), "utf-8"));
const interactions = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "interactions_sample.json"), "utf-8"));

const REVIEW_FLOOR = 0.6;

const taxonomyContext = taxonomy
  .map(
    (t, i) =>
      `${i + 1}. [Theme: ${t.theme}] [L1: ${t.l1}] [L2: ${t.l2}]${t.l3 ? ` [L3: ${t.l3}]` : ""}${
        t.l4 ? ` [L4: ${t.l4}]` : ""
      } — ${t.descriptive_risk_statement ?? t.example_signals ?? ""}`
  )
  .join("\n");

const useLLM = !!process.env.OPENAI_API_KEY && !FORCE_HEURISTIC;

// ---------- Stage implementations ----------

async function callOpenAI(messages, schemaName, schema) {
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
      response_format: {
        type: "json_schema",
        json_schema: { name: schemaName, schema, strict: true },
      },
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${txt}`);
  }
  const json = await res.json();
  return JSON.parse(json.choices[0].message.content);
}

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

async function normalizeLLM(rootCause) {
  return callOpenAI(
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

async function tagLLM(canonicalStatement) {
  return callOpenAI(
    [
      {
        role: "system",
        content:
          "You classify a canonical customer root-cause statement into EXACTLY ONE node from the enterprise risk taxonomy below. " +
          "Only choose theme/l1/l2/l3/l4 values that appear together in one of the numbered rows — do not invent new categories. " +
          "If l3 or l4 is not specified for that row, return null for it. Provide a confidence (0-1) and a one-sentence rationale.\n\n" +
          "TAXONOMY:\n" + taxonomyContext,
      },
      { role: "user", content: canonicalStatement },
    ],
    "taxonomy_tag",
    taggingSchema
  );
}

// ---------- Heuristic fallback (no API key) ----------
const STOP = new Set(["the","a","an","to","of","and","or","in","on","for","was","were","with","that","this","is","are","it","as","by","at","be","not","they","their","customer","agent","due","because"]);

function tokenize(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

const taxonomyTokens = taxonomy.map((t) =>
  new Set(tokenize([t.descriptive_risk_statement, t.example_signals, t.l1, t.l2, t.l3, t.l4, t.why_it_correlates].join(" ")))
);

function normalizeHeuristic(rootCause) {
  const clean = rootCause.replace(/\s+/g, " ").trim();
  const sentence = clean.split(/(?<=[.!?])\s/)[0] || clean;
  const tokens = tokenize(clean);
  const freq = {};
  tokens.forEach((t) => (freq[t] = (freq[t] || 0) + 1));
  const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w]) => w);
  return {
    canonical_statement: sentence.length > 220 ? sentence.slice(0, 217) + "..." : sentence,
    key_phrase: top.join(" "),
    entities: top,
  };
}

function tagHeuristic(canonicalStatement) {
  const qTokens = new Set(tokenize(canonicalStatement));
  let bestIdx = 0;
  let bestScore = -1;
  taxonomyTokens.forEach((tset, idx) => {
    let overlap = 0;
    qTokens.forEach((tok) => {
      if (tset.has(tok)) overlap++;
    });
    const score = overlap / Math.sqrt(tset.size + 1);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = idx;
    }
  });
  const node = taxonomy[bestIdx];
  // squash heuristic score into a 0.3-0.95 confidence band so distribution looks plausible
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

// ---------- Main ----------
async function main() {
  const subset = interactions.slice(0, Math.min(LIMIT, interactions.length));
  console.log(`Tagging ${subset.length} interactions using ${useLLM ? "OpenAI LLM pipeline" : "heuristic fallback (set OPENAI_API_KEY to use the real pipeline)"}...`);

  const out = [];
  let i = 0;
  for (const interaction of subset) {
    i++;
    try {
      let normalized, tag;
      if (useLLM) {
        normalized = await normalizeLLM(interaction.root_cause);
        tag = await tagLLM(normalized.canonical_statement);
      } else {
        normalized = normalizeHeuristic(interaction.root_cause);
        tag = tagHeuristic(normalized.canonical_statement);
      }
      out.push({
        ...interaction,
        normalized,
        tag,
        needs_review: tag.confidence < REVIEW_FLOOR,
      });
    } catch (err) {
      console.error(`  ! failed on ${interaction.interaction_id}:`, err.message);
    }
    if (i % 50 === 0) console.log(`  ...${i}/${subset.length}`);
  }

  const outPath = path.join(DATA_DIR, "tagged_interactions.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`Wrote ${out.length} tagged interactions to ${outPath}`);
  const reviewCount = out.filter((o) => o.needs_review).length;
  console.log(`  -> ${reviewCount} flagged needs_review (confidence < ${REVIEW_FLOOR})`);
}

main();
