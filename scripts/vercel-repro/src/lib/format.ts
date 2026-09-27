/** Market-number formatting helpers. Western digits inside LTR-embedded spans. */

export function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** T37 — price-adaptive level precision (entry/stop/target): 2dp above 20
 *  EGP, 3dp above 2, 4dp below — a fixed 2dp broke the R:R of low-priced
 *  names (see riskLevels). Matches riskLevels' own rounding. */
export function fmtLevel(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const dp = Math.abs(n) >= 20 ? 2 : Math.abs(n) >= 2 ? 3 : 4;
  return n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-US");
}

/** EGP value with m/bn suffix. */
export function fmtValue(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}bn`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}m`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return v.toFixed(0);
}

export function fmtPct(p: number | null | undefined, signed = true): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return "—";
  const s = p.toFixed(2);
  if (!signed) return `${s}%`;
  return `${p > 0 ? "+" : ""}${s}%`;
}

/** T39 — P/E display: a scanner-served P/E above 1000 means earnings are
 *  ~0.1% of price (near-zero TTM profit). The raw number (e.g. 3,406.3)
 *  is real but reads like fabricated data on screen, so extreme readings
 *  render as an explicit "—" dash; sorting/filtering still use the raw
 *  value. Negative/zero P/E (loss-making TTM) was already dashed. */
export function fmtPE(pe: number | null | undefined): string {
  if (pe === null || pe === undefined || !Number.isFinite(pe)) return "—";
  if (pe <= 0 || pe >= 1000) return "—";
  return pe >= 100 ? fmtNum(pe, 0) : fmtNum(pe, 1);
}

export function fmtRatio(r: number | null | undefined): string {
  if (r === null || r === undefined || !Number.isFinite(r)) return "—";
  return `${r.toFixed(2)}×`;
}

export function fmtDateAr(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtTimeAr(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function directionClass(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p) || p === 0) return "text-muted-foreground";
  return p > 0 ? "text-up" : "text-down";
}
