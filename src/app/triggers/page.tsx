"use client";
import { useEffect, useState, useCallback } from "react";
import { themes } from "@/lib/taxonomy";

type EventType = "platinum_refresh" | "product_launch" | "policy_change" | "rate_move" | "weather_event" | "fee_update";
type Monitor = {
  id: string; event_type: EventType; label: string; theme: string;
  sensitivity_multiplier: number; recipients: string[]; armed: boolean;
  created_at: string; expires_at: string;
};

const EVENT_INFO: Record<EventType, { title: string; example: string }> = {
  platinum_refresh: { title: "Platinum card refresh", example: "e.g. an annual-fee or benefits refresh landing for a cohort" },
  product_launch: { title: "Product launch", example: "e.g. a new card product or feature rolling out" },
  policy_change: { title: "Policy / terms change", example: "e.g. updated terms, fees, or servicing policy taking effect" },
  rate_move: { title: "Interest rate move", example: "e.g. a Fed move that ripples into APR-linked products" },
  weather_event: { title: "Severe weather event", example: "e.g. a storm or disaster disrupting a region's payments/travel" },
  fee_update: { title: "Fee schedule update", example: "e.g. a foreign-transaction or late-fee schedule change" },
};

function timeLeft(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  if (days > 0) return `${days}d ${hours}h left`;
  return `${hours}h left`;
}

