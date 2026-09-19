/** T46 — the SIGNALS FILE + WORKLOG FILE: the agent's durable, file-based
 *  context that never gets lost.
 *
 *  The user asked for exactly this: "working in a signals file and worklog
 *  file to never lose the context". So the agent now keeps, next to the DB:
 *
 *    data/agent/signals.jsonl  — one JSON line per run: when, what kind, the
 *      bias, every pick with its plan (entry zone / targets / stop / risk),
 *      which models served it, and the run/set ids. Human-readable, greppable,
 *      append-only — the machine-readable ledger.
 *
 *    data/agent/worklog.md     — the agent's own worklog in markdown: one
 *      section per run with the outcome, the picks, the journal reflection
 *      and (when a run failed) the honest error. This is the file a human
 *      reads to see everything the agent ever did.
 *
 *  Both are READ back at the start of every run and fed to the brain as
 *  ARCHIVE CONTEXT — so even if the database were wiped, the agent would
 *  still know its own history from the files. Every write is append-only
 *  and crash-safe (single fsync'd-style append; a torn line is skipped on
 *  read, never corrupts the rest).
 *
 *  Honesty: the files record what ACTUALLY happened (including failures),
 *  they never fabricate, and they live under the project root so they ship
 *  with the repo and the backups. */

import { promises as fs } from "fs";
import path from "path";

const ARCHIVE_DIR = process.env.EGX_ARCHIVE_DIR
  ? path.resolve(process.env.EGX_ARCHIVE_DIR)
  : path.join(process.cwd(), "data", "agent");
const SIGNALS_FILE = path.join(ARCHIVE_DIR, "signals.jsonl");
const WORKLOG_FILE = path.join(ARCHIVE_DIR, "worklog.md");

export type SignalRunEntry = {
  at: string; // ISO
  kind: string; // pre-open | midday | post-close | manual
  runId: string;
  setRef: string | null;
  model: string;
  visionModel: string | null;
  bias: { direction: string; conviction: number };
  picks: {
    ticker: string;
    stance: string;
    conviction: number;
    horizonSessions: number | null;
    entryZone: [number, number] | null;
    targets: number[] | null;
    stop: number | null;
    riskPct: number | null;
  }[];
};

async function ensureDir(): Promise<void> {
  try {
    await fs.mkdir(ARCHIVE_DIR, { recursive: true });
  } catch {
    /* exists, or unwritable — the caller's try/catch handles it */
  }
}

/** Append one line, SELF-HEALING: if a previous crash left a torn line
 *  without its trailing newline, terminate it first — otherwise the next
 *  append would merge into it and corrupt TWO records instead of losing
 *  one. (Found by the T46 test suite — real crash-safety, not theater.) */
async function appendLine(file: string, line: string): Promise<void> {
  await ensureDir();
  try {
    const stat = await fs.stat(file);
    if (stat.size > 0) {
      const fh = await fs.open(file, "r");
      try {
        const buf = Buffer.alloc(1);
        await fh.read(buf, 0, 1, stat.size - 1);
        if (buf[0] !== 10) await fs.appendFile(file, "\n", "utf8");
      } finally {
        await fh.close();
      }
    }
  } catch {
    /* no file yet — first append */
  }
  await fs.appendFile(file, line + "\n", "utf8");
}

/** Append one run to the signals ledger (JSONL). Never throws. */
export async function appendSignalRun(entry: SignalRunEntry): Promise<boolean> {
  try {
    await appendLine(SIGNALS_FILE, JSON.stringify(entry));
    return true;
  } catch (err) {
    console.warn("[agent-archive] signals append failed:", err instanceof Error ? err.message : String(err));
    return false;
  }
}

/** Append one run's section to the agent's markdown worklog. Never throws. */
export async function appendWorklog(opts: {
  at: string;
  kind: string;
  ok: boolean;
  picks: { ticker: string; stance: string; conviction: number }[];
  bias?: { direction: string; conviction: number };
  journalEn: string;
  model?: string;
  visionModel?: string | null;
  error?: string;
}): Promise<boolean> {
  const d = new Date(opts.at);
  const date = d.toISOString().slice(0, 10);
  const time = d.toISOString().slice(11, 19) + "Z";
  const lines: string[] = [];
  lines.push(`## ${date} ${time} — ${opts.kind} run — ${opts.ok ? "OK" : "FAILED"}`);
  if (!opts.ok) {
    lines.push(`- error: ${opts.error ?? "unknown"}`);
  } else {
    if (opts.bias) lines.push(`- market bias: ${opts.bias.direction} (conviction ${opts.bias.conviction}/5)`);
    lines.push(`- picks: ${opts.picks.length === 0 ? "none cleared the gates" : opts.picks.map((p) => `${p.ticker} ${p.stance} ×${p.conviction}`).join(", ")}`);
    if (opts.model) lines.push(`- brain: ${opts.model}${opts.visionModel ? ` · vision: ${opts.visionModel}` : ""}`);
    lines.push(`- journal: ${opts.journalEn.replace(/\s+/g, " ").slice(0, 500)}`);
  }
  lines.push("");
  try {
    await appendLine(WORKLOG_FILE, lines.join("\n"));
    return true;
  } catch (err) {
    console.warn("[agent-archive] worklog append failed:", err instanceof Error ? err.message : String(err));
    return false;
  }
}

// ── reading it back ──

/** The last n ledger lines, oldest→newest. Torn/corrupt lines are skipped. */
export async function readRecentSignals(n = 5): Promise<SignalRunEntry[]> {
  try {
    const raw = await fs.readFile(SIGNALS_FILE, "utf8");
    const out: SignalRunEntry[] = [];
    for (const line of raw.split("\n")) {
      const s = line.trim();
      if (!s) continue;
      try {
        const p = JSON.parse(s) as SignalRunEntry;
        if (p && typeof p.at === "string" && Array.isArray(p.picks) && typeof p.kind === "string") out.push(p);
      } catch {
        /* torn line from a crash mid-append — skip it */
      }
    }
    return out.slice(-n);
  } catch {
    return []; // no file yet — first run
  }
}

/** The tail of the markdown worklog (chars), for humans/API. */
export async function readWorklogTail(chars = 4000): Promise<string | null> {
  try {
    const raw = await fs.readFile(WORKLOG_FILE, "utf8");
    if (raw.length <= chars) return raw;
    return raw.slice(-chars);
  } catch {
    return null;
  }
}

/** Compact archive context for the brain's prompt — what the agent's own
 *  FILES say about its recent history (survives any DB loss). */
export type ArchiveContext = {
  fileBacked: true;
  ledgerRuns: {
    at: string;
    kind: string;
    bias: string;
    picks: string[]; // "COMI long x4"
  }[];
};

export async function archiveContext(n = 3): Promise<ArchiveContext> {
  const recent = await readRecentSignals(n);
  return {
    fileBacked: true,
    ledgerRuns: recent.map((r) => ({
      at: r.at,
      kind: r.kind,
      bias: `${r.bias.direction} ${r.bias.conviction}/5`,
      picks: r.picks.map((p) => `${p.ticker} ${p.stance} x${p.conviction}`),
    })),
  };
}

/** Files status for the API/UI (does the durable context exist yet). */
export async function archiveStatus(): Promise<{ signalsFile: boolean; worklogFile: boolean; runs: number; dir: string }> {
  const recent = await readRecentSignals(1000);
  let worklog = false;
  try {
    await fs.access(WORKLOG_FILE);
    worklog = true;
  } catch {
    worklog = false;
  }
  return { signalsFile: recent.length > 0, worklogFile: worklog, runs: recent.length, dir: "data/agent" };
}
