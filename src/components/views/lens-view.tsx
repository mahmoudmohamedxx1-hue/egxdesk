"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../market/app-context";
import { bootParam, patchUrlParams } from "@/lib/url-state";
import { T, dn, type Lang } from "@/lib/i18n";
import { holderColor, hashStr } from "@/lib/holder-color";
import { Skeleton } from "@/components/ui/skeleton";

/** عدسة الملكية — the Ownership Lens (T59: dynamic, theme-aware, auto-updated).
 *
 *  An archipelago map of the whole exchange:
 *   - every sector is a "lake" — a treemap cell (sized by COMPANY COUNT so
 *     small issuers keep readable room) with an organic, name-seeded
 *     coastline that never moves between renders;
 *   - every company is a DONUT RING placed on a phyllotaxis (sunflower)
 *     spiral, radius ∝ √market-cap, and the ring's colored slices are each
 *     FILED holder's exact stake % from the official EGX disclosure forms;
 *     the grey remainder is ownership nobody had to disclose — NOT free float;
 *     companies with NO filed disclosure yet wear a dotted outline;
 *   - click a company → the camera FLIES to it and its equity structure
 *     opens ON THE SAME PAGE: holders get seats around it (pop-in, name +
 *     stake %, onward lines to every other company they are in) and the
 *     right panel shows the full ownership profile with bulletin links;
 *   - click a holder (register row / seat / spoke) → his investments across
 *     the stocks light up: spokes draw in with stake pills, his companies
 *     wear his color halo, the camera frames the whole portfolio, and the
 *     INVESTOR PORTFOLIO panel lists every holding with stake %, estimated
 *     stake value (pct × market cap), sector and the official filing link;
 *   - the week strip replays every disclosed week of stake changes: outer
 *     green/red arcs sized in stake points, halos on moved rings, ▶ plays;
 *   - the register lists every named party alphabetically BY POLICY (never
 *     ranked), searchable in Arabic and English;
 *   - the camera is touchpad-first: two-finger scroll pans the board 1:1
 *     with the fingers (both axes, momentum included), pinch / ctrl+scroll
 *     zooms at the cursor, a mouse notch still zooms, and a soft edge clamp
 *     keeps the map from ever being flung off-screen;
 *   - the data refreshes itself daily (GitHub Action → EGX disclosure
 *     archive rebuild → deploy) — the badge in the header shows the stamp.
 *
 *  Honesty rules baked into the drawing (from the source data):
 *   undisclosed ≠ free float · percentages belong to ONE company and are
 *   never summed · every position links to the official EGX bulletin PDF. */

// ── payload types (GET /api/ownership-lens) ─────────────────────────────────

type LensCompany = {
  ticker: string;
  name: string;
  nameAr: string;
  sectorEn: string;
  sectorAr: string;
  close: number | null;
  changePct: number;
  marketCap: number | null;
};

type NetPerson = { n: string; e?: string; k: "p" | "f"; alts?: string[] };
type NetPosition = { h: number; t: string; p: number; a: string | null; b: "r" | "t"; f: string | null; s?: string };
type NetPeriod = {
  start: string;
  end: string;
  l: string;
  n: number;
  m: { h: number; t: string; f: number | null; o: number | null; c: number | null }[];
};
type NetCross = { o: string; d: string; p: number | null; v: number | null; f?: string; s?: string };

type LensPayload = {
  ok: boolean;
  asOf: string;
  source: string;
  sourceAr: string;
  bulletinBase: string;
  people: NetPerson[];
  positions: NetPosition[];
  periods: NetPeriod[];
  cross: NetCross[];
  refused: { holder: string; t: string; why: string }[];
  companies: LensCompany[];
  counts: Record<string, number>;
};

// ── deterministic layout math ───────────────────────────────────────────────

const W = 1200;
const H = 760;
const GOLDEN = Math.PI * (3 - Math.sqrt(5)); // ~137.5°
const RING_MIN = 15;
const RING_MAX = 34;
const BAND = 7; // slice band thickness

/** mulberry32 seeded PRNG — deterministic coastline per sector name. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Squarified treemap — deterministic, same algorithm family as T57. */
type Rect = { code: string; x: number; y: number; w: number; h: number };
function squarify(items: { code: string; area: number }[], x: number, y: number, w: number, h: number): Rect[] {
  const out: Rect[] = [];
  const total = items.reduce((s, i) => s + i.area, 0) || 1;
  const scale = (w * h) / total;
  let cx = x;
  let cy = y;
  let cw = w;
  let ch = h;
  let rest = [...items];
  while (rest.length) {
    const horizontal = cw >= ch; // lay a row along the SHORTER side
    const side = horizontal ? ch : cw;
    let row: typeof rest = [];
    let bestRatio = Infinity;
    for (let i = 0; i < rest.length; i++) {
      const cand = rest.slice(0, i + 1);
      const candArea = cand.reduce((s, it) => s + it.area, 0) * scale;
      const thick = candArea / side;
      if (thick <= 0) break;
      const worst = Math.max(...cand.map((it) => {
        const len = (it.area * scale) / thick;
        return Math.max(len / thick, thick / len);
      }));
      if (worst <= bestRatio || i === 0) {
        bestRatio = worst;
        row = cand;
      } else break;
    }
    const rowArea = row.reduce((s, it) => s + it.area, 0) * scale;
    const thick = rowArea / side;
    let off = 0;
    for (const it of row) {
      const len = (it.area * scale) / thick;
      out.push(
        horizontal
          ? { code: it.code, x: cx, y: cy + off, w: thick, h: len }
          : { code: it.code, x: cx + off, y: cy, w: len, h: thick }
      );
      off += len;
    }
    if (horizontal) {
      cx += thick;
      cw -= thick;
    } else {
      cy += thick;
      ch -= thick;
    }
    rest = rest.slice(row.length);
  }
  return out;
}

/** Organic lake coastline: an inset ellipse whose radius wobbles with three
 *  name-seeded sinusoids — the SAME sector keeps the SAME coastline forever
 *  ("nothing moves unless the data moved"). Returns an SVG path + the safe
 *  inner ellipse for ring placement. */
function lakePath(
  cell: Rect,
  seedName: string
): { path: string; cx: number; cy: number; rx: number; ry: number } {
  const cx = cell.x + cell.w / 2;
  const cy = cell.y + cell.h / 2;
  const rx = Math.max(18, (cell.w / 2) * 0.86);
  const ry = Math.max(18, (cell.h / 2) * 0.84);
  const rnd = mulberry32(hashStr(seedName));
  const p1 = rnd() * Math.PI * 2;
  const p2 = rnd() * Math.PI * 2;
  const p3 = rnd() * Math.PI * 2;
  const a1 = 0.05 + rnd() * 0.05;
  const a2 = 0.04 + rnd() * 0.05;
  const a3 = 0.03 + rnd() * 0.04;
  const N = 56;
  const pts: [number, number][] = [];
  for (let i = 0; i < N; i++) {
    const th = (i / N) * Math.PI * 2;
    const wob = 1 + a1 * Math.sin(2 * th + p1) + a2 * Math.sin(3 * th + p2) + a3 * Math.sin(5 * th + p3);
    pts.push([cx + Math.cos(th) * rx * wob, cy + Math.sin(th) * ry * wob]);
  }
  // closed smooth path through midpoints (quadratic)
  let d = `M ${(pts[0][0] + pts[N - 1][0]) / 2} ${(pts[0][1] + pts[N - 1][1]) / 2}`;
  for (let i = 0; i < N; i++) {
    const next = pts[(i + 1) % N];
    d += ` Q ${pts[i][0]} ${pts[i][1]} ${(pts[i][0] + next[0]) / 2} ${(pts[i][1] + next[1]) / 2}`;
  }
  return { path: d + " Z", cx, cy, rx: rx * 0.82, ry: ry * 0.82 };
}

/** SVG arc path for a ring slice (annular sector). Angles in radians,
 *  clockwise from the top (-π/2). */
function arcPath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const x0 = cx + Math.cos(a0) * r1;
  const y0 = cy + Math.sin(a0) * r1;
  const x1 = cx + Math.cos(a1) * r1;
  const y1 = cy + Math.sin(a1) * r1;
  const x2 = cx + Math.cos(a1) * r0;
  const y2 = cy + Math.sin(a1) * r0;
  const x3 = cx + Math.cos(a0) * r0;
  const y3 = cy + Math.sin(a0) * r0;
  return `M ${x0} ${y0} A ${r1} ${r1} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${r0} ${r0} 0 ${large} 0 ${x3} ${y3} Z`;
}

type Ring = {
  ticker: string;
  company: LensCompany;
  x: number;
  y: number;
  r: number;
};

type SectorLake = {
  code: string;
  labelAr: string;
  labelEn: string;
  cell: Rect;
  path: string;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rings: Ring[];
};

/** Phyllotaxis placement of company rings inside a lake, radius ∝ √cap,
 *  with a light pairwise anti-collision relaxation pass. */
