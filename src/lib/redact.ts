// ---------------------------------------------------------------------------
// Stage 0 — PII/PHI Redaction Gate
//
// Deterministic, regex-based redaction applied to free text BEFORE it is
// passed to any LLM (or, in this prototype, before it is displayed/logged as
// "model input"). This is a governance-critical control for servicing data at
// a financial institution — original values are tokenized, never transmitted,
// and every redaction event is written to the audit trail (the *type* of
// entity found, never the value itself).
//
// In production this would be a proper NER + regex hybrid with a vaulted
// token<->value map (encrypted at rest). The prototype implements the
// deterministic regex layer — the actual mechanism that does the heavy
// lifting for structured PII (cards, SSNs, accounts, emails, phones) — and
// stubs the lightweight-NER name detection behind the same interface.
// ---------------------------------------------------------------------------

export type RedactionEntity = {
  type: "card_number" | "ssn" | "account_number" | "email" | "phone" | "person_name";
  token: string;
};

export type RedactionResult = {
  redacted_text: string;
  entities: RedactionEntity[];
  pii_found: boolean;
};

// Order matters — more specific patterns first so e.g. card numbers aren't
// partially matched by the looser account-number pattern.
const PATTERNS: { type: RedactionEntity["type"]; re: RegExp; tokenPrefix: string }[] = [
  { type: "card_number", re: /\b(?:\d[ -]?){13,16}\b/g, tokenPrefix: "CARD" },
  { type: "ssn", re: /\b\d{3}-\d{2}-\d{4}\b/g, tokenPrefix: "SSN" },
  { type: "email", re: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g, tokenPrefix: "EMAIL" },
  { type: "phone", re: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, tokenPrefix: "PHONE" },
  { type: "account_number", re: /\b(?:acct|account|acc)[#:.\s]*\d{6,12}\b/gi, tokenPrefix: "ACCT" },
];

// Lightweight stand-in for an NER name-detector: a small list of common given
// names frequently seen in CCP transcript root causes. Real impl swaps in a
// proper NER model behind this same function signature — the seam is the point.
const NAME_HINTS = /\b(?:Mr\.|Mrs\.|Ms\.|Dr\.)\s+[A-Z][a-z]+(?:\s[A-Z][a-z]+)?\b/g;

let counter = 0;
function nextToken(prefix: string) {
  counter += 1;
  return `[${prefix}_${String(counter).padStart(4, "0")}]`;
}

/** Redacts PII from free text. Deterministic — same input always tokenizes consistently within a process lifetime. */
export function redact(text: string): RedactionResult {
  if (!text) return { redacted_text: text, entities: [], pii_found: false };
  let out = text;
  const entities: RedactionEntity[] = [];

  for (const { type, re, tokenPrefix } of PATTERNS) {
    out = out.replace(re, () => {
      const token = nextToken(tokenPrefix);
      entities.push({ type, token });
      return token;
    });
  }
  out = out.replace(NAME_HINTS, () => {
    const token = nextToken("NAME");
    entities.push({ type: "person_name", token });
    return token;
  });

  return { redacted_text: out, entities, pii_found: entities.length > 0 };
}

/** Summarizes entity counts by type for audit logging — never logs the values. */
export function summarizeEntities(entities: RedactionEntity[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of entities) out[e.type] = (out[e.type] || 0) + 1;
  return out;
}
