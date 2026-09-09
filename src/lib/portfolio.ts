"use client";

/** Client-side portfolio store (G2). Positions live in localStorage only —
 *  no account, no server, nothing leaves the device. The view recomputes
 *  day P&L / total P&L / weights on every quote refresh from the same
 *  /api/companies rows the market table renders. */

export type Position = {
  ticker: string;
  shares: number; // whole shares
  cost: number; // average EGP per share
  addedAt: string; // ISO
};

const PORTFOLIO_KEY = "egx-portfolio";

export function loadPositions(): Position[] {
  try {
    const raw = localStorage.getItem(PORTFOLIO_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (p): p is Position =>
        p &&
        typeof p === "object" &&
        typeof p.ticker === "string" &&
        Number.isFinite(p.shares) &&
        p.shares > 0 &&
        Number.isFinite(p.cost) &&
        p.cost > 0
    );
  } catch {
    return [];
  }
}

export function savePositions(list: Position[]): void {
  try {
    localStorage.setItem(PORTFOLIO_KEY, JSON.stringify(list));
  } catch {}
}
