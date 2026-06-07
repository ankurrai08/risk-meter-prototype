"use client";
import { useState } from "react";

type Evidence = { interaction_id: string; type: string; date: string; normalized: { canonical_statement: string; key_phrase: string }; tag: { confidence: number } };
export type ConsoleAlert = {
  id: string;
  theme: string;
  type: string;
  severity: "low" | "medium" | "high";
  current_pct: number;
  threshold_pct: number | null;
  message: string;
  evidence: Evidence[];
  fired_at: string;
  delivered: boolean;
  delivery_error?: string;
};

const SEV_COLOR: Record<string, string> = { low: "var(--muted)", medium: "var(--blue)", high: "var(--bad)" };

export default function DecisionConsole({
  alert,
  playbook,
  onClose,
  onDecision,
}: {
  alert: ConsoleAlert;
  playbook: string | null;
  onClose: () => void;
  onDecision: (action: "approve" | "override" | "escalate", note: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function act(action: "approve" | "override" | "escalate") {
    setBusy(action);
    await onDecision(action, note);
    setBusy(null);
    setDone(action);
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,23,90,.35)", backdropFilter: "blur(2px)" }} />
      <div className="card" style={{ position: "relative", width: 480, maxWidth: "92vw", height: "100%", borderRadius: 0, overflowY: "auto", padding: "28px 28px 40px" }}>
        <button onClick={onClose} className="mono" style={{ position: "absolute", top: 22, right: 24, background: "none", border: "none", color: "var(--muted)", fontSize: 13, cursor: "pointer" }}>
          close ✕
        </button>
        <div className="mono" style={{ fontSize: 10.5, letterSpacing: ".14em", textTransform: "uppercase", color: SEV_COLOR[alert.severity], marginBottom: 8 }}>
          {alert.severity} severity · {alert.type} alert
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
          Evidence — sample canonical root causes
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 22 }}>
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

        {playbook && (
          <div style={{ background: "var(--b50)", border: "1px solid var(--b150)", borderRadius: 12, padding: "14px 16px", marginBottom: 22 }}>
            <div className="mono" style={{ fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--blue)", marginBottom: 4 }}>Suggested playbook</div>
            <div style={{ fontSize: 13.5, color: "var(--text)", lineHeight: 1.5 }}>{playbook}</div>
          </div>
        )}

        <div className="mono" style={{ fontSize: 10.5, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--faint)", marginBottom: 8 }}>
          Decision
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
            {busy === "approve" ? "Approving…" : "Approve playbook"}
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
            ✓ Recorded "{done}" to the audit trail.
          </div>
        )}
      </div>
    </div>
  );
}
