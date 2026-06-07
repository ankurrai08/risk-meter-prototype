import taggedData from "@/data/tagged_interactions.json";
import { taxonomy, themes } from "./taxonomy";
import type { TaggedInteraction } from "./types";
import { redact, summarizeEntities } from "./redact";

// ---------------------------------------------------------------------------
// In-memory live-pipeline simulation store.
//
// In production this state would live in Postgres + a streaming aggregation
// service fed by the actual CIE pipeline (see dev plan v3 architecture). For
// the prototype we keep a single server-side singleton (survives across
// requests in one running instance) that the replay engine advances and the
// dashboard polls. The shapes below mirror the planned Postgres schema
// (interactions, redactions, tags, monitors, alerts, actions, outcomes,
// audit_log) closely enough that porting to real persistence is a storage
// swap, not a redesign.
// ---------------------------------------------------------------------------

export type AlertType = "threshold" | "spike" | "emerging";
export type AlertChannel = "email";

export type AlertConfig = {
  id: string;
  theme: string;
  type: AlertType;
  threshold_pct: number; // for threshold alerts: rolling % that trips it
  spike_multiplier?: number; // for spike alerts: x times trailing baseline
  severity: "low" | "medium" | "high";
  channel: AlertChannel;
  recipients: string[];
  enabled: boolean;
  created_at: string;
};

// --- Trigger Studio (Anticipate) -------------------------------------------
export type TriggerEventType =
  | "platinum_refresh" | "product_launch" | "policy_change" | "rate_move" | "weather_event" | "fee_update";

export type TriggerMonitor = {
  id: string;
  event_type: TriggerEventType;
  label: string;
  theme: string;
  sensitivity_multiplier: number; // effective threshold = base / multiplier (higher = more sensitive)
  recipients: string[];
  armed: boolean;
  created_at: string;
  expires_at: string;
};

// --- Decision Console / Action Engine ---------------------------------------
export type CandidateAction = {
  id: string;
  label: string;
  rationale: string;
  customer_impact: number; // 0-100, higher = more positive impact on the customer
  effort: number; // 0-100, higher = more operational effort required
  cost: number; // 0-100, higher = more costly
  time_to_effect: number; // 0-100, higher = slower to take effect
  recommended_path: ActionPath;
};

export type ActionPath = "alert" | "automate" | "research";

export type ActionRecord = {
  id: string;
  alert_id: string;
  theme: string;
  action_label: string;
  path: ActionPath;
  approver: string;
  note: string;
  status: "completed" | "queued" | "running";
  result: Record<string, unknown>;
  created_at: string;
  baseline_pct: number; // theme rolling % at the moment the action was taken
  outcome_trend: number[]; // rolling % snapshots captured on subsequent ticks
  outcome_resolved: boolean;
  was_recommendation_correct: boolean | null;
};

export type FeedbackEntry = {
  id: string;
  action_id: string;
  alert_id: string;
  theme: string;
  decision_path: ActionPath;
  baseline_pct: number;
  final_pct: number;
  delta_pct: number;
  was_recommendation_correct: boolean;
  created_at: string;
};

export type FiredAlert = {
  id: string;
  config_id: string | null; // null for emerging-pattern alerts (no pre-config needed)
  trigger_id?: string | null; // set when an armed Trigger Studio monitor contributed to firing
  theme: string;
  type: AlertType;
  severity: "low" | "medium" | "high";
  current_pct: number;
  threshold_pct: number | null;
  message: string;
  evidence: TaggedInteraction[];
  candidate_actions: CandidateAction[];
  fired_at: string;
  delivered: boolean;
  delivery_error?: string;
};

export type AuditEntry = {
  id: string;
  ts: string;
  kind:
    | "tag" | "redaction" | "alert_fired" | "alert_delivered" | "alert_config"
    | "decision" | "trigger_armed" | "trigger_expired" | "action_taken" | "outcome";
  summary: string;
  detail?: Record<string, unknown>;
};

const ROLLING_WINDOW = 60; // last N interactions used for rolling % calc
const BASELINE_WINDOW = 120; // wider trailing window for spike comparison
const OUTCOME_TREND_LENGTH = 6; // snapshots captured before an outcome is "resolved"

