/** T45 — the SELF-LEARNING layer (hermes-agent inspiration).
 *
 *  "Smarter by time" done honestly: the agent replays its OWN published
 *  record — every closed episode in the track record, attributed to the
 *  strategies that fired for the pick at issue — and lets each strategy's
 *  live hit rate bend its influence:
 *
 *    multiplier = clamp(0.75, 1.25, 0.5 + hitRate)
 *      hitRate 0.50 (coin flip) → ×1.00 (no change)
 *      hitRate 0.75 (winning)   → ×1.25 (max +25%)
 *      hitRate 0.25 (losing)    → ×0.75 (max −25%)
 *
 *  Guards (the learning can enrich, never break):
 *   - N-GATE: a strategy needs ≥ MIN_N (8) DECIDED attributed episodes
 *     (target-before-stop + stopped) before its weight moves at all;
 *   - the learning-weighted consensus is computed by the same math as the
 *     ensemble (reweightedEnsembleRead) but is used for REASONING and the
 *     learning panel ONLY — the served charter gates (0.35 long gate, ATR
 *     guard, conviction caps) never move;
 *   - attribution is exact: an episode's strategies are the ones persisted
 *     with the pick in the FIRST set that carried it (same freeze the track
 *  record uses) — never re-derived with hindsight. */

import { db } from "@/lib/db";
import { getTrackRecord } from "@/lib/signal-track";
import { STRATEGY_REGISTRY, reweightedEnsembleRead, type EnsembleRead } from "@/lib/strategies";

export const LEARN_MIN_N = 8;
const SETS_SCAN = 400; // newest persisted sets scanned for attribution
const CACHE_TTL_MS = 10 * 60_000;

export type StrategyLearning = {
  id: string;
  nameAr: string;
  nameEn: string;
  family: string;
  baseWeight: number;
  /** ×0.75..×1.25 — 1.00 while under the n-gate */
  multiplier: number;
  adaptedWeight: number;
  closed: number; // closed attributed episodes (target+stopped+expired)
  hits: number; // target before stop
  stopped: number;
  expired: number;
  decided: number; // hits + stopped (the n-gate's denominator)
  hitRate: number | null;
  avgRetPct: number | null;
};

export type LearningState = {
  computedAt: string;
  since: string | null; // earliest attributed episode issue date
  episodesClosed: number; // closed episodes attributed to ≥1 strategy
  minN: number;
  strategies: StrategyLearning[];
  noteAr: string;
  noteEn: string;
};

export type WeightChange = {
  id: string;
  nameEn: string;
  nameAr: string;
  from: number; // previous multiplier
  to: number; // new multiplier
  decided: number;
  hitRate: number | null;
};

// ── attribution: which strategies fired for each closed episode at issue ──

type AttributionIndex = Map<string, string[]>; // `${ticker}:${issuedAtMs}` → strategy ids

