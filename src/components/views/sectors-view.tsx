"use client";

import { useEffect, useState } from "react";
import { useApp } from "../market/app-context";
import { T, tt } from "@/lib/i18n";
import { fmtNum, fmtValue, fmtPct } from "@/lib/format";
import { ChangeCell } from "../market/change-cell";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Building2 } from "lucide-react";

type SectorCard = {
  code: string; nameAr: string; nameEn: string; count: number;
  up: number; down: number; flat: number;
  pe: number | null; pb: number | null; roe: number | null; roa: number | null;
  debtToEquity: number | null; divYield: number | null; netProfit: number | null;
  eps: number | null; totalAssets: number | null; marketCap: number;
  biggestMover: { ticker: string; changePct: number } | null;
};

export function SectorsView() {
  const { lang, navigate, auth } = useApp();
  const [sectors, setSectors] = useState<SectorCard[] | null>(null);

  useEffect(() => {
    fetch("/api/sectors")
      .then((r) => r.json())
      .then((d) => setSectors(d.sectors ?? []))
      .catch(() => setSectors([]));
  }, [auth.email]);

  if (!sectors) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 md:grid-cols-2">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-52" />)}</div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold tracking-tight">{tt(T.sectors, lang)}</h1>
        <p className="num text-xs text-muted-foreground">
          <span className="font-semibold">{sectors.length}</span> {tt(T.sectorCount, lang)} · 06 Sep 2026
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {sectors.map((s) => (
          <button
            key={s.code}
            onClick={() => navigate("market")}
            className="group rounded-lg border bg-card p-4 text-start hover:border-ring transition-colors"
          >
            {/* header */}
            <div className="flex items-start justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground" aria-hidden />
                <h2 className="font-bold leading-tight">{lang === "ar" ? s.nameAr : s.nameEn}</h2>
              </div>
              <span className="num text-sm font-bold shrink-0">{s.count}</span>
            </div>

            {/* breadth */}
            <div className="flex items-center gap-2 mb-3 text-xs">
              <span className="num text-muted-foreground">{tt(T.companies, lang)}</span>
              <span className="flex-1 min-w-8 h-1.5 rounded-full bg-secondary overflow-hidden" aria-hidden>
                <span className={`block h-full ${s.up > 0 ? "bg-up" : ""}`} style={{ width: `${(s.up / s.count) * 100}%`, float: "inline-end" }} />
              </span>
              <span className="inline-flex items-center gap-1 text-up">
                <TrendingUp className="h-3 w-3" aria-hidden />
                <span className="num font-semibold">{s.up}</span>
              </span>
              <span className="inline-flex items-center gap-1 text-down">
                <TrendingDown className="h-3 w-3" aria-hidden />
                <span className="num font-semibold">{s.down}</span>
              </span>
              <span className="num text-muted-foreground">= {s.flat}</span>
            </div>

            {/* metrics */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              <Metric label={lang === "ar" ? "مكرر الربحية" : "P/E"} value={s.pe ? fmtNum(s.pe, 1) : "—"} />
              <Metric label={lang === "ar" ? "العائد على الملكية" : "ROE"} value={s.roe !== null ? `${fmtNum(s.roe, 1)}%` : "—"} />
              <Metric label={lang === "ar" ? "العائد على الأصول" : "ROA"} value={s.roa !== null ? `${fmtNum(s.roa, 1)}%` : "—"} />
              <Metric label={lang === "ar" ? "الدين / الملكية" : "D/E"} value={s.debtToEquity !== null ? `${fmtNum(s.debtToEquity, 2)}×` : "—"} />
              <Metric label={lang === "ar" ? "عائد التوزيعات" : "Div yield"} value={s.divYield !== null ? `${fmtNum(s.divYield, 1)}%` : "—"} />
              <Metric label={lang === "ar" ? "صافي الربح" : "Net profit"} value={s.netProfit !== null ? `${fmtValue(s.netProfit * 1e6)}` : "—"} />
              <Metric label={lang === "ar" ? "ربحية السهم" : "EPS"} value={s.eps !== null ? fmtNum(s.eps) : "—"} />
              <Metric label={lang === "ar" ? "إجمالي الأصول" : "Assets"} value={s.totalAssets !== null ? fmtValue(s.totalAssets * 1e6) : "—"} />
            </div>

            {/* biggest mover */}
            {s.biggestMover && (
              <div className="mt-3 pt-3 border-t flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground">{tt(T.biggestMover, lang)}</span>
                <span className="flex items-center gap-2">
                  <span className="num text-sm font-bold">{s.biggestMover.ticker}</span>
                  <ChangeCell pct={s.biggestMover.changePct} />
                </span>
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-dotted pb-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="num font-medium">{value}</span>
    </div>
  );
}
