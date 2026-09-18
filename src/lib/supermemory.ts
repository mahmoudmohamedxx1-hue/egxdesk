/** T46 — SUPERMEMORY: the agent's unlimited, always-connected memory.
 *
 *  Inspired by supermemoryai/supermemory + supermemory-mcp, done the honest
 *  local-first way on this codebase's own rules:
 *
 *    STORE  — every run writes what happened (the LLM's reflection, each pick
 *      and its thesis, the market read, the vision verdicts, the weight-move
 *      lessons) as AgentMemory rows: text + tags + a compact embedding.
 *
 *    RECALL — before every run the engine embeds the CURRENT context (run
 *      kind, market bias, the top candidate tickers, the learning note) and
 *      searches the whole memory by cosine similarity, blended with a mild
 *      recency tilt. The top hits go into the brain's prompt — the agent
 *      literally starts each session remembering what its own past taught it
 *      about THIS situation, not just the last N rows.
 *
 *    UNLIMITED — rows are never evicted; the search scans a growing window
 *      (last 800 rows — months of runs) and the archive files (agent-archive
 *      .ts) plus the DB keep everything durable. The vector is a deterministic
 *      hashed bag-of-words (unigrams + bigrams, 384 dims, L2-normalized):
 *      zero external calls, zero drift, runs offline, and tests can pin it.
 *
 *    CLOUD (optional, honest) — when SUPERMEMORY_API_KEY is set, each new
 *      memory is ALSO mirrored to the Supermemory cloud (v3 documents API)
 *      best-effort; the mirror never blocks a run and never gates recall —
 *      the local engine always serves. Without the key everything works,
 *      the UI just shows the honest "local engine" badge.
 *
 *  Why not call a hosted embedding model? The signals key is for SIGNALS
 *  only, recall must be instant, deterministic and free — a hashed TF vector
 *  is fully honest about what it is: lexical-semantic recall, no magic. */

import { db } from "@/lib/db";

// ── the embedding: deterministic hashed bag-of-words (uni + bigrams) ──

export const MEM_DIM = 384;

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function tokenize(text: string): string[] {
  return (
    text
      .toLowerCase()
      // letters (Latin + Arabic), digits, and ticker-ish tokens
      .match(/[a-z0-9\u0600-\u06ff]{2,}/g) ?? []
  ).slice(0, 400);
}

/** A deterministic 384-dim unit vector: term-frequency-weighted unigrams and
 *  bigrams hashed into buckets. Same text → same vector, always, anywhere. */
export function embedText(text: string): number[] {
  const v = new Array<number>(MEM_DIM).fill(0);
  const toks = tokenize(text);
  const tf = new Map<string, number>();
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    tf.set(t, (tf.get(t) ?? 0) + 1);
    if (i + 1 < toks.length) {
      const bg = t + "_" + toks[i + 1];
      tf.set(bg, (tf.get(bg) ?? 0) + 0.5); // bigrams matter a little less
    }
  }
  for (const [term, count] of tf) {
    const w = 1 + Math.log(count);
    v[fnv1a(term) % MEM_DIM] += w;
  }
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm === 0) return v;
  return v.map((x) => x / norm);
}

export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot; // both unit vectors → dot IS the cosine
}

// ── cloud sync (optional, best-effort, never a dependency) ──

const SUPERMEMORY_API_KEY = process.env.SUPERMEMORY_API_KEY ?? "";
const SUPERMEMORY_DOCS_URL = "https://api.supermemory.com/v3/documents";

type CloudState = { configured: boolean; state: "off" | "ok" | "error"; lastError: string | null; mirrored: number };

const g = globalThis as unknown as { __egxSupermemoryCloud?: CloudState };
g.__egxSupermemoryCloud ??= { configured: SUPERMEMORY_API_KEY.length > 0, state: SUPERMEMORY_API_KEY ? "ok" : "off", lastError: null, mirrored: 0 };

export function cloudState(): CloudState {
  return g.__egxSupermemoryCloud!;
}

async function pushToCloud(row: { id: string; kind: string; text: string; tagsJson: string | null; createdAt: Date }): Promise<void> {
  if (!SUPERMEMORY_API_KEY) return;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(SUPERMEMORY_DOCS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${SUPERMEMORY_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        content: row.text,
        metadata: {
          source: "egxdesk-hermes",
          kind: row.kind,
          tags: row.tagsJson ? (JSON.parse(row.tagsJson) as string[]) : [],
          localId: row.id,
          createdAt: row.createdAt.toISOString(),
        },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`supermemory cloud HTTP ${res.status}`);
    const json = (await res.json().catch(() => ({}))) as { id?: string; documentId?: string };
    const cloudId = json.id ?? json.documentId ?? null;
    if (cloudId) {
      await db.agentMemory.update({ where: { id: row.id }, data: { cloudId } }).catch(() => {});
    }
    const st = cloudState();
    st.state = "ok";
    st.mirrored++;
    st.lastError = null;
  } catch (err) {
    // honest: the cloud mirror failed — local memory still serves everything
    const st = cloudState();
    st.state = "error";
    st.lastError = err instanceof Error ? err.message.slice(0, 160) : String(err).slice(0, 160);
  } finally {
    clearTimeout(t);
  }
}

// ── store ──

export type MemoryInput = {
  kind: "reflection" | "pick" | "bias" | "vision" | "lesson" | "milestone";
  text: string;
  textAr?: string | null;
  tags?: string[];
  sourceRun?: string | null;
  meta?: Record<string, unknown>;
};

