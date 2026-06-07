import taggedData from "@/data/tagged_interactions.json";
import { taxonomy, themes } from "./taxonomy";
import type { TaggedInteraction } from "./types";

// ---------------------------------------------------------------------------
// In-memory live-pipeline simulation store.
//
// In production this state would live in Vercel KV / a real streaming
// aggregation service fed by the actual CIE pipeline. For the prototype we
// keep a single server-side singleton (survives across requests in one
// running instance) that the replay engine advances and the dashboard polls.
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

export type FiredAlert = {
  id: string;
  config_id: string | null; // null for emerging-pattern alerts (no pre-config needed)
  theme: string;
  type: AlertType;
  severity: "low" | "medium" | "high";
  current_pct: number;
  threshold_pct: number | null;
  message: string;
  evidence: TaggedInteraction[];
  fired_at: string;
  delivered: boolean;
  delivery_error?: string;
};

export type AuditEntry = {
  id: string;
  ts: string;
  kind: "tag" | "alert_fired" | "alert_delivered" | "alert_config" | "decision";
  summary: string;
  detail?: Record<string, unknown>;
};

const ROLLING_WINDOW = 60; // last N interactions used for rolling % calc
const BASELINE_WINDOW = 120; // wider trailing window for spike comparison

type ThemeStats = {
  theme: string;
  count_in_window: number;
  pct_in_window: number;
  baseline_pct: number;
  trend: number[]; // recent rolling pct snapshots, for sparkline
};

class RiskMeterStore {
  all: TaggedInteraction[] = taggedData as TaggedInteraction[];
  cursor = 0;
  seen: TaggedInteraction[] = [];
  alertConfigs: AlertConfig[] = [];
  firedAlerts: FiredAlert[] = [];
  audit: AuditEntry[] = [];
  knownThemeSet = new Set(themes);
  emergingClusterCounts: Record<string, number> = {};

  constructor() {
    this.seedDefaultAlertConfigs();
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

  reset() {
    this.cursor = 0;
    this.seen = [];
    this.firedAlerts = [];
    this.audit = [];
    this.emergingClusterCounts = {};
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
    if (this.audit.length > 500) this.audit.length = 500;
  }

  /** Advance the replay by `n` interactions, recompute aggregation, check thresholds. */
  tick(n = 1): { advanced: number; newAlerts: FiredAlert[] } {
    const newAlerts: FiredAlert[] = [];
    let advanced = 0;
    for (let i = 0; i < n; i++) {
      if (this.cursor >= this.all.length) break;
      const item = this.all[this.cursor];
      this.cursor++;
      this.seen.push(item);
      if (this.seen.length > BASELINE_WINDOW * 3) this.seen.shift();
      advanced++;
      this.log(
        "tag",
        `Tagged ${item.interaction_id.slice(-6)} → ${item.tag.theme} / ${item.tag.l1} (conf ${item.tag.confidence})${
          item.needs_review ? " — routed to human review" : ""
        }`,
        { interaction_id: item.interaction_id, tag: item.tag, needs_review: item.needs_review }
      );
      this.trackEmergingCluster(item);
    }
    if (advanced > 0) {
      newAlerts.push(...this.evaluateAlerts());
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
        trend: [], // populated by caller if needed
      };
    });
  }

  getAggregation() {
    const stats = this.rollingStats();
    // overall "risk level" = weighted toward themes with active alert configs / highest pct
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

  private evaluateAlerts(): FiredAlert[] {
    const fired: FiredAlert[] = [];
    const stats = this.rollingStats();
    const statByTheme: Record<string, ThemeStats> = Object.fromEntries(stats.map((s) => [s.theme, s]));

    // 1) Threshold + spike alerts from configured rules
    for (const cfg of this.alertConfigs) {
      if (!cfg.enabled) continue;
      const s = statByTheme[cfg.theme];
      if (!s) continue;

      const recentlyFiredSameType = this.firedAlerts.find(
        (f) => f.config_id === cfg.id && Date.now() - new Date(f.fired_at).getTime() < 1000 * 60 * 2
      );
      if (recentlyFiredSameType) continue; // basic de-dupe / cooldown

      if (cfg.type === "threshold" && s.pct_in_window >= cfg.threshold_pct && s.count_in_window >= 3) {
        fired.push(this.buildAlert(cfg, s, "threshold"));
      } else if (cfg.type === "spike") {
        const mult = cfg.spike_multiplier ?? 2;
        if (s.baseline_pct > 0 && s.pct_in_window >= s.baseline_pct * mult && s.count_in_window >= 3) {
          fired.push(this.buildAlert(cfg, s, "spike"));
        }
      }
    }

    // 2) Emerging-pattern alerts (no pre-config — system-detected)
    for (const [phrase, count] of Object.entries(this.emergingClusterCounts)) {
      if (count === 4) {
        // fire once when a cluster crosses a small recurrence threshold
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
          fired_at: new Date().toISOString(),
          delivered: false,
        };
        fired.push(alert);
      }
    }

    fired.forEach((a) => {
      this.firedAlerts.unshift(a);
      this.log("alert_fired", `Alert fired: ${a.theme} (${a.type}) — ${a.message.slice(0, 80)}...`, { alert_id: a.id });
    });
    if (this.firedAlerts.length > 200) this.firedAlerts.length = 200;
    return fired;
  }

  private buildAlert(cfg: AlertConfig, s: ThemeStats, type: AlertType): FiredAlert {
    const evidence = this.seen
      .filter((x) => x.tag.theme === cfg.theme)
      .slice(-3);
    const node = taxonomy.find((t) => t.theme === cfg.theme);
    const message =
      type === "threshold"
        ? `"${cfg.theme}" has crossed its configured threshold: ${s.pct_in_window.toFixed(1)}% of the last ${ROLLING_WINDOW} interactions vs. a ${cfg.threshold_pct}% threshold.`
        : `"${cfg.theme}" has spiked: ${s.pct_in_window.toFixed(1)}% now vs. a ${s.baseline_pct.toFixed(1)}% trailing baseline (${(cfg.spike_multiplier ?? 2)}x threshold).`;
    return {
      id: `${cfg.id}-${type}-${Date.now()}`,
      config_id: cfg.id,
      theme: cfg.theme,
      type,
      severity: cfg.severity,
      current_pct: Math.round(s.pct_in_window * 10) / 10,
      threshold_pct: type === "threshold" ? cfg.threshold_pct : Math.round(s.baseline_pct * (cfg.spike_multiplier ?? 2) * 10) / 10,
      message,
      evidence,
      fired_at: new Date().toISOString(),
      delivered: false,
      // Stash playbook on the alert via message context — UI looks it up from taxonomy by theme too
      ...(node ? {} : {}),
    };
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
}

// Survive Next.js dev-mode hot-reload by stashing the singleton on globalThis
const g = globalThis as unknown as { __riskMeterStore?: RiskMeterStore };
export const store: RiskMeterStore = g.__riskMeterStore ?? (g.__riskMeterStore = new RiskMeterStore());
