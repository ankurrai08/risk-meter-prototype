"use client";
import { useState } from "react";

type Evidence = { interaction_id: string; type: string; date: string; normalized: { canonical_statement: string; key_phrase: string }; tag: { confidence: number } };

export type CandidateAction = {
  id: string;
  label: string;
  rationale: string;
  customer_impact: number;
  effort: number;
  cost: number;
  time_to_effect: number;
  recommended_path: "alert" | "automate" | "research";
};

export type ConsoleAlert = {
  id: string;
  theme: string;
  type: string;
  severity: "low" | "medium" | "high";
  current_pct: number;
  threshold_pct: number | null;
  message: string;
  evidence: Evidence[];
  candidate_actions: CandidateAction[];
  fired_at: string;
  delivered: boolean;
  delivery_error?: string;
  trigger_id?: string | null;
};

const SEV_COLOR: Record<string, string> = { low: "var(--muted)", medium: "var(--blue)", high: "var(--bad)" };

const TRADEOFF_BARS: { key: keyof CandidateAction; label: string; goodIsHigh: boolean }[] = [
  { key: "customer_impact", label: "Customer impact", goodIsHigh: true },
  { key: "effort", label: "Effort required", goodIsHigh: false },
  { key: "cost", label: "Cost", goodIsHigh: false },
  { key: "time_to_effect", label: "Time to effect", goodIsHigh: false },
];

const PATH_INFO: Record<CandidateAction["recommended_path"], { label: string; hint: string }> = {
  alert: { label: "Send alert email", hint: "Live — dispatches a templated email to the configured recipients now." },
  automate: { label: "Automate (HITL)", hint: "Queues a structured, human-approved workflow into case management — returns a tracked ID." },
  research: { label: "Commission research", hint: "Kicks off a deeper-dive analysis agent over the full theme interaction set." },
};

function TradeoffBar({ label, value, goodIsHigh }: { label: string; value: number; goodIsHigh: boolean }) {
  const good = goodIsHigh ? value >= 55 : value <= 45;
  const color = good ? "var(--good)" : value > 70 || value < 30 ? "var(--blue)" : "var(--warn)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ flex: "0 0 110px", fontSize: 11, color: "var(--muted)" }}>{label}</span>
      <span className="barTrack" style={{ flex: 1, height: 6 }}>
        <span className="barFill" style={{ width: `${Math.max(4, Math.min(100, value))}%`, background: color }} />
      </span>
      <span className="mono" style={{ fontSize: 10, minWidth: 26, textAlign: "right", color: "var(--faint)" }}>{value}</span>
    </div>
  );
}

