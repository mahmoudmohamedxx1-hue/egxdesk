import { NextResponse } from "next/server";
import { fetchUniverse, companyRow } from "@/lib/market";
import rawNetwork from "@/data/ownership-network.json";

/** GET /api/ownership-lens — the عدسة الملكية (Ownership Lens) payload.
 *
 *  T58 REBUILD (esthmr-grade): merges the LIVE universe (every listed stock —
 *  sector, market cap, today's change → the map canvas) with the parsed EGX
 *  DISCLOSURE NETWORK (src/data/ownership-network.json):
 *    - 1,396 named parties (people + firms, Arabic/English names);
 *    - 1,629 standing positions (holder → ticker, exact stake %, basis
 *      register|trade, as-of date, official bulletin link) — every ring's
 *      slices and every seat's percentage;
 *    - 37 weekly periods of stake moves — the week playback;
 *    - 41 listed-company → listed-company cross holdings;
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
type NetPerson = { n: string; e?: string; k: "p" | "f" };
type NetPeriod = { start: string; end: string; l: string; n: number; m: { h: number; t: string; f: number | null; o: number | null; c: number | null }[] };
type NetCross = { o: string; d: string; p: number | null; v: number | null; f?: string; s?: string };

const network = rawNetwork as unknown as {
  asOf: string;
  source: string;
  sourceAr: string;
  bulletinBase: string;
  people: NetPerson[];
  positions: NetPosition[];
  periods: NetPeriod[];
  cross: NetCross[];
  refused: { holder: string; t: string; why: string }[];
  counts: Record<string, number>;
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
