/** Server-side investor-category flows layer — REAL EGX data, no mock numbers.
 *
 *  Deep-research source map (verified reachable from this sandbox):
 *   1. Sigma Capital market page (sigma-cap.com) republishes the official EGX
 *      "investor distribution" table: buy / sell / net / turnover / trading %
 *      for Egyptians, Arabs & Foreigners, each split into retail (individuals)
 *      and institutions — plus block trades. Static HTML, no auth. PRIMARY.
 *   2. EGXBot (egxbot.com) daily session report: participation % by
 *      nationality + total traded value + indices, with a public archive of
 *      past sessions. Used for the participation-history chart. SECONDARY.
 *   3. The EGX official site itself (egx.com.eg/en/InvestorsTypeCharts.aspx)
 *      publishes the same breakdown but is unreachable from this network —
 *      documented for reference, not fetched.
 *
 *  Everything is parsed with arithmetic self-validation (net = buy − sell,
 *  totals = sums) so a layout change upstream fails loudly instead of
 *  silently feeding wrong numbers to the UI.
 */

import { marketStatus } from "./market-status";
import { db } from "./db";

// ─────────────────────────────────────────────────────────── types ───

export type CatKey =
  | "EGY_RETAIL"
  | "EGY_INST"
  | "ARAB_RETAIL"
  | "ARAB_INST"
  | "FOR_RETAIL"
  | "FOR_INST";

export type FlowCategory = {
  key: CatKey;
  buy: number; // EGP mn
  sell: number; // EGP mn
  net: number; // EGP mn
  turnover: number; // EGP mn (2-way)
  tradingPct: number; // share of total trading value
};

export type BlockTrade = {
  name: string;
  qty: number;
  value: number; // EGP
  count: number;
};

export type FlowsSnapshot = {
  asOf: string; // YYYY-MM-DD trading session
  scope: string;
  turnoverTotal: number; // 2-way, EGP mn
  valueTradedOneWay: number; // ≈ turnover / 2, EGP mn
  categories: FlowCategory[];
  nationalityNet: { egyptians: number; arabs: number; foreigners: number }; // EGP mn
  retailPct: number;
  instPct: number;
  blockTrades: BlockTrade[];
  source: string;
  sourceUrl: string;
  capturedAt: string; // ISO
};

export type ParticipationPoint = {
  date: string;
  egyptiansPct: number | null;
  arabsPct: number | null;
  foreignersPct: number | null;
  totalValueEgpMn: number | null;
  egx30Close: number | null;
  egx30ChangePct: number | null;
};

export type FlowHistoryPoint = {
  date: string;
  egyRetail: number;
  egyInst: number;
  arabRetail: number;
  arabInst: number;
  forRetail: number;
  forInst: number;
  egyNet: number;
  arabNet: number;
  forNet: number;
  turnover: number;
};

// ─────────────────────────────────────────────────────── constants ───

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const SIGMA_URL = "https://www.sigma-cap.com/main/x_market_page.overview?u_sess=";
const EGXBOT_URL = "https://egxbot.com/en/market-report";

export const FLOWS_SOURCES = [
  {
    name: "Sigma Capital — EGX investor distribution",
    url: SIGMA_URL,
    role: "Daily buy/sell/net by investor category (live table)",
  },
  {
    name: "EGXBot — session reports",
    url: EGXBOT_URL,
    role: "Participation % by nationality + archive of past sessions",
  },
  {
    name: "EGX official — InvestorsTypeCharts",
    url: "https://www.egx.com.eg/en/InvestorsTypeCharts.aspx",
    role: "Authoritative source (not reachable from this server's network)",
  },
] as const;

const CAT_KEYS: CatKey[] = [
  "EGY_RETAIL",
  "EGY_INST",
  "ARAB_RETAIL",
  "ARAB_INST",
  "FOR_RETAIL",
  "FOR_INST",
];

// ─────────────────────────────────────────────────────────── caching ───

type Entry = { data: unknown; at: number };
const cache = new Map<string, Entry>();
const stale = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