async function buildAttribution(): Promise<AttributionIndex> {
  let rows: { createdAt: Date; data: string }[] = [];
  try {
    rows = await db.aiSignalSet.findMany({
      orderBy: { createdAt: "desc" },
      take: SETS_SCAN,
      select: { createdAt: true, data: true },
    });
  } catch {
    return new Map();
  }
  const idx: AttributionIndex = new Map();
  // oldest first — the FIRST set carrying a pick owns its attribution
  for (const row of [...rows].reverse()) {
    try {
      const d = JSON.parse(row.data) as {
        picks?: { ticker?: unknown; stance?: unknown; strategies?: unknown }[];
      };
      if (!Array.isArray(d.picks)) continue;
      for (const p of d.picks) {
        if (!p || p.stance !== "long" || typeof p.ticker !== "string") continue;
        const ticker = p.ticker.toUpperCase().replace(/[^A-Z0-9]/g, "");
        if (!ticker) continue;
        const key = `${ticker}:${row.createdAt.getTime()}`;
        if (idx.has(key)) continue; // first set wins
        const strats = Array.isArray(p.strategies)
          ? p.strategies.filter((s): s is string => typeof s === "string")
          : [];
        idx.set(key, strats);
      }
    } catch {
      /* unparseable row — skip it */
    }
  }
  return idx;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ── the learning state ──

const g = globalThis as unknown as { __egxLearningCache?: { state: LearningState; at: number } };

export async function computeLearning(): Promise<LearningState> {
  const cached = g.__egxLearningCache;
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.state;

  const [record, attribution] = await Promise.all([getTrackRecord().catch(() => null), buildAttribution()]);

  type Acc = { closed: number; hits: number; stopped: number; expired: number; retSum: number; retN: number };
  const acc = new Map<string, Acc>();
  let episodesClosed = 0;
  let since: string | null = null;
  for (const ep of record?.signals ?? []) {
    if (ep.status === "open") continue;
    const key = `${ep.ticker}:${Date.parse(ep.issuedAt)}`;
    const strats = attribution.get(key);
    if (!strats || !strats.length) continue;
    episodesClosed++;
    if (!since || ep.issuedDate < since) since = ep.issuedDate;
    for (const id of strats) {
      const a = acc.get(id) ?? { closed: 0, hits: 0, stopped: 0, expired: 0, retSum: 0, retN: 0 };
      a.closed++;
      if (ep.status === "target") a.hits++;
      else if (ep.status === "stopped") a.stopped++;
      else a.expired++;
      a.retSum += ep.retPct;
      a.retN++;
      acc.set(id, a);
    }
  }

  const strategies: StrategyLearning[] = STRATEGY_REGISTRY.map((s) => {
    const a = acc.get(s.id);
    const hits = a?.hits ?? 0;
    const stopped = a?.stopped ?? 0;
    const decided = hits + stopped;
    const hitRate = decided >= LEARN_MIN_N ? hits / decided : null;
    const multiplier = hitRate !== null ? Number(clamp(0.5 + hitRate, 0.75, 1.25).toFixed(3)) : 1;
    return {
      id: s.id,
      nameAr: s.nameAr,
      nameEn: s.nameEn,
      family: s.family,
      baseWeight: s.weight,
      multiplier,
      adaptedWeight: Number((s.weight * multiplier).toFixed(3)),
      closed: a?.closed ?? 0,
      hits,
      stopped,
      expired: a?.expired ?? 0,
      decided,
      hitRate: hitRate !== null ? Number(hitRate.toFixed(3)) : null,
      avgRetPct: a && a.retN > 0 ? Number((a.retSum / a.retN).toFixed(2)) : null,
    };
  });

  const moved = strategies.filter((s) => s.multiplier !== 1).length;
  const state: LearningState = {
    computedAt: new Date().toISOString(),
    since,
    episodesClosed,
    minN: LEARN_MIN_N,
    strategies,
    noteAr:
      `يتعلّم الوكيل من سجله المنشور فقط: ${episodesClosed} إشارة مغلقة نُسبت للاستراتيجيات التي أطلقتها عند الإصدار. ` +
      `${moved > 0 ? `${moved} استراتيجية تجاوزت عتبة ${LEARN_MIN_N} قرارات فتحرّك وزنها (±٢٥٪ كحد أقصى).` : `لا استراتيجية تجاوزت عتبة ${LEARN_MIN_N} قرارات بعد — كل الأوزان محايدة. السجل يتراكم جلسة بعد جلسة.`} ` +
      `الأوزان تُغذّي استدلال الوكيل فقط — بوابات الميثاق الرياضية لا تتحرك أبدًا.`,
    noteEn:
      `The agent learns only from its own published record: ${episodesClosed} closed episode(s) attributed to the strategies that fired at issue. ` +
      `${moved > 0 ? `${moved} strateg${moved === 1 ? "y has" : "ies have"} crossed the ${LEARN_MIN_N}-decision gate, so their weight moved (±25% max).` : `No strategy has crossed the ${LEARN_MIN_N}-decision gate yet — all weights neutral; the record accumulates session by session.`} ` +
      `Weights feed the agent's reasoning only — the charter's mathematical gates never move.`,
  };

  g.__egxLearningCache = { state, at: Date.now() };
  return state;
}

/** multiplier lookup for reweightedEnsembleRead. */
export function multiplierOf(state: LearningState): (id: string) => number {
  const m = new Map(state.strategies.map((s) => [s.id, s.multiplier]));
  return (id: string) => m.get(id) ?? 1;
}

/** The learning-weighted consensus for one candidate (same aggregation math
 *  as the ensemble, learned multipliers applied). For reasoning + display. */
export function learnedConsensus(ens: EnsembleRead | null, atrPct: number | null, state: LearningState): number | null {
  if (!ens) return null;
  return reweightedEnsembleRead(ens.verdicts, atrPct, multiplierOf(state));
}

/** Diff two learning states → the weight changes worth journaling (|Δ| ≥ 0.05). */
export function diffLearning(prev: LearningState | null, next: LearningState): WeightChange[] {
  if (!prev) return [];
  const prevById = new Map(prev.strategies.map((s) => [s.id, s.multiplier]));
  const out: WeightChange[] = [];
  for (const s of next.strategies) {
    const from = prevById.get(s.id) ?? 1;
    if (Math.abs(s.multiplier - from) >= 0.05) {
      out.push({ id: s.id, nameEn: s.nameEn, nameAr: s.nameAr, from, to: s.multiplier, decided: s.decided, hitRate: s.hitRate });
    }
  }
  return out;
}
