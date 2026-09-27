"use client";

/** Paper-trading simulator store (T27 — P2-3 gap, TradingView/Schwab-style
 *  education flywheel). Virtual EGP cash, buy/sell executed at the SAME
 *  delayed quotes every other number in the app uses (~15 min), realistic
 *  EGX-style costs (0.25% brokerage commission, 5 EGP minimum), positions
 *  with live P&L recomputed from the quote table, and a full trade log.
 *  Everything lives on the device — no account, no server, no order book.
 *  The only thing it cannot simulate is execution itself (queue position,
 *  partial fills) and that is labeled honestly in the view. */

export type PaperPosition = {
  id: string;
  ticker: string;
  qty: number;
  avgPrice: number; // incl. commission (true cost basis)
  openedAt: string; // ISO
};

export type PaperTrade = {
  id: string;
  at: string; // ISO
  ticker: string;
  side: "buy" | "sell";
  qty: number;
  price: number; // executed price (delayed quote)
  fee: number;
  realizedPl: number | null; // sells only, net of fees
  note?: string;
};

export type PaperBook = {
  version: 1;
  startCash: number;
  cash: number;
  startedAt: string;
  positions: PaperPosition[];
  trades: PaperTrade[];
};

export const PAPER_START_CASH = 100_000;
export const PAPER_KEY = "egx-paper-book";
export const FEE_RATE = 0.0025; // 0.25% brokerage commission
export const FEE_MIN = 5; // EGP minimum per ticket

export function tradeFee(gross: number): number {
  if (!Number.isFinite(gross) || gross <= 0) return 0;
  return Math.max(FEE_MIN, gross * FEE_RATE);
}

export function emptyBook(startCash: number = PAPER_START_CASH): PaperBook {
  return {
    version: 1,
    startCash,
    cash: startCash,
    startedAt: new Date().toISOString(),
    positions: [],
    trades: [],
  };
}

export function loadBook(): PaperBook | null {
  try {
    const raw = localStorage.getItem(PAPER_KEY);
    if (!raw) return null;
    const b = JSON.parse(raw) as PaperBook;
    if (!b || typeof b.cash !== "number" || !Array.isArray(b.positions) || !Array.isArray(b.trades)) return null;
    return {
      version: 1,
      startCash: Number.isFinite(b.startCash) && b.startCash > 0 ? b.startCash : PAPER_START_CASH,
      cash: b.cash,
      startedAt: typeof b.startedAt === "string" ? b.startedAt : new Date().toISOString(),
      positions: b.positions.filter(
        (p) => p && typeof p.ticker === "string" && Number.isFinite(p.qty) && p.qty > 0 && Number.isFinite(p.avgPrice) && p.avgPrice > 0,
      ),
      trades: b.trades.filter(
        (t) =>
          t && (t.side === "buy" || t.side === "sell") && typeof t.ticker === "string" && Number.isFinite(t.qty) && t.qty > 0 && Number.isFinite(t.price),
      ),
    };
  } catch {
    return null;
  }
}

export function saveBook(b: PaperBook): void {
  try {
    localStorage.setItem(PAPER_KEY, JSON.stringify(b));
  } catch {}
}

export function clearBook(): void {
  try {
    localStorage.removeItem(PAPER_KEY);
  } catch {}
}

export type TradeResult =
  | { ok: true; book: PaperBook; trade: PaperTrade }
  | { ok: false; reason: "badQty" | "badPrice" | "insufficientCash" | "insufficientShares" | "noTicker" };

/** Execute a BUY at the given (delayed) price. Cost = qty×price + fee. */
export function buy(b: PaperBook, ticker: string, qty: number, price: number): TradeResult {
  const t = ticker.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!t) return { ok: false, reason: "noTicker" };
  const q = Math.floor(qty);
  if (!Number.isFinite(qty) || q < 1) return { ok: false, reason: "badQty" };
  if (!Number.isFinite(price) || price <= 0) return { ok: false, reason: "badPrice" };
  const gross = q * price;
  const fee = tradeFee(gross);
  const total = gross + fee;
  if (total > b.cash + 1e-9) return { ok: false, reason: "insufficientCash" };
  const existing = b.positions.find((p) => p.ticker === t);
  let positions = b.positions;
  if (existing) {
    const newQty = existing.qty + q;
    const newAvg = (existing.qty * existing.avgPrice + total) / newQty;
    positions = b.positions.map((p) => (p.ticker === t ? { ...p, qty: newQty, avgPrice: newAvg } : p));
  } else {
    positions = [...b.positions, { id: `p-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, ticker: t, qty: q, avgPrice: total / q, openedAt: new Date().toISOString() }];
  }
  const trade: PaperTrade = {
    id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    at: new Date().toISOString(),
    ticker: t,
    side: "buy",
    qty: q,
    price,
    fee,
    realizedPl: null,
  };
  return { ok: true, book: { ...b, cash: b.cash - total, positions, trades: [...b.trades, trade] }, trade };
}

/** Execute a SELL at the given (delayed) price. Proceeds = qty×price − fee;
 *  realized P&L = proceeds − qty×avgCost. */
export function sell(b: PaperBook, ticker: string, qty: number, price: number): TradeResult {
  const t = ticker.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!t) return { ok: false, reason: "noTicker" };
  const pos = b.positions.find((p) => p.ticker === t);
  if (!pos) return { ok: false, reason: "insufficientShares" };
  const q = Math.floor(qty);
  if (!Number.isFinite(qty) || q < 1) return { ok: false, reason: "badQty" };
  if (!Number.isFinite(price) || price <= 0) return { ok: false, reason: "badPrice" };
  if (q > pos.qty) return { ok: false, reason: "insufficientShares" };
  const gross = q * price;
  const fee = tradeFee(gross);
  const proceeds = gross - fee;
  const realized = proceeds - q * pos.avgPrice;
  const positions =
    pos.qty - q > 0
      ? b.positions.map((p) => (p.ticker === t ? { ...p, qty: p.qty - q } : p))
      : b.positions.filter((p) => p.ticker !== t);
  const trade: PaperTrade = {
    id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    at: new Date().toISOString(),
    ticker: t,
    side: "sell",
    qty: q,
    price,
    fee,
    realizedPl: realized,
  };
  return { ok: true, book: { ...b, cash: b.cash + proceeds, positions, trades: [...b.trades, trade] }, trade };
}

/** Reason strings for the active language. */
export function tradeErrText(reason: Exclude<TradeResult, { ok: true }>["reason"], lang: "ar" | "en"): string {
  switch (reason) {
    case "noTicker":
      return lang === "ar" ? "اختر رمزًا صحيحًا" : "Pick a valid ticker";
    case "badQty":
      return lang === "ar" ? "أدخل كمية صحيحة (١ فأكثر)" : "Enter a valid quantity (1 or more)";
    case "badPrice":
      return lang === "ar" ? "لا يوجد سعر حالي لهذه الورقة" : "No live price for this ticker";
    case "insufficientCash":
      return lang === "ar" ? "الرصيد النقدي لا يكفي (شامل العمولة)" : "Insufficient cash (including commission)";
    case "insufficientShares":
      return lang === "ar" ? "لا تملك هذا العدد من الأسهم" : "You don't hold that many shares";
  }
}
