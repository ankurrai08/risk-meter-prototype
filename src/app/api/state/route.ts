import { NextResponse } from "next/server";
import { store } from "@/lib/store";
import { taxonomy } from "@/lib/taxonomy";

export async function GET() {
  const agg = store.getAggregation();
  const recent = store.seen.slice(-12).reverse();
  return NextResponse.json({
    aggregation: agg,
    recent,
    alerts: store.firedAlerts.slice(0, 30),
    alertConfigs: store.alertConfigs,
    audit: store.audit.slice(0, 80),
    taxonomyNodeCount: taxonomy.length,
  });
}
