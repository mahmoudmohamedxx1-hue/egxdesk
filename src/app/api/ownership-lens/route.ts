import { NextResponse } from "next/server";
import { fetchUniverse, companyRow } from "@/lib/market";
import rawNetwork from "@/data/ownership-network.json";
import { mergeOwnershipNetwork, type MergedPerson } from "@/lib/ownership-merge";

/** GET /api/ownership-lens — the عدسة الملكية (Ownership Lens) payload.
 *
 *  T58 REBUILD (esthmr-grade): merges the LIVE universe (every listed stock —
 *  sector, market cap, today's change → the map canvas) with the parsed EGX
 *  DISCLOSURE NETWORK (src/data/ownership-network.json — counts are served
 *  live in the payload's `stats` block; the daily refresh daemon keeps the
 *  file current):
 *    - named parties (people + firms, Arabic/English names);
 *    - standing positions (holder → ticker, exact stake %, basis
 *      register|trade, as-of date, official bulletin link) — every ring's
 *      slices and every seat's percentage;
 *    - weekly periods of stake moves — the week playback;
 *    - listed-company → listed-company cross holdings;
 *    - the refused-filings honesty list.
 *
 *  GET ?ticker=COMI → the company ownership profile (top holders + exact
 *  percentages + the undisclosed remainder) for the stock-page Ownership card.
 *
 *  Honesty rules (same as the source): the grey remainder is ownership
 *  nobody was obliged to disclose — it is NOT free float; percentages belong
 *  to ONE company and are never summed; every position links to the official
 *  EGX bulletin PDF. */

export const dynamic = "force-dynamic";

type NetPosition = { h: number; t: string; p: number; a: string | null; b: "r" | "t"; f: string | null; s?: string };
type NetPerson = MergedPerson;
type NetPeriod = { start: string; end: string; l: string; n: number; m: { h: number; t: string; f: number | null; o: number | null; c: number | null }[] };
type NetCross = { o: string; d: string; p: number | null; v: number | null; f?: string; s?: string };

// T66 — the duplicate-holder merge runs ONCE per process on the static
// registry: filing-typos of the same person/company (leading "+",
// "ليمتد/ليميتد", "لالتصالات/للاتصالات", hamza/ة-ه variants…) become ONE
// holder, so the same name never shows twice with "4.5% and 15.6%". Guards
// keep genuinely different entities apart: first word must match (محمد ≠
// محمود), digits must match (pension-fund account ٦ ≠ account ٧),
// parenthetical suffixes must match ((CEFM) ≠ (SCFM)). Merged entries carry
// `alts` — the spellings they absorbed — and same-(holder, company)
// positions collapse to the latest filing. Deterministic; recomputed on
// every deploy so the daily data refresh inherits it automatically.
const merged = mergeOwnershipNetwork(rawNetwork as unknown as Parameters<typeof mergeOwnershipNetwork>[0]);

const network = {
  asOf: (rawNetwork as { asOf: string }).asOf,
  source: (rawNetwork as { source: string }).source,
  sourceAr: (rawNetwork as { sourceAr: string }).sourceAr,
  bulletinBase: (rawNetwork as { bulletinBase: string }).bulletinBase,
  people: merged.people,
  positions: merged.positions,
  periods: merged.periods,
  cross: (rawNetwork as unknown as { cross: NetCross[] }).cross,
  refused: (rawNetwork as unknown as { refused: { holder: string; t: string; why: string }[] }).refused,
  counts: (rawNetwork as { counts: Record<string, number> }).counts,
};

