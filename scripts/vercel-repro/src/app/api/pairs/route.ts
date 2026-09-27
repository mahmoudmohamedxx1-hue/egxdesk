import { NextResponse } from "next/server";
import { fetchUniverse } from "@/lib/market";
import { arName } from "@/lib/ar-names";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** GET /api/pairs?pair=ABUK_MFPC&range=1Y — فروق الأسعار والتسوية (pairs &
 *  relative value): the named sector pairs the source screen carries — two
 *  listed companies that compete in the same business — compared on a
 *  price-return chart calibrated to base 100, plus the full valuation card
 *  (price, cap, profit, P/E, P/B, D/E, ROE, dividend yield).
 *
 *  The DIVERGENCE reading is honest arithmetic, not advice: how many
 *  standard deviations the pair's relative return sits from its own
 *  history over the chosen range — the same "ratio + σ" the source screen
 *  prints — with the standing caveat that pairs converge when they want to.
 *
 *  Data: Yahoo daily candles (the app's own chart source) + the live
 *  TradingView universe for the fundamentals. */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

type Pair = { id: string; a: string; b: string; labelAr: string; labelEn: string };

const PAIRS: Pair[] = [
  { id: "ABUK_MFPC", a: "ABUK", b: "MFPC", labelAr: "الأسمدة والكيماويات", labelEn: "Fertilizers & chemicals" },
  { id: "HELI_MASR", a: "HELI", b: "MASR", labelAr: "التطوير والإسكان", labelEn: "Development & housing" },
  { id: "COMI_CIEB", a: "COMI", b: "CIEB", labelAr: "البنوك التجارية الخاصة", labelEn: "Private commercial banks" },
  { id: "TMGH_PHDC", a: "TMGH", b: "PHDC", labelAr: "العقارات الفاخرة", labelEn: "Luxury real estate" },
  { id: "SKPC_AMOC", a: "SKPC", b: "AMOC", labelAr: "البتروكيماويات والتكرير", labelEn: "Petrochemicals & refining" },
  { id: "FWRY_EFIH", a: "FWRY", b: "EFIH", labelAr: "المدفوعات والتكنولوجيا", labelEn: "Payments & technology" },
];

const RANGES = { "6M": "6mo", "1Y": "1y", "2Y": "2y", "3Y": "3y", "5Y": "5y" } as const;

type Candle = { date: string; close: number };

async function yahooDaily(ticker: string, range: string): Promise<Candle[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(`${ticker}.CA`)}?range=${range}&interval=1d&includePrePost=false`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`yahoo ${ticker} ${res.status}`);
  const json = (await res.json()) as {
    chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[] };
  };
  const r = json.chart?.result?.[0];
  if (!r?.timestamp?.length) throw new Error(`yahoo ${ticker} empty`);
  const closes = r.indicators?.quote?.[0]?.close ?? [];
  const out: Candle[] = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    const c = closes[i];
    if (typeof c === "number" && Number.isFinite(c)) {
      out.push({ date: new Date(r.timestamp[i] * 1000).toISOString().slice(0, 10), close: c });
    }
  }
  return out;
}

/** join two series by date; base-100 both at the first common date; compute
 *  the RELATIVE line (a/b) and its σ-band stats over the window. */
function calibrate(a: Candle[], b: Candle[]) {
  const byDateA = new Map(a.map((x) => [x.date, x.close]));
  const byDateB = new Map(b.map((x) => [x.date, x.close]));
  const common = a.map((x) => x.date).filter((d) => byDateB.has(d));
  if (common.length < 30) return null;
  const a0 = byDateA.get(common[0])!;
  const b0 = byDateB.get(common[0])!;
  const points = common.map((d) => {
    const av = (byDateA.get(d)! / a0) * 100;
    const bv = (byDateB.get(d)! / b0) * 100;
    return { date: d, a: Number(av.toFixed(2)), b: Number(bv.toFixed(2)), ratio: Number((av / bv).toFixed(4)) };
  });
  const ratios = points.map((p) => p.ratio);
  const mean = ratios.reduce((x, y) => x + y, 0) / ratios.length;
  const sd = Math.sqrt(ratios.reduce((x, y) => x + (y - mean) ** 2, 0) / ratios.length) || 1e-9;
  const last = ratios[ratios.length - 1];
  const sigma = (last - mean) / sd;
  return { points, mean: Number(mean.toFixed(4)), sd: Number(sd.toFixed(4)), last: Number(last.toFixed(4)), sigma: Number(sigma.toFixed(2)) };
}

const CACHE_MS = 300_000;
const cache = new Map<string, { at: number; body: unknown }>();

export async function GET(req: Request) {
  const url = new URL(req.url);
  const pairId = url.searchParams.get("pair") ?? PAIRS[0].id;
  const rangeKey = (url.searchParams.get("range") ?? "1Y") as keyof typeof RANGES;
  const range = RANGES[rangeKey] ?? "1y";
  const pair = PAIRS.find((p) => p.id === pairId) ?? PAIRS[0];
  const key = `${pair.id}:${rangeKey}`;

  try {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return NextResponse.json(hit.body);

    const [a, b, universe] = await Promise.all([yahooDaily(pair.a, range), yahooDaily(pair.b, range), fetchUniverse()]);
    const cal = calibrate(a, b);
    if (!cal) throw new Error("not enough overlapping sessions");

    const card = (t: string) => {
      const s = universe.find((x) => x.ticker === t);
      return {
        ticker: t,
        nameAr: arName(t) ?? s?.name ?? t,
        nameEn: s?.name ?? t,
        close: s?.close ?? null,
        marketCap: s?.marketCap ?? null,
        netIncomeTTM: s?.netIncomeTTM ?? null,
        pe: s?.pe ?? null,
        pb: s?.pb ?? null,
        de: s?.debtToEquity ?? null,
        roe: s?.roe ?? null,
        divYield: s?.divYield ?? null,
      };
    };

    const body = {
      asOf: new Date().toISOString(),
      pair: { id: pair.id, a: pair.a, b: pair.b, labelAr: pair.labelAr, labelEn: pair.labelEn },
      range: rangeKey,
      pairs: PAIRS.map((p) => ({ id: p.id, labelAr: p.labelAr, labelEn: p.labelEn, a: p.a, b: p.b })),
      chart: { points: cal.points, mean: cal.mean, sd: cal.sd, last: cal.last, sigma: cal.sigma },
      cardA: card(pair.a),
      cardB: card(pair.b),
      note: {
        ar: "المعايرة بعائد السعر (أساس ١٠٠) — كل خط يبدأ من ١٠٠ في أول جلسة مشتركة. نسبة الخطّين ومجال الانحراف حساب إحصائي على النافذة المختارة، وليست إشارة إلى أن الزوج سيعود إلى التوازن.",
        en: "Calibrated to price return (base 100) — each line starts at 100 on the first common session. The ratio and its σ band are statistics of the chosen window, not a promise the pair converges.",
      },
    };
    cache.set(key, { at: Date.now(), body });
    return NextResponse.json(body);
  } catch (e) {
    return NextResponse.json({ error: "pairs unavailable", detail: String((e as Error)?.message ?? e).slice(0, 120) }, { status: 502 });
  }
}
