/** Shared client-side types for the live API payloads. */

export type CompanyRow = {
  ticker: string;
  name: string;
  /** Official EGX Arabic name (falls back to English name server-side). */
  nameAr: string;
  /** True when the exchange quotes this listing in US dollars. */
  usdQuoted?: boolean;
  sectorEn: string;
  sectorAr: string;
  sectorCode: string;
  close: number;
  changePct: number;
  changeAbs: number;
  volume: number;
  valueTraded: number;
  marketCap: number | null;
  pe: number | null;
  eps: number | null;
  divYield: number | null;
  perfW: number | null;
  perf1M: number | null;
  perf3M: number | null;
  perf6M: number | null;
  perfYTD: number | null;
  perfY: number | null;
  perf3Y: number | null;
  perf5Y: number | null;
  high52: number | null;
  low52: number | null;
  avgVolume: number | null;
  volumeRatio: number | null;
  industry?: string | null;
  netMarginTTM?: number | null;
  revenueTTM?: number | null;
  floatShares?: number | null;
  avgTurnover30?: number | null;
  high1M?: number | null;
  low1M?: number | null;
  updateMode?: string | null;
  // extended fundamentals (TradingView scanner)
  pb?: number | null;
  debtToEquity?: number | null;
  roe?: number | null;
  netIncomeTTM?: number | null;
  payoutRatio?: number | null;
  grossMarginTTM?: number | null;
  revenueGrowthQ?: number | null;
  netDebt?: number | null;
  employees?: number | null;
  nextEarnings?: number | null;
};

export type SessionMeta = {
  asOf: string;
  cairoTime: string;
  lastSession: string;
  open: boolean;
  delayMinutes: number;
  source: string;
};

export type IndexRow = {
  code: string;
  name: string;
  nameAr?: string;
  close: number;
  changePct: number;
  changeAbs: number;
  perf1M: number | null;
  perf6M: number | null;
  perfYTD: number | null;
  perfY: number | null;
  volume: number;
};

export type NewsRow = {
  id: string;
  title: string;
  link: string;
  publishedAt: string;
  snippet: string | null;
  source: string;
  categories: string[];
  /** T26: rule-based lexicon chip — "bullish" | "bearish" | "neutral". */
  sentiment?: "bullish" | "bearish" | "neutral";
  /** T26: EGX tickers plausibly mentioned (clickable). */
  tickers?: string[];
};

export type SectorCard = {
  code: string;
  nameAr: string;
  nameEn: string;
  count: number;
  up: number;
  down: number;
  flat: number;
  avgChangePct: number | null;
  capWeightedChangePct: number | null;
  marketCap: number;
  valueTraded: number;
  pe: number | null;
  pb: number | null;
  roe: number | null;
  divYield: number | null;
  biggestMover: { ticker: string; changePct: number } | null;
  topGainer: { ticker: string; changePct: number } | null;
  topLoser: { ticker: string; changePct: number } | null;
  turnoverLeader: { ticker: string; valueTraded: number } | null;
};

// ── investor-category flows (real EGX data) ──

export type FlowCatKey =
  | "EGY_RETAIL"
  | "EGY_INST"
  | "ARAB_RETAIL"
  | "ARAB_INST"
  | "FOR_RETAIL"
  | "FOR_INST";

export type FlowCatRow = {
  key: FlowCatKey;
  buy: number; // EGP mn
  sell: number; // EGP mn
  net: number; // EGP mn
  turnover: number; // EGP mn
  tradingPct: number;
};

export type BlockTradeRow = {
  name: string;
  qty: number;
  value: number; // EGP
  count: number;
};

export type FlowsToday = {
  asOf: string;
  scope: string;
  turnoverTotal: number;
  valueTradedOneWay: number;
  categories: FlowCatRow[];
  nationalityNet: { egyptians: number; arabs: number; foreigners: number };
  retailPct: number;
  instPct: number;
  blockTrades: BlockTradeRow[];
  source: string;
  sourceUrl: string;
  capturedAt: string;
};

export type ParticipationRow = {
  date: string;
  egyptiansPct: number | null;
  arabsPct: number | null;
  foreignersPct: number | null;
  totalValueEgpMn: number | null;
  egx30Close: number | null;
  egx30ChangePct: number | null;
};

export type FlowHistoryRow = {
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

export type FlowsSource = {
  name: string;
  url: string;
  role: string;
};

export type InvestorsData = {
  session: { asOf: string; lastSession: string; open: boolean; cairoTime: string };
  today: FlowsToday | null;
  flowsError: boolean;
  history: { flows: FlowHistoryRow[]; participation: ParticipationRow[] };
  sources: FlowsSource[];
};
