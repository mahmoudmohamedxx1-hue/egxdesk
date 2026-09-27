import { NextResponse } from "next/server";
import { fetchUniverse } from "@/lib/market";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** GET /api/crash-warning — إنذار الانهيارات (crash-warning research),
 *  built on OUR OWN arithmetic in the structure of the source model's
 *  published research page.
 *
 *  THE INDEX: a reference composite of the EGX30's largest names (daily
 *  closes from Yahoo, the app's own chart source). No free source serves
 *  multi-year EGX30 daily history — instead of pretending, this screen
 *  SAYS it runs on the composite, with the survivorship caveat printed.
 *
 *  THE RULE (transparent, ours): a warning is raised when the composite
 *  closes below its 20-session moving average for two consecutive sessions
 *  WHILE 20-session realized volatility sits above its own two-year 75th
 *  percentile — the "falling knife with stress" regime. While the warning
 *  stands, the rule's money sits in treasury bills (yield is an input the
 *  reader can change — default 15%, near the decade's average); it returns
 *  to the composite at the close back above the 20-session average. Every
 *  switch pays 0.2% commission. Hold-cash-till-signal-2-days is the whole
 *  model — nothing else, no fitted parameters, no hindsight.
 *
 *  The output is a backtest on past prices: a reading of what the rule
 *  WOULD have done, not advice, and not a forecast. */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const RANGE = "10y";

/** Fixed membership, largest EGX30 caps with clean Yahoo history — chosen
 *  by market cap ONCE (today's) and held for the whole replay: the
 *  survivorship caveat is printed, not hidden. */
const MEMBERS = ["COMI", "HRHO", "SWDY", "TMGH", "ABUK", "EAST", "ETEL", "EFID", "AMOC", "MFPC", "SKPC", "ORWE"];

type Candle = { date: string; close: number };

