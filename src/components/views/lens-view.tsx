"use client";

import { useEffect, useMemo, useState } from "react";
import { useApp } from "../market/app-context";
import { bootParam, patchUrlParams } from "@/lib/url-state";
import { T, dn, type Lang } from "@/lib/i18n";
import { fmtPct } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";

/** عدسة الملكية — the Ownership Lens (T57).
 *
 *  A visual map of the whole exchange: every sector as a region sized by its
 *  total market cap, every listed company a bubble inside its sector sized
 *  by its own market cap and colored by today's change. Pick an investor
 *  from the registry and the lens draws curved links to every company that
 *  investor has documented dealings in (official EGX disclosure filings —
 *  dates, share counts and filing links attached), dimming the rest.
 *
 *  All data is real: the map comes from the live scanner universe, the
 *  investor edges from the exchange's own disclosure archive. No
 *  percentages are invented — the exchange's live top-10 tables are not one
 *  of our sources, so the lens shows documented relationships instead, each
 *  with its official filing link. */

type LensCompany = {
  ticker: string;
  name: string;
  nameAr: string;
  sectorEn: string;
  sectorAr: string;
  sectorCode: string;
  close: number;
  changePct: number;
  marketCap: number | null;
};

type LensEdge = {
  investorId: string;
  ticker: string;
  self: boolean;
  boughtShares: number;
  soldShares: number;
  filings: number;
  firstDate: string;
  lastDate: string;
  links: string[];
};

type LensInvestor = {
  id: string;
  ticker: string | null;
  group: boolean;
  nameEn: string;
  nameAr: string;
  crossHoldings: number;
  filings: number;
  listed: boolean;
};

type LensPayload = {
  ok: boolean;
  asOf: string;
  generatedAt: string;
  sourceAr: string;
  source: string;
  noteAr: string;
  noteEn: string;
  total: number;
  companies: LensCompany[];
  investors: LensInvestor[];
  edges: LensEdge[];
  activity: Record<string, number>;
};

// ── deterministic layout ────────────────────────────────────────────────────

const W = 1180;
const H = 760;
const PAD = 6;
const HEADER = 22;

type Placed = { c: LensCompany; x: number; y: number; r: number };

type SectorCell = {
  code: string;
  label: string;
  labelEn: string;
  x: number;
  y: number;
  w: number;
  h: number;
  cap: number;
  bubbles: Placed[];
};

/** Squarified treemap on sector caps — the classic algorithm, deterministic. */
function squarify(items: { code: string; area: number }[], x: number, y: number, w: number, h: number): { code: string; x: number; y: number; w: number; h: number }[] {
  const out: { code: string; x: number; y: number; w: number; h: number }[] = [];
  const total = items.reduce((s, i) => s + i.area, 0) || 1;
  let scale = (w * h) / total;
  let cx = x;
  let cy = y;
  let rest = [...items];
  while (rest.length) {
    // worst-case ratio greedy: fill the shorter side
    const horizontal = w >= h ? false : true; // lay a row along the shorter side
    const side = horizontal ? w : h;
    let row: typeof rest = [];
    let rowArea = 0;
    let bestRatio = Infinity;
    for (let i = 0; i < rest.length; i++) {
      const cand = rest.slice(0, i + 1);
      const candArea = cand.reduce((s, it) => s + it.area, 0);
      const thick = candArea / side / scale;
      const maxSide = Math.max(side / scale / thick, thick);
      const ratio = maxSide / Math.min(side / scale / thick, thick);
      if (ratio <= bestRatio || i === 0) {
        bestRatio = ratio;
        row = cand;
        rowArea = candArea;
      } else break;
    }
    const thick = (rowArea * scale) / side;
    let off = 0;
    for (const it of row) {
      const len = (it.area * scale) / thick;
      if (horizontal) out.push({ code: it.code, x: cx + off, y: cy, w: len, h: thick });
      else out.push({ code: it.code, x: cx, y: cy + off, w: thick, h: len });
      off += horizontal ? len : len;
    }
    if (horizontal) {
      cy += thick;
      h -= thick;
    } else {
      cx += thick;
      w -= thick;
    }
    rest = rest.slice(row.length);
    scale = (w * h) / (rest.reduce((s, i) => s + i.area, 0) || 1);
  }
  return out;
}

