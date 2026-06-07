import { NextResponse } from "next/server";
import { store, type TriggerEventType } from "@/lib/store";

const VALID_EVENTS: TriggerEventType[] = ["platinum_refresh", "product_launch", "policy_change", "rate_move", "weather_event", "fee_update"];

export async function GET() {
  return NextResponse.json({ monitors: store.triggerMonitors });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const event_type = VALID_EVENTS.includes(body?.event_type) ? (body.event_type as TriggerEventType) : "platinum_refresh";
  const theme = typeof body?.theme === "string" ? body.theme : "";
  if (!theme) return NextResponse.json({ error: "theme is required" }, { status: 400 });

  const monitor = store.armTrigger({
    event_type,
    label: typeof body?.label === "string" ? body.label : "",
    theme,
    sensitivity_multiplier: Number(body?.sensitivity_multiplier) || 1.5,
    recipients: Array.isArray(body?.recipients) ? body.recipients.filter((r: unknown) => typeof r === "string" && r.includes("@")) : [],
    days: Number(body?.days) || 7,
  });
  return NextResponse.json({ monitor });
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  store.disarmTrigger(id);
  return NextResponse.json({ monitors: store.triggerMonitors });
}
