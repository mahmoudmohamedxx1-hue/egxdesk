/** T44 — SMART MONEY: the honest "whale radar" data layer.
 *
 *  The user asked whether big wallets can be tracked "through their code".
 *  For a traditional exchange like the EGX there are NO blockchain wallets to
 *  follow — so the honest whale footprint is exactly what the exchange
 *  itself publishes:
 *
 *   1. INVESTOR-CATEGORY FLOWS (daily, EGP mn): buy/sell/net per category
 *      (Egyptians / Arabs / Foreigners × retail / institutions) — the
 *      closest public thing to watching what the big money does. Foreign
 *      institutions ARE the EGX's whales.
 *   2. OFFICIAL INSIDER / MAJOR-HOLDER FILINGS: post-execution disclosure
 *      forms + treasury-share trades filed with the exchange (our
 *      src/data/insiders.json snapshot, harvested from the EGX's own
 *      disclosure records).
 *
 *  This module turns those two real sources into the per-ticker InsiderRead
 *  and the market-wide WhaleRead the ensemble's insider-flow and whale-watch
 *  strategies vote on — plus the digest the Whale Radar panel shows. No
 *  per-wallet simulation, no synthetic whales: if the flow layer is down the
 *  read is null and the strategies stay silent. */

import rawInsiders from "@/data/insiders.json";
import { fetchFlows, flowHistory, type FlowsSnapshot, type FlowHistoryPoint } from "@/lib/flows";
import type { InsiderRead, WhaleRead } from "@/lib/strategies";

type InsiderItem = {
  date: string; // YYYY-MM-DD
  ticker: string;
  action: string; // bought | sold | treasury_purchase | treasury_sale | disclosure | …
};

const insiders = rawInsiders as unknown as { asOf: string; items: InsiderItem[] };

// ── per-ticker insider read (90-day window on the filings snapshot) ──

const WINDOW_DAYS = 90;

function daysBetween(a: string, b: string): number {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return Infinity;
  return Math.abs(ta - tb) / 86_400_000;
}

/** Per-ticker filings read over the last 90 days of the snapshot. Pure,
 *  deterministic, O(items) — pre-indexed once per process. */
export function insiderReadFor(ticker: string): InsiderRead | null {
  const idx = insiderIndex();
  const rows = idx.get(ticker.toUpperCase());
  if (!rows || !rows.length) return null;
  const asOf = insiders.asOf; // snapshot date — the 90-day window ends here
  let buys = 0;
  let sells = 0;
  let treasuryBuys = 0;
  let treasurySells = 0;
  let lastDate: string | null = null;
  for (const r of rows) {
    if (daysBetween(r.date, asOf) > WINDOW_DAYS) continue;
    if (r.action === "bought") buys++;
    else if (r.action === "sold") sells++;
    else if (r.action === "treasury_purchase") treasuryBuys++;
    else if (r.action === "treasury_sale") treasurySells++;
    if (!lastDate || r.date > lastDate) lastDate = r.date;
  }
  if (buys + sells + treasuryBuys + treasurySells === 0) return null;
  return { buys, sells, treasuryBuys, treasurySells, lastDate };
}

let cachedIndex: Map<string, InsiderItem[]> | null = null;
function insiderIndex(): Map<string, InsiderItem[]> {
  if (cachedIndex) return cachedIndex;
  const m = new Map<string, InsiderItem[]>();
  for (const it of insiders.items ?? []) {
    if (!it?.ticker || !it?.date || !it?.action) continue;
    const arr = m.get(it.ticker) ?? [];
    arr.push(it);
    m.set(it.ticker, arr);
  }
  cachedIndex = m;
  return m;
}

// ── market-wide whale regime (real investor-category flows) ──

const g = globalThis as unknown as {
  __egxWhaleCache?: { read: WhaleRead | null; digest: SmartMoneyDigest | null; at: number };
};
const CACHE_TTL = 30 * 60_000; // flows update with the session — 30 min is honest

function whaleReadFrom(flows: FlowsSnapshot | null, hist: FlowHistoryPoint[]): WhaleRead | null {
  // flowHistory() is ordered NEWEST-FIRST (orderBy date desc)
  const latest = hist.length ? hist[0] : null;
  const snapFor = flows && flows.categories
    ? flows.categories.find((c) => c.key === "FOR_INST")
    : undefined;
  // prefer the PERSISTED history point (stable, session-stamped); fall back
  // to the live snapshot when the history is still warming up
  const asOf = latest?.date ?? flows?.asOf ?? null;
  const net1 = latest ? latest.forInst : snapFor ? snapFor.net : null;
  const last3 = hist.slice(0, 3); // newest three sessions
  const net3 = last3.length
    ? Number(last3.reduce((a, b) => a + b.forInst, 0).toFixed(1))
    : net1 !== null
      ? net1
      : null;
  const instShare = flows && Number.isFinite(flows.instPct) ? flows.instPct : null;
  if (net1 === null && net3 === null && instShare === null) return null;
  return {
    forInstNet1d: net1 !== null && Number.isFinite(net1) ? Number(net1.toFixed(1)) : null,
    forInstNet3d: net3,
    instSharePct: instShare,
    asOf,
  };
}