/** Row-packed circles inside a rect: biggest first, wrapped rows, centered.
 *  rMax is solved from the AREA budget (Σπr² ≤ 68% of the cell) so the pack
 *  can never overflow its box — then capped by the cell height. */
function packBubbles(rect: { x: number; y: number; w: number; h: number }, rows: LensCompany[], capOf: (c: LensCompany) => number): Placed[] {
  const innerW = Math.max(10, rect.w - PAD * 2);
  const innerH = Math.max(10, rect.h - HEADER - PAD * 2);
  const ox = rect.x + PAD;
  const oy = rect.y + HEADER + PAD;
  if (!rows.length || innerW < 24 || innerH < 24) return [];
  const caps = rows.map(capOf);
  const maxCap = Math.max(...caps, 1);
  // area solve: r_i = R·sqrt(cap_i/maxCap) ⇒ Σπ·r_i² = π·R²·Σ(cap_i/maxCap)
  const relSum = caps.reduce((s, c) => s + Math.sqrt(c / maxCap) ** 2, 0) || 1;
  let rMax = Math.sqrt((innerW * innerH * 0.68) / (Math.PI * relSum));
  rMax = Math.min(rMax, innerH / 2.4, innerW / 3.2, 30);
  rMax = Math.max(rMax, 3);

  const placed: Placed[] = [];
  const rowsOut: Placed[][] = [];
  let curRow: Placed[] = [];
  let px = 0;
  let py = 0;
  let rowH = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = Math.max(2.6, rMax * Math.sqrt(caps[i] / maxCap));
    if (px > 0 && px + r * 2 > innerW) {
      rowsOut.push(curRow);
      curRow = [];
      py += rowH + 4;
      rowH = 0;
      px = 0;
    }
    if (py + r * 2 > innerH) break; // box full — stop, no overflow
    const p: Placed = { c: rows[i], x: ox + px + r, y: oy + py + r, r };
    placed.push(p);
    curRow.push(p);
    px += r * 2 + 3;
    rowH = Math.max(rowH, r * 2);
  }
  if (curRow.length) rowsOut.push(curRow);
  // center each row horizontally, center the whole block vertically
  const totalH = rowsOut.reduce((s, row) => s + (row.length ? Math.max(...row.map((p) => p.r)) * 2 : 0), 0) + Math.max(0, rowsOut.length - 1) * 4;
  const dy = (innerH - totalH) / 2;
  let yy = oy + Math.max(0, dy);
  for (const row of rowsOut) {
    if (!row.length) continue;
    const usedW = row[row.length - 1].x + row[row.length - 1].r - (row[0].x - row[0].r);
    const shift = (innerW - usedW) / 2;
    const rRow = Math.max(...row.map((p) => p.r));
    for (const p of row) {
      p.x += shift;
      p.y = yy + rRow;
    }
    yy += rRow * 2 + 4;
  }
  return placed;
}

function heatFill(pct: number, dim = false): string {
  const p = dim ? pct * 0.25 : pct;
  if (Math.abs(p) < 0.05) return dim ? "oklch(0.75 0.01 90 / 0.35)" : "oklch(0.75 0.01 90)";
  const cap = 4;
  const a = dim ? 0.28 : 0.9;
  const i = Math.min(Math.abs(p) / cap, 1);
  if (p > 0) return `oklch(${(0.72 - 0.14 * i).toFixed(2)} ${((0.13 + 0.06 * i) * 1).toFixed(2)} 150 / ${a})`;
  return `oklch(${(0.7 - 0.12 * i).toFixed(2)} ${((0.14 + 0.06 * i) * 1).toFixed(2)} 25 / ${a})`;
}