async function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data as T;
  const flying = inflight.get(key);
  if (flying) return flying as Promise<T>;
  const p = (async () => {
    try {
      const data = await loader();
      cache.set(key, { data, at: Date.now() });
      stale.set(key, { data, at: Date.now() });
      return data;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  try {
    return await p;
  } catch (err) {
    const s = stale.get(key);
    if (s) return s.data as T;
    throw err;
  }
}

// ─────────────────────────────────────────── HTML → text utilities ───

function textify(html: string): string[] {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const text = cleaned.replace(/<[^>]+>/g, "\n");
  const lines = text
    .split("\n")
    .map((l) =>
      l
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#\d+;/g, " ")
        .trim()
    )
    .filter(Boolean);
  return lines;
}

/** Numeric table cell like "11,900.42" or "-138.98" (no %, no parentheses). */
function numCell(line: string): number | null {
  if (!/^-?[\d.,]+$/.test(line)) return null;
  const v = Number(line.replace(/,/g, ""));
  return Number.isFinite(v) ? v : null;
}

/** Read n numeric lines starting at index i; returns [values, nextIndex]. */
function readNums(lines: string[], i: number, n: number): [number[], number] {
  const out: number[] = [];
  let j = i;
  while (j < lines.length && out.length < n) {
    const v = numCell(lines[j]);
    if (v === null) break;
    out.push(v);
    j++;
  }
  return [out, j];
}

function findLine(lines: string[], target: string): number {
  const t = target.toLowerCase();
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase() === t) return i;
  }
  return -1;
}

function isoDates(text: string): string[] {
  const out: string[] = [];
  const re = /(\d{4})-(\d{2})-(\d{2})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(`${m[1]}-${m[2]}-${m[3]}`);
  return out;
}

/** dd-mm-yyyy (Egyptian convention) dates → ISO. */
function euDates(text: string): string[] {
  const out: string[] = [];
  const re = /(\d{2})[/-](\d{2})[/-](\d{4})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const [, d, mo, y] = m;
    out.push(`${y}-${mo}-${d}`);
  }
  return out;
}

