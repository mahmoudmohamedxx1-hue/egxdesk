import { NextResponse } from "next/server";
import backtest from "@/data/backtest.json";
import { signalForTicker } from "@/lib/signals-scan";
import { STRATEGY_REGISTRY, type StrategyFamily } from "@/lib/strategies";

export const dynamic = "force-dynamic";

/** GET /api/strategy-lab/live?ticker=COMI — T65: apply the WHOLE 18-strategy
 *  ensemble to ONE stock the reader picks, live. This is the workbench half
 *  of the Strategy Lab (the record half stays /api/strategy-lab):
 *
 *    - every strategy's LIVE verdict on this tape (fired / direction /
 *      strength / evidence codes), computed by the same deterministic
 *      engine the walk-forward backtest replays — no lookahead, the
 *      candles end at the last session;
 *    - the ensemble consensus + vote counts;
 *    - each strategy's PUBLISHED track record from backtest.json beside
 *      its live verdict, so "this strategy says long NOW" always reads
 *      next to "this strategy did X% over the replay" — the lab's whole
 *      honesty contract;
 *    - the stock's own context (price, composite rating, ML read, insider
 *      filings) that the strategies voted on.
 *
 *  Errors degrade honestly: unknown ticker → 404 with the message; a data
 *  layer hiccup → 503. Nothing is invented. */

const FAMILY_LABEL_AR: Record<StrategyFamily, string> = {
  trend: "ترند",
  momentum: "زخم",
  reversion: "ارتداد",
  volume: "حجم",
  fundamental: "أساسي",
  news: "أخبار",
  ml: "تعلم آلة",
  flow: "تدفقات",
};

type TrackRecord = {
  backtested: boolean;
  cumPct: number | null;
  benchCumPct: number | null;
  trades: number | null;
  hitRate: number | null;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const ticker = (url.searchParams.get("ticker") ?? "").trim().toUpperCase();
  if (!ticker) {
    return NextResponse.json({ error: "ticker query parameter required" }, { status: 400 });
  }
  const row = await signalForTicker(ticker);
  if (!row) {
    return NextResponse.json({ error: `no live signal for ${ticker} — unknown ticker or not enough candle history` }, { status: 404 });
  }

  // the published record, keyed by strategy id
  const rec = new Map<string, TrackRecord>();
  for (const s of backtest.perStrategy ?? []) {
    const st = (s as { stats?: Record<string, number | null> }).stats ?? {};
    rec.set((s as { id: string }).id, {
      backtested: Boolean((s as { backtested?: boolean }).backtested),
      cumPct: (st.strategyCumPct as number | null) ?? null,
      benchCumPct: (st.benchCumPct as number | null) ?? null,
      trades: (st.trades as number | null) ?? null,
      hitRate: (st.hitRate as number | null) ?? null,
    });
  }

  const verdicts = row.ensembleVerdicts ?? [];
  const strategies = STRATEGY_REGISTRY.map((s) => {
    const v = verdicts.find((x) => x.id === s.id) ?? null;
    const t = rec.get(s.id) ?? null;
    return {
      id: s.id,
      nameAr: s.nameAr,
      nameEn: s.nameEn,
      family: s.family,
      familyAr: FAMILY_LABEL_AR[s.family],
      weight: s.weight,
      oneLineAr: s.oneLineAr,
      oneLineEn: s.oneLineEn,
      live: v ? { fired: v.fired, direction: v.direction, score: v.score, evidence: v.evidence } : null,
      record: t,
    };
  });

  return NextResponse.json(
    {
      asOf: row.lastDate,
      ticker: row.ticker,
      name: row.name,
      nameAr: row.nameAr,
      close: row.close,
      changePct: row.changePct,
      composite: row.composite,
      compositeRating: row.compositeRating,
      rsi: row.rsi,
      pos52: row.pos52,
      ml: row.ml,
      insider: row.insider,
      ensemble: row.ensemble,
      strategies,
      honestNote:
        "Every verdict is machine-computed from the last session's candles and live scanner fields by the same deterministic engine the walk-forward backtest replays — no lookahead, no advice.",
    },
    { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=600" } }
  );
}