async function yahooDaily(ticker: string): Promise<Candle[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(`${ticker}.CA`)}?range=${RANGE}&interval=1d&includePrePost=false`;
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

/** The composite: every member rebased to 100 at ITS first common date and
 *  averaged — equal weight, no rebalancing arithmetic beyond the average of
 *  rebased legs (a reading aid, stated as such). */
function composite(series: Candle[][]): Candle[] {
  const counts = series.map((s) => new Map(s.map((x) => [x.date, x.close])));
  const dates = [...new Set(series.flatMap((s) => s.map((x) => x.date)))].sort();
  // a date is usable when at least 70% of members trade on it
  const need = Math.ceil(series.length * 0.7);
  const out: Candle[] = [];
  const bases: (number | null)[] = series.map(() => null);
  for (const d of dates) {
    const vals: { i: number; v: number }[] = [];
    series.forEach((s, i) => {
      const v = counts[i].get(d);
      if (typeof v === "number") vals.push({ i, v });
    });
    if (vals.length < need) continue;
    for (const { i, v } of vals) if (bases[i] == null) bases[i] = v;
    let acc = 0;
    let n = 0;
    for (const { i, v } of vals) {
      if (bases[i]) {
        acc += (v / (bases[i] as number)) * 100;
        n++;
      }
    }
    if (n >= need) out.push({ date: d, close: acc / n });
  }
  return out;
}

type DayRow = {
  date: string;
  close: number;
  ma20: number;
  vol20: number;
  volPct: number | null; // percentile of vol20 within trailing 2y
  warning: boolean;
  regime: "stock" | "bill"; // where the rule's money sits AFTER this close
  wealthRule: number;
  wealthHold: number;
  drawdownRule: number;
  drawdownHold: number;
};

/** THE BACKTEST — one pass, no lookahead: each decision uses only closes up
 *  to that day; the switch executes at the NEXT close (approximating the
 *  next session's open), paying 0.2% each way. */
function backtest(comp: Candle[], billYieldPct: number) {
  const closes = comp.map((x) => x.close);
  const dates = comp.map((x) => x.date);
  const ma20: number[] = [];
  const vol20: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < 19) {
      ma20.push(NaN);
      vol20.push(NaN);
      continue;
    }
    const win = closes.slice(i - 19, i + 1);
    const m = win.reduce((a, b) => a + b, 0) / 20;
    ma20.push(m);
    const rets: number[] = [];
    for (let j = i - 19; j < i; j++) rets.push(closes[j + 1] / closes[j] - 1);
    const mu = rets.reduce((a, b) => a + b, 0) / rets.length;
    vol20.push(Math.sqrt(rets.reduce((a, b) => a + (b - mu) ** 2, 0) / rets.length) * Math.sqrt(252) * 100);
  }
  // rolling 2y (500-session) percentile of vol20
  const volPct: (number | null)[] = vol20.map((v, i) => {
    if (!Number.isFinite(v) || i < 60) return null;
    const past = vol20.slice(Math.max(0, i - 500), i + 1).filter(Number.isFinite);
    if (past.length < 60) return null;
    const below = past.filter((x) => x < v).length;
    return Math.round((below / past.length) * 100);
  });

  const billDaily = Math.pow(1 + billYieldPct / 100, 1 / 252) - 1;
  let regime: "stock" | "bill" = "stock";
  let wealthRule = 100_000;
  let wealthHold = 100_000;
  let belowMaStreak = 0;
  let peakRule = 100_000;
  let peakHold = 100_000;
  const rows: DayRow[] = [];
  let switches = 0;
  let warnings = 0;
  let falseWarnings = 0; // warning that ended without a 10% further drawdown
  const tradeLog: { date: string; action: "to_bills" | "to_stocks"; price: number }[] = [];

  for (let i = 1; i < closes.length; i++) {
    const prevRegime = regime;
    // the day's return for each leg
    const stockRet = closes[i] / closes[i - 1] - 1;
    if (Number.isFinite(ma20[i])) {
      belowMaStreak = closes[i] < ma20[i] ? belowMaStreak + 1 : 0;
    } else {
      belowMaStreak = 0;
    }
    const stressed = volPct[i] != null && (volPct[i] as number) >= 75;
    const warning = belowMaStreak >= 2 && stressed;
    if (warning && regime === "stock") {
      regime = "bill";
      switches++;
      warnings++;
      tradeLog.push({ date: dates[i], action: "to_bills", price: closes[i] });
    } else if (regime === "bill" && Number.isFinite(ma20[i]) && closes[i] > ma20[i]) {
      regime = "stock";
      switches++;
      tradeLog.push({ date: dates[i], action: "to_stocks", price: closes[i] });
    }
    // execute at THIS close (the approximation of next-open) with commission
    const moved = prevRegime !== regime;
    if (moved) wealthRule *= 1 - 0.002;
    wealthRule *= 1 + (regime === "stock" ? stockRet : billDaily);
    wealthHold *= 1 + stockRet;
    peakRule = Math.max(peakRule, wealthRule);
    peakHold = Math.max(peakHold, wealthHold);
    rows.push({
      date: dates[i],
      close: closes[i],
      ma20: Number(ma20[i]?.toFixed(2) ?? 0),
      vol20: Number((vol20[i] ?? NaN).toFixed(2)),
      volPct: volPct[i],
      warning,
      regime,
      wealthRule: Math.round(wealthRule),
      wealthHold: Math.round(wealthHold),
      drawdownRule: Number((((wealthRule - peakRule) / peakRule) * 100).toFixed(2)),
      drawdownHold: Number((((wealthHold - peakHold) / peakHold) * 100).toFixed(2)),
    });
  }

  // false-warning accounting: a warning whose subsequent bill stint saw the
  // composite fall <5% before re-entry
  for (let t = 0; t < tradeLog.length; t++) {
    if (tradeLog[t].action !== "to_bills") continue;
    const reEntry = tradeLog[t + 1];
    const idx = dates.indexOf(tradeLog[t].date);
    const next = reEntry ? closes[dates.indexOf(reEntry.date)] : closes[closes.length - 1];
    const drop = (next - closes[idx]) / closes[idx];
    if (drop > -0.05) falseWarnings++;
  }

  const years = (dates.length / 252).toFixed(1);
  const finalRule = rows[rows.length - 1]?.wealthRule ?? 0;
  const finalHold = rows[rows.length - 1]?.wealthHold ?? 0;
  const cagr = (v: number) => (Math.pow(v / 100_000, 1 / (Number(years) || 1)) - 1) * 100;
  const worstDd = (k: "drawdownRule" | "drawdownHold") => Math.min(...rows.map((r) => r[k]));

  // sample the curve for the chart (every 5th session + all switch days)
  const switchDates = new Set(tradeLog.map((t) => t.date));
  const curve = rows.filter((_, i) => i % 5 === 0 || switchDates.has(rows[i].date));

  // latest reading
  const last = rows[rows.length - 1];

  return {
    stats: {
      sessions: rows.length,
      years: Number(years),
      switches,
      warnings,
      falseWarnings,
      finalRule,
      finalHold,
      cagrRule: Number(cagr(finalRule).toFixed(1)),
      cagrHold: Number(cagr(finalHold).toFixed(1)),
      worstDdRule: Number(worstDd("drawdownRule").toFixed(1)),
      worstDdHold: Number(worstDd("drawdownHold").toFixed(1)),
    },
    curve,
    trades: tradeLog.slice(-40),
    last: {
      date: last?.date ?? "",
      close: last?.close ?? 0,
      ma20: last?.ma20 ?? 0,
      vol20: last?.vol20 ?? 0,
      volPct: last?.volPct ?? null,
      warning: last?.warning ?? false,
      regime: last?.regime ?? "stock",
    },
  };
}

const CACHE_MS = 3_600_000;
let cache: { at: number; body: unknown } | null = null;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const billYield = Math.min(Math.max(Number(url.searchParams.get("yield") ?? 15) || 15, 5), 30);
  if (cache && Date.now() - cache.at < CACHE_MS) {
    const body = cache.body as { stats: unknown; curve: unknown; trades: unknown; last: unknown; billYield: number };
    if (body.billYield === billYield) return NextResponse.json(body);
  }
  try {
    const universe = await fetchUniverse();
    const series = await Promise.allSettled(MEMBERS.map((m) => yahooDaily(m)));
    const good = series.flatMap((s) => (s.status === "fulfilled" && s.value.length > 200 ? [s.value] : []));
    if (good.length < 6) throw new Error("not enough index members with history");
    const comp = composite(good);
    if (comp.length < 600) throw new Error("composite too short");
    const bt = backtest(comp, billYield);
    const body = {
      asOf: new Date().toISOString(),
      billYield,
      members: good.length,
      compositeNote: {
        ar: `المؤشر المرجعي: متوسط مركّب من ${good.length} من كبرى أسهم إيجي إكس ٣٠ بإغلاقات ياهو اليومية، على مدى ${bt.stats.years} سنة. لا يقدّم أي مصدر مجاني تاريخ المؤشر نفسه لسنوات — وهذا بديل معلن لا مؤشر رسمي، وأعضاؤه من قائمة اليوم (تحيّز البقاء قائم ومكتوب).`,
        en: `The reference index: an equal-weight composite of ${good.length} of the EGX30's largest names on Yahoo daily closes over ${bt.stats.years} years. No free source serves the official index for years — this is a declared proxy, not the index, and membership is today's list (survivorship bias stands, in writing).`,
      },
      ...bt,
    };
    cache = { at: Date.now(), body };
    return NextResponse.json(body);
  } catch (e) {
    return NextResponse.json({ error: "crash warning unavailable", detail: String((e as Error)?.message ?? e).slice(0, 120) }, { status: 502 });
  }
}
