import { NextResponse } from "next/server";
import { store } from "@/lib/store";
import { tagOne, usingLiveLLM } from "@/lib/tagging";
import type { TaggedInteraction } from "@/lib/types";

// Cap how many rows we'll tag per upload — keeps the demo responsive and,
// when OPENAI_API_KEY is set, bounds the live-API cost/time of a single request.
const MAX_ROWS = 300;

const REQUIRED_COLUMNS = ["interaction_id", "type", "date", "root_cause"];

function parseCsv(text: string): string[][] {
  // Minimal RFC-4180-ish CSV parser: handles quoted fields, embedded commas,
  // escaped quotes (""), and \n / \r\n line endings.
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data with a 'file' field." }, { status: 400 });
  }

  const file = form.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "No file uploaded — attach a CSV under the 'file' field." }, { status: 400 });
  }
  if (!/\.csv$/i.test(file.name) && file.type && !/csv|text\/plain/i.test(file.type)) {
    return NextResponse.json({ error: `"${file.name}" doesn't look like a CSV file.` }, { status: 400 });
  }

  const text = await file.text();
  const rows = parseCsv(text).filter((r) => r.some((cell) => cell.trim() !== ""));
  if (rows.length < 2) {
    return NextResponse.json({ error: "The file needs a header row plus at least one data row." }, { status: 400 });
  }

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const colIdx: Record<string, number> = {};
  for (const col of REQUIRED_COLUMNS) colIdx[col] = header.indexOf(col);
  const missing = REQUIRED_COLUMNS.filter((c) => colIdx[c] === -1);
  if (missing.length) {
    return NextResponse.json(
      { error: `Missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Expected headers: ${REQUIRED_COLUMNS.join(", ")}.` },
      { status: 400 }
    );
  }

  const dataRows = rows.slice(1, 1 + MAX_ROWS);
  const truncated = rows.length - 1 > MAX_ROWS;

  const usedLLM = usingLiveLLM();
  const tagged: TaggedInteraction[] = [];
  const failures: string[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i];
    const interaction_id = (r[colIdx.interaction_id] || `uploaded-${i + 1}`).trim();
    const type = (r[colIdx.type] || "unknown").trim();
    const date = (r[colIdx.date] || "").trim();
    const root_cause = (r[colIdx.root_cause] || "").trim();
    if (!root_cause) continue;
    try {
      const { normalized, tag, needs_review } = await tagOne(root_cause);
      tagged.push({ interaction_id, type, date, root_cause, normalized, tag, needs_review });
    } catch (err) {
      failures.push(`${interaction_id}: ${(err as Error).message}`);
    }
  }

  if (!tagged.length) {
    return NextResponse.json(
      { error: "No rows could be tagged." + (failures.length ? ` First failure: ${failures[0]}` : "") },
      { status: 422 }
    );
  }

  const needsReview = tagged.filter((t) => t.needs_review).length;
  store.loadDataset(tagged, { filename: file.name, usedLLM, needsReview });

  return NextResponse.json({
    ok: true,
    filename: file.name,
    loaded: tagged.length,
    skipped_failures: failures.length,
    needs_review: needsReview,
    used_llm: usedLLM,
    truncated,
    truncated_to: truncated ? MAX_ROWS : null,
    aggregation: store.getAggregation(),
  });
}