function packRings(lake: Omit<SectorLake, "rings">, rows: LensCompany[], maxCap: number): Ring[] {
  const rings: Ring[] = [...rows]
    .sort((a, b) => (b.marketCap ?? 1e7) - (a.marketCap ?? 1e7))
    .map((company) => ({
      ticker: company.ticker,
      company,
      x: lake.cx,
      y: lake.cy,
      r: RING_MIN + (RING_MAX - RING_MIN) * Math.sqrt((company.marketCap ?? 1e7) / (maxCap || 1)),
    }));
  const spacing = Math.max(9, Math.sqrt((lake.rx * lake.ry) / (rings.length || 1)) * 0.72);
  rings.forEach((ring, i) => {
    if (i === 0) {
      ring.x = lake.cx;
      ring.y = lake.cy;
      return;
    }
    const th = i * GOLDEN;
    const rad = spacing * Math.sqrt(i);
    ring.x = lake.cx + Math.cos(th) * rad * (lake.rx / Math.max(lake.rx, lake.ry));
    ring.y = lake.cy + Math.sin(th) * rad * (lake.ry / Math.max(lake.rx, lake.ry));
  });
  // clamp inside the lake ellipse (with a small margin), then relax overlaps
  for (const ring of rings) {
    const dx = (ring.x - lake.cx) / (lake.rx - ring.r - 2 || 1);
    const dy = (ring.y - lake.cy) / (lake.ry - ring.r - 2 || 1);
    const m = Math.hypot(dx, dy);
    if (m > 1) {
      ring.x = lake.cx + (dx / m) * (lake.rx - ring.r - 2);
      ring.y = lake.cy + (dy / m) * (lake.ry - ring.r - 2);
    }
  }
  for (let pass = 0; pass < 24; pass++) {
    let moved = false;
    for (let i = 0; i < rings.length; i++) {
      for (let j = i + 1; j < rings.length; j++) {
        const a = rings[i];
        const b = rings[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.01;
        const min = a.r + b.r + 2.5;
        if (dist < min) {
          const push = (min - dist) / 2;
          const ux = dx / dist;
          const uy = dy / dist;
          a.x -= ux * push;
          a.y -= uy * push;
          b.x += ux * push;
          b.y += uy * push;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  // final clamp — rings may poke the shore slightly; keep them on the water
  for (const ring of rings) {
    const dx = (ring.x - lake.cx) / (lake.rx - ring.r * 0.7 || 1);
    const dy = (ring.y - lake.cy) / (lake.ry - ring.r * 0.7 || 1);
    const m = Math.hypot(dx, dy);
    if (m > 1) {
      ring.x = lake.cx + (dx / m) * (lake.rx - ring.r * 0.7);
      ring.y = lake.cy + (dy / m) * (lake.ry - ring.r * 0.7);
    }
  }
  return rings;
}

const fmtCap = (v: number | null, lang: Lang): string => {
  if (v == null || !Number.isFinite(v)) return "—";
  const b = v / 1e9;
  if (b >= 1) return `${b.toFixed(1)}${lang === "ar" ? " مليار ج" : "B EGP"}`;
  return `${(v / 1e6).toFixed(0)}${lang === "ar" ? " مليون ج" : "M EGP"}`;
};
const fmtEgp = (v: number | null, lang: Lang): string => {
  if (v == null || !Number.isFinite(v)) return "—";
  const b = v / 1e9;
  if (b >= 1) return `${b.toFixed(2)}${lang === "ar" ? " مليار جنيه" : "B EGP"}`;
  return `${(v / 1e6).toFixed(1)}${lang === "ar" ? " مليون جنيه" : "M EGP"}`;
};
const fmtPct = (p: number): string => (p < 10 ? p.toFixed(2) : p.toFixed(1));

/** T71 — CONCRETE move sizing (the user's ask): the moved quantity in actual
 *  SHARES plus its EGP value. Total shares = market cap ÷ close (both from
 *  the live universe); moved shares = |Δ stake %| × total shares ÷ 100.
 *  Returns null when the price/cap is unknown — never a fabricated number. */
function moveSize(
  company: LensCompany | undefined,
  deltaPct: number | null | undefined
): { shares: number; valueEgp: number } | null {
  if (!company || company.marketCap == null || company.close == null || company.close <= 0 || deltaPct == null) return null;
  const fraction = Math.abs(deltaPct) / 100;
  return { shares: fraction * (company.marketCap / company.close), valueEgp: fraction * company.marketCap };
}

/** T71 — share-count formatter: compact western digits ("1.2M", "12.4K"). */
const fmtShares = (n: number): string => {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}K`;
  return `${Math.round(n)}`;
};

/** T73 — localized archive date with LATIN digits: the lens is a numeric
 *  surface (tickers, percentages, share counts are all western digits), so
 *  Arabic-Indic numerals on the same screen flip numeral systems mid-view.
 *  Arabic month names + Latin digits — the convention Egyptian financial
 *  media use. */
const fmtAsOf = (iso: string, lang: Lang): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  try {
    return d.toLocaleDateString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
};

/** T73 — compact bilingual cap label for the ring captions: adaptive
 *  magnitude (0.8B used to round UP to "1B" — a lie at that size) and a
 *  real Arabic unit in AR mode instead of a bare English "B". */
const capLabel = (c: LensCompany, lang: Lang): string => {
  if (c.marketCap == null || !Number.isFinite(c.marketCap)) return "—";
  const b = c.marketCap / 1e9;
  if (b >= 10) return `${b.toFixed(0)}${lang === "ar" ? " مليار ج" : "B"}`;
  if (b >= 1) return `${b.toFixed(1)}${lang === "ar" ? " مليار ج" : "B"}`;
  return `${(c.marketCap / 1e6).toFixed(0)}${lang === "ar" ? " مليون ج" : "M"}`;
};

/** T73 — estimated SHARES behind a filed stake: pct × (market cap ÷ close).
 *  Null when the price/cap is unknown — never a fabricated number. */
function stakeShares(company: LensCompany | undefined, pct: number): number | null {
  if (!company || company.marketCap == null || company.close == null || company.close <= 0) return null;
  return (pct / 100) * (company.marketCap / company.close);
}

// ── the view ────────────────────────────────────────────────────────────────

type Focus = { type: "company"; ticker: string } | { type: "holder"; h: number } | null;
type View = { k: number; x: number; y: number };

/** Soft camera clamp: the board (W×H scaled by k) may slide at most ~18% of
 *  the viewport past each edge — scrolling feels free, but the map can never
 *  be flung off-screen and lost (the reset button still flies home). */
const clampView = (v: View): View => {
  const k = Math.min(3, Math.max(0.6, v.k));
  const padX = W * 0.18;
  const padY = H * 0.18;
  return {
    k,
    x: Math.min(padX, Math.max(W - W * k - padX, v.x)),
    y: Math.min(padY, Math.max(H - H * k - padY, v.y)),
  };
};

type Slice = { h: number; pct: number; a0: number; a1: number; color: string };

export function LensView() {
  const { lang, navigate } = useApp();
  const [data, setData] = useState<LensPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus>(null);
  const [weekIdx, setWeekIdx] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [view, setView] = useState<View>({ k: 1, x: 0, y: 0 });
  const [hoverTip, setHoverTip] = useState<{ x: number; y: number; title: string; sub: string } | null>(null);
  const [query, setQuery] = useState("");
  const svgRef = useRef<SVGSVGElement | null>(null);

  // T72 — the investor BRIEF PANEL: choosing an investor opens a short,
  // data-grounded brief docked over the map itself. `briefClosed` lets the
  // user dismiss it with ✕ while KEEPING the holder focus on the board;
  // any focus change (choosing an investor again) re-opens it.
  const [briefClosed, setBriefClosed] = useState(false);
  useEffect(() => {
    setBriefClosed(false);
  }, [focus]);
  // T72 — scrolls the aside's holder-portfolio card into view when the
  // brief panel's "full profile" button is pressed
  const asideProfileRef = useRef<HTMLDivElement | null>(null);
  // T72 — the brief panel's own ref: on tall boards the map's bottom-right
  // corner can sit below the fold, so the panel gently scrolls itself into
  // view when it opens (block:"nearest" = zero movement when already on
  // screen). Keyed on data-readiness so it also fires when the panel mounts
  // LATE — e.g. a shared ?focus=h:… link whose data arrives after the focus
  // state was already restored from the URL.
  const briefPanelRef = useRef<HTMLDivElement | null>(null);
  const dataReady = !!data;
  useEffect(() => {
    if (focus?.type !== "holder" || briefClosed || !dataReady) return;
    briefPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [focus, briefClosed, dataReady]);

  // ── T69 — FULLSCREEN: native Fullscreen API when the browser grants it
  // (desktop Chrome/Safari/Android), CSS fixed-overlay fallback otherwise
  // (iOS Safari never fullscreens arbitrary elements — the map then becomes
  // a fixed inset-0 layer over the app). "fs" covers both modes; the
  // fullscreenchange listener keeps state honest for ESC / programmatic exits.
  const mapWrapRef = useRef<HTMLDivElement | null>(null);
  const [fs, setFs] = useState<boolean>(false);
  useEffect(() => {
    const onFsChange = () => setFs(document.fullscreenElement === mapWrapRef.current);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);
  const toggleFullscreen = () => {
    const el = mapWrapRef.current;
    if (!el) return;
    if (fs || document.fullscreenElement === el) {
      if (document.fullscreenElement === el) void document.exitFullscreen().catch(() => {});
      setFs(false);
      return;
    }
    if (el.requestFullscreen) {
      el.requestFullscreen()
        .then(() => setFs(true))
        .catch(() => setFs(true)); // API present but refused → CSS overlay mode
    } else {
      setFs(true); // no Fullscreen API (iOS Safari) → CSS overlay mode
    }
  };

  useEffect(() => {
    let alive = true;
    fetch("/api/ownership-lens", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: LensPayload) => {
        if (!alive) return;
        if (!j.ok) throw new Error("lens unavailable");
        setData(j);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  // shareable state: ?view=lens&focus=t:COMI|h:123&week=12
  useEffect(() => {
    const f = bootParam("focus");
    const w = bootParam("week");
    if (f) {
      const m = f.match(/^t:(\w+)$/) || f.match(/^h:(\d+)$/);
      if (m) {
         
        if (f[0] === "t") setFocus({ type: "company", ticker: f.slice(2) });
         
        else setFocus({ type: "holder", h: Number(f.slice(2)) });
      }
    }
    if (w && Number.isFinite(Number(w))) {
       
      setWeekIdx(Math.max(0, Number(w)));
    }
  }, []);
  // T73 — clamp a bogus ?week= once the payload is in: a deep link can
  // carry an out-of-range index (or the archive can shrink on a refresh) —
  // the strip used to show no selection at all while the URL kept the
  // impossible value. Snap to the newest real week instead.
  useEffect(() => {
    if (!data || weekIdx == null) return;
    if (weekIdx >= data.periods.length) {
      setWeekIdx(data.periods.length ? data.periods.length - 1 : null);
    }
  }, [data, weekIdx]);
  useEffect(() => {
    patchUrlParams({
      focus: focus ? (focus.type === "company" ? `t:${focus.ticker}` : `h:${focus.h}`) : null,
      week: weekIdx !== null ? String(weekIdx) : null,
    });
  }, [focus, weekIdx]);

  // week playback
  useEffect(() => {
    if (!playing || !data) return;
    const id = setInterval(() => {
      setWeekIdx((w) => {
        const next = (w ?? -1) + 1;
        if (next >= data.periods.length) {
          setPlaying(false);
          return w;
        }
        return next;
      });
    }, 1500);
    return () => clearInterval(id);
  }, [playing, data]);

  // ── derived layout ──
  const layout = useMemo(() => {
    if (!data) return null;
    const bySector = new Map<string, LensCompany[]>();
    for (const c of data.companies) {
      const key = c.sectorEn || "Unclassified";
      const g = bySector.get(key) ?? [];
      g.push(c);
      bySector.set(key, g);
    }
    // treemap by COMPANY COUNT (small issuers keep readable room)
    const items = [...bySector.entries()]
      .map(([en, rows]) => ({ code: en, area: rows.length, rows, labelAr: rows[0]?.sectorAr ?? en, labelEn: en }))
      .sort((a, b) => b.area - a.area);
    const cells = squarify(items.map((i) => ({ code: i.code, area: i.area })), 0, 0, W, H);
    const maxCap = Math.max(...data.companies.map((c) => c.marketCap ?? 0), 1);
    const sectors: SectorLake[] = [];
    const byTicker = new Map<string, Ring>();
    for (const cell of cells) {
      const it = items.find((i) => i.code === cell.code)!;
      const base = lakePath(cell, it.labelEn);
      const lake: SectorLake = { ...base, code: it.code, labelAr: it.labelAr, labelEn: it.labelEn, cell, rings: [] };
      if (cell.w < 70 || cell.h < 70) {
        // tiny sector: mini dots instead of rings
        lake.rings = it.rows.slice(0, 10).map((company, i) => ({
          ticker: company.ticker,
          company,
          x: base.cx + (((i % 5) - 2) * 11 * (base.rx / Math.max(base.rx, 1))),
          y: base.cy + (Math.floor(i / 5) - 1) * 11,
          r: 3.5,
        }));
      } else {
        lake.rings = packRings(lake, it.rows, maxCap);
      }
      lake.rings.forEach((r) => byTicker.set(r.ticker, r));
      sectors.push(lake);
    }

    // ring slices: positions grouped per ticker, sorted desc, over-disclosure rescaled
    const slicesByTicker = new Map<string, { slices: Slice[]; over: boolean; total: number }>();
    for (const [ticker, list] of data.positions.reduce((m, p) => {
      const arr = m.get(p.t) ?? [];
      arr.push(p);
      m.set(p.t, arr);
      return m;
    }, new Map<string, NetPosition[]>())) {
      const ring = byTicker.get(ticker);
      if (!ring) continue;
      const sorted = [...list].sort((a, b) => b.p - a.p);
      const total = sorted.reduce((s, p) => s + p.p, 0);
      const over = total > 100.5;
      const scale = over ? 100 / total : 1;
      let a = -Math.PI / 2;
      const slices: Slice[] = [];
      for (const p of sorted) {
        const span = (p.p * scale / 100) * Math.PI * 2;
        if (span > 0.0035) {
          const color = holderColor(data.people[p.h]?.n ?? String(p.h));
          if (span >= Math.PI * 2 - 0.002) {
            // T73 — a sole 100% stake: a single 2π arc renders NOTHING in
            // SVG (coincident endpoints → the arc segment is omitted and
            // the ring stays grey). Draw it as two half-arcs so the ring
            // actually wears its holder's color.
            slices.push({ h: p.h, pct: p.p, a0: a, a1: a + span / 2, color });
            slices.push({ h: p.h, pct: p.p, a0: a + span / 2, a1: a + span, color });
          } else {
            slices.push({ h: p.h, pct: p.p, a0: a, a1: a + span, color });
          }
        }
        a += span;
      }
      slicesByTicker.set(ticker, { slices, over, total: Math.round(total * 100) / 100 });
    }

    // holder → companies (bridges + seats + focus)
    const holderCompanies = new Map<number, string[]>();
    for (const p of data.positions) {
      if (!byTicker.has(p.t)) continue;
      const arr = holderCompanies.get(p.h) ?? [];
      if (!arr.includes(p.t)) arr.push(p.t);
      holderCompanies.set(p.h, arr);
    }

    // holder → positions (for holder focus % + portfolio values)
    const holderPositions = new Map<number, NetPosition[]>();
    for (const p of data.positions) {
      if (!byTicker.has(p.t)) continue;
      const arr = holderPositions.get(p.h) ?? [];
      arr.push(p);
      holderPositions.set(p.h, arr);
    }

    // company → positions (profile card + seats)
    const companyPositions = new Map<string, NetPosition[]>();
    for (const p of data.positions) {
      if (!byTicker.has(p.t)) continue;
      const arr = companyPositions.get(p.t) ?? [];
      arr.push(p);
      companyPositions.set(p.t, arr);
    }

    return {
      sectors,
      byTicker,
      slicesByTicker,
      holderCompanies,
      holderPositions,
      companyPositions,
      maxCap,
      coverage: { withStakes: slicesByTicker.size, total: byTicker.size },
    };
  }, [data]);

  // ── camera: touchpad two-finger scroll pans · pinch/ctrl-scroll & mouse
  //    notch zoom at the cursor · drag pans · eased fly-to · soft clamp ────
  const viewRef = useRef<View>({ k: 1, x: 0, y: 0 });
  const rafRef = useRef<number | null>(null);
  const cancelFlight = () => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };
  const applyView = (v: View) => {
    const c = clampView(v);
    viewRef.current = c;
    setView(c);
  };
  const flyTo = (target: View) => {
    cancelFlight();
    const from = { ...viewRef.current };
    const t0 = performance.now();
    const dur = 560;
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / dur);
      const e = ease(t);
      applyView({
        k: from.k + (target.k - from.k) * e,
        x: from.x + (target.x - from.x) * e,
        y: from.y + (target.y - from.y) * e,
      });
      rafRef.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    rafRef.current = requestAnimationFrame(step);
  };
  useEffect(() => cancelFlight, []);

  useEffect(() => {
    // dep on !!data: at cold mount the skeleton is showing (no <svg> yet), so
    // this must re-run when the map actually renders — otherwise the camera
    // listeners never attach and wheel/scroll does nothing on a fresh load.
    if (!data) return;
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cancelFlight();
      const v = viewRef.current;
      const rect = el.getBoundingClientRect();
      // A real mouse notch: line-mode deltas (Firefox/Safari) or big integer
      // pixel steps (Chrome) → zoom, as map muscle memory expects. Everything
      // else — a touchpad two-finger scroll, fractional pixel deltas, any
      // horizontal deltaX — pans the board 1:1 with the fingers, exactly like
      // scrolling a page: scroll down reveals what is below.
      const notch =
        e.deltaMode === 1 ||
        (e.deltaMode === 0 && e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 40);
      if (e.ctrlKey || e.metaKey || notch) {
        // pinch (browsers send ctrl+wheel) or a wheel notch → zoom at cursor
        const raw = notch ? (e.deltaY < 0 ? 1.12 : 1 / 1.12) : Math.exp(-e.deltaY * 0.012);
        const k = Math.min(3, Math.max(0.6, v.k * Math.min(1.25, Math.max(0.8, raw))));
        const px = ((e.clientX - rect.left) / rect.width) * W;
        const py = ((e.clientY - rect.top) / rect.height) * H;
        applyView({ k, x: px - ((px - v.x) / v.k) * k, y: py - ((py - v.y) / v.k) * k });
      } else {
        // touchpad scroll → pan (page-style direction, both axes, shift+wheel
        // is horizontal the way most browsers deliver it)
        let dx = e.deltaX;
        let dy = e.deltaY;
        if (e.deltaMode === 1) {
          dx *= 16;
          dy *= 16;
        } else if (e.deltaMode === 2) {
          dx *= rect.width;
          dy *= rect.height;
        }
        if (e.shiftKey && dx === 0) {
          dx = dy;
          dy = 0;
        }
        const s = W / rect.width;
        applyView({ k: v.k, x: v.x - dx * s, y: v.y - dy * s });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    // Safari reports touchpad pinch as proprietary gesture* events instead of
    // ctrl+wheel — support them so pinch-zoom works there too.
    let gestureK = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      cancelFlight();
      gestureK = viewRef.current.k;
    };
    const onGestureChange = (e: Event) => {
      const ge = e as Event & { scale?: number; clientX?: number; clientY?: number };
      e.preventDefault();
      const k = Math.min(3, Math.max(0.6, gestureK * (ge.scale ?? 1)));
      const v = viewRef.current;
      const rect = el.getBoundingClientRect();
      // anchor at the gesture point when Safari reports one, else at center
      const px = Number.isFinite(ge.clientX) ? ((ge.clientX! - rect.left) / rect.width) * W : W / 2;
      const py = Number.isFinite(ge.clientY) ? ((ge.clientY! - rect.top) / rect.height) * H : H / 2;
      applyView({ k, x: px - ((px - v.x) / v.k) * k, y: py - ((py - v.y) / v.k) * k });
    };
    el.addEventListener("gesturestart", onGestureStart, { passive: false });
    el.addEventListener("gesturechange", onGestureChange, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
    };
  }, [data]);
  const dragRef = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    cancelFlight();
    dragRef.current = { x: e.clientX, y: e.clientY, vx: viewRef.current.x, vy: viewRef.current.y };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragRef.current || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const sx = W / rect.width;
    const sy = H / rect.height;
    applyView({
      k: viewRef.current.k,
      x: dragRef.current.vx + (e.clientX - dragRef.current.x) * sx,
      y: dragRef.current.vy + (e.clientY - dragRef.current.y) * sy,
    });
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  /** zoom around the viewport center — the +/− buttons */
  const zoomStep = (f: number) => {
    cancelFlight();
    const v = viewRef.current;
    const k = Math.min(3, Math.max(0.6, v.k * f));
    applyView({ k, x: W / 2 - ((W / 2 - v.x) / v.k) * k, y: H / 2 - ((H / 2 - v.y) / v.k) * k });
  };

  // ── week effects ──
  const weekMoves = useMemo(() => {
    if (weekIdx === null || !data || !layout) return null;
    const per = data.periods[weekIdx];
    if (!per) return null;
    const byT = new Map<string, { h: number; from: number | null; to: number | null; c: number | null }[]>();
    for (const m of per.m) {
      const arr = byT.get(m.t) ?? [];
      arr.push({ h: m.h, from: m.f, to: m.o, c: m.c });
      byT.set(m.t, arr);
    }
    return { period: per, byT };
  }, [weekIdx, data, layout]);
  const movedTickers = useMemo(() => new Set(weekMoves ? [...weekMoves.byT.keys()] : []), [weekMoves]);

  // ── focus derivation ──
  const focusState = useMemo(() => {
    if (!layout || !focus) return null;
    if (focus.type === "company") {
      const ring = layout.byTicker.get(focus.ticker);
      if (!ring) return null;
      const positions = [...(layout.companyPositions.get(focus.ticker) ?? [])].sort((a, b) => b.p - a.p);
      // seats around the ring, multi-orbit when many holders; labels fan out
      // RADIALLY from the seat dot so they never stack on one another
      const seats = positions.map((p, i) => {
        const per = 8; // seats per orbit → 45° apart minimum
        const orbit = Math.floor(i / per);
        const slot = i % per;
        const R = ring.r + 40 + orbit * 56;
        const ang = -Math.PI / 2 + (slot / per) * Math.PI * 2 + orbit * (Math.PI / per);
        return {
          p,
          ang,
          x: ring.x + Math.cos(ang) * R,
          y: ring.y + Math.sin(ang) * R,
          color: holderColor(data ? data.people[p.h]?.n ?? String(p.h) : String(p.h)),
        };
      });
      const involved = new Set<number>(positions.map((p) => p.h));
      return { kind: "company" as const, ring, positions, seats, involved };
    }
    const holdings = [...(layout.holderPositions.get(focus.h) ?? [])].sort((a, b) => b.p - a.p);
    const rings = holdings.map((p) => layout.byTicker.get(p.t)).filter((r): r is Ring => !!r);
    if (!rings.length) return null;
    const cx = rings.reduce((s, r) => s + r.x, 0) / rings.length;
    const cy = rings.reduce((s, r) => s + r.y, 0) / rings.length;
    // push the holder node off any ring it overlaps
    let hx = cx;
    let hy = cy;
    for (const r of [...rings].sort((a, b) => Math.hypot(hx - a.x, hy - a.y) - Math.hypot(hx - b.x, hy - b.y))) {
      const d = Math.hypot(hx - r.x, hy - r.y);
      if (d < r.r + 26) {
        const ang = Math.atan2(hy - r.y, hx - r.x);
        hx = r.x + Math.cos(ang) * (r.r + 30);
        hy = r.y + Math.sin(ang) * (r.r + 30);
        break;
      }
    }
    const involvedTickers = new Set(rings.map((r) => r.ticker));
    return { kind: "holder" as const, holdings, rings, hx, hy, involvedTickers, h: focus.h };
  }, [focus, layout, data]);

  // ── camera follows the focus: company → frame it + its seats; holder →
  // frame the WHOLE portfolio; cleared → home. Manual zoom/pan cancels it. ──
  useEffect(() => {
    if (!layout || layout.byTicker.size === 0) return;
    const pad = 56;
    if (!focusState) {
      if (viewRef.current.k !== 1 || viewRef.current.x !== 0 || viewRef.current.y !== 0) flyTo({ k: 1, x: 0, y: 0 });
      return;
    }
    if (focusState.kind === "company") {
      const { ring } = focusState;
      const margin = ring.r + 96 + (focusState.seats.length > 8 ? 56 : 0);
      const k = Math.min(2.2, Math.max(0.75, Math.min(W / (margin * 2 + pad * 2), H / (margin * 2 + pad * 2))));
      flyTo({ k, x: W / 2 - k * ring.x, y: H / 2 - k * ring.y });
      return;
    }
    // holder: bounding box of every company he holds (+ the node itself)
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const r of [...focusState.rings, { x: focusState.hx, y: focusState.hy, r: 10 } as Ring]) {
      x0 = Math.min(x0, r.x - r.r);
      y0 = Math.min(y0, r.y - r.r);
      x1 = Math.max(x1, r.x + r.r);
      y1 = Math.max(y1, r.y + r.r);
    }
    const bw = Math.max(80, x1 - x0) + pad * 2;
    const bh = Math.max(80, y1 - y0) + pad * 2;
    const k = Math.min(2.2, Math.max(0.6, Math.min(W / bw, H / bh)));
    flyTo({ k, x: W / 2 - k * (x0 + x1) / 2, y: H / 2 - k * (y0 + y1) / 2 });
     
  }, [focusState, layout]);

  // ── register (alphabetical BY POLICY — never ranked) ──
  const register = useMemo(() => {
    if (!data || !layout) return { people: [] as NetPerson[], companies: [] as LensCompany[] };
    const q = query.trim().toLowerCase();
    const onBoard = (h: number) => (layout.holderCompanies.get(h)?.length ?? 0) > 0;
    let people = data.people.filter((_, i) => onBoard(i));
    if (q) people = people.filter((p) => p.n.toLowerCase().includes(q) || (p.e ?? "").toLowerCase().includes(q));
    people = [...people].sort((a, b) => a.n.localeCompare(b.n, "ar"));
    let companies = data.companies;
    if (q) {
      companies = companies.filter(
        (c) =>
          c.ticker.toLowerCase().includes(q) ||
          (c.name ?? "").toLowerCase().includes(q) ||
          (c.nameAr ?? "").includes(query.trim())
      );
    }
    return { people: people.slice(0, 400), peopleTotal: people.length, companies: companies.slice(0, 30) };
  }, [data, layout, query]);

  // header stats + auto-update stamp
  const stats = useMemo(() => {
    if (!data || !layout) return null;
    let capOfStakes = 0;
    for (const p of data.positions) {
      const ring = layout.byTicker.get(p.t);
      if (ring?.company.marketCap) capOfStakes += (p.p / 100) * ring.company.marketCap;
    }
    const asOfMs = Date.parse(data.asOf);
    const ageHours = Number.isFinite(asOfMs) ? (Date.now() - asOfMs) / 36e5 : Infinity;
    return {
      companies: layout.byTicker.size,
      parties: layout.holderCompanies.size,
      stakes: data.counts.listedPositions ?? data.positions.length,
      capOfStakes,
      coverage: layout.coverage,
      asOf: data.asOf,
      fresh: ageHours < 48,
    };
  }, [data, layout]);

  // T73 — RANK BY VALUE among all named parties on the board. The register
  // itself stays alphabetical BY POLICY (never ranked) — this map only feeds
  // one factual sentence in the brief ("his filed stakes rank #N by value
  // among the M named parties"), computed exactly like the brief's own
  // values: every stake's pct × the live market cap of its company.
  // T74 FIX — this useMemo sat BELOW the loading/error early returns: when
  // data arrived after the skeleton paint the hook count changed mid-mount
  // and React threw "Rendered more hooks than during the previous render"
  // (a latent crash on every cold load of the lens). Hooks must run before
  // any early return; the memo already null-guards cold data.
  const holderValueRank = useMemo(() => {
    if (!data || !layout) return null;
    const totals = new Map<number, number>();
    for (const p of data.positions) {
      const ring = layout.byTicker.get(p.t);
      if (!ring?.company.marketCap) continue;
      totals.set(p.h, (totals.get(p.h) ?? 0) + (p.p / 100) * ring.company.marketCap);
    }
    const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    const rankOf = new Map<number, number>();
    ranked.forEach(([h], i) => rankOf.set(h, i + 1));
    return { rankOf, total: ranked.length };
  }, [data, layout]);

  if (error)
    return (
      <div className="p-4">
        <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
          {lang === "ar" ? "تعذّر تحميل عدسة الملكية الآن — أعد المحاولة." : "The ownership lens could not load right now — please retry."}
          <button className="block mt-3 underline text-foreground" onClick={() => location.reload()}>
            {lang === "ar" ? "إعادة التحميل" : "reload"}
          </button>
        </div>
      </div>
    );
  if (!data || !layout) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-[70vh] w-full" />
      </div>
    );
  }

  const personName = (h: number) => {
    const p = data.people[h];
    if (!p) return "?";
    return lang === "ar" || !p.e ? p.n : p.e;
  };
  const bulletin = (s?: string) => (s ? `${data.bulletinBase}${s}.pdf` : null);
  const basisLabel = (b: "r" | "t") => (b === "r" ? (lang === "ar" ? "سجل الملكية" : "register") : lang === "ar" ? "صفقة" : "trade");

  const focusCompanyTicker = focus?.type === "company" ? focus.ticker : null;
  const focusHolder = focus?.type === "holder" ? focus.h : null;
  const profilePositions = focusCompanyTicker ? [...(layout.companyPositions.get(focusCompanyTicker) ?? [])].sort((a, b) => b.p - a.p) : [];
  const profileDisclosed = profilePositions.reduce((s, p) => s + p.p, 0);
  const profileRing = focusCompanyTicker ? layout.byTicker.get(focusCompanyTicker) : undefined;
  const crossOut = focusCompanyTicker ? data.cross.filter((c) => c.o === focusCompanyTicker) : [];
  const crossIn = focusCompanyTicker ? data.cross.filter((c) => c.d === focusCompanyTicker) : [];

  // holder portfolio rows: stake % + ESTIMATED VALUE (pct × market cap)
  const holderPortfolio = (() => {
    if (focusState?.kind !== "holder") return null;
    const rows = focusState.holdings
      .map((p) => {
        const ring = layout.byTicker.get(p.t);
        const cap = ring?.company.marketCap ?? null;
        const value = cap != null ? (p.p / 100) * cap : null;
        return { p, ring, value };
      })
      .sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || b.p.p - a.p.p);
    const totalValue = rows.reduce((s, r) => s + (r.value ?? 0), 0);
    const valuedCount = rows.filter((r) => r.value != null).length;
    return { rows, totalValue, valuedCount };
  })();

  // (holderValueRank moved above the early returns — see its T74 note.)

  // T73 — the investor BRIEF, now a full IDENTITY profile (the user's ask:
  // "richer and deeper description for investor identity"). Everything is
  // data-grounded from the official filings / the live universe — nothing
  // invented: kind + bilingual names + the spellings the filings absorbed,
  // how long he has been on the record, register-vs-trade filing basis,
  // concentration style, rank by value, cross-holding network presence, the
  // recent move record with share quantities, and buys/sells split.
  const holderBrief = (() => {
    if (focusState?.kind !== "holder" || !holderPortfolio) return null;
    const h = focusState.h;
    const rows = holderPortfolio.rows;
    const person = data.people[h] ?? null;
    // sector footprint: count of companies AND share of portfolio value
    const sectorCounts = new Map<string, { n: number; value: number }>();
    for (const r of rows) {
      if (!r.ring) continue;
      const s = lang === "ar" ? r.ring.company.sectorAr : r.ring.company.sectorEn;
      if (!s) continue;
      const cur = sectorCounts.get(s) ?? { n: 0, value: 0 };
      cur.n += 1;
      cur.value += r.value ?? 0;
      sectorCounts.set(s, cur);
    }
    const sectorList = [...sectorCounts.entries()].sort((a, b) => b[1].value - a[1].value);
    const biggest = rows[0] ?? null;
    // the move record, newest period first (the API lists periods that way)
    const moves: { per: string; ticker: string; from: number | null; to: number | null; c: number | null }[] = [];
    for (const per of data.periods) {
      for (const m of per.m) {
        if (m.h === h) moves.push({ per: per.l, ticker: m.t, from: m.f, to: m.o, c: m.c });
      }
    }
    const latest = moves[0] ?? null;
    const latestSz = latest ? moveSize(data.companies.find((c) => c.ticker === latest.ticker), latest.c) : null;
    const recent = moves.slice(0, 4).map((m) => ({
      ...m,
      sz: moveSize(data.companies.find((c) => c.ticker === m.ticker), m.c),
    }));
    const netRecent = moves.slice(0, 3).reduce((s, m) => s + (m.c ?? 0), 0);
    const buys = moves.filter((m) => (m.c ?? 0) > 0).length;
    const sells = moves.filter((m) => (m.c ?? 0) < 0).length;
    // tenure: the earliest dated filing among his standing positions (this
    // archive only — phrased honestly as such, never "active since" in
    // absolute terms)
    const dates = focusState.holdings.map((p) => (p.a ? Date.parse(p.a) : NaN)).filter(Number.isFinite);
    const since = dates.length ? new Date(Math.min(...dates)) : null;
    const sinceIso = since ? since.toISOString().slice(0, 10) : null;
    const latestFilingIso = focusState.holdings.reduce<string | null>((acc, p) => (p.a && (!acc || p.a > acc) ? p.a : acc), null);
    // filing basis split: shareholders' register vs disclosed trades
    const registerCount = focusState.holdings.filter((p) => p.b === "r").length;
    const tradeCount = focusState.holdings.filter((p) => p.b === "t").length;
    // concentration: the biggest holding's share of his total filed value
    const concentration =
      holderPortfolio.totalValue > 0 && biggest?.value != null ? biggest.value / holderPortfolio.totalValue : null;
    const rank = holderValueRank ? holderValueRank.rankOf.get(h) ?? null : null;
    // listed-to-listed cross-holding networks his companies take part in
    const hisTickers = new Set(focusState.rings.map((r) => r.ticker));
    const crossCount = data.cross.filter((c) => hisTickers.has(c.o) || hisTickers.has(c.d)).length;
    return {
      person,
      isFirm: person?.k === "f",
      alts: person?.alts ?? [],
      sectorCount: sectorCounts.size,
      sectorList,
      biggest,
      moves,
      latest,
      latestSz,
      recent,
      netRecent,
      buys,
      sells,
      totalValue: holderPortfolio.totalValue,
      companies: focusState.rings.length,
      sinceIso,
      latestFilingIso,
      registerCount,
      tradeCount,
      concentration,
      rank,
      rankTotal: holderValueRank?.total ?? 0,
      crossCount,
    };
  })();

  const holderColorOf = (h: number) => holderColor(data.people[h]?.n ?? String(h));

  return (
    <div className="space-y-4 pb-6">
      {/* ── heading + auto-update stamp ── */}
      <div className="px-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold tracking-tight">
            {lang === "ar" ? "من اشترى ومن باع من داخل الشركات؟" : "Who bought and who sold from inside the companies?"}
            <span className="ms-2 text-sm font-normal text-muted-foreground">{T.lensNav[lang]}</span>
          </h1>
          {stats && (
            <span
              className={`lens-badge inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${
                stats.fresh
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
              }`}
              title={
                lang === "ar"
                  ? "تُحدَّث بيانات الملكية تلقائيًا كل يوم من نماذج الإفصاح الرسمية"
                  : "ownership data refreshes automatically every day from the official disclosure forms"
              }
            >
              <span className={`size-1.5 rounded-full ${stats.fresh ? "animate-pulse bg-emerald-500" : "bg-amber-500"}`} />
              {lang === "ar" ? "تحديث تلقائي يومي · آخر تحديث" : "auto daily · updated"} <b>{fmtAsOf(stats.asOf, lang)}</b>
            </span>
          )}
        </div>
        {stats && (
          <div className="flex flex-wrap gap-2 mt-2 text-xs">
            <span className="rounded-full border bg-card px-2.5 py-1">
              <b>{stats.companies}</b> {lang === "ar" ? "شركة على الخريطة" : "companies on the board"}
            </span>
            <span className="rounded-full border bg-card px-2.5 py-1">
              <b>{stats.parties}</b> {lang === "ar" ? "طرفًا مذكورًا في الإفصاحات" : "named parties"}
            </span>
            <span className="rounded-full border bg-card px-2.5 py-1">
              <b>{stats.stakes}</b> {lang === "ar" ? "حصة قائمة" : "standing stakes"}
            </span>
            <span className="rounded-full border bg-card px-2.5 py-1">
              {lang === "ar" ? "قيمة الحصص المعلنة" : "value of filed stakes"}: <b>{fmtEgp(stats.capOfStakes, lang)}</b>
            </span>
            <span
              className="rounded-full border bg-card px-2.5 py-1"
              title={
                lang === "ar"
                  ? "الشركات التي ورد اسم مالك لها في نموذج إفصاح — الباقي ملكيته غير معلنة، وليست بلا مالك"
                  : "companies with a named holder in a filed form — the rest is undisclosed ownership, not ownerless"
              }
            >
              <b>
                {stats.coverage.withStakes}/{stats.coverage.total}
              </b>{" "}
              {lang === "ar" ? "شركة لها إفصاحات ملكية" : "companies with filed stakes"}
            </span>
          </div>
        )}
      </div>

      {/* ── week strip ── */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <button
          className={`rounded-full border px-3 py-1 transition-colors ${weekIdx === null ? "border-primary bg-primary/15 font-semibold" : "bg-card hover:bg-accent"}`}
          onClick={() => {
            setPlaying(false);
            setWeekIdx(null);
          }}
        >
          {lang === "ar" ? "الوضع الحالي · كل ما أُفصح عنه" : "Standing · all disclosures"}
        </button>
        <button
          className="rounded-full border bg-card px-2.5 py-1 hover:bg-accent"
          title={lang === "ar" ? "تشغيل الأسابيع" : "play weeks"}
          onClick={() => {
            // T73 — ▶ at the end restarts the replay from week 0 (see the
            // fullscreen twin above for the full story)
            const atEnd = weekIdx != null && weekIdx >= data.periods.length - 1;
            setPlaying((p) => !p);
            if (!playing && (weekIdx === null || atEnd)) setWeekIdx(0);
          }}
        >
          {playing ? "⏸" : "▶"}
        </button>
        <div className="flex items-center gap-1.5 flex-wrap max-h-[72px] overflow-y-auto thin-scroll">
          {data.periods.map((per, i) => (
            <button
              key={per.start}
              className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                weekIdx === i ? "border-primary bg-primary/15 font-semibold" : "bg-card/70 hover:bg-accent"
              }`}
              onClick={() => {
                setPlaying(false);
                setWeekIdx(weekIdx === i ? null : i);
              }}
            >
              {per.l} · {per.n} {lang === "ar" ? "تحرّك" : per.n === 1 ? "move" : "moves"}
            </button>
          ))}
        </div>
      </div>

      {/* ── map + panel ── */}
      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div
          ref={mapWrapRef}
          /* T72 fix: `relative` and `fixed` must never coexist — Tailwind
           * emits .relative after .fixed, so the CSS-overlay fullscreen
           * fallback (iOS Safari, where the Fullscreen API is absent) was
           * silently beaten by .relative and never covered the viewport.
           * The position now rides the branch itself. */
          className={`overflow-hidden lens-map ${
            fs ? "fixed inset-0 z-[60] rounded-none border-0 lens-fs" : "relative rounded-xl border"
          }`}
        >
          {/* T69 — the fullscreen toggle (native API, CSS-overlay fallback) */}
          <button
            className="absolute top-2 right-2 z-20 flex items-center gap-1.5 rounded-md border bg-card/90 px-2.5 py-1.5 text-[11px] font-medium hover:bg-accent"
            onClick={toggleFullscreen}
            title={
              fs
                ? lang === "ar"
                  ? "اخرج من ملء الشاشة (Esc)"
                  : "exit fullscreen (Esc)"
                : lang === "ar"
                  ? "اعرض اللوحة في ملء الشاشة"
                  : "open the board in fullscreen"
            }
          >
            {fs ? (
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 3H5a2 2 0 0 0-2 2v4M15 3h4a2 2 0 0 1 2 2v4M9 21H5a2 2 0 0 1-2-2v-4M15 21h4a2 2 0 0 0 2-2v-4" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 9V5a2 2 0 0 1 2-2h4M21 9V5a2 2 0 0 0-2-2h-4M3 15v4a2 2 0 0 0 2 2h4M21 15v4a2 2 0 0 1-2 2h-4" />
              </svg>
            )}
            <span>{fs ? (lang === "ar" ? "خروج" : "exit") : lang === "ar" ? "ملء الشاشة" : "fullscreen"}</span>
          </button>

          {/* T69 — in-fullscreen week strip (the page-level strip is covered
              by the fixed overlay, so the period replay rides INSIDE the map) */}
          {fs && data && (
            <div className="absolute top-2 left-2 z-20 flex max-w-[46%] flex-wrap items-center gap-1.5 rounded-lg border bg-card/90 px-2 py-1.5 text-[11px] backdrop-blur">
              <button
                className={`rounded-full border px-2 py-0.5 transition-colors ${weekIdx === null ? "border-primary bg-primary/15 font-semibold" : "bg-background/60 hover:bg-accent"}`}
                onClick={() => {
                  setPlaying(false);
                  setWeekIdx(null);
                }}
              >
                {lang === "ar" ? "الوضع الحالي" : "standing"}
              </button>
              <button
                className="rounded-full border bg-background/60 px-2 py-0.5 hover:bg-accent"
                title={lang === "ar" ? "تشغيل الأسابيع" : "play weeks"}
                onClick={() => {
                  // T73 — ▶ at the END of the archive restarts from week 0:
                  // the old handler left weekIdx at the last index, so the
                  // interval computed next = length → instantly stopped —
                  // a replay could never be watched twice.
                  const atEnd = weekIdx != null && weekIdx >= data.periods.length - 1;
                  setPlaying((p) => !p);
                  if (!playing && (weekIdx === null || atEnd)) setWeekIdx(0);
                }}
              >
                {playing ? "⏸" : "▶"}
              </button>
              <div className="flex items-center gap-1 flex-wrap max-h-[60px] overflow-y-auto thin-scroll">
                {data.periods.map((per, i) => (
                  <button
                    key={per.start}
                    className={`rounded-full border px-1.5 py-px text-[10px] transition-colors ${
                      weekIdx === i ? "border-primary bg-primary/15 font-semibold" : "bg-background/60 hover:bg-accent"
                    }`}
                    onClick={() => {
                      setPlaying(false);
                      setWeekIdx(weekIdx === i ? null : i);
                    }}
                  >
                    {per.l}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* T69/T71 — the MOVES side summary docks over the board's right
              edge whenever a week is active — in NORMAL mode too (the user's
              ask: it used to appear only in fullscreen), so clicking ▶ or a
              period shows the ranked moves next to the arcs themselves. */}
          {weekMoves && (
            <div
              className={`absolute top-12 right-2 z-20 w-[300px] overflow-auto rounded-xl border bg-card/95 p-3 text-xs shadow-xl backdrop-blur thin-scroll ${
                /* T73 — collision guard: when the investor brief is open over the
                 * board, the week summary shrinks so the two overlays never paint
                 * over one another on short viewports (70% + 64% > 100%). */
                focusState?.kind === "holder" && holderBrief && !briefClosed ? "max-h-[45%]" : "max-h-[70%]"
              }`}
            >
              <p className="font-bold mb-1">
                {weekMoves.period.l} · {weekMoves.period.m.length} {lang === "ar" ? (weekMoves.period.m.length === 1 ? "تحرك واحد" : "تحركات") : weekMoves.period.m.length === 1 ? "move" : "moves"}
              </p>
              {[...weekMoves.period.m]
                .sort((a, b) => Math.abs(b.c ?? 0) - Math.abs(a.c ?? 0))
                .slice(0, 12)
                .map((m, i) => {
                  const up = (m.c ?? 0) >= 0;
                  const sz = moveSize(data.companies.find((c) => c.ticker === m.t), m.c);
                  return (
                    <button
                      key={`${m.t}-${m.h}-${i}`}
                      className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-1 text-start hover:bg-accent/50"
                      onClick={() => setFocus({ type: "company", ticker: m.t })}
                      title={`${data.people[m.h]?.n ?? String(m.h)} · ${m.t}${m.f != null && m.o != null ? ` (${fmtPct(m.f)}% → ${fmtPct(m.o)}%)` : ""}${sz ? ` · ≈ ${fmtShares(sz.shares)} ${lang === "ar" ? "سهم" : "shares"}` : ""}`}
                    >
                      <span className="min-w-0 truncate">
                        <b className="text-[10px] rounded bg-secondary px-1" dir="ltr">{m.t}</b>{" "}
                        {/* T72 — the holder's NAME is clickable on its own:
                         * choosing the investor opens his brief panel over
                         * the board (the row itself still opens the company) */}
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            setFocus({ type: "holder", h: m.h });
                          }}
                          onKeyDown={(e) => {
                            // T73 — role="button" needs BOTH activation keys
                            // (WAI-ARIA): Space was missing, keyboard users
                            // could not open the brief from here
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              e.stopPropagation();
                              setFocus({ type: "holder", h: m.h });
                            }
                          }}
                          className="font-semibold underline decoration-dotted underline-offset-2 hover:text-primary"
                          title={lang === "ar" ? "اضغط لفتح ملخص هذا المستثمر" : "click to open this investor's brief"}
                        >
                          {data.people[m.h]?.n ?? String(m.h)}
                        </span>
                      </span>
                      <b className={`shrink-0 tabular-nums ${up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`} dir="ltr">
                        {up ? "+" : ""}{(m.c ?? 0).toFixed(2)}%
                      </b>
                    </button>
                  );
                })}
            </div>
          )}

          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="w-full touch-none select-none cursor-grab active:cursor-grabbing"
            style={{ height: fs ? "100vh" : "min(72vh, 720px)" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={() => {
              onPointerUp();
              setHoverTip(null);
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget || (e.target as Element).getAttribute("data-bg") === "1") {
                setFocus(null);
              }
            }}
          >
            <defs>
              <radialGradient id="lakeWater" cx="50%" cy="50%" r="65%">
                <stop offset="0%" style={{ stopColor: "var(--lens-water-1)" }} />
                <stop offset="100%" style={{ stopColor: "var(--lens-water-2)" }} />
              </radialGradient>
              <pattern id="hatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
                <rect width="6" height="6" fill="transparent" />
                <line x1="0" y1="0" x2="0" y2="6" style={{ stroke: "var(--lens-remainder)" }} strokeWidth="1.4" />
              </pattern>
            </defs>
            <rect data-bg="1" x="0" y="0" width={W} height={H} fill="transparent" />
            <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
              {/* lakes */}
              {layout.sectors.map((s) => (
                <g key={s.code}>
                  <path d={s.path} fill="url(#lakeWater)" style={{ stroke: "var(--lens-coast)" }} strokeWidth="1" />
                  <path d={s.path} fill="none" style={{ stroke: "var(--lens-coast)" }} strokeWidth="4" opacity={0.28} />
                  <text
                    x={s.cell.x + 10}
                    y={s.cell.y + 18}
                    fontSize="11"
                    fontWeight={600}
                    style={{ fill: "var(--lens-sector)" }}
                    className="pointer-events-none"
                  >
                    {lang === "ar" ? s.labelAr : s.labelEn} · {s.rings.length}
                  </text>
                </g>
              ))}

              {/* bridges at rest (holders present in >1 company) */}
              {!focusState &&
                [...layout.holderCompanies.entries()].map(([h, tickers]) => {
                  if (tickers.length < 2) return null;
                  const rings = tickers.map((t) => layout.byTicker.get(t)!).filter(Boolean);
                  const hub = rings.reduce((a, b) => ((a.company.marketCap ?? 0) >= (b.company.marketCap ?? 0) ? a : b));
                  const color = holderColorOf(h);
                  return rings
                    .filter((r) => r !== hub)
                    .map((r) => {
                      const mx = (hub.x + r.x) / 2 + (r.y - hub.y) * 0.12;
                      const my = (hub.y + r.y) / 2 - (r.x - hub.x) * 0.12;
                      return (
                        <path
                          key={`br-${h}-${r.ticker}`}
                          d={`M ${hub.x} ${hub.y} Q ${mx} ${my} ${r.x} ${r.y}`}
                          fill="none"
                          stroke={color}
                          strokeWidth={0.7}
                          opacity={0.18}
                          className="pointer-events-none"
                        />
                      );
                    });
                })}

              {/* rings */}
              {layout.sectors.map((s) =>
                s.rings.map((ring) => {
                  const sliceData = layout.slicesByTicker.get(ring.ticker);
                  const dimmed =
                    focusState?.kind === "company"
                      ? focusState.ring.ticker !== ring.ticker &&
                        !focusState.positions.some((p) => layout.byTicker.get(p.t)?.ticker === ring.ticker)
                      : focusState?.kind === "holder"
                        ? !focusState.involvedTickers.has(ring.ticker)
                        : false;
                  const moved = movedTickers.has(ring.ticker);
                  const holderHalo =
                    focusState?.kind === "holder" && focusState.involvedTickers.has(ring.ticker)
                      ? holderColorOf(focusState.h)
                      : null;
                  return (
                    <g
                      key={ring.ticker}
                      opacity={dimmed ? 0.14 : 1}
                      className={ring.r >= 6 ? "lens-ring cursor-pointer" : "cursor-pointer"}
                      onClick={(e) => {
                        e.stopPropagation();
                        setFocus({ type: "company", ticker: ring.ticker });
                      }}
                      onMouseMove={(e) => {
                        const svg = svgRef.current;
                        if (!svg) return;
                        const rect = svg.getBoundingClientRect();
                        setHoverTip({
                          x: ((e.clientX - rect.left) / rect.width) * 100,
                          y: ((e.clientY - rect.top) / rect.height) * 100,
                          title: `${ring.ticker} · ${dn(ring.company, lang)}`,
                          sub: `${fmtCap(ring.company.marketCap, lang)} · ${
                            sliceData
                              ? `${sliceData.slices.length} ${lang === "ar" ? "مالكًا مُفصحًا" : "filed holders"}`
                              : lang === "ar"
                                ? "لا إفصاحات ملكية بعد"
                                : "no filed stakes yet"
                          }${ring.company.changePct ? ` · ${ring.company.changePct > 0 ? "+" : ""}${ring.company.changePct}%` : ""}`,
                        });
                      }}
                      onMouseLeave={() => setHoverTip(null)}
                    >
                      {ring.r < 6 ? (
                        <circle cx={ring.x} cy={ring.y} r={ring.r} fill={ring.company.changePct >= 0 ? "#34d399" : "#f87171"} opacity={0.85} />
                      ) : (
                        <>
                          {/* holder-focus halo: his companies wear his color */}
                          {holderHalo && (
                            <circle className="lens-halo" cx={ring.x} cy={ring.y} r={ring.r + 5} fill="none" stroke={holderHalo} strokeWidth={1.2} opacity={0.6} />
                          )}
                          {sliceData ? (
                            <>
                              {/* grey remainder band = undisclosed ownership (NOT free float) */}
                              <circle
                                cx={ring.x}
                                cy={ring.y}
                                r={ring.r - BAND / 2}
                                fill="none"
                                style={{ stroke: "var(--lens-remainder)" }}
                                strokeWidth={BAND}
                              />
                              {/* filed-stake slices */}
                              {sliceData.slices.map((sl, i) => (
                                <path
                                  key={i}
                                  d={arcPath(ring.x, ring.y, ring.r - BAND, ring.r, sl.a0, sl.a1)}
                                  fill={sl.color}
                                  opacity={0.92}
                                />
                              ))}
                            </>
                          ) : (
                            /* no disclosure filed yet — a DOTTED outline so the
                             * company stays on the board, honestly marked */
                            <circle
                              cx={ring.x}
                              cy={ring.y}
                              r={ring.r - BAND / 2}
                              fill="none"
                              style={{ stroke: "var(--lens-remainder)" }}
                              strokeWidth={1.2}
                              strokeDasharray="1.6 3"
                              opacity={0.75}
                            />
                          )}
                          <circle cx={ring.x} cy={ring.y} r={ring.r} fill="none" style={{ stroke: "var(--lens-ring)" }} strokeWidth="0.6" />
                          {/* over-disclosure marker */}
                          {sliceData?.over && (
                            <circle cx={ring.x} cy={ring.y} r={ring.r + 2} fill="none" stroke="#fbbf24" strokeWidth="1" strokeDasharray="2 2" />
                          )}
                          {/* week change — T65: RECOGNIZABLE. A pulsing halo in
                           * the NET direction color catches the eye on the
                           * whole board; the outer arcs are bigger, brighter
                           * and sized by the stake points actually moved */}
                          {moved && (
                            <>
                              <circle
                                className="lens-move-pulse"
                                cx={ring.x}
                                cy={ring.y}
                                r={ring.r + 6}
                                fill="none"
                                stroke={(weekMoves?.byT.get(ring.ticker) ?? []).reduce((s, mv) => s + (mv.c ?? 0), 0) >= 0 ? "#10b981" : "#ef4444"}
                                strokeWidth={2.2}
                              />
                              {(weekMoves?.byT.get(ring.ticker) ?? []).map((mv, i) => {
                                const span = Math.min(Math.PI / 3, Math.max(0.24, Math.abs(mv.c ?? 0) * 0.16));
                                const a0 = -Math.PI / 2 + i * (span + 0.22);
                                const col = (mv.c ?? 0) >= 0 ? "#34d399" : "#f87171";
                                // T66 — WHO made the move, on the board itself:
                                // the holder's name rides with the arc (shortened
                                // to the first two words) and the full identity
                                // + from→to live in the native tooltip.
                                const mvHolder = data ? data.people[mv.h]?.n ?? String(mv.h) : String(mv.h);
                                const mvHolderShort = mvHolder.split(/\s+/).slice(0, 2).join(" ");
                                // T71 — the move now speaks in CONCRETE terms: the % of
                                // the company's total equity + the share quantity it
                                // represents (plus its EGP value in the tooltip)
                                const mvSz = moveSize(ring.company, mv.c);
                                const tip = `${mvHolder} · ${ring.ticker} ${mv.c != null ? `${mv.c > 0 ? "+" : ""}${mv.c.toFixed(2)}% ${lang === "ar" ? "من إجمالي ملكية الشركة" : "of the company's total equity"}` : ""}${mv.from != null && mv.to != null ? ` (${fmtPct(mv.from)}% → ${fmtPct(mv.to)}%)` : ""}${mvSz ? ` · ≈ ${fmtShares(mvSz.shares)} ${lang === "ar" ? "سهم" : "shares"} · ≈ ${fmtEgp(mvSz.valueEgp, lang)}` : ""}`;
                                return (
                                  <g key={`wa-${i}`}>
                                    <path
                                      d={arcPath(ring.x, ring.y, ring.r + 4, ring.r + 13, a0, a0 + span)}
                                      fill={col}
                                      opacity={0.9}
                                      stroke={col}
                                      strokeWidth={0.8}
                                      className="pointer-events-auto cursor-help"
                                    >
                                      <title>{tip}</title>
                                    </path>
                                    {/* the move's size + WHO, printed at the arc's
                                     * mid-angle — sized to fit small rings too */}
                                    {ring.r > 12 && Math.abs(mv.c ?? 0) >= 0.25 && (
                                      <text
                                        x={ring.x + Math.cos(a0 + span / 2) * (ring.r + 17)}
                                        y={ring.y + Math.sin(a0 + span / 2) * (ring.r + 17) + 2.5}
                                        textAnchor="middle"
                                        fontSize="8"
                                        fontWeight={700}
                                        style={{ fill: col }}
                                        className="pointer-events-none"
                                      >
                                        {`${(mv.c ?? 0) > 0 ? "+" : ""}${(mv.c ?? 0).toFixed(1)}%`}
                                      </text>
                                    )}
                                    {ring.r > 13 && Math.abs(mv.c ?? 0) >= 0.5 && (
                                      <text
                                        x={ring.x + Math.cos(a0 + span / 2) * (ring.r + 17)}
                                        y={ring.y + Math.sin(a0 + span / 2) * (ring.r + 17) + 11}
                                        textAnchor="middle"
                                        fontSize="7.5"
                                        style={{ fill: "var(--lens-ink-soft)" }}
                                        className="pointer-events-none"
                                      >
                                        {mvHolderShort}
                                      </text>
                                    )}
                                  </g>
                                );
                              })}
                            </>
                          )}
                          {/* ticker + cap labels */}
                          <text
                            x={ring.x}
                            y={ring.y + (ring.r > 22 ? 3 : 2.5)}
                            textAnchor="middle"
                            fontSize={ring.r > 26 ? 11 : ring.r > 19 ? 9 : 7.5}
                            fontWeight={700}
                            style={{ fill: "var(--lens-ink)" }}
                            opacity={sliceData ? 1 : 0.55}
                            direction="ltr"
                            className="pointer-events-none"
                          >
                            {ring.ticker}
                          </text>
                          {ring.r > 26 && ring.company.marketCap != null && (
                            <text
                              x={ring.x}
                              y={ring.y + ring.r + 9}
                              textAnchor="middle"
                              fontSize="7.5"
                              style={{ fill: "var(--lens-ink-soft)" }}
                              className="pointer-events-none"
                            >
                              {capLabel(ring.company, lang)}
                            </text>
                          )}
                        </>
                      )}
                    </g>
                  );
                })
              )}

              {/* company-focus seats: holders around the chosen company */}
              {focusState?.kind === "company" && (
                <g className="pointer-events-auto">
                  {/* focus halo breathes */}
                  <circle className="lens-pulse" cx={focusState.ring.x} cy={focusState.ring.y} r={focusState.ring.r + 9} fill="none" style={{ stroke: "var(--lens-ink)" }} strokeWidth="1.2" opacity={0.65} />
                  {focusState.seats.map((seat, i) => {
                    const onward = (layout.holderCompanies.get(seat.p.h) ?? []).filter((t) => t !== focusState.ring.ticker);
                    const seatLen = Math.hypot(seat.x - focusState.ring.x, seat.y - focusState.ring.y);
                    const label = `${fmtPct(seat.p.p)}% · ${personName(seat.p.h).slice(0, 18)}`;
                    const lw = Math.max(62, label.length * 5.4 + 8);
                    const lx = seat.x + Math.cos(seat.ang) * (lw / 2 + 9);
                    const ly = seat.y + Math.sin(seat.ang) * 12;
                    return (
                      <g key={seat.p.h}>
                        {/* onward ties fade in (staggered) */}
                        {onward.map((t, j) => {
                          const tr = layout.byTicker.get(t);
                          if (!tr) return null;
                          return (
                            <path
                              key={`on-${t}`}
                              className="lens-fade"
                              style={{ animationDelay: `${180 + i * 40 + j * 25}ms` }}
                              d={`M ${seat.x} ${seat.y} L ${tr.x} ${tr.y}`}
                              stroke={seat.color}
                              strokeWidth={0.8}
                              opacity={0.35}
                              strokeDasharray="3 3"
                              fill="none"
                            />
                          );
                        })}
                        {/* the seat's tie to the company draws itself in */}
                        <line
                          className="lens-draw"
                          style={{ ["--lens-dash" as string]: seatLen } as React.CSSProperties}
                          x1={seat.x}
                          y1={seat.y}
                          x2={focusState.ring.x}
                          y2={focusState.ring.y}
                          stroke={seat.color}
                          strokeWidth={1.1}
                          strokeDasharray={seatLen}
                          strokeDashoffset={seatLen}
                          opacity={0.85}
                        />
                        {/* seat dot + name pill pop in */}
                        <g
                          className="lens-seat"
                          style={{ animationDelay: `${i * 45}ms` }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setFocus({ type: "holder", h: seat.p.h });
                          }}
                        >
                          <circle cx={seat.x} cy={seat.y} r={4.5} fill={seat.color} style={{ stroke: "var(--lens-pill-bg)" }} strokeWidth={1} />
                          <rect
                            x={lx - lw / 2}
                            y={ly - 8.5}
                            width={lw}
                            height={15}
                            rx={4}
                            style={{ fill: "var(--lens-pill-bg)", stroke: seat.color }}
                            strokeWidth={0.7}
                          />
                          <text x={lx} y={ly + 2.5} textAnchor="middle" fontSize="8.5" style={{ fill: "var(--lens-pill-ink)" }} className="pointer-events-none">
                            {label}
                          </text>
                        </g>
                      </g>
                    );
                  })}
                </g>
              )}

              {/* holder-focus: node + spokes + stake pills — his investments
               *  across the stocks light up and draw in */}
              {focusState?.kind === "holder" && (
                <g>
                  {focusState.rings.map((r, i) => {
                    const pos = focusState.holdings.find((p) => p.t === r.ticker);
                    const pctv = pos?.p ?? 0;
                    const len = Math.hypot(r.x - focusState.hx, r.y - focusState.hy);
                    const changed = weekMoves?.byT.get(r.ticker)?.length ? "4 3" : undefined;
                    return (
                      <g key={r.ticker}>
                        <line
                          className={changed ? "lens-fade" : "lens-draw"}
                          style={
                            changed
                              ? { animationDelay: `${i * 60}ms` }
                              : ({ ["--lens-dash" as string]: len, animationDelay: `${i * 60}ms` } as React.CSSProperties)
                          }
                          x1={focusState.hx}
                          y1={focusState.hy}
                          x2={r.x}
                          y2={r.y}
                          stroke={holderColorOf(focusState.h)}
                          strokeWidth={1.2 + Math.min(1.6, pctv / 12)}
                          opacity={0.85}
                          strokeDasharray={changed ?? len}
                          strokeDashoffset={changed ? undefined : len}
                        />
                        <g
                          className="lens-fade"
                          style={{ animationDelay: `${240 + i * 60}ms` }}
                          transform={`translate(${focusState.hx + (r.x - focusState.hx) * 0.72},${focusState.hy + (r.y - focusState.hy) * 0.72})`}
                        >
                          <rect x={-17} y={-8} width={35} height={15} rx={7.5} style={{ fill: "var(--lens-pill-bg)", stroke: "var(--lens-pill-border)" }} strokeWidth={0.6} />
                          <text textAnchor="middle" y={2.5} fontSize="9" fontWeight={700} style={{ fill: "var(--lens-pill-ink)" }} className="pointer-events-none">
                            {fmtPct(pctv)}%
                          </text>
                        </g>
                      </g>
                    );
                  })}
                  {/* the investor node itself */}
                  <g className="lens-seat">
                    <circle cx={focusState.hx} cy={focusState.hy} r={7} fill={holderColorOf(focusState.h)} style={{ stroke: "var(--lens-ink)" }} strokeWidth={1.2} />
                    <text x={focusState.hx} y={focusState.hy - 13} textAnchor="middle" fontSize="10" fontWeight={700} style={{ fill: "var(--lens-ink)" }}>
                      {personName(focusState.h).slice(0, 26)}
                    </text>
                  </g>
                </g>
              )}
            </g>
          </svg>

          {/* hover tooltip plate */}
          {hoverTip && (
            <div
              className="pointer-events-none absolute z-10 max-w-[260px] rounded-lg border bg-popover/95 px-2.5 py-1.5 text-xs shadow-lg"
              style={{ left: `${Math.min(78, hoverTip.x + 1.5)}%`, top: `${Math.max(2, hoverTip.y - 7)}%` }}
            >
              <p className="font-semibold leading-snug">{hoverTip.title}</p>
              <p className="text-muted-foreground mt-0.5 leading-snug">{hoverTip.sub}</p>
            </div>
          )}

          {/* zoom controls */}
          <div className="absolute bottom-2 left-2 flex items-center gap-1 text-xs">
            <button
              className="rounded-md border bg-card/90 px-2 py-1 hover:bg-accent"
              onClick={() => zoomStep(1.4)}
            >
              +
            </button>
            <button
              className="rounded-md border bg-card/90 px-2 py-1 hover:bg-accent"
              onClick={() => zoomStep(1 / 1.4)}
            >
              −
            </button>
            <button
              className="rounded-md border bg-card/90 px-2 py-1 hover:bg-accent"
              onClick={() => {
                setFocus(null);
                setWeekIdx(null);
                flyTo({ k: 1, x: 0, y: 0 });
              }}
            >
              {view.k.toFixed(1)}× · {lang === "ar" ? "إعادة" : "reset"}
            </button>
          </div>

          {/* T72 — the INVESTOR BRIEF PANEL (the user's ask: "surfing the map
           *  and choosing an investor opens a short brief panel with the data
           *  about this investor"). It docks over the board's bottom-right
           *  corner — bottom-10 on phones so it never covers the zoom row —
           *  and lives INSIDE the map container, so it is on screen in normal
           *  mode AND in fullscreen (where the aside with the full portfolio
           *  does not exist at all). Every number is data-grounded from the
           *  official filings; ✕ dismisses the panel but keeps the holder
           *  highlighted on the board. */}
          {focusState?.kind === "holder" && holderPortfolio && holderBrief && !briefClosed && (
            <div
              ref={briefPanelRef}
              aria-label={lang === "ar" ? "ملخص المستثمر" : "investor brief"}
              className="absolute bottom-10 right-2 z-20 flex max-h-[64%] w-[300px] max-w-[calc(100%-1rem)] flex-col overflow-hidden rounded-xl border bg-card/95 text-xs shadow-2xl backdrop-blur md:bottom-2"
            >
              {/* header: who he is — full bilingual identity + rank + dismiss */}
              <div className="flex items-start justify-between gap-2 border-b bg-background/40 px-3 py-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 font-bold leading-snug">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: holderColorOf(focusState.h) }} />
                    <span className="truncate">{personName(focusState.h)}</span>
                  </p>
                  {/* the OTHER name: Arabic UI shows the English filing name
                   * and vice versa — the full bilingual identity, not just one */}
                  {holderBrief.person && lang === "ar" && holderBrief.person.e ? (
                    <p className="mt-0.5 truncate text-[10px] italic text-muted-foreground" dir="auto">
                      {holderBrief.person.e}
                    </p>
                  ) : holderBrief.person && lang === "en" && holderBrief.person.n !== holderBrief.person.e ? (
                    <p className="mt-0.5 truncate text-[10px] italic text-muted-foreground" dir="auto">
                      {holderBrief.person.n}
                    </p>
                  ) : null}
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {data.people[focusState.h]?.k === "f"
                      ? lang === "ar"
                        ? "شركة أو صندوق"
                        : "firm / fund"
                      : lang === "ar"
                        ? "شخص"
                        : "person"}
                    {" · "}
                    {focusState.rings.length}{" "}
                    {lang === "ar"
                      ? focusState.rings.length === 1
                        ? "شركة مدرجة"
                        : "شركات مدرجة"
                      : focusState.rings.length === 1
                        ? "listed company"
                        : "listed companies"}
                    {holderBrief.sectorCount > 0 &&
                      ` · ${holderBrief.sectorCount} ${
                        lang === "ar"
                          ? holderBrief.sectorCount === 1
                            ? "قطاع"
                            : "قطاعات"
                          : holderBrief.sectorCount === 1
                            ? "sector"
                            : "sectors"
                      }`}
                  </p>
                  {/* T73 — his standing on the board, by filed-stakes value */}
                  {holderBrief.rank != null && holderBrief.rankTotal > 0 && (
                    <p className="mt-1 inline-flex items-center gap-1 rounded-full border bg-secondary/50 px-1.5 py-px text-[9.5px] text-muted-foreground">
                      {lang === "ar" ? "الترتيب بقيمة الحصص المعلنة" : "by filed-stakes value"}:{" "}
                      <b className="num">#{holderBrief.rank}</b> {lang === "ar" ? "من" : "of"}{" "}
                      <b className="num">{holderBrief.rankTotal.toLocaleString("en-GB")}</b>
                    </p>
                  )}
                </div>
                <button
                  className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={() => setBriefClosed(true)}
                  title={lang === "ar" ? "إغلاق الملخص (يبقي المستثمر مُحددًا على اللوحة)" : "close the brief (the investor stays highlighted on the board)"}
                >
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* body: the investor's IDENTITY + data — richer & deeper (T73) */}
              <div className="min-h-0 flex-1 space-y-2.5 overflow-auto px-3 py-2.5 thin-scroll">
                {/* the identity paragraph — a written, data-grounded profile */}
                <p className="leading-relaxed text-[11px]">
                  {lang === "ar" ? (
                    <>
                      {personName(focusState.h)}{" "}
                      {holderBrief.isFirm
                        ? "كيان (شركة أو صندوق) ورد اسمه في إفصاحات الملكية الرسمية للبورصة المصرية كمالك أو عضو مجلس إدارة في"
                        : "شخص طبيعي ورد اسمه في إفصاحات الملكية الرسمية للبورصة المصرية كمالك أو عضو مجلس إدارة في"}{" "}
                      <b>{holderBrief.companies}</b>{" "}
                      {holderBrief.companies === 1 ? "شركة مدرجة واحدة" : "شركات مدرجة"}
                      {holderBrief.sectorCount > 1 && (
                        <>
                          {" "}عبر <b>{holderBrief.sectorCount}</b> قطاعات
                        </>
                      )}
                      .
                      {holderBrief.alts.length > 0 && (
                        <>
                          {" "}ورد اسمه في النشرات أيضًا بصيغ:{" "}
                          <span className="italic">{holderBrief.alts.slice(0, 3).join(" · ")}</span>.
                        </>
                      )}
                      {holderBrief.sinceIso && (
                        <>
                          {" "}أقدم حصة مؤرخة له في أرشيف الإفصاحات تعود إلى <b>{fmtAsOf(holderBrief.sinceIso, lang)}</b>
                          {holderBrief.latestFilingIso && holderBrief.latestFilingIso > holderBrief.sinceIso
                            ? ` (آخر إفصاح مؤرّخ: ${fmtAsOf(holderBrief.latestFilingIso, lang)})`
                            : ""}
                          .
                        </>
                      )}
                      {holderBrief.concentration != null &&
                        holderBrief.concentration >= 0.05 &&
                        (holderBrief.companies === 1 ? (
                          <>
                            {" "}حضوره المعلن محصور في شركة واحدة.
                          </>
                        ) : (
                          <>
                            {" "}
                            {holderBrief.concentration >= 0.7 ? "محفظته شديدة التركّز — " : ""}
                            أكبر حصصه المعلنة في <b dir="ltr">{holderBrief.biggest?.p.t}</b> (
                            {fmtPct(holderBrief.biggest?.p.p ?? 0)}% · ≈{fmtEgp(holderBrief.biggest?.value ?? null, lang)}) تمثل{" "}
                            <b>{Math.round(holderBrief.concentration * 100)}%</b> من قيمة حصصه المعلنة.
                          </>
                        ))}
                      {holderBrief.registerCount > 0 && holderBrief.tradeCount > 0 ? (
                        <>
                          {" "}حصصه موزعة بين <b>{holderBrief.registerCount}</b>{" "}
                          {holderBrief.registerCount === 1 ? "حصة" : "حصص"} في سجل الملكية و
                          <b>{holderBrief.tradeCount}</b> {" "}
                          {holderBrief.tradeCount === 1 ? "حصة أعلنت عبر صفقة" : "حصص أعلنت عبر صفقات"}.
                        </>
                      ) : holderBrief.tradeCount > 0 ? (
                        <>
                          {" "}كل حصصه أعلنت عبر صفقات مؤيدة بالكتلة.
                        </>
                      ) : holderBrief.registerCount > 0 ? (
                        <>
                          {" "}كل حصصه مسجلة في سجل الملكية.
                        </>
                      ) : null}
                      {holderBrief.rank != null && holderBrief.rankTotal > 0 && (
                        <>
                          {" "}بقيمة حصصه المعلنة يقع في{" "}
                          <b>
                            المرتبة #{holderBrief.rank} من {holderBrief.rankTotal.toLocaleString("en-GB")}
                          </b>{" "}
                          طرفًا مذكورًا على اللوحة.
                        </>
                      )}
                      {holderBrief.crossCount > 0 && (
                        <>
                          {" "}شركاته تدخل في شبكات الملكية المتقاطعة بين الشركات المدرجة (
                          <b>{holderBrief.crossCount}</b>{" "}
                          {holderBrief.crossCount === 1 ? "علاقة" : "علاقات"}).
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      {personName(focusState.h)} is{" "}
                      {holderBrief.isFirm
                        ? "an entity (firm / fund) named in the Egyptian Exchange's official ownership disclosures as a holder or board member in"
                        : "an individual named in the Egyptian Exchange's official ownership disclosures as a holder or board member in"}{" "}
                      <b>
                        {holderBrief.companies === 1 ? "one listed company" : `${holderBrief.companies} listed companies`}
                      </b>
                      {holderBrief.sectorCount > 1 && (
                        <>
                          {" "}across <b>{holderBrief.sectorCount}</b> sectors
                        </>
                      )}
                      .
                      {holderBrief.alts.length > 0 && (
                        <>
                          {" "}Also filed under the spellings:{" "}
                          <span className="italic">{holderBrief.alts.slice(0, 3).join(" · ")}</span>.
                        </>
                      )}
                      {holderBrief.sinceIso && (
                        <>
                          {" "}His earliest dated stake in the disclosure archive is from{" "}
                          <b>{fmtAsOf(holderBrief.sinceIso, lang)}</b>
                          {holderBrief.latestFilingIso && holderBrief.latestFilingIso > holderBrief.sinceIso
                            ? ` (latest dated filing: ${fmtAsOf(holderBrief.latestFilingIso, lang)})`
                            : ""}
                          .
                        </>
                      )}
                      {holderBrief.concentration != null &&
                        holderBrief.concentration >= 0.05 &&
                        (holderBrief.companies === 1 ? (
                          <>
                            {" "}His disclosed presence is confined to a single company.
                          </>
                        ) : (
                          <>
                            {" "}
                            {holderBrief.concentration >= 0.7 ? "A highly concentrated portfolio — " : ""}
                            his largest filed stake, <b dir="ltr">{holderBrief.biggest?.p.t}</b> (
                            {fmtPct(holderBrief.biggest?.p.p ?? 0)}% · est. {fmtEgp(holderBrief.biggest?.value ?? null, lang)}), is{" "}
                            <b>{Math.round(holderBrief.concentration * 100)}%</b> of his filed-stakes value.
                          </>
                        ))}
                      {holderBrief.registerCount > 0 && holderBrief.tradeCount > 0 ? (
                        <>
                          {" "}Positions split between <b>{holderBrief.registerCount}</b> on the shareholders' register and{" "}
                          <b>{holderBrief.tradeCount}</b> disclosed via block trades.
                        </>
                      ) : holderBrief.tradeCount > 0 ? (
                        <>
                          {" "}All his stakes were disclosed via block trades.
                        </>
                      ) : holderBrief.registerCount > 0 ? (
                        <>
                          {" "}All his stakes sit on the shareholders' register.
                        </>
                      ) : null}
                      {holderBrief.rank != null && holderBrief.rankTotal > 0 && (
                        <>
                          {" "}By filed-stakes value he ranks{" "}
                          <b>
                            #{holderBrief.rank} of {holderBrief.rankTotal.toLocaleString("en-GB")}
                          </b>{" "}
                          named parties on the board.
                        </>
                      )}
                      {holderBrief.crossCount > 0 && (
                        <>
                          {" "}His companies take part in listed-to-listed cross-holding networks (
                          <b>{holderBrief.crossCount}</b> {holderBrief.crossCount === 1 ? "edge" : "edges"}).
                        </>
                      )}
                    </>
                  )}
                </p>

                {/* the numbers at a glance — a 2×2 stats grid */}
                <div className="grid grid-cols-2 gap-1.5">
                  <div className="rounded-lg border bg-background/60 px-2 py-1.5">
                    <p className="text-[9.5px] text-muted-foreground">
                      {lang === "ar" ? "قيمة الحصص المعلنة" : "filed-stakes value"}
                    </p>
                    <p className="text-xs font-bold tabular-nums">
                      {fmtEgp(holderPortfolio.totalValue, lang)}
                      {holderPortfolio.valuedCount < holderPortfolio.rows.length && (
                        <span className="ms-1 text-[9px] font-normal text-muted-foreground">
                          ({holderPortfolio.valuedCount}/{holderPortfolio.rows.length}{" "}
                          {lang === "ar" ? "مقيّمة" : "valued"})
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-background/60 px-2 py-1.5">
                    <p className="text-[9.5px] text-muted-foreground">
                      {lang === "ar" ? "تحركات موثّقة" : "documented moves"}
                    </p>
                    <p className="text-xs font-bold tabular-nums">
                      {holderBrief.moves.length.toLocaleString("en-GB")}
                      {holderBrief.buys + holderBrief.sells > 0 && (
                        <span className="ms-1 text-[9px] font-normal text-muted-foreground" dir="ltr">
                          {" "}
                          ({holderBrief.buys}▲ / {holderBrief.sells}▼)
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-background/60 px-2 py-1.5">
                    <p className="text-[9.5px] text-muted-foreground">{lang === "ar" ? "أقدم إفصاح" : "first filing"}</p>
                    <p className="text-xs font-bold tabular-nums">
                      {holderBrief.sinceIso ? fmtAsOf(holderBrief.sinceIso, lang) : "—"}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-background/60 px-2 py-1.5">
                    <p className="text-[9.5px] text-muted-foreground">{lang === "ar" ? "أساس الحصص" : "stake basis"}</p>
                    <p className="text-xs font-bold tabular-nums" dir={lang === "ar" ? "rtl" : "ltr"}>
                      {lang === "ar"
                        ? `${holderBrief.registerCount} سجل · ${holderBrief.tradeCount} صفقة`
                        : `${holderBrief.registerCount} reg · ${holderBrief.tradeCount} trade`}
                    </p>
                  </div>
                </div>

                {/* the move record — not just the latest: the last four
                 * documented moves, each with from→to, the ±% of company
                 * equity, and the estimated share quantity + EGP value */}
                {holderBrief.recent.length > 0 && (
                  <div className="rounded-lg border bg-background/60 px-2 py-1.5 space-y-1">
                    <p className="text-[9.5px] text-muted-foreground">
                      {lang === "ar"
                        ? `أحدث التحركات الموثّقة (${holderBrief.moves.length} إجمالًا)`
                        : `latest documented moves (${holderBrief.moves.length} in all)`}
                    </p>
                    {holderBrief.recent.map((m, i) => {
                      const up = (m.c ?? 0) >= 0;
                      return (
                        <button
                          key={`${m.per}-${m.ticker}-${i}`}
                          onClick={() => setFocus({ type: "company", ticker: m.ticker })}
                          className="flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-start hover:bg-accent/50"
                          title={
                            lang === "ar"
                              ? `افتح ملف ملكية ${m.ticker} — ${m.per}`
                              : `open ${m.ticker}'s ownership profile — ${m.per}`
                          }
                        >
                          <span className="min-w-0 truncate text-[10px] text-muted-foreground">
                            <b className="rounded bg-secondary px-1 text-[9.5px] text-foreground/80" dir="ltr">
                              {m.ticker}
                            </b>{" "}
                            {m.per}
                          </span>
                          <span className="shrink-0 text-[10px] tabular-nums" dir="ltr">
                            {m.from != null && m.to != null ? `${fmtPct(m.from)}% → ${fmtPct(m.to)}%` : m.to != null ? `${fmtPct(m.to)}%` : "—"}
                            {" "}
                            <b className={up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}>
                              {up ? "+" : ""}
                              {(m.c ?? 0).toFixed(2)}%
                            </b>
                          </span>
                        </button>
                      );
                    })}
                    {holderBrief.latestSz && (
                      <p className="tabular-nums text-[9.5px] text-muted-foreground" title={lang === "ar" ? "حجم أحدث تحرك: الكمية المقدّرة من الأسهم وقيمتها بالسعر الحالي" : "the latest move's size: estimated share quantity and its value at the current price"}>
                        {lang === "ar" ? "أحدث تحرك ≈ " : "latest move ≈ "}
                        <b>{fmtShares(holderBrief.latestSz.shares)}</b> {lang === "ar" ? "سهم" : "shares"} · ≈{" "}
                        <b>{fmtEgp(holderBrief.latestSz.valueEgp, lang)}</b>
                      </p>
                    )}
                  </div>
                )}

                {/* recent net direction — with the buys/sells split */}
                {holderBrief.moves.length >= 3 && (
                  <p className="text-[11px]">
                    {lang === "ar" ? "صافي آخر تحركاته: " : "recent net direction: "}
                    <b className={holderBrief.netRecent >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}>
                      {holderBrief.netRecent >= 0
                        ? lang === "ar"
                          ? "شرائي — يراكم مراكزه"
                          : "accumulating — net buyer"
                        : lang === "ar"
                          ? "بيعي — يخفف مراكزه"
                          : "reducing — net seller"}
                    </b>
                    {holderBrief.buys + holderBrief.sells > 0 && (
                      <span className="ms-1 text-[9.5px] text-muted-foreground" dir="ltr">
                        ({holderBrief.buys}▲ / {holderBrief.sells}▼)
                      </span>
                    )}
                  </p>
                )}

                {/* sector footprint — where his money actually sits */}
                {holderBrief.sectorList.length > 0 && holderBrief.totalValue > 0 && (
                  <div className="space-y-1">
                    <p className="text-[9.5px] font-semibold text-muted-foreground">
                      {lang === "ar" ? "بصمة القطاعات (بحسب القيمة)" : "sector footprint (by value)"}
                    </p>
                    {holderBrief.sectorList.slice(0, 3).map(([s, v]) => {
                      const share = Math.max(0, Math.min(1, v.value / holderBrief.totalValue));
                      return (
                        <div key={s} className="flex items-center gap-2">
                          <span className="w-[38%] shrink-0 truncate text-[10px] text-muted-foreground" title={s}>
                            {s}
                          </span>
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full" style={{ width: `${share * 100}%`, backgroundColor: holderColorOf(focusState.h) }} />
                          </div>
                          <span className="w-[22%] shrink-0 text-end text-[10px] tabular-nums text-muted-foreground">
                            {Math.round(share * 100)}%
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* largest filed stakes — clickable through to the company */}
                {holderPortfolio.rows.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[9.5px] font-semibold text-muted-foreground">
                      {lang === "ar" ? "أكبر الحصص المعلنة" : "largest filed stakes"}
                    </p>
                    {holderPortfolio.rows.slice(0, 3).map(({ p, ring, value }) => {
                      const shares = stakeShares(ring?.company, p.p);
                      return (
                        <button
                          key={`${p.t}-${p.a}`}
                          onClick={() => setFocus({ type: "company", ticker: p.t })}
                          className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-1 text-start hover:bg-accent/50"
                          title={
                            (ring ? dn(ring.company, lang) : p.t) +
                            (shares ? `\n≈ ${fmtShares(shares)} ${lang === "ar" ? "سهم" : "shares"}` : "")
                          }
                        >
                          <span className="min-w-0 truncate">
                            <b className="rounded bg-secondary px-1 text-[10px]" dir="ltr">
                              {p.t}
                            </b>
                            {ring && <span className="ms-1 text-[10px] text-muted-foreground">{lang === "ar" ? ring.company.sectorAr : ring.company.sectorEn}</span>}
                          </span>
                          <span className="shrink-0 tabular-nums">
                            <b>{fmtPct(p.p)}%</b>{" "}
                            <span className="text-[10px] text-muted-foreground">
                              {fmtEgp(value, lang)}
                              {shares ? ` · ≈${fmtShares(shares)}` : ""}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* footer: through to the full portfolio in the aside */}
              <button
                className="border-t bg-background/40 px-3 py-2 text-[11px] font-semibold hover:bg-accent"
                onClick={() => {
                  if (fs) toggleFullscreen();
                  window.setTimeout(() => asideProfileRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), fs ? 420 : 0);
                }}
              >
                {lang === "ar" ? "الملف الكامل في اللوحة الجانبية ↘" : "full profile in the side panel ↘"}
              </button>
            </div>
          )}
        </div>

        {/* ── right panel: company profile / investor portfolio / register ── */}
        <aside className="space-y-3">
          {/* T69 — PERIOD MOVES side summary, ALWAYS visible (the user's ask:
           * "a side summary shows period moves"): every disclosed period with
           * its date, move count and the biggest named moves inline — clicking
           * a period replays it on the board; clicking a move opens that
           * company's ownership profile. */}
          {data.periods.length > 0 && (
            <div className="rounded-xl border bg-card p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold leading-snug">
                    {lang === "ar" ? "ملخص تحركات الفترات" : "Period moves digest"}
                  </h2>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {data.periods.reduce((s, p) => s + p.m.length, 0).toLocaleString("en-GB")}{" "}
                    {lang === "ar" ? "تحرك حصة في" : "stake moves across"}{" "}
                    {data.periods.length} {lang === "ar" ? (data.periods.length === 1 ? "فترة إفصاح" : "فترات إفصاح") : data.periods.length === 1 ? "filing period" : "filing periods"}
                  </p>
                </div>
                {weekIdx !== null && (
                  <button className="text-[11px] underline text-muted-foreground hover:text-foreground shrink-0" onClick={() => setWeekIdx(null)}>
                    {lang === "ar" ? "إخفاء الأسبوع" : "clear week"}
                  </button>
                )}
              </div>
              <div className="max-h-[40vh] overflow-auto space-y-1 pr-1 thin-scroll">
                {data.periods.map((per, idx) => {
                  // the API lists periods newest-first — the digest keeps that
                  // order and its index matches the week strip exactly
                  const active = weekIdx === idx;
                  const top = [...per.m].sort((a, b) => Math.abs(b.c ?? 0) - Math.abs(a.c ?? 0)).slice(0, 3);
                  return (
                    <div
                      key={per.start}
                      className={`rounded-lg border px-2 py-1.5 transition-colors ${active ? "border-primary bg-primary/10" : "bg-background/60"}`}
                    >
                      <button
                        className="flex w-full items-center justify-between gap-2 text-xs"
                        onClick={() => setWeekIdx(active ? null : idx)}
                        title={lang === "ar" ? "اعرض تحركات هذه الفترة على اللوحة" : "replay this period's moves on the board"}
                      >
                        <span className="font-semibold">{per.l}</span>
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          {per.m.length} {lang === "ar" ? "تحرك" : "moves"}
                        </span>
                      </button>
                      {top.length > 0 && (
                        <div className="mt-1 space-y-0.5">
                          {top.map((m, j) => {
                            const up = (m.c ?? 0) >= 0;
                            const sz = moveSize(data.companies.find((c) => c.ticker === m.t), m.c);
                            return (
                              <button
                                key={`${m.t}-${m.h}-${j}`}
                                className="flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-[10.5px] text-start hover:bg-accent/50"
                                onClick={() => setFocus({ type: "company", ticker: m.t })}
                                title={`${data.people[m.h]?.n ?? String(m.h)} · ${m.t}${m.f != null && m.o != null ? ` (${fmtPct(m.f)}% → ${fmtPct(m.o)}%)` : ""}${sz ? ` · ≈ ${fmtShares(sz.shares)} ${lang === "ar" ? "سهم" : "shares"} · ≈ ${fmtEgp(sz.valueEgp, lang)}` : ""}`}
                              >
                                <span className="min-w-0 truncate text-muted-foreground">
                                  <b className="rounded bg-secondary px-1 font-bold text-foreground/80" dir="ltr">{m.t}</b>{" "}
                                  {(data.people[m.h]?.n ?? String(m.h)).slice(0, 22)}
                                  {sz && (
                                    <span className="ms-1 tabular-nums" dir="ltr">· {fmtShares(sz.shares)}</span>
                                  )}
                                </span>
                                <b className={`shrink-0 tabular-nums ${up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`} dir="ltr">
                                  {up ? "+" : ""}{(m.c ?? 0).toFixed(2)}%
                                </b>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {/* T65 — the WEEK'S MOVES, ranked: the most recognizable form of
           * the week replay — not tiny arcs on the board but a plain list of
           * who moved, in which company, from → to, biggest first. Clicking a
           * row focuses the company; clicking the holder name focuses HIM. */}
          {weekMoves && (
            <div className="rounded-xl border bg-card p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold leading-snug">
                    {lang === "ar" ? "تحركات الأسبوع المختار" : "The chosen week's moves"}
                  </h2>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {weekMoves.period.l} ·{" "}
                    {weekMoves.period.m.length.toLocaleString("en-GB")}{" "}
                    {lang === "ar" ? "حصة تحرّكت" : "stakes moved"} ·{" "}
                    {new Set(weekMoves.period.m.map((m) => m.t)).size} {lang === "ar" ? (new Set(weekMoves.period.m.map((m) => m.t)).size === 1 ? "شركة" : "شركات") : new Set(weekMoves.period.m.map((m) => m.t)).size === 1 ? "company" : "companies"}
                  </p>
                </div>
                <button className="text-[11px] underline text-muted-foreground hover:text-foreground shrink-0" onClick={() => setWeekIdx(null)}>
                  {lang === "ar" ? "إخفاء" : "clear"}
                </button>
              </div>
              <div className="max-h-[34vh] overflow-auto space-y-1 pr-1 thin-scroll">
                {[...weekMoves.period.m]
                  .sort((a, b) => Math.abs(b.c ?? 0) - Math.abs(a.c ?? 0))
                  .slice(0, 24)
                  .map((m, i) => {
                    const up = (m.c ?? 0) >= 0;
                    const holder = data ? data.people[m.h]?.n ?? String(m.h) : String(m.h);
                    const holderAlts = data ? data.people[m.h]?.alts : undefined;
                    const sz = moveSize(data.companies.find((c) => c.ticker === m.t), m.c);
                    return (
                      <button
                        key={`${m.t}-${m.h}-${i}`}
                        onClick={() => setFocus({ type: "company", ticker: m.t })}
                        className="w-full rounded-lg border bg-background/60 px-2 py-1.5 text-start text-xs hover:bg-accent/50 transition-colors"
                        title={lang === "ar" ? "افتح ملف ملكية الشركة" : "open the company's ownership profile"}
                      >
                        {/* T66 — WHO made the move, first and prominent: the
                         * holder's own name leads every row (the user's ask),
                         * the company + stake change follow */}
                        <div className="flex items-center justify-between gap-2">
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                              e.stopPropagation();
                              setFocus({ type: "holder", h: m.h });
                            }}
                            onKeyDown={(e) => {
                              // T73 — Space activation added (WAI-ARIA), same as the in-map twin
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                e.stopPropagation();
                                setFocus({ type: "holder", h: m.h });
                              }
                            }}
                            className="min-w-0 truncate font-semibold underline decoration-dotted underline-offset-2 hover:text-primary"
                            title={`${holder}${holderAlts?.length ? `\n${lang === "ar" ? "ورد أيضًا باسم:" : "also filed as:"} ${holderAlts.join(" · ")}` : ""}${lang === "ar" ? "\nاضغط لفتح ملف المالك" : "\nclick to open the holder's profile"}`}
                          >
                            {holder}
                          </span>
                          <b
                            className={`shrink-0 tabular-nums ${up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}
                            title={
                              lang === "ar"
                                ? "النسبة المتغيرة من إجمالي حقوق ملكية الشركة (رأس مالها الأساسي) بين نشرتين"
                                : "the changed share of the company's total equity (share capital) between two filings"
                            }
                          >
                            {up ? "+" : ""}
                            {(m.c ?? 0).toFixed(2)}%
                          </b>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground tabular-nums">
                          <b className="rounded bg-secondary px-1 py-px font-bold text-foreground/80" dir="ltr">{m.t}</b>
                          <span>
                            {m.f != null && m.o != null ? `${fmtPct(m.f)}% → ${fmtPct(m.o)}%` : m.o != null ? `${lang === "ar" ? "إفصاح جديد" : "new filing"} ${fmtPct(m.o)}%` : "—"}
                          </span>
                          {sz && (
                            <span dir="auto" title={lang === "ar" ? "الكمية المقدّرة من الأسهم التي تمثلها هذه الحركة، وقيمتها بالسعر الحالي" : "the estimated share quantity this move represents, and its value at the current price"}>
                              · ≈ <b>{fmtShares(sz.shares)}</b> {lang === "ar" ? "سهم" : "shares"} · ≈ <b>{fmtEgp(sz.valueEgp, lang)}</b>
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
              </div>
            </div>
          )}
          {focusState?.kind === "company" ? (
            <div className="rounded-xl border bg-card p-3 space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold leading-snug">
                    {lang === "ar" ? "ملف ملكية الشركة" : "Company ownership profile"}
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {focusState.ring.ticker} · {dn(focusState.ring.company, lang)}
                  </p>
                </div>
                <button className="text-[11px] underline text-muted-foreground hover:text-foreground shrink-0" onClick={() => setFocus(null)}>
                  {lang === "ar" ? "رجوع" : "back"}
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {/* T73 — no more dangling "· ·" separators when a field is
                 * missing (a null close used to render "12M EGP ·  · Bank") */}
                {[
                  fmtCap(focusState.ring.company.marketCap, lang),
                  focusState.ring.company.close != null ? `${focusState.ring.company.close} EGP` : null,
                  lang === "ar" ? focusState.ring.company.sectorAr : focusState.ring.company.sectorEn,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>

              {profilePositions.length === 0 ? (
                /* T59 — honest empty state: public company, no filed owners yet */
                <div className="rounded-lg border border-dashed bg-background/60 px-2.5 py-3 text-[11px] text-muted-foreground leading-relaxed">
                  {lang === "ar"
                    ? `لا توجد إفصاحات ملكية منشورة لهذه الشركة حتى ${data.asOf.slice(0, 10)}.`
                    : `No ownership disclosures have been filed for this company as of ${data.asOf.slice(0, 10)}.`}
                </div>
              ) : (
                <>
                  {/* disclosed share bar */}
                  <div>
                    <div className="flex h-4 w-full overflow-hidden rounded-md border">
                      {profilePositions.slice(0, 8).map((p) => (
                        <div key={p.h} style={{ width: `${Math.max(0.5, Math.min(100, p.p))}%`, backgroundColor: holderColorOf(p.h) }} title={`${personName(p.h)} · ${fmtPct(p.p)}%`} />
                      ))}
                      {100 - profileDisclosed > 0 && (
                        <div style={{ width: `${Math.max(0, 100 - profileDisclosed)}%` }} className="hatch-bg" title={lang === "ar" ? "غير معلن" : "not disclosed"} />
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {lang === "ar" ? "المعلن" : "disclosed"} <b>{profileDisclosed.toFixed(1)}%</b> ·{" "}
                      {lang === "ar" ? "غير معلن" : "not disclosed"} <b>{Math.max(0, 100 - profileDisclosed).toFixed(1)}%</b>
                      {profilePositions[0]?.a ? ` · ${lang === "ar" ? "آخر إفصاح" : "latest"} ${profilePositions[0].a}` : ""}
                    </p>
                  </div>

                  {/* holders list */}
                  <div className="max-h-[38vh] overflow-auto space-y-1 pr-1 thin-scroll">
                    {profilePositions.map((p) => {
                      const bl = bulletin(p.s);
                      return (
                        <div key={`${p.h}-${p.a}`} className="rounded-lg border bg-background/60 px-2 py-1.5 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-1.5 min-w-0">
                              <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: holderColorOf(p.h) }} />
                              <span className="truncate">{personName(p.h)}</span>
                            </span>
                            <b className="shrink-0">{fmtPct(p.p)}%</b>
                          </div>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {basisLabel(p.b)} · {p.a ?? "—"}
                            {p.f ? ` · #${p.f}` : ""}
                            {bl && (
                              <>
                                {" · "}
                                <a href={bl} target="_blank" rel="noreferrer" className="underline hover:text-foreground">
                                  {lang === "ar" ? "الإفصاح الرسمي ↗" : "bulletin ↗"}
                                </a>
                              </>
                            )}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {/* cross holdings */}
              {(crossOut.length > 0 || crossIn.length > 0) && (
                <div className="space-y-1 text-xs border-t pt-2">
                  {crossOut.length > 0 && (
                    <p className="text-muted-foreground">
                      {lang === "ar" ? "تملك:" : "owns:"}{" "}
                      {crossOut.map((c) => (
                        <button key={c.d} className="underline hover:text-foreground" onClick={() => setFocus({ type: "company", ticker: c.d })}>
                          {c.d}
                          {c.p != null ? ` (${c.p}%)` : ""}
                        </button>
                      ))}
                    </p>
                  )}
                  {crossIn.length > 0 && (
                    <p className="text-muted-foreground">
                      {lang === "ar" ? "تملكها:" : "held by:"}{" "}
                      {crossIn.map((c) => (
                        <button key={c.o} className="underline hover:text-foreground" onClick={() => setFocus({ type: "company", ticker: c.o })}>
                          {c.o}
                          {c.p != null ? ` (${c.p}%)` : ""}
                        </button>
                      ))}
                    </p>
                  )}
                </div>
              )}

              <button
                className="w-full rounded-md border bg-primary/10 px-2 py-1.5 text-xs font-semibold hover:bg-primary/20"
                onClick={() => navigate("company", { ticker: focusState.ring.ticker })}
              >
                {lang === "ar" ? "افتح صفحة الشركة ↗" : "open company page ↗"}
              </button>
            </div>
          ) : focusState?.kind === "holder" && holderPortfolio ? (
            /* ── T59 — INVESTOR PORTFOLIO: his investments across the stocks ── */
            <div ref={asideProfileRef} className="rounded-xl border bg-card p-3 space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-sm font-bold leading-snug truncate">
                    <span className="inline-block size-2.5 rounded-full me-1.5 align-middle" style={{ backgroundColor: holderColorOf(focusState.h) }} />
                    {personName(focusState.h)}
                  </h2>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {data.people[focusState.h]?.k === "f"
                      ? lang === "ar"
                        ? "شركة أو صندوق"
                        : "firm / fund"
                      : lang === "ar"
                        ? "شخص"
                        : "person"}{" "}
                    · {focusState.rings.length} {lang === "ar" ? (focusState.rings.length === 1 ? "شركة مدرجة" : "شركات مدرجة") : focusState.rings.length === 1 ? "listed company" : "listed companies"}
                  </p>
                  {/* T66 — the filing variants this identity absorbed (the
                   * dedupe is transparent, never silent) */}
                  {!!data.people[focusState.h]?.alts?.length && (
                    <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
                      {lang === "ar" ? "ورد في النشرات أيضًا باسم:" : "also filed as:"}{" "}
                      <span className="italic">{data.people[focusState.h]!.alts!.join(" · ")}</span>
                    </p>
                  )}
                </div>
                <button className="text-[11px] underline text-muted-foreground hover:text-foreground shrink-0" onClick={() => setFocus(null)}>
                  {lang === "ar" ? "رجوع" : "back"}
                </button>
              </div>

              {/* T71 — the INVESTOR BRIEF: a written, data-grounded paragraph
                  about the focused holder (the user's ask) */}
              {holderBrief && (
                <div className="rounded-lg border bg-background/60 px-2.5 py-2 text-[11px] leading-relaxed">
                  <p className="font-bold mb-1">{lang === "ar" ? "ملخص المستثمر" : "Investor brief"}</p>
                  <p>
                    {lang === "ar" ? (
                      <>
                        {personName(focusState.h)}{" "}
                        {holderBrief.isFirm ? "كيان (شركة أو صندوق) ورد اسمه في إفصاحات الملكية الرسمية كمالك أو عضو مجلس في" : "شخص طبيعي ورد اسمه في إفصاحات الملكية الرسمية كمالك أو عضو مجلس في"}{" "}
                        <b>{holderBrief.companies}</b>{" "}
                        {holderBrief.companies === 1 ? "شركة مدرجة واحدة" : "شركات مدرجة"}
                        {holderBrief.sectorCount > 0 && (
                          <>
                            {""} عبر <b>{holderBrief.sectorCount}</b>{" "}
                            {holderBrief.sectorCount === 1 ? "قطاع" : "قطاعات"}
                          </>
                        )}. 
                        {holderBrief.sinceIso && (
                          <>
                            {" "}أقدم حصة مؤرخة له في أرشيف الإفصاحات تعود إلى <b>{fmtAsOf(holderBrief.sinceIso, lang)}</b>.
                          </>
                        )}
                        {holderBrief.rank != null && holderBrief.rankTotal > 0 && (
                          <>
                            {" "}بقيمة حصصه المعلنة يقع في <b>المرتبة #{holderBrief.rank} من {holderBrief.rankTotal.toLocaleString("en-GB")}</b> طرفًا مذكورًا على اللوحة.
                          </>
                        )}
                        {holderBrief.biggest?.value != null && (
                          <>
                            أكبر حصصه المعلنة في <b dir="ltr">{holderBrief.biggest.p.t}</b> ({fmtPct(holderBrief.biggest.p.p)}%، بقيمة تقديرية {fmtEgp(holderBrief.biggest.value, lang)}).
                          </>
                        )}{" "}
                        {holderBrief.moves.length > 0 && holderBrief.latest && (
                          <>
                            يوثّق سجل الإفصاحات <b>{holderBrief.moves.length}</b>{" "}
                            {holderBrief.moves.length === 1 ? "تحركًا واحدًا لحصصه" : holderBrief.moves.length === 2 ? "تحركين لحصصه" : "تحركات لحصصه"}؛ أحدثها في فترة {holderBrief.latest.per}: {" "}
                            {holderBrief.latest.from != null && holderBrief.latest.to != null
                              ? `تحرّكت حصته في ${holderBrief.latest.ticker} من ${fmtPct(holderBrief.latest.from)}% إلى ${fmtPct(holderBrief.latest.to)}%`
                              : `تحرك في ${holderBrief.latest.ticker}`}
                            {holderBrief.latestSz
                              ? ` — أي ما يعادل تقديريًا ${fmtShares(holderBrief.latestSz.shares)} سهمًا بقيمة ${fmtEgp(holderBrief.latestSz.valueEgp, lang)}`
                              : ""}
                            .
                          </>
                        )}{" "}
                        {holderBrief.moves.length >= 3 && (
                          <>
                            صافي اتجاهه في آخر تحركاته <b className={holderBrief.netRecent >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}>{holderBrief.netRecent >= 0 ? "شرائي (تراكم مراكز)" : "بيعي (تخفيف مراكز)"}</b>.
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        {personName(focusState.h)} is{" "}
                        {holderBrief.isFirm ? "an entity (firm / fund) named in the official ownership disclosures as a holder or board member in" : "an individual named in the official ownership disclosures as a holder or board member in"}{" "}
                        <b>{holderBrief.companies === 1 ? "one listed company" : `${holderBrief.companies} listed companies`}</b>
                        {holderBrief.sectorCount > 0 && (
                          <>
                            {""} across <b>{holderBrief.sectorCount === 1 ? "one sector" : `${holderBrief.sectorCount} sectors`}</b>
                          </>
                        )}. 
                        {holderBrief.sinceIso && (
                          <>
                            {" "}His earliest dated stake in the disclosure archive is from <b>{fmtAsOf(holderBrief.sinceIso, lang)}</b>.
                          </>
                        )}
                        {holderBrief.rank != null && holderBrief.rankTotal > 0 && (
                          <>
                            {" "}By filed-stakes value he ranks <b>#{holderBrief.rank} of {holderBrief.rankTotal.toLocaleString("en-GB")}</b> named parties on the board.
                          </>
                        )}
                        {holderBrief.biggest?.value != null && (
                          <>
                            Largest filed stake: <b dir="ltr">{holderBrief.biggest.p.t}</b> ({fmtPct(holderBrief.biggest.p.p)}%, est. {fmtEgp(holderBrief.biggest.value, lang)}).
                          </>
                        )}{" "}
                        {holderBrief.moves.length > 0 && holderBrief.latest && (
                          <>
                            The filing record documents <b>{holderBrief.moves.length}</b>{" "}
                            {holderBrief.moves.length === 1 ? "stake move" : "stake moves"}; the latest in {holderBrief.latest.per}: {" "}
                            {holderBrief.latest.from != null && holderBrief.latest.to != null
                              ? `his stake in ${holderBrief.latest.ticker} moved from ${fmtPct(holderBrief.latest.from)}% to ${fmtPct(holderBrief.latest.to)}%`
                              : `a move in ${holderBrief.latest.ticker}`}
                            {holderBrief.latestSz
                              ? ` — an estimated ${fmtShares(holderBrief.latestSz.shares)} shares worth ${fmtEgp(holderBrief.latestSz.valueEgp, lang)}`
                              : ""}
                            .
                          </>
                        )}{" "}
                        {holderBrief.moves.length >= 3 && (
                          <>
                            Recent net direction: <b className={holderBrief.netRecent >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}>{holderBrief.netRecent >= 0 ? "accumulating (net buyer)" : "reducing (net seller)"}</b>.
                          </>
                        )}
                      </>
                    )}
                  </p>
                </div>
              )}

              {/* portfolio headline: total estimated value of the filed stakes */}
              <div className="rounded-lg border bg-background/60 px-2.5 py-2">
                <p className="text-[10px] text-muted-foreground">{lang === "ar" ? "قيمة الحصص المعلنة (تقدير بالسعر الحالي)" : "value of filed stakes (at current prices)"}</p>
                <p className="text-base font-bold tabular-nums mt-0.5">
                  {fmtEgp(holderPortfolio.totalValue, lang)}
                  {holderPortfolio.valuedCount < holderPortfolio.rows.length && (
                    <span className="text-[10px] font-normal text-muted-foreground ms-1.5">
                      ({holderPortfolio.valuedCount}/{holderPortfolio.rows.length} {lang === "ar" ? "مقيّمة" : "valued"})
                    </span>
                  )}
                </p>
              </div>

              {/* holdings, sorted by stake value */}
              <div className="max-h-[46vh] overflow-auto space-y-1 pr-1 thin-scroll">
                {holderPortfolio.rows.map(({ p, ring, value }) => {
                  const bl = bulletin(p.s);
                  const rel = holderPortfolio.totalValue > 0 && value != null ? value / holderPortfolio.totalValue : 0;
                  const changed = weekMoves?.byT.get(p.t)?.length;
                  return (
                    <div key={`${p.t}-${p.a}`} className="rounded-lg border bg-background/60 px-2 py-1.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <button
                          className="font-semibold underline decoration-muted-foreground/40 hover:text-foreground text-start truncate"
                          onClick={() => setFocus({ type: "company", ticker: p.t })}
                          title={ring ? dn(ring.company, lang) : p.t}
                        >
                          {p.t}
                          {changed ? <span className="ms-1 text-[9px] text-emerald-600 dark:text-emerald-400">● {lang === "ar" ? "تحرك هذا الأسبوع" : "moved"}</span> : null}
                        </button>
                        <b className="shrink-0 tabular-nums">{fmtPct(p.p)}%</b>
                      </div>
                      {ring && (
                        <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{dn(ring.company, lang)} · {lang === "ar" ? ring.company.sectorAr : ring.company.sectorEn}</p>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full" style={{ width: `${Math.min(100, rel * 100)}%`, backgroundColor: holderColorOf(focusState.h) }} />
                        </div>
                        <span className="text-[10px] tabular-nums text-muted-foreground shrink-0">{fmtEgp(value, lang)}</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {basisLabel(p.b)} · {p.a ?? "—"}
                        {bl && (
                          <>
                            {" · "}
                            <a href={bl} target="_blank" rel="noreferrer" className="underline hover:text-foreground">
                              {lang === "ar" ? "الإفصاح ↗" : "bulletin ↗"}
                            </a>
                          </>
                        )}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border bg-card p-3">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold">{lang === "ar" ? "سجل الأطراف" : "Register of parties"}</h2>
                <span className="text-[10px] text-muted-foreground">{register.peopleTotal ?? 0}</span>
              </div>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={lang === "ar" ? "ابحث عن شركة أو اسم مودع…" : "search a company or a named party…"}
                className="w-full mb-2 rounded-md border bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
              />
              {register.companies.length > 0 && (
                <div className="mb-2 space-y-1">
                  {register.companies.map((c) => (
                    <button
                      key={c.ticker}
                      onClick={() => setFocus({ type: "company", ticker: c.ticker })}
                      className="w-full text-start rounded-lg px-2 py-1.5 text-xs border border-transparent hover:bg-accent"
                    >
                      <span className="font-semibold">{c.ticker}</span> · {dn(c, lang)}
                      <span className="block text-[10px] text-muted-foreground">
                        {layout.slicesByTicker.has(c.ticker)
                          ? lang === "ar"
                            ? "على الخريطة"
                            : "on the board"
                          : lang === "ar"
                            ? "بلا إفصاحات ملكية بعد"
                            : "no filed stakes yet"}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <div className="max-h-[52vh] overflow-auto pr-1 space-y-0.5 thin-scroll">
                {register.people.map((p, i) => {
                  const h = data.people.indexOf(p);
                  return (
                    <button
                      key={`${p.n}-${i}`}
                      onClick={() => setFocus({ type: "holder", h })}
                      className="w-full text-start rounded-lg px-2 py-1.5 text-xs border border-transparent hover:bg-accent"
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: holderColor(p.n) }} />
                        <span className="truncate">{lang === "ar" || !p.e ? p.n : p.e}</span>
                      </span>
                      <span className="block text-[10px] text-muted-foreground ps-3.5">
                        {p.k === "f" ? (lang === "ar" ? "شركة أو صندوق" : "firm / fund") : lang === "ar" ? "شخص" : "person"} ·{" "}
                        {(layout.holderCompanies.get(h)?.length ?? 0)} {lang === "ar" ? ((layout.holderCompanies.get(h)?.length ?? 0) === 1 ? "شركة" : "شركات") : (layout.holderCompanies.get(h)?.length ?? 0) === 1 ? "company" : "companies"}
                      </span>
                    </button>
                  );
                })}
                {register.people.length === 0 && (
                  <p className="text-xs text-muted-foreground py-2">{lang === "ar" ? "لا نتائج." : "no matches."}</p>
                )}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
