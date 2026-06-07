"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import Gauge from "@/components/Gauge";
import DecisionConsole, { type ConsoleAlert } from "@/components/DecisionConsole";
import taxonomyData from "@/data/taxonomy.json";

type ThemeStat = { theme: string; count_in_window: number; pct_in_window: number; baseline_pct: number };
type Aggregation = {
  cursor: number; total: number; window_size: number;
  overall_risk_pct: number; themes: ThemeStat[];
  top_theme: ThemeStat | null;
};
type RecentItem = {
  interaction_id: string; type: string; date: string;
  normalized: { canonical_statement: string; key_phrase: string };
  tag: { theme: string; l1: string; confidence: number };
  needs_review: boolean;
};

const THEME_COLORS = ["#006fcf", "#00175a", "#8fbbe8", "#1f9d6f", "#d97706", "#c0392b", "#63769b"];

function playbookFor(theme: string): string | null {
  const node = (taxonomyData as { theme: string; suggested_playbook: string | null }[]).find((t) => t.theme === theme);
  return node?.suggested_playbook ?? null;
}

export default function DashboardPage() {
  const [agg, setAgg] = useState<Aggregation | null>(null);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [alerts, setAlerts] = useState<ConsoleAlert[]>([]);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(2); // interactions per tick
  const [openAlert, setOpenAlert] = useState<ConsoleAlert | null>(null);
  const [flash, setFlash] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ tagged: number; total: number; latestTheme?: string } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/state");
    const data = await res.json();
    setAgg(data.aggregation);
    setRecent(data.recent);
    setAlerts(data.alerts);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const tick = useCallback(async () => {
    const res = await fetch("/api/replay/tick", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ n: speed }) });
    const data = await res.json();
    if (data.newAlerts?.length) {
      setFlash(true);
      setTimeout(() => setFlash(false), 900);
    }
    if (data.cursorAtEnd) setPlaying(false);
    await refresh();
  }, [speed, refresh]);

  useEffect(() => {
    if (playing) {
      timer.current = setInterval(tick, 1400);
    } else if (timer.current) {
      clearInterval(timer.current);
    }
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [playing, tick]);

  async function reset() {
    setPlaying(false);
    await fetch("/api/replay/reset", { method: "POST" });
    await refresh();
  }

  async function uploadDataset(file: File) {
    setPlaying(false);
    setUploading(true);
    setUploadMsg(null);
    setUploadProgress(null);
    try {
      // Phase 1: parse + validate the CSV and open a tagging session. Nothing
      // is tagged yet — this returns almost instantly with a row count.
      const fd = new FormData();
      fd.append("file", file);
      const startRes = await fetch("/api/dataset/upload", { method: "POST", body: fd });
      const start = await startRes.json();
      if (!startRes.ok) {
        setUploadMsg({ ok: false, text: start.error || "Upload failed." });
        return;
      }

      const tagSourceLabel = start.used_llm ? "live OpenAI (gpt-4o-mini)" : "heuristic fallback (set OPENAI_API_KEY for live tagging)";
      setUploadProgress({ tagged: 0, total: start.total });
      setUploadMsg({ ok: true, text: `Tagging "${start.filename}" via ${tagSourceLabel} — 0 / ${start.total} so far…` });

      // Phase 2: drive tagging in small batches so the UI updates as it goes,
      // instead of waiting on one all-at-once pass that can drop the connection.
      let final: Record<string, unknown> | null = null;
      for (;;) {
        const res = await fetch("/api/dataset/upload/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uploadId: start.uploadId }),
        });
        const data = await res.json();
        if (!res.ok) {
          setUploadMsg({ ok: false, text: data.error || "Tagging failed partway through — try again." });
          setUploadProgress(null);
          return;
        }

        const latestTheme = data.latest?.length ? data.latest[data.latest.length - 1].theme : undefined;
        setUploadProgress({ tagged: data.tagged ?? data.loaded ?? 0, total: data.total ?? start.total, latestTheme });
        setUploadMsg({
          ok: true,
          text: `Tagging "${start.filename}" via ${tagSourceLabel} — ${data.tagged ?? data.loaded} / ${data.total ?? start.total}` +
            (latestTheme ? ` · latest: ${latestTheme.split(" ").slice(0, 4).join(" ")}…` : "") +
            (data.needs_review ? ` · ${data.needs_review} flagged for review so far` : ""),
        });

        if (data.done) { final = data; break; }
        // Brief pause between batches keeps the UI smooth and is gentle on rate limits.
        await new Promise((r) => setTimeout(r, 250));
      }

      if (final) {
        setUploadMsg({
          ok: true,
          text: `Loaded ${final.loaded} interactions from "${final.filename}" — tagged via ${tagSourceLabel}, ${final.needs_review} flagged for review${final.truncated ? ` (file truncated to first ${final.truncated_to} rows)` : ""}${final.skipped_failures ? `, ${final.skipped_failures} rows skipped (tagging failures)` : ""}. Replay restarted.`,
        });
      }
    } catch {
      setUploadMsg({ ok: false, text: "Upload failed — check your connection and try again." });
    } finally {
      setUploading(false);
      setUploadProgress(null);
      if (fileInput.current) fileInput.current.value = "";
      await refresh();
    }
  }

  async function recordDecision(action: "approve" | "override" | "escalate", note: string) {
    if (!openAlert) return;
    await fetch("/api/decisions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alertId: openAlert.id, action, note }),
    });
    await refresh();
  }

  async function executeAction(actionId: string, path: "alert" | "automate" | "research", note: string) {
    if (!openAlert) return;
    const res = await fetch("/api/actions/execute", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alertId: openAlert.id, actionId, path, approver: "demo-approver@amex.com", note }),
    });
    const data = await res.json();
    await refresh();
    return data;
  }

  const progressPct = agg ? Math.round((agg.cursor / agg.total) * 100) : 0;

  return (
    <div className="wrap" style={{ maxWidth: 1180, margin: "0 auto", padding: "30px 30px 90px" }}>
      {/* Hero / control strip */}
      <div style={{ display: "grid", gridTemplateColumns: "1.1fr .9fr", gap: 28, alignItems: "start", marginBottom: 40 }}>
        <div>
          <div className="pill-live" style={{ background: "var(--b100)", border: "1px solid var(--b150)", padding: "7px 14px", borderRadius: 30, marginBottom: 20, display: "inline-flex" }}>
            Live CIE root-cause feed · simulated stream
          </div>
          <h1 className="df" style={{ fontWeight: 800, fontSize: "clamp(30px,4vw,46px)", lineHeight: 1.05, letterSpacing: "-.02em", color: "var(--ink)", marginBottom: 14 }}>
            From signal to action — <span style={{ color: "var(--blue)" }}>before it scales.</span>
          </h1>
          <p style={{ fontSize: 15.5, color: "var(--muted)", maxWidth: 460, lineHeight: 1.55, marginBottom: 24 }}>
            Every interaction&apos;s root cause (from the Customer Intelligence Engine) is normalized and tagged against the
            distilled enterprise risk taxonomy in real time. Cross a threshold, and the right people get notified — automatically.
          </p>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <button
              onClick={() => setPlaying((p) => !p)}
              className="df"
              style={{ background: playing ? "var(--ink)" : "var(--blue)", color: "#fff", border: "none", borderRadius: 10, padding: "11px 22px", fontWeight: 700, fontSize: 14, cursor: "pointer" }}
            >
              {playing ? "⏸ Pause stream" : "▶ Start live stream"}
            </button>
            <button onClick={() => tick()} className="df" style={{ background: "#fff", border: "1px solid var(--line)", color: "var(--ink)", borderRadius: 10, padding: "11px 18px", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
              Step ×{speed}
            </button>
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="mono" style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", fontSize: 12.5, color: "var(--text)" }}>
              <option value={1}>1 / tick</option>
              <option value={2}>2 / tick</option>
              <option value={5}>5 / tick</option>
              <option value={10}>10 / tick</option>
            </select>
            <button onClick={reset} className="mono" style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>
              reset replay
            </button>
            <span style={{ width: 1, height: 20, background: "var(--line)" }} />
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadDataset(f); }}
            />
            <button
              onClick={() => fileInput.current?.click()}
              disabled={uploading}
              className="mono"
              style={{ background: "#fff", border: "1px solid var(--line)", color: "var(--ink)", borderRadius: 10, padding: "9px 16px", fontSize: 12, cursor: uploading ? "default" : "pointer", fontWeight: 600 }}
              title="Load a different interaction-root-cause CSV — replaces the replay dataset and re-tags every row"
            >
              {uploading ? "Tagging upload…" : "⤴ Load different dataset (CSV)"}
            </button>
          </div>
          {agg && (
            <div className="mono" style={{ marginTop: 18, fontSize: 11.5, color: "var(--faint)" }}>
              {agg.cursor.toLocaleString()} / {agg.total.toLocaleString()} interactions replayed ({progressPct}%) · rolling window: last {agg.window_size}
            </div>
          )}
          {uploadProgress && uploadProgress.total > 0 && (
            <div style={{ marginTop: 10, maxWidth: 420 }}>
              <span className="barTrack" style={{ display: "block" }}>
                <span
                  className="barFill"
                  style={{
                    width: `${Math.min(100, Math.round((uploadProgress.tagged / uploadProgress.total) * 100))}%`,
                    background: "var(--blue)",
                    transition: "width .3s ease",
                  }}
                />
              </span>
              <div className="mono" style={{ marginTop: 4, fontSize: 10.5, color: "var(--faint)" }}>
                {uploadProgress.tagged} / {uploadProgress.total} tagged ({Math.round((uploadProgress.tagged / uploadProgress.total) * 100)}%) — streaming in batches of 10
              </div>
            </div>
          )}
          {uploadMsg && (
            <div className="mono" style={{ marginTop: 10, fontSize: 11.5, lineHeight: 1.6, color: uploadMsg.ok ? "var(--good)" : "var(--bad)", maxWidth: 560 }}>
              {uploadMsg.ok ? "✓ " : "✗ "}{uploadMsg.text}
            </div>
          )}
          <div className="mono" style={{ marginTop: 8, fontSize: 10.5, color: "var(--faint)", maxWidth: 560, lineHeight: 1.6 }}>
            CSV columns expected: interaction_id, type, date, root_cause — each row is normalized and tagged against the taxonomy (live OpenAI if OPENAI_API_KEY is configured, heuristic fallback otherwise) before replacing the replay feed.
          </div>
        </div>

        <div className="card" style={{ padding: "22px 24px 18px", position: "relative", overflow: "hidden" }}
          >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <span className="df" style={{ fontWeight: 700, fontSize: 14, color: "var(--ink)" }}>Live Risk Surveillance</span>
            <span className="pill-live">Streaming</span>
          </div>
          <Gauge value={agg?.overall_risk_pct ?? 0} label={agg?.top_theme ? `${agg.top_theme.theme.split(" ").slice(0, 3).join(" ")}…` : "Awaiting signal"} />
          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 9 }}>
            {(agg?.themes ?? []).slice(0, 4).map((t, i) => (
              <div key={t.theme} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ flex: "0 0 150px", fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.theme}>
                  {t.theme}
                </span>
                <span className="barTrack" style={{ flex: 1 }}>
                  <span className="barFill" style={{ width: `${Math.min(100, t.pct_in_window * 4)}%`, background: THEME_COLORS[i % THEME_COLORS.length] }} />
                </span>
                <span className="mono" style={{ fontSize: 11.5, minWidth: 42, textAlign: "right", color: "var(--navy)" }}>{t.pct_in_window.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Active alerts */}
      <section style={{ marginBottom: 40 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14 }}>
          <h2 className="df" style={{ fontWeight: 800, fontSize: 22, color: "var(--ink)" }}>Active alerts</h2>
          <span className="mono" style={{ fontSize: 11, color: "var(--faint)" }}>{alerts.length} fired this session</span>
          {flash && <span className="mono" style={{ fontSize: 11, color: "var(--bad)", animation: "lv 1s" }}>● new alert</span>}
        </div>
        {!alerts.length && (
          <div className="card" style={{ padding: "26px 24px", color: "var(--muted)", fontSize: 14 }}>
            No alerts yet — start the live stream to begin detecting signals against your configured thresholds.
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {alerts.map((a) => (
            <button
              key={a.id}
              onClick={() => setOpenAlert(a)}
              className="card"
              style={{ textAlign: "left", padding: "16px 18px", display: "flex", alignItems: "center", gap: 16, cursor: "pointer", border: a.severity === "high" ? "1px solid #f3d4cf" : "1px solid var(--line)" }}
            >
              <span className="mono" style={{
                fontSize: 9.5, letterSpacing: ".1em", textTransform: "uppercase", padding: "4px 9px", borderRadius: 6, color: "#fff",
                background: a.severity === "high" ? "var(--bad)" : a.severity === "medium" ? "var(--blue)" : "var(--muted)", flex: "none",
              }}>{a.type}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="df" style={{ fontWeight: 700, fontSize: 14.5, color: "var(--ink)", display: "block" }}>{a.theme}</span>
                <span style={{ fontSize: 12.5, color: "var(--muted)", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.message}</span>
              </span>
              <span className="mono" style={{ fontSize: 11, color: a.delivered ? "var(--good)" : "var(--warn)", flex: "none" }}>
                {a.delivered ? "✓ emailed" : "sending…"}
              </span>
              <span className="mono" style={{ fontSize: 11, color: "var(--faint)", flex: "none" }}>
                {new Date(a.fired_at).toLocaleTimeString()}
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Recent feed */}
      <section>
        <h2 className="df" style={{ fontWeight: 800, fontSize: 22, color: "var(--ink)", marginBottom: 14 }}>Live feed — latest tagged interactions</h2>
        <div className="card" style={{ overflow: "hidden" }}>
          {recent.map((r, i) => (
            <div key={r.interaction_id} style={{ display: "flex", gap: 14, padding: "13px 18px", borderBottom: i < recent.length - 1 ? "1px solid var(--line2)" : "none", alignItems: "center" }}>
              <span className="mono" style={{ fontSize: 10, color: "var(--faint)", flex: "0 0 64px" }}>{r.interaction_id.slice(-8)}</span>
              <span style={{ flex: 1, fontSize: 13, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.normalized.canonical_statement}</span>
              <span className="mono" style={{ fontSize: 10.5, color: "var(--blue)", flex: "0 0 230px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "right" }} title={r.tag.theme}>
                {r.tag.theme.split(" ").slice(0, 4).join(" ")}…
              </span>
              <span className="mono" style={{ fontSize: 10, color: "var(--muted)", flex: "0 0 60px", textAlign: "right" }}>conf {r.tag.confidence}</span>
              {r.needs_review && (
                <span className="mono" style={{ fontSize: 9, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--warn)", background: "#fdf3e3", padding: "3px 7px", borderRadius: 5, flex: "none" }}>
                  needs review
                </span>
              )}
            </div>
          ))}
          {!recent.length && <div style={{ padding: "26px 18px", color: "var(--muted)", fontSize: 14 }}>Stream hasn&apos;t started — click &ldquo;Start live stream&rdquo; to begin replaying interactions.</div>}
        </div>
      </section>

      {openAlert && (
        <DecisionConsole
          alert={openAlert}
          playbook={playbookFor(openAlert.theme)}
          onClose={() => setOpenAlert(null)}
          onDecision={recordDecision}
          onExecuteAction={executeAction}
        />
      )}
    </div>
  );
}
