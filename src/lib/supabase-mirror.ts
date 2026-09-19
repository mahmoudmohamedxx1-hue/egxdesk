/** T46 — the SUPABASE mirror: auth + durable cloud storage for the agent's
 *  signals, memory and worklog — ready to switch on, honestly gated on the
 *  user's own project keys.
 *
 *  What the user asked for: integrate the website with Supabase (1) for AUTH,
 *  (2) for SAVING the AI agent's signals, (3) working in a signals file and
 *  a worklog file so context is never lost, (4) unlimited memory keeping
 *  everything connected.
 *
 *  This module is the server-side half of (2)+(3)+(4): a zero-dependency
 *  REST client (plain fetch against PostgREST + the Auth API — no new npm
 *  package, nothing to break the build). It activates ONLY when these env
 *  vars exist:
 *
 *      SUPABASE_URL            https://<project>.supabase.co
 *      SUPABASE_SERVICE_ROLE_KEY   (server-only! never the anon key here)
 *      SUPABASE_ANON_KEY       (optional — for the browser auth flow)
 *
 *  …and until then it reports `configured: false` everywhere and mirrors
 *  NOTHING — the SQLite DB, the data/agent/*.jsonl|md files and the local
 *  supermemory engine remain the single source of truth. When the keys
 *  arrive, each successful agent run is mirrored to:
 *
 *      agent_runs      — one row per run (kind, status, models, timings…)
 *      agent_signals   — one row per pick (the plan: entry zone / targets /
 *                        stop / risk) — the cloud "signals file"
 *      agent_memories  — every supermemory entry — the cloud "unlimited memory"
 *      agent_worklog   — the markdown worklog, upserted whole — "never lose
 *                        the context"
 *
 *  Mirrors are fire-and-forget with bounded timeouts; a mirror failure is
 *  logged and surfaced in the API status, NEVER blocks or fails a run.
 *  The exact SQL to create these tables lives in docs/SUPABASE-SETUP.md.
 *
 *  AUTH (the user's ask #1) is a browser flow (supabase-js or the platform's
 *  own OTP email magic link) — see docs/SUPABASE-SETUP.md for the exact
 *  steps; this server module only needs the service-role key to verify the
 *  user's JWT (`/auth/v1/user`) and attribute rows to real users. */

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const MIRROR_TIMEOUT_MS = 10_000;

export type MirrorStatus = {
  configured: boolean;
  url: string | null;
  state: "off" | "ok" | "error" | "needs-setup";
  mirrored: number;
  lastError: string | null;
};

const g = globalThis as unknown as { __egxSupabaseMirror?: MirrorStatus; __egxSbMirrorProbe?: { at: number; state: MirrorStatus["state"] } };
g.__egxSupabaseMirror ??= { configured: SUPABASE_URL.length > 0 && SERVICE_KEY.length > 0, url: SUPABASE_URL || null, state: SUPABASE_URL && SERVICE_KEY ? "ok" : "off", mirrored: 0, lastError: null };

export function mirrorStatus(): MirrorStatus {
  return g.__egxSupabaseMirror!;
}

/** T47 — the initialized "ok" state has never touched the project yet; a
 *  status line must not claim connection before the first real write. This
 *  cheap probe (one PostgREST select, 5-min cache) verifies the agent tables
 *  actually exist so the UI can say "needs-setup" honestly, up front. */
