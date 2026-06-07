# Risk Meter — Prototype

A working prototype of "Risk Meter" — a capability inside Amex's Customer Intelligence Engine (CIE) that takes CIE's per-interaction root-cause output, normalizes it, maps it to the distilled Enterprise Risk Taxonomy, and gives leaders a live, proactive view of emerging risk with configurable alerting (email).

## What's inside

- **Live Surveillance dashboard** (`/`) — animated risk gauge, per-theme breakdown, live replay controls (play/pause/speed), live feed table, Decision Console (evidence + suggested playbook + Approve/Override/Escalate)
- **Alert Studio** (`/alerts`) — configure threshold / spike / emerging-pattern alerts per taxonomy theme, set severity & email recipients, send a test email, view fired alerts and delivery status
- **Audit Log** (`/audit`) — full governance trail: every tag, alert fired, alert delivered, config change, and human decision

## How it works

1. **Data**: 400 sampled real CIE root-cause interactions (`src/data/interactions_sample.json`) and the 53-node / 13-theme distilled risk taxonomy (`src/data/taxonomy.json`), both converted from the source Excel files.
2. **Two-stage tagging pipeline** (`scripts/tag-interactions.mjs`): Stage 1 normalizes each raw root cause into a canonical statement + key phrase; Stage 2 tags the canonical statement to exactly one taxonomy node with a confidence score. Uses OpenAI structured outputs (`gpt-4o-mini`) when `OPENAI_API_KEY` is set, otherwise falls back to a deterministic keyword-overlap heuristic — either way the output is cached to `src/data/tagged_interactions.json` so the live demo never depends on API latency.
3. **Live replay engine** (`src/lib/store.ts`): an in-memory singleton that "streams" the cached tagged interactions, maintains a rolling 60-item window (with a 120-item trailing baseline), computes per-theme risk percentages, and evaluates alert rules on every tick.
4. **Alerts**: three types — *threshold breach* (rolling % crosses a configured line), *spike/anomaly* (vs. trailing baseline), and *emerging/unmapped pattern* (recurring low-confidence root causes that don't map cleanly to the taxonomy — the "blind to the new" gap). Firing an alert triggers an email via the Resend API (or a simulated/logged delivery if `RESEND_API_KEY` isn't set).
5. **Governance**: low-confidence tags are routed to "needs human review"; every tag, alert, delivery, config change, and decision is written to the audit log.

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
3. Hit play on the replay — narrate: "this is CIE's root-cause output streaming in, exactly as it would in production."
4. Watch a threshold cross → an alert fires on screen and an email is sent/logged — open the Decision Console from the alert.
5. Show evidence (real canonical root causes), the taxonomy's pre-approved suggested playbook, and Approve/Override/Escalate → logged to the audit trail.
6. Close on the **Audit Log** — full governance trail of every tag, alert, delivery, and human decision.

## Notes & assumptions

- This is a UI/decision-layer prototype: it samples and replays 400 of the ~25K daily interactions at demo speed. Production would stream the full volume through the existing CIE pipeline infrastructure.
- The risk taxonomy is treated as a static, pre-approved config — the model can only tag into nodes a human has already signed off on, which is itself a governance control worth calling out to judges.
- All LLM outputs for the demo path are pre-cached so the live walkthrough never depends on OpenAI latency or rate limits.