export type SmartMoneyDigest = {
  whale: WhaleRead;
  /** net EGP mn per nationality over the latest session (Egyptians/Arabs/Foreigners) */
  nationalityNet: { egyptians: number | null; arabs: number | null; foreigners: number | null };
  /** top names by net insider BUY filings in the 90-day window (≥1 buy, zero sells) */
  insiderBuys: { ticker: string; buys: number; treasuryBuys: number; lastDate: string | null }[];
  /** top names by net insider SELL filings in the window */
  insiderSells: { ticker: string; sells: number; lastDate: string | null }[];
  insidersAsOf: string;
  /** how the EGX answers the "can we track wallets?" question — shown verbatim */
  methodAr: string;
  methodEn: string;
};

function buildDigest(whale: WhaleRead, flows: FlowsSnapshot | null): SmartMoneyDigest {
  const nat = flows?.nationalityNet;
  const idx = insiderIndex();
  const buys: SmartMoneyDigest["insiderBuys"] = [];
  const sells: SmartMoneyDigest["insiderSells"] = [];
  for (const [ticker, rows] of idx) {
    let b = 0;
    let s = 0;
    let tb = 0;
    let last: string | null = null;
    for (const r of rows) {
      if (daysBetween(r.date, insiders.asOf) > WINDOW_DAYS) continue;
      if (r.action === "bought") b++;
      else if (r.action === "sold") s++;
      else if (r.action === "treasury_purchase") tb++;
      if (!last || r.date > last) last = r.date;
    }
    if (b > 0 && s === 0) buys.push({ ticker, buys: b, treasuryBuys: tb, lastDate: last });
    else if (s >= 2 && b === 0) sells.push({ ticker, sells: s, lastDate: last });
  }
  buys.sort((a, b) => b.buys + b.treasuryBuys - (a.buys + a.treasuryBuys));
  sells.sort((a, b) => b.sells - a.sells);
  return {
    whale,
    nationalityNet: {
      egyptians: nat ? Number(nat.egyptians.toFixed(1)) : null,
      arabs: nat ? Number(nat.arabs.toFixed(1)) : null,
      foreigners: nat ? Number(nat.foreigners.toFixed(1)) : null,
    },
    insiderBuys: buys.slice(0, 6),
    insiderSells: sells.slice(0, 6),
    insidersAsOf: insiders.asOf,
    methodAr:
      "البورصة التقليدية لا توجد بها محافظ على سلسلة كتل يمكن تتبعها — الأثر الحقيقي للحيتان هنا هو ما تنشره البورصة نفسها: تدفقات فئات المستثمرين (المؤسسات الأجنبية تحديدًا) وإفصاحات المتصلين والمساهمين الرئيسيين وأسهم الخزينة. هذه أرقام رسمية لا محاكاة فيها.",
    methodEn:
      "A traditional exchange has no on-chain wallets to track — the honest whale footprint is what the exchange itself publishes: investor-category flows (foreign institutions above all), insider/major-holder filings and treasury trades. Official numbers, zero simulation.",
  };
}

/** The shared smart-money read (flows + filings digest). Cached 30 minutes;
 *  null whale only when BOTH flow sources are unavailable (then the
 *  whale-watch strategy stays silent — honest silence). */
export async function smartMoney(): Promise<{
  whale: WhaleRead | null;
  digest: SmartMoneyDigest | null;
}> {
  const cached = g.__egxWhaleCache;
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    return { whale: cached.read, digest: cached.digest };
  }
  let flows: FlowsSnapshot | null = null;
  let hist: FlowHistoryPoint[] = [];
  try {
    flows = await fetchFlows();
  } catch {
    flows = null;
  }
  try {
    hist = await flowHistory(); // newest-first persisted sessions (desc)
  } catch {
    hist = [];
  }
  const read = whaleReadFrom(flows, hist);
  const digest = read ? buildDigest(read, flows) : null;
  g.__egxWhaleCache = { read, digest, at: Date.now() };
  return { whale: read, digest };
}