export async function probeMirrorState(): Promise<MirrorStatus> {
  const st = mirrorStatus();
  if (!st.configured) return st;
  if (st.mirrored > 0 || st.state === "error") return st; // real evidence already exists
  const now = Date.now();
  const cached = g.__egxSbMirrorProbe;
  if (cached && now - cached.at < 5 * 60_000) {
    st.state = cached.state;
    return st;
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/agent_runs?select=run_id&limit=1`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      signal: ctrl.signal,
      cache: "no-store",
    });
    const body = await res.text().catch(() => "");
    if (res.ok) {
      st.state = "ok";
      st.lastError = null;
    } else if (/PGRST20[45]/.test(body) || /Could not find the (table|'.*?' relation)/i.test(body)) {
      st.state = "needs-setup";
      st.lastError = "Supabase tables not created yet — run the SQL in docs/SUPABASE-SETUP.md once (dashboard → SQL editor)";
    } else {
      st.state = "error";
      st.lastError = `probe HTTP ${res.status}: ${body.slice(0, 120)}`;
    }
    g.__egxSbMirrorProbe = { at: now, state: st.state };
  } catch (err) {
    st.state = "error";
    st.lastError = err instanceof Error ? err.message.slice(0, 180) : String(err).slice(0, 180);
  } finally {
    clearTimeout(t);
  }
  return st;
}

/** One PostgREST insert (array body → many rows). Returns rows inserted or -1. */
async function restInsert(table: string, rows: Record<string, unknown>[]): Promise<number> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), MIRROR_TIMEOUT_MS);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(rows),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`${table} HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 140)}`);
    return rows.length;
  } finally {
    clearTimeout(t);
  }
}

async function restUpsert(table: string, rows: Record<string, unknown>[], onConflict: string): Promise<number> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), MIRROR_TIMEOUT_MS);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(rows),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`${table} HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 140)}`);
    return rows.length;
  } finally {
    clearTimeout(t);
  }
}

/** Verify a user's Supabase JWT server-side (the AUTH half). Returns the
 *  user's id/email or null — never throws. */
export async function verifySupabaseUser(jwt: string): Promise<{ id: string; email: string | null } | null> {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${jwt}` },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { id?: string; email?: string };
    return json.id ? { id: json.id, email: json.email ?? null } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Mirror one successful agent run: the run row, its picks, the run's new
 *  memories, and the whole markdown worklog (upsert). Best-effort — every
 *  failure is recorded in the status, nothing is retried inline. */
export async function mirrorAgentRun(opts: {
  run: {
    runId: string;
    startedAt: string;
    kind: string;
    session: string;
    model: string;
    visionModel: string | null;
    llmMs: number;
    visionMs: number;
    setRef: string | null;
  };
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
  memories: { localId: string; kind: string; text: string; createdAt: string }[];
  worklogMarkdown: string | null;
  /** T47 — when a Supabase-authed user triggered the run, rows are attributed
   *  to that real account (scheduler runs stay unattributed — honest). */
  user?: { id: string; email: string | null } | null;
}): Promise<void> {
  const st = mirrorStatus();
  if (!st.configured) return;
  try {
    let n = 0;
    n += await restInsert("agent_runs", [
      {
        run_id: opts.run.runId,
        started_at: opts.run.startedAt,
        kind: opts.run.kind,
        session: opts.run.session,
        model: opts.run.model,
        vision_model: opts.run.visionModel,
        llm_ms: opts.run.llmMs,
        vision_ms: opts.run.visionMs,
        set_ref: opts.run.setRef,
        status: "ok",
        user_id: opts.user?.id ?? null,
        user_email: opts.user?.email ?? null,
      },
    ]);
    if (opts.picks.length > 0) {
      n += await restInsert(
        "agent_signals",
        opts.picks.map((p) => ({
          run_id: opts.run.runId,
          set_ref: opts.run.setRef,
          ticker: p.ticker,
          stance: p.stance,
          conviction: p.conviction,
          horizon_sessions: p.horizonSessions,
          entry_zone: p.entryZone,
          targets: p.targets,
          stop: p.stop,
          risk_pct: p.riskPct,
          bias_direction: opts.bias.direction,
          user_id: opts.user?.id ?? null,
          user_email: opts.user?.email ?? null,
          created_at: opts.run.startedAt,
        }))
      );
    }
    if (opts.memories.length > 0) {
      n += await restInsert(
        "agent_memories",
        opts.memories.map((m) => ({
          local_id: m.localId,
          kind: m.kind,
          text: m.text,
          created_at: m.createdAt,
        }))
      );
    }
    if (opts.worklogMarkdown !== null) {
      n += await restUpsert(
        "agent_worklog",
        [{ slug: "agent-worklog", markdown: opts.worklogMarkdown.slice(0, 500_000), updated_at: new Date().toISOString() }],
        "slug"
      );
    }
    st.state = "ok";
    st.mirrored += n;
    st.lastError = null;
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 180) : String(err).slice(0, 180);
    // T47 — the honest pre-DDL state: keys are in but the project has no
    // agent tables yet (PGRST204/205). Say exactly that instead of a cryptic
    // REST error, so the UI can point at the one-time setup SQL.
    if (/PGRST20[45]/.test(msg) || /Could not find the (table|'.*?' relation)/i.test(msg)) {
      st.state = "needs-setup";
      st.lastError = "Supabase tables not created yet — run the SQL in docs/SUPABASE-SETUP.md once (dashboard → SQL editor)";
    } else {
      st.state = "error";
      st.lastError = msg;
    }
    console.warn("[supabase-mirror] failed:", st.lastError);
  }
}
