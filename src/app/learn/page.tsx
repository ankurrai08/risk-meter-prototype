"use client";
import { useEffect, useState, useCallback } from "react";

type ActionPath = "alert" | "automate" | "research";
type ActionRecord = {
  id: string; alert_id: string; theme: string; action_label: string; path: ActionPath;
  approver: string; note: string; status: "completed" | "queued" | "running";
  result: Record<string, unknown>; created_at: string; baseline_pct: number;
  outcome_trend: number[]; outcome_resolved: boolean; was_recommendation_correct: boolean | null;
};
type FeedbackEntry = {
  id: string; action_id: string; alert_id: string; theme: string; decision_path: ActionPath;
  baseline_pct: number; final_pct: number; delta_pct: number; was_recommendation_correct: boolean; created_at: string;
};

const PATH_LABEL: Record<ActionPath, string> = { alert: "Alert", automate: "Automate (HITL)", research: "Research" };
const PATH_COLOR: Record<ActionPath, string> = { alert: "var(--blue)", automate: "#1f9d6f", research: "#8b5cf6" };

function Sparkline({ baseline, trend }: { baseline: number; trend: number[] }) {
  const points = [baseline, ...trend];
  const max = Math.max(...points, 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 34 }}>
      {points.map((v, i) => (
        <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <div
            title={`${i === 0 ? "baseline" : `sample ${i}`}: ${v.toFixed(1)}%`}
            style={{
              width: 9, height: Math.max(3, (v / max) * 28), borderRadius: 2,
              background: i === 0 ? "var(--faint)" : v <= baseline ? "var(--good)" : "var(--bad)",
            }}
          />
        </div>
      ))}
    </div>
  );
}

