import { NextResponse } from "next/server";
import { sendAlertEmail } from "@/lib/email";

// Lets a user fire a one-off test email from Alert Studio to verify delivery
// before relying on it during a live threshold breach.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const to: string[] = Array.isArray(body?.recipients) ? body.recipients : [];
  if (!to.length) return NextResponse.json({ error: "Provide at least one recipient email." }, { status: 400 });
  const result = await sendAlertEmail({
    to,
    theme: body?.theme || "Test Alert — Payment, billing, pricing, and credit-term errors",
    type: "threshold",
    severity: "medium",
    message: "This is a test alert from Risk Meter's Alert Studio — confirming delivery configuration is working before relying on it live.",
    currentPct: 12.4,
    thresholdPct: 10,
    evidenceQuotes: [
      "A late payment fee was applied because the due-date reminder didn't reach the customer in time.",
      "Customer was unexpectedly charged an annual fee they believed had been waived at signup.",
    ],
    playbook: "Trigger heatmap alert and root-cause drilldown; route to billing-policy review queue.",
    consoleUrl: "/console",
  });
  return NextResponse.json({ result });
}
