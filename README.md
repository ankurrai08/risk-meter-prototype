# Risk Meter — Prototype (v3)

A working prototype of "Risk Meter" — a capability inside Amex's Customer Intelligence Engine (CIE) that takes CIE's per-interaction root-cause output, redacts PII, normalizes it, maps it to the distilled Enterprise Risk Taxonomy, and gives leaders a live, proactive "anticipate → decide → act → measure" loop — all in **Shadow Mode**: the system only ever recommends, a human always approves.

## What's inside

- **Live Surveillance dashboard** (`/`) — animated risk gauge, per-theme breakdown, live replay controls (play/pause/speed), live feed table, and an upgraded **Decision Console**: evidence, suggested playbook, candidate-action cards scored across four tradeoff dimensions (customer impact, effort, cost, time-to-effect), an **Action Engine** that routes each decision down one of three paths (Alert / Automate-with-human-in-the-loop / Research), plus the original Approve/Override/Escalate flow
- **Alert Studio** (`/alerts`) — configure threshold / spike / emerging-pattern alerts per taxonomy theme, set severity & email recipients, send a test email, view fired alerts and delivery status
- **Trigger Studio — Anticipate** (`/triggers`) — pre-arm time-boxed, event-scoped sensitivity monitors ahead of known events (a Platinum refresh, a rate move, a policy change…). Armed monitors temporarily lower the effective detection threshold for a theme (standing threshold ÷ sensitivity multiplier) and can even surface "anticipatory catches" on themes with no standing alert configured. Monitors auto-disarm when their window expires.
- **Measure & Learn** (`/learn`) — closes the loop on every approved action: snapshots the theme's rolling rate at decision time (the baseline), samples it on subsequent ticks, and once enough samples land, records whether the rate moved in the right direction (`delta_pct`, `was_recommendation_correct`) — feeding a growing feedback store that the tradeoff scoring can learn from over time
- **Audit Log** (`/audit`) — full governance trail plus a **Shadow Mode** badge, four impact tiles (interactions processed, PII items redacted, items flagged for human review, audit entries this session), and a **PII/PHI posture panel** showing redaction counts by entity type

## How it works

1. **Data**: 400 sampled real CIE root-cause interactions (`src/data/interactions_sample.json`) and the 53-node / 13-theme distilled risk taxonomy (`src/data/taxonomy.json`), both converted from the source Excel files.
2. **Stage 0 — PII/PHI redaction gate**: before any root-cause text reaches a model, a deterministic regex layer detects and tokenizes sensitive entities (card numbers, SSNs, emails, phone numbers, account numbers — `[CARD_0001]`-style tokens). Only entity-type counts are ever logged; actual values never are. Person-name detection is stubbed behind the same interface for a future NER upgrade.
3. **Two-stage tagging pipeline** (`scripts/tag-interactions.mjs`): Stage 1 normalizes each redacted root cause into a canonical statement + key phrase; Stage 2 tags the canonical statement to exactly one taxonomy node with a confidence score. Uses OpenAI structured outputs (`gpt-4o-mini`) when `OPENAI_API_KEY` is set, otherwise falls back to a deterministic keyword-overlap heuristic — either way the output is cached to `src/data/tagged_interactions.json` so the live demo never depends on API latency.
4. **Live replay engine** (`src/lib/store.ts`): an in-memory singleton that "streams" the cached tagged interactions, maintains a rolling 60-item window (with a 120-item trailing baseline), computes per-theme risk percentages, and evaluates both standing alert rules and armed Trigger Studio monitors on every tick.
5. **Alerts**: three types — *threshold breach* (rolling % crosses a configured line), *spike/anomaly* (vs. trailing baseline), and *emerging/unmapped pattern* (recurring low-confidence root causes that don't map cleanly to the taxonomy — the "blind to the new" gap). Firing an alert triggers an email via the Resend API (or a simulated/logged delivery if `RESEND_API_KEY` isn't set).
6. **Decision Console + Action Engine**: each fired alert carries 2-3 candidate actions, each scored on customer impact / effort / cost / time-to-effect and tagged with a recommended path. A leader picks an action, then routes it through Alert (send notification), Automate-HITL (queue an automated workflow that still requires human sign-off), or Research (commission deeper analysis) — every path is logged with the named approver.
7. **Measure & Learn**: approving an action snapshots the theme's current rolling rate as a baseline and begins sampling it on every subsequent tick. After six samples the loop resolves into a `FeedbackEntry` recording the rate's delta and whether the recommendation was borne out — visible on `/learn` as both in-flight sparklines and a resolved feedback store.
8. **Governance**: low-confidence tags are routed to "needs human review"; every redaction, tag, alert, delivery, trigger arm/expiry, action taken, outcome, config change, and decision is written to the append-only audit log. The Audit Log surfaces a Shadow Mode badge, impact tiles, and a PII posture panel summarizing redaction activity by entity type.

