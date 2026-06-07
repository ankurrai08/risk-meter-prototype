import { NextResponse } from "next/server";
import { store } from "@/lib/store";
import { sendAlertEmail } from "@/lib/email";
import { taxonomy } from "@/lib/taxonomy";

// Manually (re)trigger delivery for an already-fired alert — lets judges
// replay the "send the email" moment on demand.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const alert = store.firedAlerts.find((a) => a.id === body?.alertId);
  if (!alert) return NextResponse.json({ error: "alert not found" }, { status: 404 });
  const cfg = store.alertConfigs.find((c) => c.id === alert.config_id);
  const node = taxonomy.find((t) => t.theme === alert.theme);
  const result = await sendAlertEmail({
    to: cfg?.recipients ?? [],
    theme: alert.theme,
    type: alert.type,
    severity: alert.severity,
    message: alert.message,
    currentPct: alert.current_pct,
    thresholdPct: alert.threshold_pct,
    evidenceQuotes: alert.evidence.map((e) => e.normalized.canonical_statement),
    playbook: node?.suggested_playbook ?? null,
    consoleUrl: "/console",
  });
  store.markDelivered(alert.id, result.ok, result.error);
  return NextResponse.json({ result, alert });
}