type ThemeStats = {
  theme: string;
  count_in_window: number;
  pct_in_window: number;
  baseline_pct: number;
  trend: number[]; // recent rolling pct snapshots, for sparkline
};

const EVENT_LABELS: Record<TriggerEventType, string> = {
  platinum_refresh: "Platinum card refresh",
  product_launch: "Product launch",
  policy_change: "Policy / terms change",
  rate_move: "Interest rate move",
  weather_event: "Severe weather event",
  fee_update: "Fee schedule update",
};

class RiskMeterStore {
  all: TaggedInteraction[] = taggedData as TaggedInteraction[];
  cursor = 0;
  seen: TaggedInteraction[] = [];
  alertConfigs: AlertConfig[] = [];
  triggerMonitors: TriggerMonitor[] = [];
  firedAlerts: FiredAlert[] = [];
  actions: ActionRecord[] = [];
  feedback: FeedbackEntry[] = [];
  audit: AuditEntry[] = [];
  knownThemeSet = new Set(themes);
  emergingClusterCounts: Record<string, number> = {};
  redactionTotals: Record<string, number> = {};
  redactedCount = 0;

  constructor() {
    this.seedDefaultAlertConfigs();
    this.seedDefaultTriggerMonitors();
  }

  private seedDefaultAlertConfigs() {
    // A few sensible starting configs so Alert Studio isn't empty on first load
    const seedThemes = [
      "Payment, billing, pricing, and credit-term errors",
      "Customer dissatisfaction and reputational escalation",
      "Victim fraud, scams, identity theft, and account takeover",
    ];
    seedThemes.forEach((theme, i) => {
      this.alertConfigs.push({
        id: `seed-${i}`,
        theme,
        type: "threshold",
        threshold_pct: 12,
        spike_multiplier: 2,
        severity: i === 2 ? "high" : "medium",
        channel: "email",
        recipients: [],
        enabled: true,
        created_at: new Date().toISOString(),
      });
    });
  }

  private seedDefaultTriggerMonitors() {
    // One pre-armed event monitor so Trigger Studio isn't empty on first load —
    // demonstrates "anticipate" rather than "wait and react".
    const theme = themes.find((t) => /payment|billing|pricing/i.test(t)) ?? themes[0];
    const now = Date.now();
    this.triggerMonitors.push({
      id: "trig-seed-0",
      event_type: "platinum_refresh",
      label: "Platinum card refresh — Q3 cohort",
      theme,
      sensitivity_multiplier: 1.6,
      recipients: [],
      armed: true,
      created_at: new Date(now - 1000 * 60 * 60 * 6).toISOString(),
      expires_at: new Date(now + 1000 * 60 * 60 * 24 * 6).toISOString(),
    });
  }

  reset() {
    this.cursor = 0;
    this.seen = [];
    this.firedAlerts = [];
    this.actions = [];
    this.feedback = [];
    this.audit = [];
    this.emergingClusterCounts = {};
    this.redactionTotals = {};
    this.redactedCount = 0;
    this.log("decision", "Replay reset to start.");
  }

  log(kind: AuditEntry["kind"], summary: string, detail?: Record<string, unknown>) {
    this.audit.unshift({
      id: `a-${this.audit.length}-${Date.now()}`,
      ts: new Date().toISOString(),
      kind,
      summary,
      detail,
    });
    if (this.audit.length > 600) this.audit.length = 600;
  }

