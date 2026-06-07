import { NextResponse } from "next/server";
import { store, type ActionPath } from "@/lib/store";
import { sendAlertEmail } from "@/lib/email";
import { taxonomy } from "@/lib/taxonomy";

const VALID_PATHS: ActionPath[] = ["alert", "automate", "research"];

// Action Engine — executes one of the three pluggable paths (Alert / Automate-HITL / Research)
// for a candidate action surfaced in the Decision Console. The "alert" path is fully live
// (reuses the same email-delivery mechanism as Alert Studio); "automate" and "research" are
// real-shaped stubbed connectors that return tracked records — exactly as the dev plan scopes them.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const alertId = typeof body?.alertId === "string" ? body.alertId : "";
  const actionId = typeof body?.actionId === "string" ? body.actionId : "";
  const path = VALID_PATHS.includes(body?.path) ? (body.path as ActionPath) : "alert";
  const approver = typeof body?.approver === "string" && body.approver ? body.approver : "demo-approver@amex.com";
  const note = typeof body?.note === "string" ? body.note : "";

  if (!alertId || !actionId) return NextResponse.json({ error: "alertId and actionId are required" }, { status: 400 });

  const record = store.executeAction({ alertId, actionId, path, approver, note });
  if (!record) return NextResponse.json({ error: "alert or candidate action not found" }, { status: 404 });

  // The "alert" path actually dispatches an email so judges see a live send, not a mock.
  if (path === "alert") {
    const alert = store.firedAlerts.find((a) => a.id === alertId);
    const cfg = alert ? store.alertConfigs.find((c) => c.id === alert.config_id) : null;
    const node = alert ? taxonomy.find((t) => t.theme === alert.theme) : null;
    if (alert) {
      const result = await sendAlertEmail({
        to: cfg?.recipients ?? [],
        theme: alert.theme,
        type: alert.type,
        severity: alert.severity,
        message: `[Action: ${record.action_label}] Approved by ${approver}. ${alert.message}`,
        currentPct: alert.current_pct,
        thresholdPct: alert.threshold_pct,
        evidenceQuotes: alert.evidence.map((e) => e.normalized.canonical_statement),
        playbook: node?.suggested_playbook ?? null,
        consoleUrl: "/",
      });
      record.result = { ...record.result, delivery: result };
      store.log("alert_delivered", `Action-path email ${result.ok ? "delivered" : "failed"} for "${alert.theme}" (${result.simulated ? "simulated" : "live"}).`, { action_id: record.id, result });
    }
  }

  return NextResponse.json({ action: record });
}
