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
  const found =
    latestDate([...isoDates(html).slice(0, 50), ...euDates(html).slice(0, 50)], status.cairoDate) ??
    status.lastSession;
  // Task 23 fix — never stamp a snapshot with a date NEWER than the session
  // it can actually contain: overnight / pre-open / weekend captures still
  // show the LAST session's table, but stray dates in the HTML (footer
  // "generated at", ads, next-day headers) used to relabel those rows as
  // future sessions, creating phantom duplicate days in the flow-history
  // chart (e.g. a "Friday" row identical to Thursday). While the market is
  // open the table IS today's live session.
  const asOf = status.open ? status.cairoDate : found > status.lastSession ? status.lastSession : found;
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

type EgxbotReport = ParticipationPoint & {
  egx70Close: number | null;
  egx100Close: number | null;
  up: number | null; // breadth: shares that rose
  down: number | null; // breadth: shares that fell
  flat: number | null; // breadth: shares unchanged
  archiveDates: string[];
};

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

  // EGX30 close + change — try the strict "close + change + %" shape first,
  // then fall back to the first plausible close value anywhere after EGX30.
  let egx30Close: number | null = null;
  let egx30ChangePct: number | null = null;
  const idx = text.match(/EGX30\D{0,40}?([\d,.]+)\s*(?:نقطة)?\s*[+−-]?\s*[\d,.]+\s*[+−-]\s*([\d.]+)%/);
  if (idx) {
    egx30Close = Number(idx[1].replace(/,/g, ""));
    egx30ChangePct = Number(idx[2]);
  } else {
    for (const m of text.matchAll(/EGX30\D{0,40}?([\d][\d,.]{3,})/g)) {
      const v = Number(m[1].replace(/,/g, ""));
      if (Number.isFinite(v) && v > 10_000 && v < 200_000) {
        egx30Close = v;
        break;
      }
    }
  }

  // EGX70 EWI / EGX100 EWI closes — the report's market-summary table lists
  // them right after EGX30; validate the value range to avoid picking up
  // stray percentages or prose numbers. The label appears both as
  // "EGX70 (EWI) 21,192.67" and "EGX70 EWI 21,192.67" (archive pages), so the
  // EWI part is optional and tolerates parentheses (Task 23 fix: the current
  // report switched to the parenthesized form and the old pattern silently
  // returned null for egx70/egx100).
  const pick = (re: RegExp, lo: number, hi: number): number | null => {
    for (const m of text.matchAll(re)) {
      const v = Number(m[1].replace(/,/g, ""));
      if (Number.isFinite(v) && v > lo && v < hi) return v;
    }
    return null;
  };
  const ewi = String.raw`(?:\s*\(?\s*EWI\s*\)?)?`;
  const egx70Close = pick(new RegExp(`EGX70${ewi}\\s*([\\d][\\d,.]*)`, "gi"), 4_000, 60_000);
  const egx100Close = pick(new RegExp(`EGX100${ewi}\\s*([\\d][\\d,.]*)`, "gi"), 8_000, 80_000);

  // market breadth — two shapes (Task 23 fix: BreadthDay previously had NO
  // runtime writer, so the home breadth chart froze; now every EGXBot fetch
  // persists it):
  //  (a) the current report's "مؤشر الاتساع" table: شركات صاعدة/هابطة/بدون تغيير
  //  (b) the archive pages' AI narrative: "60 gainers versus 160 losers (18
  //      unchanged)" / "123 advancers vs 111 decliners and 22 unchanged" /
  //      "79 stocks rose versus 150 stocks declined (26 unchanged)"
  let up: number | null = null;
  let down: number | null = null;
  let flat: number | null = null;
  const arBreadth = text.match(
    /شركات\s*صاعدة\D{0,10}(\d+)\D{0,40}?شركات\s*هابطة\D{0,10}(\d+)\D{0,40}?بدون\s*تغيير\D{0,10}(\d+)/
  );
  const upWord = String.raw`(?:advancers?|gainers?|(?:stocks?|companies?|shares?)\s+(?:rose|advanced|gained|climbed|rose))`;
  const downWord = String.raw`(?:decliners?|losers?|(?:stocks?|companies?|shares?)\s+(?:declined|fell|dropped))`;
  const enBreadth = text.match(
    new RegExp(
      `(\\d+)\\s+${upWord}\\s*(?:versus|vs\\.?|and|to)\\s+(\\d+)\\s+${downWord}\\s*[(;]?\\s*(?:and\\s+)?(\\d+)\\s+unchanged`,
      "i"
    )
  );
  const breadth = arBreadth ?? enBreadth;
  if (breadth) {
    const n = (i: number) => {
      const v = Number(breadth[i]);
      return Number.isFinite(v) && v >= 0 && v <= 600 ? v : null;
    };
    up = n(1);
    down = n(2);
    flat = n(3);
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
    egx70Close,
    egx100Close,
    up,
    down,
    flat,
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
export async function fetchEgxbotCurrent(): Promise<EgxbotReport> {
  return cached("egxbot:current", 1_800_000, async () => {
    const html = await fetchEgxbotPage("/en/market-report");
    return parseEgxbot(html, marketStatus().lastSession);
  });
}

/** Immutable archive page (cached for the process lifetime). */
async function fetchEgxbotArchive(date: string): Promise<EgxbotReport | null> {
  return cached(`egxbot:arc:${date}`, 86_400_000, async () => {
    try {
      const html = await fetchEgxbotPage(`/en/market-report/${date}`);
      return parseEgxbot(html, date);
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

/** Store one day's real index closes (nulls allowed as "checked, no data"). */
async function upsertIndexDay(r: EgxbotReport) {
  try {
    await db.indexDay.upsert({
      where: { date: r.date },
      create: {
        date: r.date,
        egx30: r.egx30Close,
        egx70: r.egx70Close,
        egx100: r.egx100Close,
      },
      update: {
        egx30: r.egx30Close,
        egx70: r.egx70Close,
        egx100: r.egx100Close,
        capturedAt: new Date(),
      },
    });
  } catch (err) {
    console.error("flows: index day persist failed", err);
  }
}

/** Store one day's market breadth (shares up/down/flat). Written by every
 *  EGXBot fetch (current + archive) and by the overview route's live persist —
 *  Task 23 fix: this writer did not exist before, so the home breadth chart
 *  froze at the last one-time import. */
async function upsertBreadthDay(date: string, up: number | null, down: number | null, flat: number | null, source: string): Promise<void> {
  if (up === null || down === null || flat === null) return;
  try {
    // a live row counts the full listed universe (the same methodology the
    // historical esthmr rows used); EGXBot counts only traded names, so its
    // figures would make the last bar shrink vs. the rest of the chart —
    // keep the live row when one exists.
    const existing = await db.breadthDay.findUnique({ where: { date } });
    if (existing && existing.source === "live" && source !== "live") return;
    await db.breadthDay.upsert({
      where: { date },
      create: { date, up, down, flat, counted: up + down + flat, source },
      update: { up, down, flat, counted: up + down + flat, source, capturedAt: new Date() },
    });
  } catch (err) {
    console.error("flows: breadth day persist failed", err);
  }
}

/** Persist the LIVE breadth computed from the TradingView universe (final
 *  figure once the market has closed). Exported for the overview route so
 *  the breadth chart keeps updating even on days EGXBot is never hit. */
export async function persistBreadthLive(date: string, up: number, down: number, flat: number): Promise<void> {
  await upsertBreadthDay(date, up, down, flat, "live");
}

/** Sun–Thu trading dates (Africa/Cairo week), oldest first, excluding today —
 *  today is covered separately by the live current-report fetch. */
function tradingDaysBack(calendarDays: number): string[] {
  const cairoNow = new Date(Date.now() + 3 * 3600 * 1000);
  const today = Date.UTC(cairoNow.getUTCFullYear(), cairoNow.getUTCMonth(), cairoNow.getUTCDate());
  const out: string[] = [];
  for (let i = 1; i <= calendarDays; i++) {
    const d = new Date(today - i * 86_400_000);
    const wd = d.getUTCDay(); // 0 Sun … 6 Sat
    if (wd !== 5 && wd !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out.reverse();
}

/** Fetch a bounded list of dates with small concurrency. */
async function mapLimit<T>(items: string[], limit: number, fn: (item: string) => Promise<T>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const chunk = items.slice(i, i + limit);
    out.push(...(await Promise.all(chunk.map(fn))));
  }
  return out;
}

let historyEnsured = false;

/** One-time-per-process backfill of REAL daily history from EGXBot's public
 *  archive: participation % by nationality + EGX30/EGX70/EGX100 closes for
 *  every Sun–Thu session of the last ~14 weeks. Results persist in SQLite
 *  (null-marker rows mark holidays so they are not refetched), and each new
 *  trading day is appended automatically as the app keeps running. */
export async function ensureHistory(): Promise<void> {
  if (historyEnsured) return;
  historyEnsured = true;
  try {
    // 1) live current report → participation + today's index closes + breadth
    const current = await fetchEgxbotCurrent();
    await upsertParticipation(current);
    await upsertIndexDay(current);
    await upsertBreadthDay(current.date, current.up, current.down, current.flat, "egxbot");

    // 2) backfill past sessions from the dated archive pages
    const dates = tradingDaysBack(98);
    const existing = new Set((await db.indexDay.findMany({ select: { date: true } })).map((r) => r.date));
    const missing = dates.filter((d) => !existing.has(d));
    const reports = await mapLimit(missing, 5, (d) => fetchEgxbotArchive(d));
    for (const r of reports) {
      if (!r) continue; // network/5xx hiccup — retried on next process start
      await upsertIndexDay(r); // marker row even when values are null (holidays)
      if (r.egyptiansPct !== null || r.totalValueEgpMn !== null || r.egx30Close !== null) {
        await upsertParticipation(r);
      }
    }

    // 3) breadth-only backfill — sessions where index rows exist but the
    //    breadth block was never stored (Task 23: the frozen-home-chart fix;
    //    covers everything the one-time esthmr import missed, e.g. Sep 8-13)
    const breadthExisting = new Set((await db.breadthDay.findMany({ select: { date: true } })).map((r) => r.date));
    const breadthMissing = dates.filter((d) => !breadthExisting.has(d));
    if (breadthMissing.length > 0) {
      const breadthReports = await mapLimit(breadthMissing, 5, (d) => fetchEgxbotArchive(d));
      for (const r of breadthReports) {
        if (!r) continue;
        await upsertBreadthDay(r.date, r.up, r.down, r.flat, "egxbot");
      }
    }
  } catch (err) {
    console.error("flows: history backfill failed", err);
  }
}

/** Real index close history from the persisted archive, oldest first.
 *  @param days  window length in calendar days
 *  @param key   "egx30" | "egx70" | "egx100" */
export async function indexHistory(days: number, key: "egx30" | "egx70" | "egx100"): Promise<{ date: string; close: number }[]> {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const rows = await db.indexDay.findMany({
    where: { date: { gte: cutoff } },
    orderBy: { date: "asc" },
  });
  return rows
    .filter((r) => r[key] !== null)
    .map((r) => ({ date: r.date, close: r[key] as number }));
}

/** Stored market-breadth history (shares up / down / flat per session), oldest first. */
export async function breadthHistory(take = 40): Promise<{ date: string; up: number; down: number; flat: number; counted: number }[]> {
  const rows = await db.breadthDay.findMany({
    orderBy: { date: "desc" },
    take,
  });
  return rows.reverse().map((r) => ({
    date: r.date,
    up: r.up ?? 0,
    down: r.down ?? 0,
    flat: r.flat ?? 0,
    counted: r.counted ?? 0,
  }));
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
