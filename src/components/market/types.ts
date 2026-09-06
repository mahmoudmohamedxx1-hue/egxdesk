/** Shared client-side types for the live API payloads. */

export type CompanyRow = {
  ticker: string;
  name: string;
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
  divYield: number | null;
  biggestMover: { ticker: string; changePct: number } | null;
  topGainer: { ticker: string; changePct: number } | null;
  topLoser: { ticker: string; changePct: number } | null;
  turnoverLeader: { ticker: string; valueTraded: number } | null;
};