  /** Advance the replay by `n` interactions, recompute aggregation, check thresholds. */
  tick(n = 1): { advanced: number; newAlerts: FiredAlert[] } {
    const newAlerts: FiredAlert[] = [];
    let advanced = 0;
    let redactedThisTick = 0;
    const entityTotals: Record<string, number> = {};

    for (let i = 0; i < n; i++) {
      if (this.cursor >= this.all.length) break;
      const item = this.all[this.cursor];
      this.cursor++;
      this.seen.push(item);
      if (this.seen.length > BASELINE_WINDOW * 3) this.seen.shift();
      advanced++;

      // --- Stage 0: PII redaction gate (runs before the text is treated as
      // "model input" — in this prototype the cached tag already exists, but
      // we still run + log redaction over the canonical statement & raw root
      // cause so the governance trail is real and inspectable.)
      const r1 = redact(item.root_cause);
      const r2 = redact(item.normalized.canonical_statement);
      const allEntities = [...r1.entities, ...r2.entities];
      if (allEntities.length) {
        redactedThisTick++;
        this.redactedCount++;
        const summary = summarizeEntities(allEntities);
        for (const [k, v] of Object.entries(summary)) {
          entityTotals[k] = (entityTotals[k] || 0) + v;
          this.redactionTotals[k] = (this.redactionTotals[k] || 0) + v;
        }
      }

      this.log(
        "tag",
        `Tagged ${item.interaction_id.slice(-6)} → ${item.tag.theme} / ${item.tag.l1} (conf ${item.tag.confidence})${
          item.needs_review ? " — routed to human review" : ""
        }`,
        { interaction_id: item.interaction_id, tag: item.tag, needs_review: item.needs_review, pii_redacted: allEntities.length > 0 }
      );
      this.trackEmergingCluster(item);
    }

    if (redactedThisTick > 0) {
      this.log(
        "redaction",
        `Redacted PII from ${redactedThisTick} interaction${redactedThisTick === 1 ? "" : "s"} before model input — ${Object.entries(entityTotals).map(([k, v]) => `${v} ${k.replace(/_/g, " ")}`).join(", ")}.`,
        { entity_counts: entityTotals }
      );
    }

    if (advanced > 0) {
      this.expireTriggers();
      newAlerts.push(...this.evaluateAlerts());
      this.trackOutcomes();
    }
    return { advanced, newAlerts };
  }

  private trackEmergingCluster(item: TaggedInteraction) {
    // "Emerging pattern": canonical key-phrase clusters whose tag confidence sits
    // below the review floor — i.e. the system can't confidently place them in the
    // existing taxonomy. If a cluster of similar low-confidence phrases recurs,
    // that's exactly the "blind to the new" gap the concept brief calls out.
    if (!item.needs_review) return;
    const key = item.normalized.key_phrase.toLowerCase().trim();
    if (!key) return;
    this.emergingClusterCounts[key] = (this.emergingClusterCounts[key] || 0) + 1;
  }

  private rollingStats(): ThemeStats[] {
    const window = this.seen.slice(-ROLLING_WINDOW);
    const baseline = this.seen.slice(-BASELINE_WINDOW, -ROLLING_WINDOW);
    const windowTotal = window.length || 1;
    const baselineTotal = baseline.length || 1;

    return themes.map((theme) => {
      const inWindow = window.filter((x) => x.tag.theme === theme).length;
      const inBaseline = baseline.filter((x) => x.tag.theme === theme).length;
      return {
        theme,
        count_in_window: inWindow,
        pct_in_window: (inWindow / windowTotal) * 100,
        baseline_pct: (inBaseline / baselineTotal) * 100,
        trend: [],
      };
    });
  }

  getAggregation() {
    const stats = this.rollingStats();
    const top = [...stats].sort((a, b) => b.pct_in_window - a.pct_in_window);
    const overall = top.length ? Math.min(100, top[0].pct_in_window * 1.6) : 0;
    return {
      cursor: this.cursor,
      total: this.all.length,
      window_size: Math.min(this.seen.length, ROLLING_WINDOW),
      overall_risk_pct: Math.round(overall * 10) / 10,
      themes: stats.sort((a, b) => b.pct_in_window - a.pct_in_window),
      top_theme: top[0] ?? null,
    };
  }

  // --- Trigger Studio ------------------------------------------------------

