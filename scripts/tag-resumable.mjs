#!/usr/bin/env node
/**
 * Resumable, concurrent variant of tag-interactions.mjs for regenerating the
 * cached demo dataset with REAL gpt-4o-mini tags (not the heuristic fallback).
 *
 * Saves incremental progress to src/data/.tag_progress.json so the run can be
 * split across multiple invocations (each capped to a wall-clock time budget)
 * without losing completed work or re-spending API calls. On full completion
 * it writes src/data/tagged_interactions.json and removes the progress file.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... node scripts/tag-resumable.mjs --budget-secs 35 --concurrency 16
 *   (run repeatedly until it prints "ALL DONE")
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "src", "data");
const PROGRESS_PATH = path.join(DATA_DIR, ".tag_progress.json");
const OUT_PATH = path.join(DATA_DIR, "tagged_interactions.json");

const args = process.argv.slice(2);
const argVal = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const BUDGET_MS = Math.round(parseFloat(argVal("--budget-secs", "35")) * 1000);
const CONCURRENCY = parseInt(argVal("--concurrency", "16"), 10);
const REVIEW_FLOOR = 0.6;

if (!process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY is required for this script (live LLM regeneration only).");
  process.exit(1);
}

const taxonomy = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "taxonomy.json"), "utf-8"));
const interactions = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "interactions_sample.json"), "utf-8"));

const taxonomyContext = taxonomy
  .map((t, i) => `${i + 1}. [Theme: ${t.theme}] [L1: ${t.l1}] [L2: ${t.l2}]${t.l3 ? ` [L3: ${t.l3}]` : ""}${t.l4 ? ` [L4: ${t.l4}]` : ""} — ${t.descriptive_risk_statement ?? t.example_signals ?? ""}`)
  .join("\n");

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
    theme: { type: "string" }, l1: { type: "string" }, l2: { type: "string" },
    l3: { type: ["string", "null"] }, l4: { type: ["string", "null"] },
    confidence: { type: "number", description: "0 to 1" },
    rationale: { type: "string", description: "One sentence on why this node fits." },
  },
  required: ["theme", "l1", "l2", "l3", "l4", "confidence", "rationale"],
  additionalProperties: false,
};

async function callOpenAI(messages, schemaName, schema) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.1,
      messages,
      response_format: { type: "json_schema", json_schema: { name: schemaName, schema, strict: true } },
    }),
  });
  if (!res.ok) { const txt = await res.text(); throw new Error(`OpenAI error ${res.status}: ${txt.slice(0, 300)}`); }
  const json = await res.json();
  return JSON.parse(json.choices[0].message.content);
}

async function tagInteraction(interaction) {
  const normalized = await callOpenAI(
    [
      { role: "system", content: "You normalize messy customer-service root-cause notes into a single clean canonical statement. Fix encoding artifacts, remove filler, keep it factual and short (one sentence)." },
      { role: "user", content: interaction.root_cause },
    ],
    "normalized_root_cause", normalizationSchema
  );
  const tag = await callOpenAI(
    [
      { role: "system", content:
        "You classify a canonical customer root-cause statement into EXACTLY ONE node from the enterprise risk taxonomy below. " +
        "Only choose theme/l1/l2/l3/l4 values that appear together in one of the numbered rows — do not invent new categories. " +
        "If l3 or l4 is not specified for that row, return null for it. Provide a confidence (0-1) and a one-sentence rationale.\n\nTAXONOMY:\n" + taxonomyContext },
      { role: "user", content: normalized.canonical_statement },
    ],
    "taxonomy_tag", taggingSchema
  );
  return { ...interaction, normalized, tag, needs_review: tag.confidence < REVIEW_FLOOR };
}

function loadProgress() {
  if (fs.existsSync(PROGRESS_PATH)) {
    try {
      const arr = JSON.parse(fs.readFileSync(PROGRESS_PATH, "utf-8"));
      return new Map(arr.map((x) => [x.interaction_id, x]));
    } catch { /* corrupt progress file — start fresh */ }
  }
  return new Map();
}
function saveProgress(map) {
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(Array.from(map.values()), null, 0));
}

async function main() {
  const done = loadProgress();
  const remaining = interactions.filter((i) => !done.has(i.interaction_id));
  console.log(`Progress: ${done.size}/${interactions.length} already tagged. ${remaining.length} remaining this run (budget ${BUDGET_MS / 1000}s, concurrency ${CONCURRENCY}).`);

  const deadline = Date.now() + BUDGET_MS;
  let idx = 0;
  let completedThisRun = 0;
  let failedThisRun = 0;

  async function worker() {
    while (idx < remaining.length && Date.now() < deadline) {
      const my = idx++;
      const item = remaining[my];
      if (!item) break;
      try {
        const tagged = await tagInteraction(item);
        done.set(item.interaction_id, tagged);
        completedThisRun++;
        if (completedThisRun % 10 === 0) saveProgress(done);
      } catch (err) {
        failedThisRun++;
        console.error(`  ! ${item.interaction_id}: ${err.message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, remaining.length || 1) }, worker));
  saveProgress(done);

  const totalDone = done.size;
  console.log(`This run: ${completedThisRun} tagged, ${failedThisRun} failed. Total progress: ${totalDone}/${interactions.length}.`);

  if (totalDone >= interactions.length) {
    // Reassemble in original order and write final output
    const out = interactions.map((i) => done.get(i.interaction_id)).filter(Boolean);
    fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
    fs.unlinkSync(PROGRESS_PATH);
    const reviewCount = out.filter((o) => o.needs_review).length;
    console.log(`ALL DONE — wrote ${out.length} tagged interactions to ${OUT_PATH} (${reviewCount} flagged needs_review).`);
  } else {
    console.log(`NOT DONE YET — re-run the same command to continue (${interactions.length - totalDone} remaining).`);
  }
}

main();
