import { NextResponse } from "next/server";
import { store } from "@/lib/store";
import { tagOne } from "@/lib/tagging";
import { getSession, discardSession } from "@/lib/uploadSessions";
import type { TaggedInteraction } from "@/lib/types";

// Default rows tagged per call — small and fixed so each request returns
// quickly and the dashboard can render a live "N / total tagged" progress bar
// instead of blocking on one giant request until the whole file is done.
const DEFAULT_BATCH_SIZE = 10;
const MAX_BATCH_SIZE = 25;

export async function POST(req: Request) {
  let body: { uploadId?: string; batchSize?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body with an 'uploadId'." }, { status: 400 });
  }

  const { uploadId } = body;
  if (!uploadId) {
    return NextResponse.json({ error: "Missing 'uploadId' — call /api/dataset/upload first." }, { status: 400 });
  }
  const session = getSession(uploadId);
  if (!session) {
    return NextResponse.json({ error: "Upload session not found or expired — start the upload again." }, { status: 404 });
  }
  if (session.committed) {
    return NextResponse.json({ error: "This upload has already finished and been loaded." }, { status: 409 });
  }

  const batchSize = Math.max(1, Math.min(MAX_BATCH_SIZE, Math.floor(body.batchSize || DEFAULT_BATCH_SIZE)));
  const slice = session.rows.slice(session.cursor, session.cursor + batchSize);

  const justTagged: TaggedInteraction[] = [];
  for (const row of slice) {
    try {
      const { normalized, tag, needs_review } = await tagOne(row.root_cause);
      const item: TaggedInteraction = { ...row, normalized, tag, needs_review };
      session.tagged.push(item);
      justTagged.push(item);
    } catch (err) {
      session.failures.push(`${row.interaction_id}: ${(err as Error).message}`);
    }
  }
  session.cursor += slice.length;

  const done = session.cursor >= session.rows.length;
  const needsReview = session.tagged.filter((t) => t.needs_review).length;

  if (!done) {
    return NextResponse.json({
      ok: true,
      uploadId: session.id,
      done: false,
      tagged: session.tagged.length,
      total: session.rows.length,
      failed: session.failures.length,
      needs_review: needsReview,
      used_llm: session.usedLLM,
      latest: justTagged.map((t) => ({
        interaction_id: t.interaction_id,
        canonical_statement: t.normalized.canonical_statement,
        theme: t.tag.theme,
        confidence: t.tag.confidence,
        needs_review: t.needs_review,
      })),
    });
  }

  // Final batch — commit (or fail out) and discard the session either way.
  if (!session.tagged.length) {
    discardSession(session.id);
    return NextResponse.json(
      { error: "No rows could be tagged." + (session.failures.length ? ` First failure: ${session.failures[0]}` : "") },
      { status: 422 }
    );
  }

  session.committed = true;
  store.loadDataset(session.tagged, { filename: session.filename, usedLLM: session.usedLLM, needsReview });
  discardSession(session.id);

  return NextResponse.json({
    ok: true,
    uploadId: session.id,
    done: true,
    filename: session.filename,
    loaded: session.tagged.length,
    skipped_failures: session.failures.length,
    needs_review: needsReview,
    used_llm: session.usedLLM,
    truncated: session.truncated,
    truncated_to: session.truncatedTo,
    latest: justTagged.map((t) => ({
      interaction_id: t.interaction_id,
      canonical_statement: t.normalized.canonical_statement,
      theme: t.tag.theme,
      confidence: t.tag.confidence,
      needs_review: t.needs_review,
    })),
    aggregation: store.getAggregation(),
  });
}
