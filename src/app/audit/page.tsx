"use client";
import { useEffect, useState, useCallback } from "react";

type Entry = { id: string; ts: string; kind: string; summary: string };

const KIND_COLOR: Record<string, string> = {
  tag: "var(--muted)",
  alert_fired: "var(--bad)",
  alert_delivered: "var(--good)",
  alert_config: "var(--blue)",
  decision: "var(--navy)",
};

export default function AuditPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [filter, setFilter] = useState<string>("all");

  const refresh = useCallback(async () => {
    const res = await fetch("/api/state");
    const data = await res.json();
    setEntries(data.audit);
  }, []);
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [refresh]);

  const kinds = ["all", "tag", "alert_fired", "alert_delivered", "alert_config", "decision"];
  const shown = filter === "all" ? entries : entries.filter((e) => e.kind === filter);

  return (
    <div className="wrap" style={{ maxWidth: 1180, margin: "0 auto", padding: "30px 30px 90px" }}>
      <div className="mono" style={{ fontSize: 11.5, letterSpacing: ".2em", textTransform: "uppercase", color: "var(--faint)", marginBottom: 10 }}>Trust &amp; Governance</div>
      <h1 className="df" style={{ fontWeight: 800, fontSize: "clamp(28px,3.5vw,40px)", color: "var(--ink)", letterSpacing: "-.02em", marginBottom: 12 }}>
        Every signal, alert &amp; decision — <span style={{ color: "var(--blue)" }}>logged for examination.</span>
      </h1>
      <p style={{ fontSize: 15, color: "var(--muted)", maxWidth: 680, lineHeight: 1.55, marginBottom: 28 }}>
        A full, append-only audit trail: every interaction tagged, every alert fired and delivered, every configuration
        change, and every leader decision — timestamped, in order. This is the record an exam would ask for.
      </p>
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