## Running locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

### Re-running the tagging pipeline (optional)

```bash
# With a real OpenAI key (recommended for the most accurate tags):
OPENAI_API_KEY=sk-... node scripts/tag-interactions.mjs

# Or force the heuristic fallback (no API key needed):
node scripts/tag-interactions.mjs --heuristic
```

This regenerates `src/data/tagged_interactions.json`, which the app reads at build/runtime (no live LLM calls during the demo).

## Environment variables

| Variable | Purpose | Required? |
|---|---|---|
| `OPENAI_API_KEY` | Used only by the offline tagging script (`scripts/tag-interactions.mjs`) to (re)generate cached tags via the real LLM pipeline | No — heuristic fallback works without it |
| `RESEND_API_KEY` | Enables real email delivery for fired alerts via [Resend](https://resend.com) | No — falls back to simulated delivery (logged to console + audit trail) |
| `ALERT_EMAIL_FROM` | "From" address for alert emails (e.g. `Risk Meter <alerts@yourdomain.com>`) | Only if `RESEND_API_KEY` is set |

## Deploying to Vercel

1. Push this repo to GitHub.
2. Import the repo in Vercel → it will auto-detect Next.js.
3. Add the environment variables above in Project Settings → Environment Variables (all optional — the app runs fully demoable without any of them, using cached tags + simulated email).
4. Deploy. Every push to `main` auto-deploys; PRs get preview URLs.

## Demo script

1. Land on the dashboard — gauge live, theme breakdown populated.
2. Open **Alert Studio**, walk through an existing config (e.g. "Victim fraud, scams, identity theft and account takeover" — threshold 12%, high severity, email channel) — show how easy it is to define a new rule.
3. Open **Trigger Studio**, arm a monitor ahead of a known event (e.g. a Platinum refresh) — explain how this temporarily raises sensitivity on a scoped theme and can produce "anticipatory catches" standing rules alone would miss.
4. Hit play on the replay — narrate: "this is CIE's root-cause output streaming in, exactly as it would in production — already passed through a PII redaction gate before any model sees it."
5. Watch a threshold cross → an alert fires on screen and an email is sent/logged — open the **Decision Console**.
6. Walk through the candidate actions and their tradeoff scores, pick one, and route it through the **Action Engine** (Alert / Automate-HITL / Research) — emphasize Shadow Mode: nothing dispatches without a named human approver.
7. Jump to **Measure & Learn** — show an in-flight outcome being sampled, and a resolved feedback entry showing whether the recommendation actually moved the number.
8. Close on the **Audit Log** — Shadow Mode badge, impact tiles, PII posture panel, and the full append-only governance trail of every tag, redaction, alert, trigger, action, outcome, and human decision.

## Notes & assumptions

- This is a UI/decision-layer prototype: it samples and replays 400 of the ~25K daily interactions at demo speed. Production would stream the full volume through the existing CIE pipeline infrastructure.
- The risk taxonomy is treated as a static, pre-approved config — the model can only tag into nodes a human has already signed off on, which is itself a governance control worth calling out to judges.
- PII/PHI redaction uses deterministic regex patterns for the demo; the entity-detection interface is designed so a production NER model could be swapped in without changing any downstream code.
- The system operates in **Shadow Mode** throughout: every Action Engine path (Alert, Automate-HITL, Research) requires an explicit human Approve/Override/Escalate before anything is dispatched — nothing auto-acts.
- All LLM outputs for the demo path are pre-cached so the live walkthrough never depends on OpenAI latency or rate limits.
