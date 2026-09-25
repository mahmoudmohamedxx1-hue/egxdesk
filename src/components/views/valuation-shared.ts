/** T64 — shared types & helpers for the valuation & debt section
 *  ( valuation-view + its three tabs ). Mirrors the /api/valuation-map
 *  payload exactly; every extended field is nullable — the API never
 *  invents a number to fill a sector. */

import type { DebtZone, FvVerdict } from "@/lib/fair-value";

export type ValRow = {
  ticker: string;
  nameAr: string;
  nameEn: string;
  sector: string;
  sectorAr: string;
  close: number | null;
  pe: number | null;
  de: number | null;
  eps: number | null;
  marketCap: number | null;
  adjusted: number | null;
  quadrant: "value" | "leveraged" | "quality" | "expensive" | null;
  pb: number | null;
  roe: number | null;
  divYield: number | null;
  payout: number | null;
  dps: number | null;
  bvps: number | null;
  beta: number | null;
  gRevQ: number | null;
  netDebt: number | null;
  netIncomeTTM: number | null;
  netDebtToCap: number | null;
  debtZone: DebtZone | null;
  sectorPe: number | null;
  sectorPb: number | null;
  sectorRoe: number | null;
  fv: number | null;
  upside: number | null;
  fvCoverage: number | null;
  verdict: FvVerdict;
  fvR: number | null;
  fvG: number | null;
  models: { multPe: number | null; multPb: number | null; graham: number | null; ddm: number | null; justifiedPb: number | null };
};

export type ValSector = {
  sector: string;
  sectorAr: string;
  count: number;
  medianPe: number | null;
  medianDe: number | null;
  medianPb: number | null;
  medianRoe: number | null;
};

export type ValData = {
  asOf: string;
  total: number;
  medianPe: number | null;
  medianDe: number | null;
  counts: { value: number; leveraged: number; quality: number; expensive: number };
  quadrants: Record<string, { ar: string; en: string; hintAr: string; hintEn: string }>;
  sectors: ValSector[];
  assumptions: {
    rf: number;
    rfSource: string;
    erp: number;
    gCap: number;
    spreadMin: number;
    mos: number;
    weights: { multPe: number; multPb: number; graham: number; ddm: number; justifiedPb: number };
    note: string;
  };
  fvStats: { withFv: number; cheap: number; fair: number; rich: number; medianUpside: number | null };
  rows: ValRow[];
};

// ── formatting helpers (local, deterministic) ──

export const fmt2 = (v: number | null | undefined): string =>
  typeof v === "number" && Number.isFinite(v) ? v.toLocaleString("en-GB", { maximumFractionDigits: 2, minimumFractionDigits: 2 }) : "—";

export const fmt1 = (v: number | null | undefined): string =>
  typeof v === "number" && Number.isFinite(v) ? v.toLocaleString("en-GB", { maximumFractionDigits: 1 }) : "—";

export const fmtPct = (v: number | null | undefined, digits = 1): string =>
  typeof v === "number" && Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%` : "—";

export const fmtCap = (cap: number | null | undefined): string => {
  if (cap == null || !Number.isFinite(cap)) return "—";
  if (Math.abs(cap) >= 1e12) return `${(cap / 1e12).toFixed(1)}T`;
  if (Math.abs(cap) >= 1e9) return `${(cap / 1e9).toFixed(1)}B`;
  if (Math.abs(cap) >= 1e6) return `${(cap / 1e6).toFixed(0)}M`;
  if (Math.abs(cap) >= 1e3) return `${(cap / 1e3).toFixed(0)}K`;
  return String(Math.round(cap));
};
