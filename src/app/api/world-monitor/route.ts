import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** GET /api/world-monitor — مرصد العالم (the world monitor), cloned in
 *  structure from the source model's screen: currencies, oil, metals and
 *  the world's major indices, each move measured AGAINST ITS OWN TWO YEARS
 *  of same-length moves — "rare" vs "ordinary" is a percentile of history,
 *  not an opinion — then the same measure applied to the EGX indices so the
 *  reader can compare how the local market took the same wave.
 *
 *  Data: Yahoo Finance daily candles (2y), the same source our charts use.
 *  Cached 10 minutes. */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

type Asset = {
  id: string;
  yahoo: string;
  labelAr: string;
  labelEn: string;
  group: "currency" | "commodity" | "index";
  unitAr: string;
  unitEn: string;
};

const ASSETS: Asset[] = [
  { id: "USD", yahoo: "EGP=X", labelAr: "الدولار الأمريكي", labelEn: "US dollar", group: "currency", unitAr: "ج.م", unitEn: "EGP" },
  { id: "EUR", yahoo: "EURUSD=X", labelAr: "اليورو", labelEn: "Euro", group: "currency", unitAr: "ج.م", unitEn: "EGP" },
  { id: "GBP", yahoo: "GBPUSD=X", labelAr: "الجنيه الإسترليني", labelEn: "British pound", group: "currency", unitAr: "ج.م", unitEn: "EGP" },
  { id: "SAR", yahoo: "SARUSD=X", labelAr: "الريال السعودي", labelEn: "Saudi riyal", group: "currency", unitAr: "ج.م", unitEn: "EGP" },
  { id: "AED", yahoo: "AEDUSD=X", labelAr: "الدرهم الإماراتي", labelEn: "UAE dirham", group: "currency", unitAr: "ج.م", unitEn: "EGP" },
  { id: "BRENT", yahoo: "BZ=F", labelAr: "نفط برنت", labelEn: "Brent oil", group: "commodity", unitAr: "$", unitEn: "USD" },
  { id: "COPPER", yahoo: "HG=F", labelAr: "النحاس", labelEn: "Copper", group: "commodity", unitAr: "$", unitEn: "USD" },
  { id: "GOLD", yahoo: "GC=F", labelAr: "الذهب", labelEn: "Gold", group: "commodity", unitAr: "$", unitEn: "USD" },
  { id: "SILVER", yahoo: "SI=F", labelAr: "الفضة", labelEn: "Silver", group: "commodity", unitAr: "$", unitEn: "USD" },
  { id: "SPX", yahoo: "^GSPC", labelAr: "ستاندرد آند بورز 500", labelEn: "S&P 500", group: "index", unitAr: "", unitEn: "" },
  { id: "NDX", yahoo: "^IXIC", labelAr: "ناسداك", labelEn: "Nasdaq", group: "index", unitAr: "", unitEn: "" },
  { id: "FTSE", yahoo: "^FTSE", labelAr: "فوتسي 100", labelEn: "FTSE 100", group: "index", unitAr: "", unitEn: "" },
];

const WINDOWS = [
  { id: "week", sessions: 5, ar: "هذا الأسبوع", en: "This week" },
  { id: "month", sessions: 21, ar: "هذا الشهر", en: "This month" },
  { id: "quarter", sessions: 63, ar: "هذا الربع", en: "This quarter" },
] as const;

type Candle = { t: number; c: number };

