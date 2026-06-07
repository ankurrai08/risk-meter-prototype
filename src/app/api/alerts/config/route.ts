import { NextResponse } from "next/server";
import { store, type AlertConfig } from "@/lib/store";

export async function GET() {
  return NextResponse.json({ configs: store.alertConfigs });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body?.theme || !body?.type) {
    return NextResponse.json({ error: "theme and type are required" }, { status: 400 });
  }
  const cfg: AlertConfig = {
    id: `cfg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    theme: body.theme,
    type: body.type,
    threshold_pct: Number(body.threshold_pct) || 10,
    spike_multiplier: body.spike_multiplier ? Number(body.spike_multiplier) : 2,
    severity: ["low", "medium", "high"].includes(body.severity) ? body.severity : "medium",
    channel: "email",
    recipients: Array.isArray(body.recipients) ? body.recipients.filter((r: unknown) => typeof r === "string" && r.includes("@")) : [],
    enabled: true,
    created_at: new Date().toISOString(),
  };
  store.alertConfigs.unshift(cfg);
  store.log("alert_config", `New alert configured: "${cfg.theme}" — ${cfg.type} @ ${cfg.threshold_pct}% → ${cfg.recipients.join(", ") || "(no recipients yet)"}`, { config: cfg });
  return NextResponse.json({ config: cfg });
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body?.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const cfg = store.alertConfigs.find((c) => c.id === body.id);
  if (!cfg) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (typeof body.enabled === "boolean") cfg.enabled = body.enabled;
  if (typeof body.threshold_pct === "number") cfg.threshold_pct = body.threshold_pct;
  if (typeof body.spike_multiplier === "number") cfg.spike_multiplier = body.spike_multiplier;
  if (Array.isArray(body.recipients)) cfg.recipients = body.recipients.filter((r: unknown) => typeof r === "string" && r.includes("@"));
  if (["low", "medium", "high"].includes(body.severity)) cfg.severity = body.severity;
  store.log("alert_config", `Alert config updated: "${cfg.theme}" (${cfg.id})`, { config: cfg });
  return NextResponse.json({ config: cfg });
}