function latestDate(candidates: string[], notAfter: string): string | null {
  const valid = candidates.filter(
    (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= notAfter // ignore future disclosure dates
  );
  if (!valid.length) return null;
  return valid.sort().at(-1) ?? null;
}

// ─────────────────────────────── Sigma Capital table parsing ───────────
type RawTable = {
  buy: number[]; // 8 cols
  sell: number[];
  net: number[]; // 11 values
  turnover: number[];
  tradingPct: number[];
  blockTrades: BlockTrade[];
  scope: string;
};

function parseSigma(html: string): RawTable {
  const lines = textify(html);

  const buyIdx = findLine(lines, "Buy (M)");
  const sellIdx = findLine(lines, "Sell (M)");
  const netIdx = findLine(lines, "Net (M)");
  const turnIdx = findLine(lines, "Turnover (M)");
  const pctIdx = findLine(lines, "Trading %");
  if (buyIdx < 0 || sellIdx < 0 || netIdx < 0 || turnIdx < 0 || pctIdx < 0) {
    throw new Error("flows: table anchors not found");
  }

  const [buy] = readNums(lines, buyIdx + 1, 8);
  const [sell] = readNums(lines, sellIdx + 1, 8);
  const [net] = readNums(lines, netIdx + 1, 11);
  const [turnover] = readNums(lines, turnIdx + 1, 8);
  const [pct] = readNums(lines, pctIdx + 1, 8);
  if (buy.length !== 8 || sell.length !== 8 || net.length !== 11 || turnover.length !== 8 || pct.length !== 8) {
    throw new Error("flows: unexpected table shape");
  }

  // arithmetic self-validation — reject the whole parse if it does not add up
  const close = (a: number, b: number, tol = 0.06) => Math.abs(a - b) <= tol;
  for (let i = 0; i < 8; i++) {
    if (!close(net[i], buy[i] - sell[i])) throw new Error(`flows: net≠buy−sell at col ${i}`);
  }
  if (!close(net[8], net[0] + net[1]) || !close(net[9], net[2] + net[3]) || !close(net[10], net[4] + net[5])) {
    throw new Error("flows: nationality totals mismatch");
  }
  if (!close(buy[6], buy[0] + buy[2] + buy[4]) || !close(buy[7], buy[1] + buy[3] + buy[5])) {
    throw new Error("flows: retail/inst totals mismatch");
  }
  if (!close(sell[6], sell[0] + sell[2] + sell[4]) || !close(sell[7], sell[1] + sell[3] + sell[5])) {
    throw new Error("flows: sell totals mismatch");
  }

  // scope note ("Equities only, OPR included, OTC not included")
  const scopeLine = lines.find((l) => /equities only/i.test(l));
  const scope = scopeLine ? scopeLine.replace(/^\*\s*/, "") : "Equities only, OPR included, OTC not included";

  // block trades: groups of (name, qty, value, count) after the header
  const btIdx = lines.findIndex((l) => /^block trades$/i.test(l));
  const blockTrades: BlockTrade[] = [];
  if (btIdx >= 0) {
    // rows start right after the 'Count' header cell
    let i = lines.findIndex((l, idx) => idx > btIdx && /^count$/i.test(l));
    if (i >= 0) i++;
    else i = btIdx + 1;
    while (i < lines.length && blockTrades.length < 25) {
      const name = lines[i];
      if (!name || numCell(name) !== null) break; // numeric or empty → not a name → stop
      const [vals, next] = readNums(lines, i + 1, 3);
      if (vals.length !== 3) break;
      blockTrades.push({ name, qty: vals[0], value: vals[1], count: vals[2] });
      i = next;
    }
  }

  return { buy, sell, net, turnover, tradingPct: pct, blockTrades, scope };
}

export function sigmaSnapshotFromHtml(html: string): FlowsSnapshot {
  const t = parseSigma(html);
  const status = marketStatus();
  const asOf =
    latestDate([...isoDates(html).slice(0, 50), ...euDates(html).slice(0, 50)], status.cairoDate) ??
    status.lastSession;
  const categories: FlowCategory[] = CAT_KEYS.map((key, i) => ({
    key,
    buy: t.buy[i],
    sell: t.sell[i],
    net: t.net[i],
    turnover: t.turnover[i],
    tradingPct: t.tradingPct[i],
  }));
  const turnoverTotal = t.turnover[6] + t.turnover[7];
  return {
    asOf,
    scope: t.scope,
    turnoverTotal,
    valueTradedOneWay: turnoverTotal / 2,
    categories,
    nationalityNet: { egyptians: t.net[8], arabs: t.net[9], foreigners: t.net[10] },
    retailPct: t.tradingPct[6],
    instPct: t.tradingPct[7],
    blockTrades: t.blockTrades,
    source: "Sigma Capital (EGX market data)",
    sourceUrl: SIGMA_URL,
    capturedAt: new Date().toISOString(),
  };
}

export async function fetchFlows(): Promise<FlowsSnapshot> {
  return cached("flows:today", 300_000, async () => {
    const res = await fetch(SIGMA_URL, {
      headers: { "User-Agent": UA, Accept: "text/html,*/*" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) throw new Error(`sigma ${res.status}`);
    return sigmaSnapshotFromHtml(await res.text());
  });
}

// ────────────────────────────────── EGXBot session report parsing ───

type EgxbotReport = ParticipationPoint & { archiveDates: string[] };

function parseEgxbot(html: string, fallbackDate: string): EgxbotReport {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");

  const date = latestDate(isoDates(html.slice(0, 6000)), fallbackDate) ?? fallbackDate;

  // participation by nationality — English or Arabic phrasing
  let egyptiansPct: number | null = null;
  let arabsPct: number | null = null;
  let foreignersPct: number | null = null;
  const en = text.match(/Egyptians\s*([\d.]+)%[^%]*?Foreigners\s*([\d.]+)%[^%]*?Arabs\s*([\d.]+)%/i);
  if (en) {
    egyptiansPct = Number(en[1]);
    foreignersPct = Number(en[2]);
    arabsPct = Number(en[3]);
  } else {
    const ar = text.match(/مصريون\s*([\d.]+)%[^%]*?عرب\s*([\d.]+)%[^%]*?أجانب\s*([\d.]+)%|أجانب\s*([\d.]+)%[^%]*?عرب\s*([\d.]+)%/);
    if (ar) {
      if (ar[1]) {
        egyptiansPct = Number(ar[1]);
        arabsPct = Number(ar[2]);
        foreignersPct = Number(ar[3]);
      } else {
        foreignersPct = Number(ar[4]);
        arabsPct = Number(ar[5]);
      }
    }
  }

  // total value traded (one-way) — try market-level phrasings first and
  // ignore implausibly small matches (a single stock's turnover, etc.)
  let totalValueEgpMn: number | null = null;
  const valuePatterns: { re: RegExp; scale: number }[] = [
    { re: /إجمالي التداول\D{0,12}?([\d.]+)\s*مليار/i, scale: 1000 },
    { re: /إجمالي التداول\D{0,12}?([\d.]+)\s*مليون/i, scale: 1 },
    { re: /قيمة تداول\D{0,12}?([\d.]+)\s*مليار/i, scale: 1000 },
    { re: /Trading value:?\s*(?:≈?\s*)?EGP\s*([\d.]+)/i, scale: 1000 },
    { re: /Trading value\D{0,12}?([\d.]+)\s*billion/i, scale: 1000 },
    { re: /قيمة تداول\D{0,12}?([\d.]+)\s*مليون/i, scale: 1 },
    { re: /EGP\s*([\d.]+)\s*billion/i, scale: 1000 },
    { re: /EGP\s*([\d.]+)\s*million/i, scale: 1 },
  ];
  for (const p of valuePatterns) {
    const m = text.match(p.re);
    if (m) {
      const v = Number(m[1]) * p.scale;
      if (Number.isFinite(v) && v >= 2000) {
        totalValueEgpMn = v;
        break;
      }
    }
  }

  // EGX30 close + change
  let egx30Close: number | null = null;
  let egx30ChangePct: number | null = null;
  const idx = text.match(/EGX30\D{0,40}?([\d,.]+)\s*(?:نقطة)?\s*[+−-]?\s*[\d,.]+\s*[+−-]\s*([\d.]+)%/);
  if (idx) {
    egx30Close = Number(idx[1].replace(/,/g, ""));
    egx30ChangePct = Number(idx[2]);
  }

  const archiveDates = [...html.matchAll(/\/en\/market-report\/(\d{4}-\d{2}-\d{2})/g)].map((m) => m[1]);
  const uniqueDates = [...new Set(archiveDates)];

  return {
    date,
    egyptiansPct,
    arabsPct,
    foreignersPct,
    totalValueEgpMn,
    egx30Close,
    egx30ChangePct,
    archiveDates: uniqueDates,
  };
}

async function fetchEgxbotPage(path: string): Promise<string> {
  const res = await fetch(`https://egxbot.com${path}`, {
    headers: { "User-Agent": UA, Accept: "text/html,*/*" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`egxbot ${path} ${res.status}`);
  return res.text();
}

/** Current EGXBot session report (30 min cache). */
export async function fetchEgxbotCurrent(): Promise<ParticipationPoint> {
  return cached("egxbot:current", 1_800_000, async () => {
    const html = await fetchEgxbotPage("/en/market-report");
    const r = parseEgxbot(html, marketStatus().lastSession);
    return {
      date: r.date,
      egyptiansPct: r.egyptiansPct,
      arabsPct: r.arabsPct,
      foreignersPct: r.foreignersPct,
      totalValueEgpMn: r.totalValueEgpMn,
      egx30Close: r.egx30Close,
      egx30ChangePct: r.egx30ChangePct,
    };
  });
}

/** Immutable archive page (cached for the process lifetime). */
async function fetchEgxbotArchive(date: string): Promise<ParticipationPoint | null> {
  return cached(`egxbot:arc:${date}`, 86_400_000, async () => {
    try {
      const html = await fetchEgxbotPage(`/en/market-report/${date}`);
      const r = parseEgxbot(html, date);
      return {
        date,
        egyptiansPct: r.egyptiansPct,
        arabsPct: r.arabsPct,
        foreignersPct: r.foreignersPct,
        totalValueEgpMn: r.totalValueEgpMn,
        egx30Close: r.egx30Close,
        egx30ChangePct: r.egx30ChangePct,
      };
    } catch {
      return null;
    }
  });
}

// ────────────────────────────────── persistence & history ────────────

/** Upsert one flow day (called only when the market is closed, so the row is
 *  the final session figure; re-captures refine the same row). */
export async function persistFlowDay(snap: FlowsSnapshot): Promise<void> {
  try {
    await db.flowDay.upsert({
      where: { date: snap.asOf },
      create: {
        date: snap.asOf,
        scope: snap.scope,
        totalBuy: snap.categories.reduce((a, c) => a + c.buy, 0),
        totalSell: snap.categories.reduce((a, c) => a + c.sell, 0),
        turnover: snap.turnoverTotal,
        retailPct: snap.retailPct,
        instPct: snap.instPct,
      },
      update: {
        totalBuy: snap.categories.reduce((a, c) => a + c.buy, 0),
        totalSell: snap.categories.reduce((a, c) => a + c.sell, 0),
        turnover: snap.turnoverTotal,
        retailPct: snap.retailPct,
        instPct: snap.instPct,
        capturedAt: new Date(),
      },
    });
    for (const c of snap.categories) {
      await db.flowCat.upsert({
        where: { date_key: { date: snap.asOf, key: c.key } },
        create: { date: snap.asOf, key: c.key, buy: c.buy, sell: c.sell, net: c.net, turnover: c.turnover, tradingPct: c.tradingPct },
        update: { buy: c.buy, sell: c.sell, net: c.net, turnover: c.turnover, tradingPct: c.tradingPct },
      });
    }
  } catch (err) {
    console.error("flows: persist failed", err);
  }
}

async function upsertParticipation(p: ParticipationPoint) {
  try {
    await db.participationDay.upsert({
      where: { date: p.date },
      create: {
        date: p.date,
        egyptiansPct: p.egyptiansPct,
        arabsPct: p.arabsPct,
        foreignersPct: p.foreignersPct,
        totalValueEgpMn: p.totalValueEgpMn,
        egx30Close: p.egx30Close,
        egx30ChangePct: p.egx30ChangePct,
      },
      update: {
        egyptiansPct: p.egyptiansPct,
        arabsPct: p.arabsPct,
        foreignersPct: p.foreignersPct,
        totalValueEgpMn: p.totalValueEgpMn,
        egx30Close: p.egx30Close,
        egx30ChangePct: p.egx30ChangePct,
        capturedAt: new Date(),
      },
    });
  } catch (err) {
    console.error("flows: participation persist failed", err);
  }
}

let historyEnsured = false;

/** Make sure we have the participation history backfilled from EGXBot's
 *  public archive (bounded: at most the ~12 archived sessions) and the
 *  current report stored. Runs at most once per process. */
export async function ensureHistory(): Promise<void> {
  if (historyEnsured) return;
  historyEnsured = true;
  try {
    const current = await fetchEgxbotCurrent();
    await upsertParticipation(current);

    // archive links from the same current report page
    const html = await fetchEgxbotPage("/en/market-report");
    const dates = [...new Set([...html.matchAll(/\/en\/market-report\/(\d{4}-\d{2}-\d{2})/g)].map((m) => m[1]))];
    const existing = new Set((await db.participationDay.findMany({ select: { date: true } })).map((r) => r.date));
    const missing = dates.filter((d) => !existing.has(d)).slice(0, 15);
    const results = await Promise.allSettled(missing.map((d) => fetchEgxbotArchive(d)));
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) await upsertParticipation(r.value);
    }
  } catch (err) {
    console.error("flows: history backfill failed", err);
  }
}

/** Stored flow history, newest first (today included once persisted). */
export async function flowHistory(): Promise<FlowHistoryPoint[]> {
  const days = await db.flowDay.findMany({
    include: { cats: true },
    orderBy: { date: "desc" },
    take: 60,
  });
  return days.map((d) => {
    const cat = (k: string) => d.cats.find((c) => c.key === k);
    const egyR = cat("EGY_RETAIL");
    const egyI = cat("EGY_INST");
    const arR = cat("ARAB_RETAIL");
    const arI = cat("ARAB_INST");
    const foR = cat("FOR_RETAIL");
    const foI = cat("FOR_INST");
    return {
      date: d.date,
      egyRetail: egyR?.net ?? 0,
      egyInst: egyI?.net ?? 0,
      arabRetail: arR?.net ?? 0,
      arabInst: arI?.net ?? 0,
      forRetail: foR?.net ?? 0,
      forInst: foI?.net ?? 0,
      egyNet: (egyR?.net ?? 0) + (egyI?.net ?? 0),
      arabNet: (arR?.net ?? 0) + (arI?.net ?? 0),
      forNet: (foR?.net ?? 0) + (foI?.net ?? 0),
      turnover: d.turnover,
    };
  });
}

/** Stored participation history, oldest first (for trend charts). */
export async function participationHistory(): Promise<ParticipationPoint[]> {
  const rows = await db.participationDay.findMany({ orderBy: { date: "asc" }, take: 90 });
  return rows.map((r) => ({
    date: r.date,
    egyptiansPct: r.egyptiansPct,
    arabsPct: r.arabsPct,
    foreignersPct: r.foreignersPct,
    totalValueEgpMn: r.totalValueEgpMn,
    egx30Close: r.egx30Close,
    egx30ChangePct: r.egx30ChangePct,
  }));
}
