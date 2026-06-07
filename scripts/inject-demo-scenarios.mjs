// One-off helper: injects two hand-crafted demo clusters into
// src/data/tagged_interactions.json so the live replay can reliably showcase:
//
//   1) A "Customer dissatisfaction and reputational escalation" spike themed
//      around a Platinum card refresh — designed to be caught by an armed
//      Trigger Studio monitor (event_type = platinum_refresh, theme =
//      "Customer dissatisfaction and reputational escalation").
//   2) An "Emerging / unmapped pattern" cluster — four interactions sharing
//      an identical, novel key-phrase ("ai assistant wrong") with low tagging
//      confidence (< 0.6, routed to human review) — the exact shape the
//      emerging-pattern detector looks for.
//
// Safe to re-run: it checks for its own marker IDs and skips if already present.

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, "..", "src", "data", "tagged_interactions.json");

const ID_PREFIX = "00EIRC3QUCD1D4D4IFOAN55AES"; // 26 chars; suffix must be exactly 6 chars for unique 32-char IDs
const id = (suffix) => {
  if (suffix.length !== 6) throw new Error(`id suffix must be exactly 6 chars, got "${suffix}" (${suffix.length})`);
  return ID_PREFIX + suffix;
};

const dissatisfactionTag = (rationale) => ({
  theme: "Customer dissatisfaction and reputational escalation",
  l1: "Reputational",
  l2: "Reputation",
  l3: "Customer Dissatisfaction",
  l4: null,
  confidence: 0.66,
  rationale,
});

const dissatisfactionRootCauses = [
  "Customer said the Platinum refresh raised their annual fee by $200 without adding any benefit they would actually use, and felt blindsided that the change wasn't proactively explained.",
  "Customer was upset that the refreshed Platinum benefits swapped their preferred airport lounge network for one with no locations near their home airport, calling it a downgrade dressed up as an upgrade.",
  "Customer said the Platinum card refresh removed a travel credit they relied on every year and felt the relationship had been quietly devalued without meaningful notice.",
  "Customer told the rep they had posted on social media that Amex \"bait and switched\" them with the Platinum refresh — higher fee, fewer credits they personally use.",
  "Customer escalated after a long hold trying to understand how the new Platinum benefit structure affects their upcoming renewal, and said the experience alone made them consider switching issuers.",
  "Customer was frustrated that concierge support could not clearly explain which of the old Platinum perks still apply after the refresh, leaving them confused and distrustful of the program.",
  "Customer, a cardmember of over a decade, said the Platinum refresh felt like it was designed for new applicants at the expense of long-time loyal customers like them.",
  "Customer compared the refreshed Platinum benefits unfavorably to a competitor's card during the call and asked for a retention offer, threatening to close the account otherwise.",
];

const emergingTag = (rationale) => ({
  theme: "Customer identity and access",
  l1: "Operational and Compliance",
  l2: "Information and Cyber Security",
  l3: "Information and Cyber Security Protect",
  l4: "Customer Identity and Access",
  confidence: 0.52,
  rationale,
});

const emergingRootCauses = [
  "Customer said the new in-app AI assistant told them their account balance was current when it was actually past due, and they only learned otherwise from a later collections call.",
  "Customer asked the in-app AI assistant about a disputed charge and said it gave a confident but completely wrong answer about the dispute status, sending them in circles before reaching a human.",
  "Customer said the AI assistant inside the app misread their rewards balance by a wide margin and recommended a redemption that wasn't actually available to them.",
  "Customer told the rep the AI assistant gave conflicting answers about their payment due date in the same conversation, and they no longer trust what it tells them.",
];

function makeEntry({ rootCause, idSuffix, date, tag, needsReview, keyPhrase, entities, canonicalSuffix }) {
  const canonical = rootCause.length > 220 ? rootCause.slice(0, 217) + "..." : rootCause;
  return {
    interaction_id: id(idSuffix),
    type: "Voice",
    date,
    root_cause: rootCause,
    normalized: {
      canonical_statement: canonical + (canonicalSuffix ?? ""),
      key_phrase: keyPhrase,
      entities,
    },
    tag,
    needs_review: needsReview,
  };
}

