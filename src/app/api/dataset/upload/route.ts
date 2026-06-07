import { NextResponse } from "next/server";
import { usingLiveLLM } from "@/lib/tagging";
import { createSession } from "@/lib/uploadSessions";
import type { RawInteraction } from "@/lib/types";

// Cap how many rows we'll tag per upload — keeps the demo responsive and,
// when OPENAI_API_KEY is set, bounds the live-API cost/time of a single request.
const MAX_ROWS = 300;

const REQUIRED_COLUMNS = ["interaction_id", "type", "date", "root_cause"];

// How many rows the client will ask the batch endpoint to tag per call. Kept
// small so each request finishes quickly — the UI polls in a loop and renders
// progress between calls instead of blocking on one giant tagging pass.
export const BATCH_SIZE = 10;

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

  const parsed: RawInteraction[] = [];
  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i];
    const root_cause = (r[colIdx.root_cause] || "").trim();
    if (!root_cause) continue;
    parsed.push({
      interaction_id: (r[colIdx.interaction_id] || `uploaded-${i + 1}`).trim(),
      type: (r[colIdx.type] || "unknown").trim(),
      date: (r[colIdx.date] || "").trim(),
      root_cause,
    });
  }

  if (!parsed.length) {
    return NextResponse.json({ error: "No usable rows found — every row was missing a root_cause value." }, { status: 422 });
  }

  const usedLLM = usingLiveLLM();
  const session = createSession(file.name, parsed, { usedLLM, truncated, truncatedTo: truncated ? MAX_ROWS : null });

  // Nothing is tagged yet — the client drives tagging via repeated calls to
  // /api/dataset/upload/batch (BATCH_SIZE rows at a time), which keeps each
  // request short and lets the UI show live progress instead of waiting on
  // one big all-at-once tagging pass that can trip connection timeouts.
  return NextResponse.json({
    ok: true,
    uploadId: session.id,
    filename: session.filename,
    total: session.rows.length,
    batch_size: BATCH_SIZE,
    used_llm: usedLLM,
    truncated,
    truncated_to: truncated ? MAX_ROWS : null,
  });
}
