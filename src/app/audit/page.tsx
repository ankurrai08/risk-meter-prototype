"use client";
import { useEffect, useState, useCallback } from "react";

type Entry = { id: string; ts: string; kind: string; summary: string };
type Governance = { redactedCount: number; redactionTotals: Record<string, number>; itemsSeen: number; needsReviewCount: number };

const KIND_COLOR: Record<string, string> = {
  tag: "var(--muted)",
  redaction: "#8b5cf6",
  alert_fired: "var(--bad)",
  alert_delivered: "var(--good)",
  alert_config: "var(--blue)",
  decision: "var(--navy)",
  trigger_armed: "#1f9d6f",
  trigger_expired: "var(--faint)",
  action_taken: "var(--blue)",
  outcome: "#d97706",
};

const ENTITY_LABEL: Record<string, string> = {
  card_number: "Card numbers",
  ssn: "SSNs",
  email: "Email addresses",
  phone: "Phone numbers",
  account_number: "Account numbers",
  person_name: "Person names",
};

export default function AuditPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [gov, setGov] = useState<Governance | null>(null);
  const [filter, setFilter] = useState<string>("all");

  const refresh = useCallback(async () => {
    const res = await fetch("/api/state");
    const data = await res.json();
    setEntries(data.audit);
    setGov(data.governance ?? null);
  }, []);
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [refresh]);

  const kinds = ["all", "tag", "redaction", "alert_fired", "alert_delivered", "alert_config", "decision", "trigger_armed", "trigger_expired", "action_taken", "outcome"];
  const shown = filter === "all" ? entries : entries.filter((e) => e.kind === filter);
  const entityRows = gov ? Object.entries(gov.redactionTotals).sort((a, b) => b[1] - a[1]) : [];
  const maxEntity = entityRows.length ? Math.max(...entityRows.map(([, v]) => v)) : 1;

  return (
    <div className="wrap" style={{ maxWidth: 1180, margin: "0 auto", padding: "30px 30px 90px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
        <span className="mono" style={{ fontSize: 11.5, letterSpacing: ".2em", textTransform: "uppercase", color: "var(--faint)" }}>Trust &amp; Governance</span>
        <span className="mono" style={{ fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--blue)", background: "var(--b100)", border: "1px solid var(--b150)", borderRadius: 20, padding: "4px 11px" }}>
          ◐ Shadow Mode — recommends, never auto-acts
        </span>
      </div>
      <h1 className="df" style={{ fontWeight: 800, fontSize: "clamp(28px,3.5vw,40px)", color: "var(--ink)", letterSpacing: "-.02em", marginBottom: 12 }}>
        Every signal, alert &amp; decision — <span style={{ color: "var(--blue)" }}>logged for examination.</span>
      </h1>
      <p style={{ fontSize: 15, color: "var(--muted)", maxWidth: 700, lineHeight: 1.55, marginBottom: 12 }}>
        A full, append-only audit trail: every interaction tagged, every PII redaction performed, every alert fired and
        delivered, every trigger armed, every action taken and its measured outcome, and every leader decision —
        timestamped, in order. This is the record an exam would ask for.
      </p>
      <p style={{ fontSize: 13, color: "var(--muted)", maxWidth: 700, lineHeight: 1.55, marginBottom: 28 }}>
        <strong style={{ color: "var(--ink)" }}>Shadow Mode</strong> means the system only ever <em>recommends</em> —
        every Action Engine path requires an explicit human Approve/Override/Escalate before anything is dispatched.
        Nothing fires without a named approver landing in this trail.
      </p>

      {/* Impact tiles */}
      {gov && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 28 }}>
          <div className="card" style={{ padding: "16px 18px" }}>
            <div className="df" style={{ fontWeight: 800, fontSize: 26, color: "var(--ink)" }}>{gov.itemsSeen.toLocaleString()}</div>
            <div className="mono" style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".06em", marginTop: 2 }}>interactions processed</div>
          </div>
          <div className="card" style={{ padding: "16px 18px" }}>
            <div className="df" style={{ fontWeight: 800, fontSize: 26, color: "#8b5cf6" }}>{gov.redactedCount.toLocaleString()}</div>
            <div className="mono" style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".06em", marginTop: 2 }}>items with PII redacted before model input</div>
          </div>
          <div className="card" style={{ padding: "16px 18px" }}>
            <div className="df" style={{ fontWeight: 800, fontSize: 26, color: "var(--warn)" }}>{gov.needsReviewCount.toLocaleString()}</div>
            <div className="mono" style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".06em", marginTop: 2 }}>flagged &ldquo;needs human review&rdquo;</div>
          </div>
          <div className="card" style={{ padding: "16px 18px" }}>
            <div className="df" style={{ fontWeight: 800, fontSize: 26, color: "var(--ink)" }}>{entries.length.toLocaleString()}</div>
            <div className="mono" style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".06em", marginTop: 2 }}>audit entries this session</div>
          </div>
        </div>
      )}

      {/* PII posture panel */}
      {gov && (
        <div className="card" style={{ padding: "20px 22px", marginBottom: 32 }}>
          <div className="df" style={{ fontWeight: 800, fontSize: 16, color: "var(--ink)", marginBottom: 4 }}>PII / PHI posture — Stage 0 redaction gate</div>
          <p style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5, marginBottom: 14, maxWidth: 640 }}>
            Before any root-cause text reaches a model, a deterministic regex layer detects and tokenizes sensitive entities
            (e.g. <span className="mono" style={{ fontSize: 11 }}>[CARD_0001]</span>) — actual values are never logged, only entity-type counts. Name detection is
            stubbed behind the same interface for a future NER upgrade.
          </p>
          {entityRows.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 520 }}>
              {entityRows.map(([type, count]) => (
                <div key={type} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ flex: "0 0 140px", fontSize: 12, color: "var(--text)" }}>{ENTITY_LABEL[type] ?? type}</span>
                  <span className="barTrack" style={{ flex: 1, height: 7 }}>
                    <span className="barFill" style={{ width: `${Math.max(4, (count / maxEntity) * 100)}%`, background: "#8b5cf6" }} />
                  </span>
                  <span className="mono" style={{ fontSize: 11, minWidth: 28, textAlign: "right", color: "var(--faint)" }}>{count}</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 12.5, color: "var(--muted)" }}>No PII detected yet in this session&apos;s replayed interactions.</div>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
        {kinds.map((k) => (
          <button key={k} onClick={() => setFilter(k)} className="mono"
            style={{
              fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", padding: "7px 14px", borderRadius: 18,
              border: "1px solid " + (filter === k ? "var(--blue)" : "var(--line)"),
              background: filter === k ? "var(--blue)" : "#fff",
              color: filter === k ? "#fff" : "var(--muted)", cursor: "pointer",
            }}>
            {k.replace("_", " ")}
          </button>
        ))}
      </div>
      <div className="card" style={{ overflow: "hidden" }}>
        {shown.map((e, i) => (
          <div key={e.id} style={{ display: "flex", gap: 14, padding: "12px 18px", borderBottom: i < shown.length - 1 ? "1px solid var(--line2)" : "none", alignItems: "flex-start" }}>
            <span className="mono" style={{ fontSize: 10.5, color: "var(--faint)", flex: "0 0 78px", paddingTop: 2 }}>{new Date(e.ts).toLocaleTimeString()}</span>
            <span className="mono" style={{
              fontSize: 9, letterSpacing: ".08em", textTransform: "uppercase", color: "#fff",
              background: KIND_COLOR[e.kind] || "var(--muted)", padding: "3px 8px", borderRadius: 5, flex: "0 0 auto", marginTop: 1,
            }}>{e.kind.replace("_", " ")}</span>
            <span style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}>{e.summary}</span>
          </div>
        ))}
        {!shown.length && <div style={{ padding: "26px 18px", color: "var(--muted)", fontSize: 14 }}>No audit entries yet — start the live stream on the dashboard.</div>}
      </div>
    </div>
  );
}
