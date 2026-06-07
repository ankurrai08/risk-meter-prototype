import { NextResponse } from "next/server";
import { store } from "@/lib/store";

// Records a leader's decision (approve / override / escalate) on an alert —
// purely for the audit trail in this prototype (no real action execution).
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const { alertId, action, note } = body || {};
  if (!alertId || !["approve", "override", "escalate"].includes(action)) {
    return NextResponse.json({ error: "alertId and a valid action are required" }, { status: 400 });
  }
  const alert = store.firedAlerts.find((a) => a.id === alertId);
  store.log("decision", `Decision recorded: ${action.toUpperCase()} on "${alert?.theme ?? alertId}"${note ? ` — "${note}"` : ""}`, {
    alertId,
    action,
    note,
  });
  return NextResponse.json({ ok: true });
}