async function yahooDaily(symbol: string): Promise<Candle[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2y&interval=1d&includePrePost=false`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`yahoo ${symbol} ${res.status}`);
  const json = (await res.json()) as {
    chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[] };
  };
  const r = json.chart?.result?.[0];
  if (!r?.timestamp?.length) throw new Error(`yahoo ${symbol} empty`);
  const closes = r.indicators?.quote?.[0]?.close ?? [];
  const out: Candle[] = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    const c = closes[i];
    if (typeof c === "number" && Number.isFinite(c)) out.push({ t: r.timestamp[i], c });
  }
  return out;
}

/** A move measured against its OWN history: the percentile of |window move|
 *  among all same-length moves of the last two years. ≥70 "unusual", ≥80
 *  "rare" — the source model's own bands (70/82/85 appeared live). */
function rarity(candles: Candle[], sessions: number): { movePct: number; percentile: number; typicalPct: number } | null {
  if (candles.length < sessions + 40) return null;
  const closes = candles.map((x) => x.c);
  const now = closes[closes.length - 1];
  const then = closes[closes.length - 1 - sessions];
  if (!then) return null;
  const movePct = ((now - then) / then) * 100;
  const moves: number[] = [];
  for (let i = sessions; i < closes.length; i++) {
    const a = closes[i - sessions];
    if (a) moves.push(Math.abs(((closes[i] - a) / a) * 100));
  }
  if (moves.length < 40) return null;
  moves.sort((a, b) => a - b);
  const abs = Math.abs(movePct);
  const below = moves.filter((m) => m < abs).length;
  const percentile = Math.round((below / moves.length) * 100);
  const typicalPct = moves[Math.floor(moves.length / 2)];
  return { movePct, percentile, typicalPct };
}

const fmtLevel = (v: number): string => (v >= 10_000 ? `${(v / 1000).toFixed(2)}K` : v >= 100 ? v.toFixed(1) : v.toFixed(2));

const USD_EGP = "EGP=X";

const CACHE_MS = 600_000;
let cache: { at: number; body: unknown } | null = null;

export async function GET() {
  if (cache && Date.now() - cache.at < CACHE_MS) return NextResponse.json(cache.body);
  try {
    const symbols = [...new Set([...ASSETS.map((a) => a.yahoo), USD_EGP])];
    const candles = await Promise.allSettled(symbols.map((s) => yahooDaily(s)));
    const bySymbol = new Map<string, Candle[]>();
    symbols.forEach((s, i) => {
      const r = candles[i];
      if (r.status === "fulfilled") bySymbol.set(s, r.value);
    });
    const usdEgpSeries = bySymbol.get(USD_EGP) ?? [];
    const usdEgp = usdEgpSeries.map((x) => x.c);

    const windowsOut = WINDOWS.map((w) => {
      const rows = ASSETS.map((a) => {
        const cs = bySymbol.get(a.yahoo);
        if (!cs?.length) return null;
        const last = cs[cs.length - 1].c;
        // EGP display AND rarity for non-USD currencies are both computed on
        // the EGP CROSS series (asset/USD × USD/EGP) — computing rarity on a
        // pegged pair (SAR/USD, AED/USD) yields degenerate statistics.
        let cross: { t: number; c: number }[] | null = null;
        if (a.group === "currency") {
          if (a.id === "USD") {
            cross = cs;
          } else if (usdEgpSeries.length) {
            const usdByT = new Map(usdEgpSeries.map((x) => [x.t, x.c]));
            cross = cs
              .map((x) => {
                const u = usdByT.get(x.t);
                return u ? { t: x.t, c: x.c * u } : null;
              })
              .filter((x): x is { t: number; c: number } => x !== null);
          }
        }
        const levelEgp = cross?.length ? cross[cross.length - 1].c : null;
        const r = rarity(cross ?? cs, w.sessions);
        if (!r) return null;
        const band = r.percentile >= 80 ? "rare" : r.percentile >= 70 ? "unusual" : "ordinary";
        return {
          id: a.id,
          labelAr: a.labelAr,
          labelEn: a.labelEn,
          group: a.group,
          unitAr: a.unitAr,
          unitEn: a.unitEn,
          level: a.group === "currency" ? (levelEgp ?? last) : last,
          levelEgp,
          levelDisplay: fmtLevel(a.group === "currency" ? (levelEgp ?? last) : last),
          asOf: new Date(cs[cs.length - 1].t * 1000).toISOString().slice(0, 10),
          movePct: Number(r.movePct.toFixed(2)),
          percentile: r.percentile,
          typicalPct: Number(r.typicalPct.toFixed(2)),
          band,
        };
      }).filter((x): x is NonNullable<typeof x> => x !== null);
      return { id: w.id, labelAr: w.ar, labelEn: w.en, sessions: w.sessions, rows };
    });

    const body = {
      asOf: new Date().toISOString(),
      basis: {
        ar: "تُقاس كل حركة مقابل سنتين من حركات بالطول نفسه — سجل لما حدث بالفعل، وليس قولاً عما سيحدث.",
        en: "Every move is placed against its own two years of same-length moves — a record of what has already happened, not a forecast.",
      },
      windows: windowsOut,
    };
    cache = { at: Date.now(), body };
    return NextResponse.json(body);
  } catch (e) {
    return NextResponse.json({ error: "world monitor unavailable", detail: String((e as Error)?.message ?? e).slice(0, 120) }, { status: 502 });
  }
}
