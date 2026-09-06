/** Market-number formatting helpers. Western digits inside LTR-embedded spans. */

export function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
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