export default function DecisionConsole({
  alert,
  playbook,
  onClose,
  onDecision,
  onExecuteAction,
}: {
  alert: ConsoleAlert;
  playbook: string | null;
  onClose: () => void;
  onDecision: (action: "approve" | "override" | "escalate", note: string) => Promise<void>;
  onExecuteAction: (actionId: string, path: "alert" | "automate" | "research", note: string) => Promise<{ action?: { result?: Record<string, unknown>; status?: string } } | void>;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(alert.candidate_actions[0]?.id ?? null);
  const [execResult, setExecResult] = useState<{ path: string; result?: Record<string, unknown>; status?: string } | null>(null);
  const [executing, setExecuting] = useState<string | null>(null);

  async function act(action: "approve" | "override" | "escalate") {
    setBusy(action);
    await onDecision(action, note);
    setBusy(null);
    setDone(action);
  }

  async function execute(path: "alert" | "automate" | "research") {
    if (!selected) return;
    setExecuting(path);
    const res = await onExecuteAction(selected, path, note);
    setExecuting(null);
    if (res && "action" in res && res.action) {
      setExecResult({ path, result: res.action.result, status: res.action.status });
    }
  }

  const selectedAction = alert.candidate_actions.find((c) => c.id === selected) ?? null;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,23,90,.35)", backdropFilter: "blur(2px)" }} />
      <div className="card" style={{ position: "relative", width: 540, maxWidth: "94vw", height: "100%", borderRadius: 0, overflowY: "auto", padding: "28px 28px 48px" }}>
        <button onClick={onClose} className="mono" style={{ position: "absolute", top: 22, right: 24, background: "none", border: "none", color: "var(--muted)", fontSize: 13, cursor: "pointer" }}>
          close ✕
        </button>
        <div className="mono" style={{ fontSize: 10.5, letterSpacing: ".14em", textTransform: "uppercase", color: SEV_COLOR[alert.severity], marginBottom: 8 }}>
          {alert.severity} severity · {alert.type} alert{alert.trigger_id ? " · anticipated by Trigger Studio" : ""}
        </div>
        <h2 className="df" style={{ fontWeight: 800, fontSize: 22, color: "var(--ink)", marginBottom: 10, lineHeight: 1.2 }}>{alert.theme}</h2>
        <p style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.5, marginBottom: 18 }}>{alert.message}</p>

        <div style={{ display: "flex", gap: 22, marginBottom: 22 }}>
          <div>
            <div className="df" style={{ fontWeight: 800, fontSize: 26, color: "var(--blue)" }}>{alert.current_pct}%</div>
            <div className="mono" style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".06em" }}>current rolling rate</div>
          </div>
          {alert.threshold_pct != null && (
            <div>
              <div className="df" style={{ fontWeight: 800, fontSize: 26, color: "var(--ink)" }}>{alert.threshold_pct}%</div>
              <div className="mono" style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".06em" }}>configured trigger</div>
            </div>
          )}
          <div>
            <div className="df" style={{ fontWeight: 800, fontSize: 26, color: alert.delivered ? "var(--good)" : "var(--warn)" }}>
              {alert.delivered ? "Sent" : "Pending"}
            </div>
            <div className="mono" style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".06em" }}>email delivery</div>
          </div>
        </div>

        <div className="mono" style={{ fontSize: 10.5, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--faint)", marginBottom: 8 }}>
          Evidence — sample canonical root causes (PII redacted before model input)
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
          {alert.evidence.map((e) => (
            <div key={e.interaction_id} className="card" style={{ padding: "12px 14px", boxShadow: "none" }}>
              <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.45 }}>{e.normalized.canonical_statement}</div>
              <div className="mono" style={{ fontSize: 10, color: "var(--faint)", marginTop: 6, display: "flex", gap: 10 }}>
                <span>{e.interaction_id.slice(-8)}</span>
                <span>{e.type}</span>
                <span>conf {e.tag.confidence}</span>
                <span>&ldquo;{e.normalized.key_phrase}&rdquo;</span>
              </div>
            </div>
          ))}
          {!alert.evidence.length && <div style={{ fontSize: 13, color: "var(--muted)" }}>No evidence captured for this alert.</div>}
        </div>

        {/* --- Candidate actions with tradeoff scoring (Decide) --- */}
        <div className="mono" style={{ fontSize: 10.5, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--faint)", marginBottom: 8 }}>
          Candidate actions — scored on customer impact / effort / cost / time-to-effect
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 22 }}>
          {alert.candidate_actions.map((c) => {
            const isSel = selected === c.id;
            return (
              <button
                key={c.id}
                onClick={() => { setSelected(c.id); setExecResult(null); }}
                className="card"
                style={{ textAlign: "left", padding: "14px 16px", cursor: "pointer", border: isSel ? "1.5px solid var(--blue)" : "1px solid var(--line)", background: isSel ? "var(--b50)" : "#fff" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6, gap: 10 }}>
                  <span className="df" style={{ fontWeight: 700, fontSize: 13.5, color: "var(--ink)" }}>{c.label}</span>
                  <span className="mono" style={{ fontSize: 9, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--blue)", flex: "none" }}>
                    suggests: {PATH_INFO[c.recommended_path].label}
                  </span>
                </div>
                <p style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.45, marginBottom: 10 }}>{c.rationale}</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {TRADEOFF_BARS.map((b) => (
                    <TradeoffBar key={String(b.key)} label={b.label} value={c[b.key] as number} goodIsHigh={b.goodIsHigh} />
                  ))}
                </div>
              </button>
            );
          })}
        </div>

        {/* --- Action Engine: route the selected action through one of 3 paths (Act) --- */}
        {selectedAction && (
          <div style={{ background: "var(--b50)", border: "1px solid var(--b150)", borderRadius: 12, padding: "14px 16px", marginBottom: 22 }}>
            <div className="mono" style={{ fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--blue)", marginBottom: 8 }}>
              Action Engine — choose how to execute &ldquo;{selectedAction.label}&rdquo;
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: execResult ? 12 : 0 }}>
              {(Object.keys(PATH_INFO) as (keyof typeof PATH_INFO)[]).map((p) => (
                <button
                  key={p}
                  disabled={!!executing}
                  onClick={() => execute(p)}
                  title={PATH_INFO[p].hint}
                  className="df"
                  style={{
                    flex: "1 1 150px", border: p === selectedAction.recommended_path ? "1.5px solid var(--blue)" : "1px solid var(--line)",
                    background: "#fff", color: "var(--ink)", borderRadius: 9, padding: "9px 12px", fontWeight: 700, fontSize: 12.5, cursor: executing ? "default" : "pointer",
                    opacity: executing && executing !== p ? 0.5 : 1,
                  }}
                >
                  {executing === p ? "Executing…" : PATH_INFO[p].label}
                  {p === selectedAction.recommended_path && <span style={{ display: "block", fontWeight: 400, fontSize: 10, color: "var(--blue)", marginTop: 2 }}>recommended</span>}
                </button>
              ))}
            </div>
            {execResult && (
              <div className="mono" style={{ fontSize: 11, color: "var(--text)", lineHeight: 1.6, background: "#fff", border: "1px solid var(--line)", borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ color: "var(--good)", marginBottom: 4 }}>✓ Routed via &ldquo;{PATH_INFO[execResult.path as CandidateAction["recommended_path"]].label}&rdquo; — status: {execResult.status}</div>
                {execResult.result && Object.entries(execResult.result).filter(([k]) => k !== "delivery").map(([k, v]) => (
                  <div key={k} style={{ color: "var(--muted)" }}>{k}: <span style={{ color: "var(--ink)" }}>{typeof v === "string" ? v : JSON.stringify(v)}</span></div>
                ))}
              </div>
            )}
          </div>
        )}

        {playbook && (
          <div style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 12, padding: "14px 16px", marginBottom: 22 }}>
            <div className="mono" style={{ fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--faint)", marginBottom: 4 }}>Pre-approved taxonomy playbook (source for the actions above)</div>
            <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>{playbook}</div>
          </div>
        )}

        <div className="mono" style={{ fontSize: 10.5, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--faint)", marginBottom: 8 }}>
          Decision — recorded to the audit trail
        </div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note for the audit trail…"
          rows={2}
          style={{ width: "100%", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", fontSize: 13, fontFamily: "inherit", marginBottom: 12, resize: "vertical" }}
        />
        <div style={{ display: "flex", gap: 10 }}>
          <button
            disabled={!!busy}
            onClick={() => act("approve")}
            className="df"
            style={{ flex: 1, background: "var(--blue)", color: "#fff", border: "none", borderRadius: 10, padding: "11px 0", fontWeight: 700, fontSize: 13.5, cursor: "pointer", opacity: busy && busy !== "approve" ? 0.5 : 1 }}
          >
            {busy === "approve" ? "Approving…" : "Approve"}
          </button>
          <button
            disabled={!!busy}
            onClick={() => act("override")}
            className="df"
            style={{ flex: 1, background: "#fff", color: "var(--ink)", border: "1px solid var(--line)", borderRadius: 10, padding: "11px 0", fontWeight: 700, fontSize: 13.5, cursor: "pointer", opacity: busy && busy !== "override" ? 0.5 : 1 }}
          >
            {busy === "override" ? "…" : "Override"}
          </button>
          <button
            disabled={!!busy}
            onClick={() => act("escalate")}
            className="df"
            style={{ flex: 1, background: "#fff", color: "var(--bad)", border: "1px solid #f3d4cf", borderRadius: 10, padding: "11px 0", fontWeight: 700, fontSize: 13.5, cursor: "pointer", opacity: busy && busy !== "escalate" ? 0.5 : 1 }}
          >
            {busy === "escalate" ? "…" : "Escalate"}
          </button>
        </div>
        {done && (
          <div className="mono" style={{ marginTop: 12, fontSize: 11.5, color: "var(--good)" }}>
            ✓ Recorded &ldquo;{done}&rdquo; to the audit trail.
          </div>
        )}
      </div>
    </div>
  );
}