const fmtCap = (v: number | null, lang: Lang): string => {
  if (v == null || !Number.isFinite(v)) return "—";
  const b = v / 1e9;
  if (b >= 1) return `${b.toFixed(1)} ${lang === "ar" ? "مليار ج" : "B EGP"}`;
  return `${(v / 1e6).toFixed(0)} ${lang === "ar" ? "مليون ج" : "M EGP"}`;
};

const fmtShares = (v: number, lang: Lang): string => {
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)} ${lang === "ar" ? "مليون سهم" : "M shares"}`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)} ${lang === "ar" ? "ألف سهم" : "K shares"}`;
  return `${v} ${lang === "ar" ? "سهم" : "shares"}`;
};

export function LensView() {
  const { lang, navigate } = useApp();
  const [data, setData] = useState<LensPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string>("");
  const [query, setQuery] = useState("");
  const [hover, setHover] = useState<Placed | null>(null);

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

  // shareable state: ?view=lens&inv=<id> (restored once on mount)
  useEffect(() => {
    const b = bootParam("inv");
    if (b) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPicked(b);
    }
  }, []);
  useEffect(() => {
    patchUrlParams({ inv: picked || null });
  }, [picked]);

  const cellMap = useMemo(() => {
    if (!data) return { sectors: [] as SectorCell[], byTicker: new Map<string, Placed>() };
    const capOf = (c: LensCompany) => c.marketCap ?? 1e7;
    const bySector = new Map<string, LensCompany[]>();
    for (const c of data.companies) {
      const g = bySector.get(c.sectorCode) ?? [];
      g.push(c);
      bySector.set(c.sectorCode, g);
    }
    const items = [...bySector.entries()].map(([code, rows]) => ({
      code,
      area: rows.reduce((s, c) => s + capOf(c), 0),
      rows: [...rows].sort((a, b) => capOf(b) - capOf(a)),
      label: rows[0]?.sectorAr ?? code,
      labelEn: rows[0]?.sectorEn ?? code,
    }));
    items.sort((a, b) => b.area - a.area);
    const rects = squarify(items.map((i) => ({ code: i.code, area: i.area })), 0, 0, W, H);
    const sectors: SectorCell[] = [];
    const byTicker = new Map<string, Placed>();
    for (const r of rects) {
      const it = items.find((i) => i.code === r.code)!;
      if (r.w < 60 || r.h < 60) {
        // tiny sector: render as a flat label cell with dots
        const bubbles: Placed[] = it.rows.slice(0, 8).map((c, i) => ({ c, x: r.x + 14 + (i % 4) * 12, y: r.y + HEADER + 10 + Math.floor(i / 4) * 12, r: 3.2 }));
        bubbles.forEach((b) => byTicker.set(b.c.ticker, b));
        sectors.push({ ...r, code: it.code, label: it.label, labelEn: it.labelEn, cap: it.area, bubbles });
        continue;
      }
      const bubbles = packBubbles(r, it.rows, capOf);
      bubbles.forEach((b) => byTicker.set(b.c.ticker, b));
      sectors.push({ ...r, code: it.code, label: it.label, labelEn: it.labelEn, cap: it.area, bubbles });
    }
    return { sectors, byTicker };
  }, [data]);

  const pickedInvestor = data?.investors.find((i) => i.id === picked) ?? null;
  const pickedEdges = useMemo(() => (picked ? (data?.edges ?? []).filter((e) => e.investorId === picked && !e.self) : []), [picked, data]);
  const connected = useMemo(() => new Set(pickedEdges.map((e) => e.ticker)), [pickedEdges]);

  const investors = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.investors
      .filter((i) => i.crossHoldings > 0)
      .filter((i) => !q || i.nameEn.toLowerCase().includes(q) || i.nameAr.includes(query.trim()) || (i.ticker ?? "").toLowerCase().includes(q))
      .sort((a, b) => b.crossHoldings - a.crossHoldings || b.filings - a.filings);
  }, [data, query]);

  const investorNode = { x: W / 2, y: 34 };

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
  if (!data || !cellMap.sectors.length) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-[70vh] w-full" />
      </div>
    );
  }

  const sectorLabel = (s: SectorCell) => (lang === "ar" ? s.label : s.labelEn);

  return (
    <div className="space-y-4">
      {/* heading */}
      <div className="px-1">
        <h1 className="text-xl font-bold tracking-tight">{T.lensNav[lang]}</h1>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-3xl">
          {lang === "ar"
            ? "خريطة بصرية للبورصة بأكملها: كل قطاع منطقة بمساحة قيمة سوقية، وكل شركة فقاعة بحجم رأس مالها ولون تغيرها اليوم. اختر مستثمرًا من السجل لتضيء الشركات التي له فيها تعاملات موثقة — بروابط الإفصاحات الرسمية."
            : "A visual map of the whole exchange: every sector a region sized by market cap, every company a bubble sized by its own cap and colored by today's move. Pick an investor from the registry to light up the companies they have documented dealings in — with the official filing links."}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        {/* investor rail */}
        <aside className="space-y-2">
          <div className="rounded-xl border bg-card p-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold">{lang === "ar" ? "سجل المستثمرين" : "Investor registry"}</h2>
              {picked && (
                <button className="text-xs text-muted-foreground hover:text-foreground underline" onClick={() => setPicked("")}>
                  {lang === "ar" ? "مسح" : "clear"}
                </button>
              )}
            </div>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={lang === "ar" ? "ابحث عن مستثمر…" : "search investor…"}
              className="w-full mb-2 rounded-md border bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="max-h-[30vh] lg:max-h-[52vh] overflow-auto pr-1 space-y-1">
              {investors.map((inv) => (
                <button
                  key={inv.id}
                  onClick={() => setPicked(picked === inv.id ? "" : inv.id)}
                  className={`w-full text-start rounded-lg px-2 py-1.5 text-xs transition-colors border ${
                    picked === inv.id ? "border-primary bg-primary/10 font-semibold" : "border-transparent hover:bg-accent"
                  }`}
                >
                  <span className="block truncate">{lang === "ar" ? inv.nameAr : inv.nameEn}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {inv.ticker ? `${inv.ticker} · ` : ""}
                    {lang === "ar" ? `${inv.crossHoldings} شركة` : `${inv.crossHoldings} companies`} · {inv.filings} {lang === "ar" ? "إفصاح" : "filings"}
                  </span>
                </button>
              ))}
              {!investors.length && <p className="text-xs text-muted-foreground py-2">{lang === "ar" ? "لا نتائج." : "no matches."}</p>}
            </div>
          </div>

          {/* picked investor detail */}
          {pickedInvestor && (
            <div className="rounded-xl border bg-card p-3 space-y-2">
              <h3 className="text-sm font-semibold leading-snug">{lang === "ar" ? pickedInvestor.nameAr : pickedInvestor.nameEn}</h3>
              <p className="text-[11px] text-muted-foreground">
                {pickedInvestor.ticker ? `${lang === "ar" ? "مقيد بالبورصة" : "EGX-listed"} · ${pickedInvestor.ticker}` : lang === "ar" ? "مجموعة/جهة مالكة" : "group / parent entity"}
              </p>
              <div className="max-h-[34vh] overflow-auto space-y-1.5 pr-1">
                {pickedEdges.map((e) => {
                  const comp = data.companies.find((c) => c.ticker === e.ticker);
                  return (
                    <div key={`${e.investorId}-${e.ticker}`} className="rounded-lg border bg-background/60 px-2 py-1.5 text-xs">
                      <button className="font-semibold hover:underline" onClick={() => navigate("company", { ticker: e.ticker })}>
                        {e.ticker} · {comp ? dn(comp, lang) : ""}
                      </button>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {e.boughtShares > 0 && (
                          <span className="text-up font-medium">
                            {lang === "ar" ? "شراء" : "bought"} {fmtShares(e.boughtShares, lang)}
                          </span>
                        )}
                        {e.boughtShares > 0 && e.soldShares > 0 && " · "}
                        {e.soldShares > 0 && (
                          <span className="text-down font-medium">
                            {lang === "ar" ? "بيع" : "sold"} {fmtShares(e.soldShares, lang)}
                          </span>
                        )}
                        {" · "}
                        {e.filings} {lang === "ar" ? "إفصاح" : "filings"} · {e.firstDate}
                      </p>
                      {e.links[0] && (
                        <a href={e.links[0]} target="_blank" rel="noreferrer" className="text-[10px] underline text-muted-foreground">
                          {lang === "ar" ? "الإفصاح الرسمي ↗" : "official filing ↗"}
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </aside>

        {/* the map */}
        <div className="rounded-xl border bg-card overflow-hidden relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto select-none" role="img" aria-label={T.lensNav[lang]}>
            {/* sector regions */}
            {cellMap.sectors.map((s) => (
              <g key={s.code}>
                <rect
                  x={s.x + 1.5}
                  y={s.y + 1.5}
                  width={Math.max(0, s.w - 3)}
                  height={Math.max(0, s.h - 3)}
                  rx={10}
                  fill="oklch(0.97 0.005 90 / 0.55)"
                  stroke="oklch(0.85 0.01 90 / 0.8)"
                  strokeWidth={1}
                  className="dark:fill-white/5 dark:stroke-white/10"
                />
                <text x={s.x + 10} y={s.y + 15} fontSize={11} className="fill-muted-foreground" direction={lang === "ar" ? "rtl" : "ltr"}>
                  {sectorLabel(s).slice(0, 28)}
                  {sectorLabel(s).length > 28 ? "…" : ""}
                </text>
                <text x={s.x + 10} y={s.y + 15} fontSize={11} className="fill-muted-foreground" style={{ direction: lang === "ar" ? "rtl" : "ltr" }}>
                  {""}
                </text>
                {/* bubbles */}
                {s.bubbles.map((b) => {
                  const isConn = picked ? connected.has(b.c.ticker) : false;
                  const dim = picked !== "" && !isConn;
                  return (
                    <g key={b.c.ticker}>
                      <circle
                        cx={b.x}
                        cy={b.y}
                        r={b.r + (isConn ? 2 : 0)}
                        fill={heatFill(b.c.changePct, dim)}
                        stroke={isConn ? "oklch(0.75 0.16 255)" : dim ? "transparent" : "oklch(0.5 0.02 90 / 0.35)"}
                        strokeWidth={isConn ? 2 : 1}
                        className="cursor-pointer transition-all"
                        onClick={() => navigate("company", { ticker: b.c.ticker })}
                        onMouseEnter={() => setHover(b)}
                        onMouseLeave={() => setHover(null)}
                      >
                        <title>{`${b.c.ticker} · ${dn(b.c, lang)} · ${fmtCap(b.c.marketCap, lang)} · ${fmtPct(b.c.changePct)}`}</title>
                      </circle>
                      {b.r > 13 && (
                        <text x={b.x} y={b.y + 3.5} fontSize={Math.min(10, b.r / 2.6)} textAnchor="middle" className="pointer-events-none fill-foreground/80 font-medium">
                          {b.c.ticker}
                        </text>
                      )}
                      {/* disclosure-activity pulse */}
                      {data.activity[b.c.ticker] > 0 && !dim && (
                        <circle cx={b.x} cy={b.y} r={b.r + 4} fill="none" stroke="oklch(0.75 0.15 85 / 0.9)" strokeWidth={1} strokeDasharray="2 3" className="pointer-events-none" />
                      )}
                    </g>
                  );
                })}
              </g>
            ))}

            {/* investor links */}
            {pickedInvestor && (
              <g>
                <circle cx={investorNode.x} cy={investorNode.y} r={22} fill="oklch(0.55 0.16 255)" stroke="oklch(0.9 0.04 255)" strokeWidth={2} />
                <text x={investorNode.x} y={investorNode.y - 30} fontSize={13} textAnchor="middle" className="fill-foreground font-semibold">
                  {(lang === "ar" ? pickedInvestor.nameAr : pickedInvestor.nameEn).slice(0, 34)}
                </text>
                {pickedEdges.map((e) => {
                  const b = cellMap.byTicker.get(e.ticker);
                  if (!b) return null;
                  const net = e.boughtShares - e.soldShares;
                  const col = net >= 0 ? "oklch(0.7 0.16 150 / 0.85)" : "oklch(0.65 0.19 25 / 0.85)";
                  const wid = 1.4 + Math.min(3.6, Math.log10(1 + Math.max(e.boughtShares, e.soldShares)) / 1.6);
                  const x0 = investorNode.x;
                  const y0 = investorNode.y + 22;
                  const mx = (x0 + b.x) / 2;
                  return (
                    <path
                      key={`lnk-${e.ticker}`}
                      d={`M ${x0} ${y0} C ${x0} ${(y0 + b.y) / 2}, ${mx} ${b.y - 40}, ${b.x} ${b.y - b.r - 2}`}
                      fill="none"
                      stroke={col}
                      strokeWidth={wid}
                      strokeOpacity={0.75}
                      className="pointer-events-none"
                    />
                  );
                })}
              </g>
            )}
          </svg>

          {/* hover tooltip */}
          {hover && (
            <div className="absolute bottom-2 start-2 rounded-lg border bg-popover/95 backdrop-blur px-3 py-2 text-xs shadow-lg max-w-[260px]">
              <p className="font-semibold">
                {hover.c.ticker} · {dn(hover.c, lang)}
              </p>
              <p className="text-muted-foreground">
                {lang === "ar" ? hover.c.sectorAr : hover.c.sectorEn} · {fmtCap(hover.c.marketCap, lang)}
              </p>
              <p className={hover.c.changePct >= 0 ? "text-up" : "text-down"}>{fmtPct(hover.c.changePct)}</p>
            </div>
          )}

          {/* legend */}
          <div className="border-t px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-full" style={{ background: "oklch(0.6 0.16 150)" }} />
              {lang === "ar" ? "صاعد" : "up"}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-full" style={{ background: "oklch(0.58 0.19 25)" }} />
              {lang === "ar" ? "هابط" : "down"}
            </span>
            <span>
              <span className="inline-block size-2.5 rounded-full border border-dashed align-middle" /> {lang === "ar" ? "إفصاحات داخلية حديثة (٩٠ يومًا)" : "recent insider filings (90d)"}
            </span>
            <span>
              {lang === "ar" ? "حجم الفقاعة = القيمة السوقية · مساحة القطاع = إجمالي قطاعه" : "bubble = market cap · region = sector total"}
            </span>
          </div>
        </div>
      </div>

      {/* provenance */}
      <p className="text-[11px] leading-relaxed text-muted-foreground px-1 max-w-3xl">
        {lang === "ar" ? data.noteAr : data.noteEn}{" "}
        <a href="https://www.egx.com.eg" target="_blank" rel="noreferrer" className="underline">
          {lang === "ar" ? data.sourceAr : data.source}
        </a>
        {" · "}
        {lang === "ar" ? "بيانات الخريطة حية من ماسح السوق (تأخير ~١٥ دقيقة)" : "map data live from the market scanner (~15 min delayed)"}.
      </p>
    </div>
  );
}
