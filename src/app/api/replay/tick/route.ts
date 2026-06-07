import { NextResponse } from "next/server";
import { store } from "@/lib/store";
import { sendAlertEmail } from "@/lib/email";
import { taxonomy } from "@/lib/taxonomy";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const n = Math.max(1, Math.min(20, Number(body?.n) || 1));
  const { advanced, newAlerts } = store.tick(n);

  // Auto-deliver email for newly fired alerts whose config channel is email
  for (const alert of newAlerts) {
    const cfg = store.alertConfigs.find((c) => c.id === alert.config_id);
    const recipients = cfg?.recipients ?? [];
    const node = taxonomy.find((t) => t.theme === alert.theme);
    const result = await sendAlertEmail({
      to: recipients,
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
    (alert as unknown as Record<string, unknown>)._delivery = result;
  }

  return NextResponse.json({
    advanced,
    cursorAtEnd: store.cursor >= store.all.length,
    newAlerts,
    aggregation: store.getAggregation(),
  });
}