const MAX_TEXT = 700;

/** Store one memory (local row + optional cloud mirror). Never throws — a
 *  memory-write failure must never kill a signal run. */
export async function rememberMemory(input: MemoryInput): Promise<string | null> {
  try {
    const text = input.text.trim().slice(0, MAX_TEXT);
    if (!text) return null;
    const row = await db.agentMemory.create({
      data: {
        kind: input.kind,
        text,
        textAr: input.textAr ? input.textAr.trim().slice(0, MAX_TEXT) : null,
        tagsJson: input.tags && input.tags.length ? JSON.stringify(input.tags.slice(0, 12)) : null,
        embJson: JSON.stringify(embedText(text)),
        sourceRun: input.sourceRun ?? null,
        metaJson: input.meta ? JSON.stringify(input.meta) : null,
      },
    });
    if (SUPERMEMORY_API_KEY) void pushToCloud({ id: row.id, kind: row.kind, text: row.text, tagsJson: row.tagsJson, createdAt: row.createdAt });
    return row.id;
  } catch {
    return null;
  }
}

// ── recall ──

export type RecalledMemory = {
  id: string;
  kind: string;
  text: string;
  textAr: string | null;
  tags: string[];
  createdAt: string;
  score: number; // 0..1 — cosine similarity with the recency tilt applied
  ageDays: number;
};

const RECALL_WINDOW = 800; // rows scanned — months of runs, effectively unlimited in practice
const RECALL_RECENTITY_DAYS = 45; // the tilt's half-life scale

/** Semantic recall: embed the query, scan the recent window, cosine + a mild
 *  recency tilt (0.75 + 0.25·recency). Deterministic, offline, instant. */
export async function recallMemories(query: string, k = 6, kinds?: string[]): Promise<RecalledMemory[]> {
  const q = embedText(query);
  let rows: { id: string; kind: string; text: string; textAr: string | null; tagsJson: string | null; embJson: string; createdAt: Date }[] = [];
  try {
    rows = await db.agentMemory.findMany({
      where: kinds && kinds.length ? { kind: { in: kinds } } : undefined,
      orderBy: { createdAt: "desc" },
      take: RECALL_WINDOW,
    });
  } catch {
    return []; // db hiccup — the run proceeds without recall, honestly
  }
  const now = Date.now();
  const scored: RecalledMemory[] = [];
  for (const r of rows) {
    let emb: number[];
    try {
      emb = JSON.parse(r.embJson) as number[];
      if (!Array.isArray(emb) || emb.length !== MEM_DIM) continue;
    } catch {
      continue;
    }
    const cos = cosine(q, emb);
    if (cos <= 0.02) continue; // below noise floor — not the same topic
    const ageDays = Math.max(0, (now - r.createdAt.getTime()) / 86_400_000);
    const recency = Math.max(0, 1 - ageDays / RECALL_RECENTITY_DAYS);
    const score = cos * (0.75 + 0.25 * recency);
    let tags: string[] = [];
    try {
      tags = r.tagsJson ? (JSON.parse(r.tagsJson) as string[]) : [];
    } catch {
      /* tags are cosmetic */
    }
    scored.push({ id: r.id, kind: r.kind, text: r.text, textAr: r.textAr, tags, createdAt: r.createdAt.toISOString(), score, ageDays });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(1, k));
}

// ── the run-time context recall (what the brain actually sees) ──

/** Build the CURRENT-situation query and recall against it: the run kind, the
 *  learned market note, and the top candidate tickers (tickers repeat across
 *  runs, so a past pick/thesis on the SAME stock scores high — that is the
 *  "keep everything connected" the user asked for). */
export async function recallForRun(
  ev: { candidates: { row: { ticker: string } }[] },
  learning: { noteEn: string },
  runKind: string
): Promise<RecalledMemory[]> {
  const tickers = ev.candidates.slice(0, 10).map((c) => c.row.ticker);
  const query = [
    `EGX ${runKind} run`,
    learning.noteEn,
    `candidates ${tickers.join(" ")}`,
    "market bias consensus picks thesis vision verdict whale insider momentum trend",
  ].join(" · ");
  return recallMemories(query, 6);
}

// ── stats for the API / UI ──

export type MemoryStats = {
  total: number;
  byKind: { kind: string; count: number }[];
  cloud: { configured: boolean; state: string; mirrored: number; lastError: string | null };
  oldest: string | null;
};

export async function memoryStats(): Promise<MemoryStats> {
  const cloud = cloudState();
  try {
    const total = await db.agentMemory.count();
    const grouped = await db.agentMemory.groupBy({ by: ["kind"], _count: { kind: true } });
    const oldest = await db.agentMemory.findFirst({ orderBy: { createdAt: "asc" } });
    return {
      total,
      byKind: grouped.map((x) => ({ kind: x.kind, count: x._count.kind })).sort((a, b) => b.count - a.count),
      cloud: { configured: cloud.configured, state: cloud.state, mirrored: cloud.mirrored, lastError: cloud.lastError },
      oldest: oldest ? oldest.createdAt.toISOString() : null,
    };
  } catch {
    return { total: 0, byKind: [], cloud: { configured: cloud.configured, state: cloud.state, mirrored: cloud.mirrored, lastError: cloud.lastError }, oldest: null };
  }
}
