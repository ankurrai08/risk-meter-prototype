"use client";
import { useEffect, useState, useCallback } from "react";
import { themes } from "@/lib/taxonomy";

type AlertType = "threshold" | "spike" | "emerging";
type Config = {
  id: string; theme: string; type: AlertType; threshold_pct: number;
  spike_multiplier?: number; severity: "low" | "medium" | "high";
  channel: string; recipients: string[]; enabled: boolean; created_at: string;
};

const TYPE_INFO: Record<AlertType, { title: string; desc: string }> = {
  threshold: {
    title: "Threshold breach",
    desc: "Fires when a taxonomy theme's rolling share of interactions crosses a fixed % you configure — the core Risk Meter alert.",
  },
  spike: {
    title: "Spike / anomaly",
    desc: "Fires when a theme suddenly jumps to N× its trailing baseline rate — catches rate-of-change, not just absolute level.",
  },
  emerging: {
    title: "Emerging / unmapped pattern",
    desc: "System-detected: a recurring root-cause cluster that doesn't map confidently to any existing taxonomy node — surfaces novel risks rules would miss. No configuration needed; the system raises these on its own.",
  },
};

export default function AlertStudioPage() {
  const [configs, setConfigs] = useState<Config[]>([]);
  const [theme, setTheme] = useState(themes[0]);
  const [type, setType] = useState<AlertType>("threshold");
  const [thresholdPct, setThresholdPct] = useState(10);
  const [spikeMult, setSpikeMult] = useState(2);
  const [severity, setSeverity] = useState<"low" | "medium" | "high">("medium");
  const [recipients, setRecipients] = useState("");
  const [creating, setCreating] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [testStatus, setTestStatus] = useState<string | null>(null);
  const [testBusy, setTestBusy] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/alerts/config");
    const data = await res.json();
    setConfigs(data.configs);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  async function createConfig() {
    setCreating(true);
    const recips = recipients.split(",").map((r) => r.trim()).filter(Boolean);
    await fetch("/api/alerts/config", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme, type, threshold_pct: thresholdPct, spike_multiplier: spikeMult, severity, recipients: recips }),
    });
    setRecipients("");
    setCreating(false);
    await refresh();
  }

  async function toggle(id: string, enabled: boolean) {
    await fetch("/api/alerts/config", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, enabled }) });
    await refresh();
  }

  async function sendTest() {
    setTestBusy(true);
    setTestStatus(null);
    const recips = testEmail.split(",").map((r) => r.trim()).filter(Boolean);
    const res = await fetch("/api/alerts/test-email", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipients: recips }),
    });
    const data = await res.json();
    setTestBusy(false);
    if (data.error) setTestStatus(`✕ ${data.error}`);
    else if (data.result?.simulated) setTestStatus("✓ Simulated send (no RESEND_API_KEY configured) — logged server-side as if delivered. Add RESEND_API_KEY to send real emails.");
    else if (data.result?.ok) setTestStatus(`✓ Sent via Resend (id: ${data.result.providerId})`);
    else setTestStatus(`✕ ${data.result?.error || "Send failed"}`);
  }

  return (
    <div className="wrap" style={{ maxWidth: 1180, margin: "0 auto", padding: "30px 30px 90px" }}>
      <div className="mono" style={{ fontSize: 11.5, letterSpacing: ".2em", textTransform: "uppercase", color: "var(--faint)", marginBottom: 10 }}>Alert Studio</div>
      <h1 className="df" style={{ fontWeight: 800, fontSize: "clamp(28px,3.5vw,40px)", color: "var(--ink)", letterSpacing: "-.02em", marginBottom: 12 }}>
        Configure how — and to whom — <span style={{ color: "var(--blue)" }}>signals become alerts.</span>
      </h1>
      <p style={{ fontSize: 15, color: "var(--muted)", maxWidth: 680, lineHeight: 1.55, marginBottom: 36 }}>
        Three alert types cover the range leaders need: a fixed threshold for known risk levels, a spike detector for sudden
        rate-of-change, and a system-raised alert for patterns that don&apos;t fit the existing taxonomy yet. Configure
        threshold and spike alerts below — emerging-pattern alerts are detected and routed automatically.
      </p>

      {/* Type explainer */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 40 }}>
        {(Object.keys(TYPE_INFO) as AlertType[]).map((t) => (
          <div key={t} className="card" style={{ padding: "18px 20px" }}>
            <div className="mono" style={{ fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--blue)", marginBottom: 6 }}>{t}</div>
            <div className="df" style={{ fontWeight: 700, fontSize: 15.5, color: "var(--ink)", marginBottom: 6 }}>{TYPE_INFO[t].title}</div>
            <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5 }}>{TYPE_INFO[t].desc}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28 }}>
        {/* Configure new alert */}
        <div>
          <h2 className="df" style={{ fontWeight: 800, fontSize: 19, color: "var(--ink)", marginBottom: 14 }}>New alert configuration</h2>
          <div className="card" style={{ padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
            <label style={{ fontSize: 12.5, color: "var(--muted)" }}>
              Taxonomy theme
              <select value={theme} onChange={(e) => setTheme(e.target.value)} style={{ display: "block", width: "100%", marginTop: 5, border: "1px solid var(--line)", borderRadius: 9, padding: "9px 10px", fontSize: 13 }}>
                {themes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 12.5, color: "var(--muted)" }}>
              Alert type
              <select value={type} onChange={(e) => setType(e.target.value as AlertType)} style={{ display: "block", width: "100%", marginTop: 5, border: "1px solid var(--line)", borderRadius: 9, padding: "9px 10px", fontSize: 13 }}>
                <option value="threshold">Threshold breach</option>
                <option value="spike">Spike / anomaly</option>
              </select>
            </label>
            {type === "threshold" ? (
              <label style={{ fontSize: 12.5, color: "var(--muted)" }}>
                Threshold — fire when rolling share ≥ this %
                <input type="number" min={1} max={100} value={thresholdPct} onChange={(e) => setThresholdPct(Number(e.target.value))} style={{ display: "block", width: "100%", marginTop: 5, border: "1px solid var(--line)", borderRadius: 9, padding: "9px 10px", fontSize: 13 }} />
              </label>
            ) : (
              <label style={{ fontSize: 12.5, color: "var(--muted)" }}>
                Spike multiplier — fire when current rate ≥ baseline × this
                <input type="number" min={1.2} max={10} step={0.1} value={spikeMult} onChange={(e) => setSpikeMult(Number(e.target.value))} style={{ display: "block", width: "100%", marginTop: 5, border: "1px solid var(--line)", borderRadius: 9, padding: "9px 10px", fontSize: 13 }} />
              </label>
            )}
            <label style={{ fontSize: 12.5, color: "var(--muted)" }}>
              Severity
              <select value={severity} onChange={(e) => setSeverity(e.target.value as "low" | "medium" | "high")} style={{ display: "block", width: "100%", marginTop: 5, border: "1px solid var(--line)", borderRadius: 9, padding: "9px 10px", fontSize: 13 }}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
            <label style={{ fontSize: 12.5, color: "var(--muted)" }}>
              Delivery — email recipients (comma-separated)
              <input type="text" placeholder="leader@amex.com, ops-lead@amex.com" value={recipients} onChange={(e) => setRecipients(e.target.value)} style={{ display: "block", width: "100%", marginTop: 5, border: "1px solid var(--line)", borderRadius: 9, padding: "9px 10px", fontSize: 13 }} />
            </label>
            <button onClick={createConfig} disabled={creating} className="df" style={{ background: "var(--blue)", color: "#fff", border: "none", borderRadius: 10, padding: "11px 0", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
              {creating ? "Saving…" : "Save alert configuration"}
            </button>
          </div>

          {/* Test email */}
          <h2 className="df" style={{ fontWeight: 800, fontSize: 19, color: "var(--ink)", margin: "28px 0 14px" }}>Test delivery</h2>
          <div className="card" style={{ padding: 22 }}>
            <p style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 12, lineHeight: 1.5 }}>
              Send a sample alert email to confirm delivery is wired correctly before relying on it live.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <input type="text" placeholder="you@amex.com" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} style={{ flex: 1, border: "1px solid var(--line)", borderRadius: 9, padding: "9px 10px", fontSize: 13 }} />
              <button onClick={sendTest} disabled={testBusy} className="df" style={{ background: "var(--ink)", color: "#fff", border: "none", borderRadius: 9, padding: "9px 18px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                {testBusy ? "Sending…" : "Send test"}
              </button>
            </div>
            {testStatus && <div className="mono" style={{ fontSize: 11.5, marginTop: 10, color: testStatus.startsWith("✓") ? "var(--good)" : "var(--bad)", lineHeight: 1.5 }}>{testStatus}</div>}
          </div>
        </div>

        {/* Existing configs */}
        <div>
          <h2 className="df" style={{ fontWeight: 800, fontSize: 19, color: "var(--ink)", marginBottom: 14 }}>Configured alerts ({configs.length})</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {configs.map((c) => (
              <div key={c.id} className="card" style={{ padding: "16px 18px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="df" style={{ fontWeight: 700, fontSize: 14, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.theme}</div>
                    <div className="mono" style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                      {c.type === "threshold" ? `fires at ≥ ${c.threshold_pct}%` : `fires at ≥ ${c.spike_multiplier}× baseline`} · {c.severity} severity
                    </div>
                    <div className="mono" style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 4 }}>
                      → {c.recipients.length ? c.recipients.join(", ") : "(no recipients — add some to enable delivery)"}
                    </div>
                  </div>
                  <label className="mono" style={{ fontSize: 10.5, color: c.enabled ? "var(--good)" : "var(--faint)", display: "flex", alignItems: "center", gap: 6, cursor: "pointer", flex: "none" }}>
                    <input type="checkbox" checked={c.enabled} onChange={(e) => toggle(c.id, e.target.checked)} />
                    {c.enabled ? "armed" : "disarmed"}
                  </label>
                </div>
              </div>
            ))}
            {!configs.length && <div className="card" style={{ padding: 20, color: "var(--muted)", fontSize: 13 }}>No alerts configured yet.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