const bulletinUrl = (s?: string): string | null => (s ? `${network.bulletinBase}${s}.pdf` : null);

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const tickerParam = url.searchParams.get("ticker");
    const stocks = await fetchUniverse();
    const byTicker = new Map(stocks.map((s) => [companyRow(s).ticker, s]));

    // ── company ownership profile mode (stock-page Ownership card) ──
    if (tickerParam) {
      const t = tickerParam.trim().toUpperCase();
      const s = byTicker.get(t);
      if (!s) return NextResponse.json({ ok: false, error: "unknown ticker" }, { status: 404 });
      const r = companyRow(s);
      const positions = network.positions
        .filter((p) => p.t === t)
        .sort((a, b) => b.p - a.p)
        .map((p) => {
          const person = network.people[p.h] ?? { n: "?", k: "p" as const };
          return {
            holder: person.n,
            holderEn: person.e ?? null,
            holderAlts: person.alts ?? null,
            kind: person.k,
            pct: p.p,
            asOf: p.a,
            basis: p.b,
            filingId: p.f,
            bulletin: bulletinUrl(p.s),
          };
        });
      const disclosed = positions.reduce((a, p) => a + p.pct, 0);
      const crossOut = network.cross
        .filter((c) => c.o === t)
        .map((c) => ({ held: c.d, pct: c.p, valueEgp: c.v, filingId: c.f ?? null, bulletin: bulletinUrl(c.s) }));
      const crossIn = network.cross
        .filter((c) => c.d === t)
        .map((c) => ({ owner: c.o, pct: c.p, valueEgp: c.v, filingId: c.f ?? null, bulletin: bulletinUrl(c.s) }));
      return NextResponse.json(
        {
          ok: true,
          ticker: t,
          name: r.name,
          nameAr: r.nameAr,
          marketCap: s.marketCap,
          close: r.close,
          asOf: network.asOf,
          sourceAr: network.sourceAr,
          source: network.source,
          holders: positions,
          disclosedPct: Math.round(disclosed * 100) / 100,
          remainderPct: Math.max(0, Math.round((100 - disclosed) * 100) / 100),
          latestAsOf: positions[0]?.asOf ?? null,
          crossOut,
          crossIn,
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // ── full network mode (the map) ──
    const companies = stocks.map((s) => {
      const r = companyRow(s);
      return {
        ticker: r.ticker,
        name: r.name,
        nameAr: r.nameAr,
        sectorEn: r.sectorEn,
        sectorAr: r.sectorGroupAr ?? r.sectorAr,
        close: r.close,
        changePct: Math.round((s.changePct + Number.EPSILON) * 100) / 100,
        marketCap: s.marketCap,
      };
    });
    const listedSet = new Set(companies.map((c) => c.ticker));

    // positions for LISTED companies only (the board draws listed rings;
    // people whose stakes are all off-board still appear in the register)
    const positions = network.positions.filter((p) => listedSet.has(p.t));
    // period moves restricted to listed tickers too (the playback highlights rings)
    const periods = network.periods.map((per) => ({
      start: per.start,
      end: per.end,
      l: per.l,
      n: per.m.filter((m) => listedSet.has(m.t)).length,
      m: per.m.filter((m) => listedSet.has(m.t)),
    }));
    const cross = network.cross.filter((c) => listedSet.has(c.o) && listedSet.has(c.d));

    // per-holder aggregate for the register rows
    const holdCount = new Map<number, Set<string>>();
    for (const p of positions) {
      const set = holdCount.get(p.h) ?? new Set();
      set.add(p.t);
      holdCount.set(p.h, set);
    }

    return NextResponse.json(
      {
        ok: true,
        asOf: network.asOf,
        source: network.source,
        sourceAr: network.sourceAr,
        bulletinBase: network.bulletinBase,
        people: network.people,
        positions,
        periods,
        cross,
        refused: network.refused,
        companies,
        counts: {
          ...network.counts,
          listedPositions: positions.length,
          listedTickers: new Set(positions.map((p) => p.t)).size,
          partiesOnBoard: holdCount.size,
          // T66 — merge transparency: how many typo-variants were unified
          mergedVariants: merged.mergedVariants,
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "ownership lens unavailable", detail: err instanceof Error ? err.message : "unknown" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
