// In-memory session store for chunked CSV-upload tagging.
//
// Tagging a few hundred rows one-by-one against a live LLM in a single HTTP
// request is slow enough to trip serverless / dev-server connection timeouts
// ("failed to fetch" in the browser). Instead, the upload is split in two:
//
//   1. POST /api/dataset/upload        — parses + validates the CSV, stores
//      the raw rows here, returns an `uploadId` and the row count immediately.
//   2. POST /api/dataset/upload/batch  — tags the next N rows (default 10),
//      appends them to the session, and reports progress. The client calls
//      this repeatedly — rendering a live progress bar — until `done: true`,
//      at which point the session commits the tagged rows into the replay
//      store and is discarded.
//
// This keeps each request short and lets the UI update incrementally instead
// of blocking on one giant all-at-once tagging pass.

import type { RawInteraction, TaggedInteraction } from "./types";

export type UploadSession = {
  id: string;
  filename: string;
  rows: RawInteraction[];
  tagged: TaggedInteraction[];
  failures: string[];
  cursor: number;
  usedLLM: boolean;
  truncated: boolean;
  truncatedTo: number | null;
  createdAt: number;
  committed: boolean;
};

const SESSION_TTL_MS = 30 * 60 * 1000; // abandoned uploads are pruned after 30 min

// Survive Next.js dev-mode hot-reload the same way the main store does.
const g = globalThis as unknown as { __riskMeterUploadSessions?: Map<string, UploadSession> };
export const uploadSessions: Map<string, UploadSession> =
  g.__riskMeterUploadSessions ?? (g.__riskMeterUploadSessions = new Map());

function pruneStale() {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, s] of uploadSessions) {
    if (s.createdAt < cutoff) uploadSessions.delete(id);
  }
}

export function createSession(filename: string, rows: RawInteraction[], opts: { usedLLM: boolean; truncated: boolean; truncatedTo: number | null }): UploadSession {
  pruneStale();
  const id = `up-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const session: UploadSession = {
    id,
    filename,
    rows,
    tagged: [],
    failures: [],
    cursor: 0,
    usedLLM: opts.usedLLM,
    truncated: opts.truncated,
    truncatedTo: opts.truncatedTo,
    createdAt: Date.now(),
    committed: false,
  };
  uploadSessions.set(id, session);
  return session;
}

export function getSession(id: string): UploadSession | undefined {
  return uploadSessions.get(id);
}

export function discardSession(id: string) {
  uploadSessions.delete(id);
}