export default function MeasureLearnPage() {
  const [actions, setActions] = useState<ActionRecord[]>([]);
  const [feedback, setFeedback] = useState<FeedbackEntry[]>([]);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/state");
    const data = await res.json();
    setActions(data.actions ?? []);
    setFeedback(data.feedback ?? []);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  const inFlight = actions.filter((a) => !a.outcome_resolved);
  const resolvedCount = feedback.length;
  const correctCount = feedback.filter((f) => f.was_recommendation_correct).length;
  const correctPct = resolvedCount ? Math.round((correctCount / resolvedCount) * 100) : null;
  const avgDelta = resolvedCount ? feedback.reduce((s, f) => s + f.delta_pct, 0) / resolvedCount : null;

  return (
    <div className="wrap" style={{ maxWidth: 1180, margin: "0 auto", padding: "30px 30px 90px" }}>
      <div className="mono" style={{ fontSize: 11.5, letterSpacing: ".2em", textTransform: "uppercase", color: "var(--faint)", marginBottom: 10 }}>Measure &amp; Learn</div>
      <h1 className="df" style={{ fontWeight: 800, fontSize: "clamp(28px,3.5vw,40px)", color: "var(--ink)", letterSpacing: "-.02em", marginBottom: 12 }}>
        Did the action actually <span style={{ color: "var(--blue)" }}>move the number?</span>
      </h1>
      <p style={{ fontSize: 15, color: "var(--muted)", maxWidth: 720, lineHeight: 1.55, marginBottom: 32 }}>
        Every approved action is tracked against the theme it targeted: we snapshot the rolling rate at the moment of the
        decision (the baseline), then keep sampling it afterward. Once enough samples accumulate, the loop closes — recording
        whether the rate fell (the recommendation gets marked &ldquo;correct&rdquo;) and feeding that signal back so future
        recommendations and tradeoff scores keep improving.
      </p>

      {/* Summary tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 36 }}>
        <div className="card" style={{ padding: "16px 18px" }}>
          <div className="df" style={{ fontWeight: 800, fontSize: 26, color: "var(--ink)" }}>{actions.length}</div>
          <div className="mono" style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".06em", marginTop: 2 }}>actions taken</div>
        </div>
        <div className="card" style={{ padding: "16px 18px" }}>
          <div className="df" style={{ fontWeight: 800, fontSize: 26, color: "var(--ink)" }}>{inFlight.length}</div>
          <div className="mono" style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".06em", marginTop: 2 }}>outcomes in flight</div>
        </div>
        <div className="card" style={{ padding: "16px 18px" }}>
          <div className="df" style={{ fontWeight: 800, fontSize: 26, color: correctPct == null ? "var(--faint)" : correctPct >= 50 ? "var(--good)" : "var(--bad)" }}>
            {correctPct == null ? "—" : `${correctPct}%`}
          </div>
          <div className="mono" style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".06em", marginTop: 2 }}>recommendations validated ({resolvedCount} resolved)</div>
        </div>
        <div className="card" style={{ padding: "16px 18px" }}>
          <div className="df" style={{ fontWeight: 800, fontSize: 26, color: avgDelta == null ? "var(--faint)" : avgDelta <= 0 ? "var(--good)" : "var(--bad)" }}>
            {avgDelta == null ? "—" : `${avgDelta > 0 ? "+" : ""}${avgDelta.toFixed(1)} pp`}
          </div>
          <div className="mono" style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".06em", marginTop: 2 }}>avg. change in rolling rate post-action</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.15fr 1fr", gap: 28 }}>
        {/* In-flight outcome tracking */}
        <div>
          <h2 className="df" style={{ fontWeight: 800, fontSize: 19, color: "var(--ink)", marginBottom: 14 }}>
            Outcome tracking <span className="mono" style={{ fontSize: 12, color: "var(--faint)", fontWeight: 400 }}>({inFlight.length} in flight)</span>
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {inFlight.map((a) => (
              <div key={a.id} className="card" style={{ padding: "15px 17px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span className="mono" style={{ fontSize: 9, letterSpacing: ".08em", textTransform: "uppercase", padding: "3px 8px", borderRadius: 6, color: "#fff", background: PATH_COLOR[a.path] }}>
                        {PATH_LABEL[a.path]}
                      </span>
                      <span className="df" style={{ fontWeight: 700, fontSize: 13.5, color: "var(--ink)" }}>{a.action_label}</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.theme}>{a.theme}</div>
                    <div className="mono" style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 4 }}>
                      baseline {a.baseline_pct.toFixed(1)}% · {a.outcome_trend.length}/6 samples · approved by {a.approver}
                    </div>
                  </div>
                  <Sparkline baseline={a.baseline_pct} trend={a.outcome_trend} />
                </div>
              </div>
            ))}
            {!inFlight.length && (
              <div className="card" style={{ padding: 20, color: "var(--muted)", fontSize: 13 }}>
                No outcomes currently being tracked — approve an action from the Decision Console to start a feedback loop.
              </div>
            )}
          </div>
        </div>

        {/* Resolved feedback */}
        <div>
          <h2 className="df" style={{ fontWeight: 800, fontSize: 19, color: "var(--ink)", marginBottom: 14 }}>
            Feedback store <span className="mono" style={{ fontSize: 12, color: "var(--faint)", fontWeight: 400 }}>({feedback.length} resolved)</span>
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {feedback.map((f) => (
              <div key={f.id} className="card" style={{ padding: "14px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, color: "var(--ink)", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.theme}>{f.theme}</div>
                    <div className="mono" style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 3 }}>
                      {PATH_LABEL[f.decision_path]} · {f.baseline_pct.toFixed(1)}% → {f.final_pct.toFixed(1)}% · {new Date(f.created_at).toLocaleString()}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flex: "none" }}>
                    <div className="df" style={{ fontWeight: 800, fontSize: 16, color: f.delta_pct <= 0 ? "var(--good)" : "var(--bad)" }}>
                      {f.delta_pct > 0 ? "+" : ""}{f.delta_pct.toFixed(1)} pp
                    </div>
                    <div className="mono" style={{ fontSize: 9.5, letterSpacing: ".06em", textTransform: "uppercase", color: f.was_recommendation_correct ? "var(--good)" : "var(--bad)" }}>
                      {f.was_recommendation_correct ? "✓ correct call" : "✕ missed"}
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {!feedback.length && (
              <div className="card" style={{ padding: 20, color: "var(--muted)", fontSize: 13 }}>
                No outcomes resolved yet — each tracked action takes 6 sampled ticks to close the loop and land here.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