export default function TriggerStudioPage() {
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [eventType, setEventType] = useState<EventType>("platinum_refresh");
  const [label, setLabel] = useState("");
  const [theme, setTheme] = useState(themes[0]);
  const [sensitivity, setSensitivity] = useState(1.5);
  const [days, setDays] = useState(7);
  const [recipients, setRecipients] = useState("");
  const [arming, setArming] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/triggers/config");
    const data = await res.json();
    setMonitors(data.monitors ?? []);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  async function arm() {
    setArming(true);
    const recips = recipients.split(",").map((r) => r.trim()).filter(Boolean);
    await fetch("/api/triggers/config", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_type: eventType, label, theme, sensitivity_multiplier: sensitivity, recipients: recips, days }),
    });
    setLabel("");
    setRecipients("");
    setArming(false);
    await refresh();
  }

  async function disarm(id: string) {
    await fetch("/api/triggers/config", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    await refresh();
  }

  const active = monitors.filter((m) => m.armed && new Date(m.expires_at).getTime() > Date.now());
  const inactive = monitors.filter((m) => !m.armed || new Date(m.expires_at).getTime() <= Date.now());

  return (
    <div className="wrap" style={{ maxWidth: 1180, margin: "0 auto", padding: "30px 30px 90px" }}>
      <div className="mono" style={{ fontSize: 11.5, letterSpacing: ".2em", textTransform: "uppercase", color: "var(--faint)", marginBottom: 10 }}>Trigger Studio · Anticipate</div>
      <h1 className="df" style={{ fontWeight: 800, fontSize: "clamp(28px,3.5vw,40px)", color: "var(--ink)", letterSpacing: "-.02em", marginBottom: 12 }}>
        Pre-arm sensitivity <span style={{ color: "var(--blue)" }}>ahead of known events.</span>
      </h1>
      <p style={{ fontSize: 15, color: "var(--muted)", maxWidth: 720, lineHeight: 1.55, marginBottom: 36 }}>
        Standing alerts react after a theme crosses its threshold. Trigger Studio lets you go further: when you know an event
        is coming — a Platinum refresh, a rate move, a policy change — arm a time-boxed monitor that temporarily raises
        detection sensitivity for the theme it&apos;s likely to touch. Armed monitors lower the effective threshold (current ×
        sensitivity) and can even catch a brand-new pattern on a theme with no standing alert configured — an
        &ldquo;anticipatory catch&rdquo; the standing rules alone would have missed. Monitors auto-disarm when their window expires.
      </p>

      {/* Event-type explainer */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 40 }}>
        {(Object.keys(EVENT_INFO) as EventType[]).map((e) => (
          <div key={e} className="card" style={{ padding: "15px 17px" }}>
            <div className="df" style={{ fontWeight: 700, fontSize: 13.5, color: "var(--ink)", marginBottom: 4 }}>{EVENT_INFO[e].title}</div>
            <div style={{ fontSize: 11.5, color: "var(--muted)", lineHeight: 1.45 }}>{EVENT_INFO[e].example}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.15fr", gap: 28 }}>
        {/* Arm a new monitor */}
        <div>
          <h2 className="df" style={{ fontWeight: 800, fontSize: 19, color: "var(--ink)", marginBottom: 14 }}>Arm a new monitor</h2>
          <div className="card" style={{ padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
            <label style={{ fontSize: 12.5, color: "var(--muted)" }}>
              Event type
              <select value={eventType} onChange={(e) => setEventType(e.target.value as EventType)} style={{ display: "block", width: "100%", marginTop: 5, border: "1px solid var(--line)", borderRadius: 9, padding: "9px 10px", fontSize: 13 }}>
                {(Object.keys(EVENT_INFO) as EventType[]).map((e) => <option key={e} value={e}>{EVENT_INFO[e].title}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 12.5, color: "var(--muted)" }}>
              Label (optional — defaults to event type)
              <input type="text" placeholder="e.g. Platinum refresh — Q4 cohort" value={label} onChange={(e) => setLabel(e.target.value)} style={{ display: "block", width: "100%", marginTop: 5, border: "1px solid var(--line)", borderRadius: 9, padding: "9px 10px", fontSize: 13 }} />
            </label>
            <label style={{ fontSize: 12.5, color: "var(--muted)" }}>
              Taxonomy theme to scope the monitor to
              <select value={theme} onChange={(e) => setTheme(e.target.value)} style={{ display: "block", width: "100%", marginTop: 5, border: "1px solid var(--line)", borderRadius: 9, padding: "9px 10px", fontSize: 13 }}>
                {themes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 12.5, color: "var(--muted)" }}>
              Sensitivity multiplier — effective threshold = standing threshold ÷ this
              <input type="number" min={1.1} max={5} step={0.1} value={sensitivity} onChange={(e) => setSensitivity(Number(e.target.value))} style={{ display: "block", width: "100%", marginTop: 5, border: "1px solid var(--line)", borderRadius: 9, padding: "9px 10px", fontSize: 13 }} />
            </label>
            <label style={{ fontSize: 12.5, color: "var(--muted)" }}>
              Active window — days until auto-disarm
              <input type="number" min={1} max={30} value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ display: "block", width: "100%", marginTop: 5, border: "1px solid var(--line)", borderRadius: 9, padding: "9px 10px", fontSize: 13 }} />
            </label>
            <label style={{ fontSize: 12.5, color: "var(--muted)" }}>
              Notify — email recipients (comma-separated, optional)
              <input type="text" placeholder="leader@amex.com, ops-lead@amex.com" value={recipients} onChange={(e) => setRecipients(e.target.value)} style={{ display: "block", width: "100%", marginTop: 5, border: "1px solid var(--line)", borderRadius: 9, padding: "9px 10px", fontSize: 13 }} />
            </label>
            <button onClick={arm} disabled={arming} className="df" style={{ background: "var(--blue)", color: "#fff", border: "none", borderRadius: 10, padding: "11px 0", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
              {arming ? "Arming…" : "Arm monitor"}
            </button>
          </div>
        </div>

        {/* Active / past monitors */}
        <div>
          <h2 className="df" style={{ fontWeight: 800, fontSize: 19, color: "var(--ink)", marginBottom: 14 }}>
            Armed monitors <span className="mono" style={{ fontSize: 12, color: "var(--faint)", fontWeight: 400 }}>({active.length} active)</span>
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: inactive.length ? 28 : 0 }}>
            {active.map((m) => (
              <div key={m.id} className="card" style={{ padding: "16px 18px", border: "1px solid var(--b150)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span className="mono" style={{ fontSize: 9, letterSpacing: ".08em", textTransform: "uppercase", padding: "3px 8px", borderRadius: 6, background: "var(--b100)", color: "var(--blue)" }}>
                        {EVENT_INFO[m.event_type].title}
                      </span>
                      <span className="mono" style={{ fontSize: 10.5, color: "var(--good)" }}>● armed · {timeLeft(m.expires_at)}</span>
                    </div>
                    <div className="df" style={{ fontWeight: 700, fontSize: 14, color: "var(--ink)" }}>{m.label}</div>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={m.theme}>
                      scoped to: {m.theme}
                    </div>
                    <div className="mono" style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 4 }}>
                      {m.sensitivity_multiplier}× sensitivity · armed {new Date(m.created_at).toLocaleString()} · expires {new Date(m.expires_at).toLocaleDateString()}
                      {m.recipients.length ? ` · notifies ${m.recipients.join(", ")}` : ""}
                    </div>
                  </div>
                  <button onClick={() => disarm(m.id)} className="mono" style={{ flex: "none", fontSize: 11, color: "var(--bad)", background: "none", border: "1px solid #f3d4cf", borderRadius: 8, padding: "6px 12px", cursor: "pointer" }}>
                    Disarm
                  </button>
                </div>
              </div>
            ))}
            {!active.length && <div className="card" style={{ padding: 20, color: "var(--muted)", fontSize: 13 }}>No monitors armed — use the form to pre-arm sensitivity ahead of an upcoming event.</div>}
          </div>

          {!!inactive.length && (
            <>
              <div className="mono" style={{ fontSize: 11, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--faint)", marginBottom: 10 }}>Disarmed / expired</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {inactive.map((m) => (
                  <div key={m.id} className="card" style={{ padding: "12px 16px", opacity: 0.6, boxShadow: "none" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 13, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {m.label} <span className="mono" style={{ color: "var(--faint)", fontSize: 11 }}>· {m.theme.split(" ").slice(0, 5).join(" ")}…</span>
                      </span>
                      <span className="mono" style={{ fontSize: 10.5, color: "var(--faint)", flex: "none" }}>{m.armed ? "expired" : "disarmed"}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