const dissatisfactionEntries = dissatisfactionRootCauses.map((rootCause, i) =>
  makeEntry({
    rootCause,
    idSuffix: `PLT${String(i + 1).padStart(3, "0")}`,
    date: `2026-06-0${(i % 6) + 1}T00:00:00`,
    tag: dissatisfactionTag(
      "Keyword overlap with \"Reputational — Reputation\" signal patterns; recurring Platinum-refresh fee/benefit-change language (heuristic placeholder for LLM tagging)."
    ),
    needsReview: false,
    keyPhrase: ["platinum refresh fee", "platinum benefits downgrade", "platinum refresh devalued", "platinum refresh switch", "platinum refresh renewal", "platinum benefits confused", "platinum refresh loyal", "platinum refresh retention"][i],
    entities: ["platinum", "refresh", i % 2 === 0 ? "fee" : "benefits"],
  })
);

const emergingEntries = emergingRootCauses.map((rootCause, i) =>
  makeEntry({
    rootCause,
    idSuffix: `AIA${String(i + 1).padStart(3, "0")}`,
    date: `2026-06-0${(i % 5) + 2}T00:00:00`,
    tag: emergingTag(
      "Low keyword overlap with any single taxonomy node — recurring complaints about a new in-app AI assistant giving incorrect account information don't map cleanly to an existing signal pattern (heuristic placeholder for LLM tagging)."
    ),
    needsReview: true,
    keyPhrase: "ai assistant wrong",
    entities: ["assistant", "wrong", "balance"],
  })
);

const raw = readFileSync(DATA_PATH, "utf-8");
let data = JSON.parse(raw);

// Clean up any earlier (broken/duplicate-ID) injection attempts before re-seeding.
const before = data.length;
data = data.filter((x) => !x.interaction_id.includes("PLATQ3") && !x.interaction_id.includes("AIAST") && !/AESPLT\d{3}$/.test(x.interaction_id) && !/AESAIA\d{3}$/.test(x.interaction_id));
if (data.length !== before) {
  console.log(`Removed ${before - data.length} previously-injected demo entries before re-seeding.`);
}

// Spread the dissatisfaction cluster across roughly indices 60–95 (every ~5
// items) so a live replay encounters a gradually-building spike rather than
// one unrealistic block — the kind of pattern Trigger Studio is meant to catch
// earlier than a standing rule would.
const dissatisfactionInsertAfter = [60, 65, 70, 74, 78, 82, 86, 90];
// Spread the emerging-pattern cluster across roughly indices 115–135 — far
// enough past the dissatisfaction cluster to read as a distinct moment in the
// replay.
const emergingInsertAfter = [115, 120, 125, 130];

const insertions = [
  ...dissatisfactionInsertAfter.map((idx, i) => ({ after: idx, item: dissatisfactionEntries[i] })),
  ...emergingInsertAfter.map((idx, i) => ({ after: idx, item: emergingEntries[i] })),
].sort((a, b) => a.after - b.after);

const out = [];
let insertionCursor = 0;
for (let i = 0; i < data.length; i++) {
  out.push(data[i]);
  while (insertionCursor < insertions.length && insertions[insertionCursor].after === i) {
    out.push(insertions[insertionCursor].item);
    insertionCursor++;
  }
}
while (insertionCursor < insertions.length) {
  out.push(insertions[insertionCursor].item);
  insertionCursor++;
}

writeFileSync(DATA_PATH, JSON.stringify(out, null, 2) + "\n");
console.log(`Injected ${dissatisfactionEntries.length} dissatisfaction + ${emergingEntries.length} emerging-pattern interactions. New total: ${out.length}`);