  armTrigger(input: { event_type: TriggerEventType; label: string; theme: string; sensitivity_multiplier: number; recipients: string[]; days: number }): TriggerMonitor {
    const now = Date.now();
    const monitor: TriggerMonitor = {
      id: `trig-${this.triggerMonitors.length}-${now}`,
      event_type: input.event_type,
      label: input.label || EVENT_LABELS[input.event_type],
      theme: input.theme,
      sensitivity_multiplier: Math.max(1, input.sensitivity_multiplier || 1.5),
      recipients: input.recipients,
      armed: true,
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + 1000 * 60 * 60 * 24 * Math.max(1, input.days || 7)).toISOString(),
    };
    this.triggerMonitors.unshift(monitor);
    this.log(
      "trigger_armed",
      `Armed "${monitor.label}" monitor on "${monitor.theme}" — ${monitor.sensitivity_multiplier}× sensitivity for ${input.days || 7} days.`,
      { trigger_id: monitor.id, event_type: monitor.event_type, theme: monitor.theme }
    );
    return monitor;
  }

  disarmTrigger(id: string) {
    const m = this.triggerMonitors.find((t) => t.id === id);
    if (!m || !m.armed) return;
    m.armed = false;
    this.log("trigger_expired", `Disarmed "${m.label}" monitor on "${m.theme}".`, { trigger_id: m.id });
  }

  private expireTriggers() {
    const now = Date.now();
    for (const m of this.triggerMonitors) {
      if (m.armed && new Date(m.expires_at).getTime() <= now) {
        m.armed = false;
        this.log("trigger_expired", `"${m.label}" monitor on "${m.theme}" reached its expiry window and auto-disarmed.`, { trigger_id: m.id });
      }
    }
  }

  private activeMonitorForTheme(theme: string): TriggerMonitor | null {
    const now = Date.now();
    return this.triggerMonitors.find((m) => m.armed && m.theme === theme && new Date(m.expires_at).getTime() > now) ?? null;
  }

  // --- Alert evaluation -----------------------------------------------------

  private evaluateAlerts(): FiredAlert[] {
    const fired: FiredAlert[] = [];
    const stats = this.rollingStats();
    const statByTheme: Record<string, ThemeStats> = Object.fromEntries(stats.map((s) => [s.theme, s]));

    // 1) Threshold + spike alerts from configured rules — Trigger Studio
    // monitors raise sensitivity (lower the effective trip-line) for armed themes.
    for (const cfg of this.alertConfigs) {
      if (!cfg.enabled) continue;
      const s = statByTheme[cfg.theme];
      if (!s) continue;

      const recentlyFiredSameType = this.firedAlerts.find(
        (f) => f.config_id === cfg.id && Date.now() - new Date(f.fired_at).getTime() < 1000 * 60 * 2
      );
      if (recentlyFiredSameType) continue; // basic de-dupe / cooldown

      const monitor = this.activeMonitorForTheme(cfg.theme);
      const effectiveThreshold = monitor ? cfg.threshold_pct / monitor.sensitivity_multiplier : cfg.threshold_pct;

      if (cfg.type === "threshold" && s.pct_in_window >= effectiveThreshold && s.count_in_window >= 3) {
        fired.push(this.buildAlert(cfg, s, "threshold", monitor, effectiveThreshold));
      } else if (cfg.type === "spike") {
        const mult = cfg.spike_multiplier ?? 2;
        const effectiveMult = monitor ? mult / monitor.sensitivity_multiplier : mult;
        if (s.baseline_pct > 0 && s.pct_in_window >= s.baseline_pct * Math.max(1.1, effectiveMult) && s.count_in_window >= 3) {
          fired.push(this.buildAlert(cfg, s, "spike", monitor));
        }
      }
    }

    // 1b) Anticipatory catches: an armed monitor on a theme with NO standing
    // detector still raises a (lighter) scoped alert if the rolling rate moves
    // meaningfully above its trailing baseline — "we anticipate, not just wait."
    for (const monitor of this.triggerMonitors) {
      if (!monitor.armed || new Date(monitor.expires_at).getTime() <= Date.now()) continue;
      if (this.alertConfigs.some((c) => c.enabled && c.theme === monitor.theme)) continue; // already covered above
      const s = statByTheme[monitor.theme];
      if (!s || s.count_in_window < 3) continue;
      const recentlyFired = this.firedAlerts.find(
        (f) => f.trigger_id === monitor.id && Date.now() - new Date(f.fired_at).getTime() < 1000 * 60 * 2
      );
      if (recentlyFired) continue;
      const scopedThreshold = 8 / monitor.sensitivity_multiplier;
      if (s.pct_in_window >= scopedThreshold) {
        fired.push(this.buildAnticipatedAlert(monitor, s, scopedThreshold));
      }
    }

    // 2) Emerging-pattern alerts (no pre-config — system-detected)
    for (const [phrase, count] of Object.entries(this.emergingClusterCounts)) {
      if (count === 4) {
        const evidence = this.seen
          .filter((x) => x.needs_review && x.normalized.key_phrase.toLowerCase().trim() === phrase)
          .slice(-4);
        if (!evidence.length) continue;
        const alert: FiredAlert = {
          id: `emerging-${phrase}-${Date.now()}`,
          config_id: null,
          theme: "Emerging / Unmapped Pattern",
          type: "emerging",
          severity: "medium",
          current_pct: 0,
          threshold_pct: null,
          message: `A recurring pattern ("${phrase}") is appearing that doesn't map confidently to any existing taxonomy node — ${count} occurrences and growing. This may be a novel risk signal worth taxonomy review.`,
          evidence,
          candidate_actions: this.buildCandidateActions("Emerging / Unmapped Pattern", "emerging", phrase),
          fired_at: new Date().toISOString(),
          delivered: false,
        };
        fired.push(alert);
      }
    }

    fired.forEach((a) => {
      this.firedAlerts.unshift(a);
      this.log("alert_fired", `Alert fired: ${a.theme} (${a.type}) — ${a.message.slice(0, 80)}...`, { alert_id: a.id, trigger_id: a.trigger_id ?? null });
    });
    if (this.firedAlerts.length > 200) this.firedAlerts.length = 200;
    return fired;
  }

  private buildAlert(cfg: AlertConfig, s: ThemeStats, type: AlertType, monitor?: TriggerMonitor | null, effectiveThreshold?: number): FiredAlert {
    const evidence = this.seen.filter((x) => x.tag.theme === cfg.theme).slice(-3);
    const anticipated = monitor ? ` An armed "${monitor.label}" trigger raised sensitivity ${monitor.sensitivity_multiplier}× for this theme, catching it earlier than the standing line would have.` : "";
    const message =
      type === "threshold"
        ? `"${cfg.theme}" has crossed its ${monitor ? "trigger-adjusted" : "configured"} threshold: ${s.pct_in_window.toFixed(1)}% of the last ${ROLLING_WINDOW} interactions vs. a ${(effectiveThreshold ?? cfg.threshold_pct).toFixed(1)}% line.${anticipated}`
        : `"${cfg.theme}" has spiked: ${s.pct_in_window.toFixed(1)}% now vs. a ${s.baseline_pct.toFixed(1)}% trailing baseline (${(cfg.spike_multiplier ?? 2)}x threshold).${anticipated}`;
    return {
      id: `${cfg.id}-${type}-${Date.now()}`,
      config_id: cfg.id,
      trigger_id: monitor?.id ?? null,
      theme: cfg.theme,
      type,
      severity: cfg.severity,
      current_pct: Math.round(s.pct_in_window * 10) / 10,
      threshold_pct: type === "threshold" ? Math.round((effectiveThreshold ?? cfg.threshold_pct) * 10) / 10 : Math.round(s.baseline_pct * (cfg.spike_multiplier ?? 2) * 10) / 10,
      message,
      evidence,
      candidate_actions: this.buildCandidateActions(cfg.theme, type),
      fired_at: new Date().toISOString(),
      delivered: false,
    };
  }

  private buildAnticipatedAlert(monitor: TriggerMonitor, s: ThemeStats, scopedThreshold: number): FiredAlert {
    const evidence = this.seen.filter((x) => x.tag.theme === monitor.theme).slice(-3);
    return {
      id: `anticipated-${monitor.id}-${Date.now()}`,
      config_id: null,
      trigger_id: monitor.id,
      theme: monitor.theme,
      type: "threshold",
      severity: "medium",
      current_pct: Math.round(s.pct_in_window * 10) / 10,
      threshold_pct: Math.round(scopedThreshold * 10) / 10,
      message: `Anticipatory catch: "${monitor.theme}" is running at ${s.pct_in_window.toFixed(1)}% during the armed "${monitor.label}" window — above the ${scopedThreshold.toFixed(1)}% scoped line set for this event (no standing detector exists for this theme; the trigger caught it anyway).`,
      evidence,
      candidate_actions: this.buildCandidateActions(monitor.theme, "threshold"),
      fired_at: new Date().toISOString(),
      delivered: false,
    };
  }

  /** Deterministic small hash so the same theme+type produces stable-but-varied tradeoff scores across the demo. */
  private hashSeed(...parts: string[]): number {
    let h = 0;
    const s = parts.join("|");
    for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; }
    return h;
  }

  private buildCandidateActions(theme: string, type: AlertType, extra = ""): CandidateAction[] {
    const node = taxonomy.find((t) => t.theme === theme);
    const playbook = node?.suggested_playbook?.trim() || "Route to the theme's process owner for review and a tailored response.";
    const seed = this.hashSeed(theme, type, extra);
    const jitter = (offset: number, span = 30, base = 35) => base + ((seed >> offset) % span);

    const actions: CandidateAction[] = [
      {
        id: "playbook",
        label: "Execute the pre-approved playbook",
        rationale: playbook.length > 180 ? playbook.slice(0, 177) + "…" : playbook,
        customer_impact: jitter(2, 25, 65),
        effort: jitter(5, 20, 20),
        cost: jitter(8, 20, 15),
        time_to_effect: jitter(11, 20, 15),
        recommended_path: "alert",
      },
      {
        id: "automate",
        label: `Automate a targeted outreach workflow for affected ${type === "emerging" ? "interactions" : "accounts"}`,
        rationale: `Queue a structured, human-approved workflow into case management — proactively contacts the affected cohort before the issue compounds, with a tracked record for follow-up.`,
        customer_impact: jitter(14, 25, 60),
        effort: jitter(17, 25, 35),
        cost: jitter(20, 25, 30),
        time_to_effect: jitter(23, 20, 30),
        recommended_path: "automate",
      },
      {
        id: "research",
        label: "Commission a deeper-dive analysis before acting",
        rationale: `Run an extended review across this theme's full interaction set to confirm root cause and scope before committing operational resources — lower upfront cost, slower to land.`,
        customer_impact: jitter(26, 20, 30),
        effort: jitter(29, 15, 15),
        cost: jitter(3, 15, 10),
        time_to_effect: jitter(6, 20, 60),
        recommended_path: "research",
      },
    ];
    return actions;
  }

  markDelivered(alertId: string, ok: boolean, error?: string) {
    const a = this.firedAlerts.find((x) => x.id === alertId);
    if (!a) return;
    a.delivered = ok;
    if (error) a.delivery_error = error;
    this.log(
      ok ? "alert_delivered" : "alert_fired",
      ok ? `Alert email delivered for "${a.theme}".` : `Alert email delivery failed for "${a.theme}": ${error}`,
      { alert_id: alertId }
    );
  }

  // --- Action Engine (3 paths) ----------------------------------------------

  executeAction(input: { alertId: string; actionId: string; path: ActionPath; approver: string; note: string }): ActionRecord | null {
    const alert = this.firedAlerts.find((a) => a.id === input.alertId);
    if (!alert) return null;
    const candidate = alert.candidate_actions.find((c) => c.id === input.actionId) ?? alert.candidate_actions[0];
    if (!candidate) return null;

    const stats = this.rollingStats();
    const baseline = stats.find((s) => s.theme === alert.theme)?.pct_in_window ?? alert.current_pct;
    const now = new Date().toISOString();
    const id = `act-${this.actions.length}-${Date.now()}`;

    let status: ActionRecord["status"] = "completed";
    let result: Record<string, unknown> = {};

    if (input.path === "alert") {
      // Reuses the same email-delivery mechanism as Alert Studio — this path
      // is fully live (subject to RESEND_API_KEY / simulated fallback).
      result = { channel: "email", note: "Delivery is dispatched by the caller via sendAlertEmail; recorded here for the audit trail.", recipients: alert.evidence.length ? "configured recipients" : "no recipients on file" };
      status = "completed";
    } else if (input.path === "automate") {
      const trackedId = `WF-${(this.hashSeed(alert.id, candidate.id, "automate") % 90000 + 10000)}`;
      result = {
        connector: "Case Management (stubbed connector — real-shaped)",
        tracked_id: trackedId,
        queued_for: alert.theme,
        requires: "Human approval recorded before dispatch (RBAC: Approver role)",
        status: "queued",
      };
      status = "queued";
    } else {
      const artifactId = `RR-${(this.hashSeed(alert.id, candidate.id, "research") % 90000 + 10000)}`;
      result = {
        connector: "Deep-dive Research Agent (stubbed — real-shaped)",
        artifact_id: artifactId,
        scope: `Full interaction set tagged to "${alert.theme}" (last ${ROLLING_WINDOW} + trailing ${BASELINE_WINDOW - ROLLING_WINDOW})`,
        summary: `Commissioned an extended review of ${alert.theme.toLowerCase()} signals — preliminary scope confirmed against ${alert.evidence.length} sampled root causes; full artifact will be attached to the audit record on completion.`,
        status: "running",
      };
      status = "running";
    }

    const record: ActionRecord = {
      id,
      alert_id: alert.id,
      theme: alert.theme,
      action_label: candidate.label,
      path: input.path,
      approver: input.approver || "demo-approver@amex.com",
      note: input.note || "",
      status,
      result,
      created_at: now,
      baseline_pct: Math.round(baseline * 10) / 10,
      outcome_trend: [Math.round(baseline * 10) / 10],
      outcome_resolved: false,
      was_recommendation_correct: null,
    };
    this.actions.unshift(record);
    if (this.actions.length > 100) this.actions.length = 100;

    this.log(
      "action_taken",
      `Action taken on "${alert.theme}": ${candidate.label} — routed via ${input.path} path by ${record.approver}.`,
      { action_id: id, alert_id: alert.id, path: input.path, result }
    );
    return record;
  }

  /** Called on every tick — advances the post-action outcome curve for in-flight actions and resolves them once enough samples are captured. */
  private trackOutcomes() {
    const stats = this.rollingStats();
    const statByTheme: Record<string, ThemeStats> = Object.fromEntries(stats.map((s) => [s.theme, s]));

    for (const action of this.actions) {
      if (action.outcome_resolved) continue;
      const s = statByTheme[action.theme];
      if (!s) continue;
      const pct = Math.round(s.pct_in_window * 10) / 10;
      const last = action.outcome_trend[action.outcome_trend.length - 1];
      if (last === pct) continue; // only snapshot on change to keep the curve meaningful
      action.outcome_trend.push(pct);
      if (action.outcome_trend.length > OUTCOME_TREND_LENGTH) {
        const finalPct = action.outcome_trend[action.outcome_trend.length - 1];
        const delta = Math.round((finalPct - action.baseline_pct) * 10) / 10;
        const wasCorrect = delta <= 0; // the recommended action should reduce (or hold down) the rolling rate
        action.outcome_resolved = true;
        action.was_recommendation_correct = wasCorrect;

        const entry: FeedbackEntry = {
          id: `fb-${this.feedback.length}-${Date.now()}`,
          action_id: action.id,
          alert_id: action.alert_id,
          theme: action.theme,
          decision_path: action.path,
          baseline_pct: action.baseline_pct,
          final_pct: finalPct,
          delta_pct: delta,
          was_recommendation_correct: wasCorrect,
          created_at: new Date().toISOString(),
        };
        this.feedback.unshift(entry);
        if (this.feedback.length > 100) this.feedback.length = 100;

        this.log(
          "outcome",
          `Outcome captured for "${action.theme}": rolling rate moved ${action.baseline_pct}% → ${finalPct}% (Δ ${delta > 0 ? "+" : ""}${delta}pp) after "${action.action_label}" — recommendation ${wasCorrect ? "validated" : "missed the mark"}. Logged to the feedback store for eval/few-shot refresh.`,
          { action_id: action.id, feedback_id: entry.id, was_correct: wasCorrect }
        );
      }
    }
  }
}

// Survive Next.js dev-mode hot-reload by stashing the singleton on globalThis
const g = globalThis as unknown as { __riskMeterStore?: RiskMeterStore };
export const store: RiskMeterStore = g.__riskMeterStore ?? (g.__riskMeterStore = new RiskMeterStore());
