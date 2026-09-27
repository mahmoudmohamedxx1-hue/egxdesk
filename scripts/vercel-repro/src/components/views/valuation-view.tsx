"use client";

/** T60 → T64 — المزيد → التقييم والديون (valuation & debt): one section,
 *  three tabs, one shared sector filter and one fetch.
 *
 *    1. خريطة التقييم — the 2D P/E × D/E map (quadrants OR the fair-value
 *       lens that paints every bubble by its upside vs the five-model
 *       blended fair value), drag-pan and ctrl-wheel zoom.
 *    2. رخيصة مقابل قيمتها — the cheap-stocks screen: every stock ranked
 *       by how far it trades below its blended fair value, with coverage
 *       dots, the assumptions strip and the honest disclaimers.
 *    3. خريطة الديون — leverage on two axes (D/E × net debt / market cap),
 *       five reading zones and the leverage ranking.
 *
 *  Honesty rules: the quadrants are reading aids (median lines printed),
 *  the debt-adjusted multiple is the ranking column, and the map shows
 *  only companies whose P/E and D/E are actually published — no point is
 *  invented to fill a sector. */

import { useEffect, useMemo, useState } from "react";
import { useApp } from "../market/app-context";
import { Skeleton } from "@/components/ui/skeleton";
import { Scale, Map as MapIcon, BadgePercent, Landmark } from "lucide-react";
import { ValuationMapTab } from "./valuation-map-tab";
import { ValuationCheapTab } from "./valuation-cheap-tab";
import { ValuationDebtTab } from "./valuation-debt-tab";
import type { ValData, ValRow } from "./valuation-shared";

type Tab = "map" | "cheap" | "debt";

export function ValuationView() {
  const { lang } = useApp();
  const [data, setData] = useState<ValData | null>(null);
  const [error, setError] = useState(false);
  const [sector, setSector] = useState<string>("all");
  const [tab, setTab] = useState<Tab>("map");

  useEffect(() => {
    fetch("/api/valuation-map")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("x"))))
      .then((d: ValData) => setData(d))
      .catch(() => setError(true));
  }, []);

  // map-eligible rows (published P/E and D/E), sector-filtered for the map tab
  const mapRows = useMemo(() => {
    if (!data) return [];
    const eligible = data.rows.filter((r) => r.pe != null && r.de != null);
    return sector === "all" ? eligible : eligible.filter((r) => r.sectorAr === sector);
  }, [data, sector]);

  // all rows with any fundamental, sector-filtered for the cheap & debt tabs
  const rows = useMemo(() => {
    if (!data) return [];
    return sector === "all" ? data.rows : data.rows.filter((r) => r.sectorAr === sector);
  }, [data, sector]);

  if (error) {
    return (
      <div className="space-y-3 p-4">
        <h1 className="text-lg font-bold">{lang === "ar" ? "خريطة التقييم والديون" : "Valuation & debt map"}</h1>
        <p className="text-sm text-muted-foreground">{lang === "ar" ? "تعذّر التحميل." : "Unavailable."}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-9 w-96" />
        <Skeleton className="h-[60vh] w-full rounded-xl" />
      </div>
    );
  }

  const tabs: { id: Tab; ar: string; en: string; icon: typeof MapIcon; count?: number }[] = [
    { id: "map", ar: "خريطة التقييم", en: "Valuation map", icon: MapIcon, count: data.total },
    { id: "cheap", ar: "رخيصة مقابل قيمتها", en: "Cheap vs fair value", icon: BadgePercent, count: data.fvStats.cheap },
    { id: "debt", ar: "خريطة الديون", en: "Debt map", icon: Landmark },
  ];

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Scale className="h-5 w-5 text-primary" aria-hidden />
          <h1 className="text-lg font-bold">{lang === "ar" ? "خريطة التقييم والديون" : "Valuation & debt map"}</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {lang === "ar"
            ? "مضاعف الربحية يسعّر حقوق الملكية فقط ويتجاهل ديون الشركة — هذه الخريطة تضع كل شركة عند دمج حجم الرافعة، وترتب الأسهم الرخيصة مقابل قيمتها العادلة المحسوبة من خمسة نماذج معلنة."
            : "P/E prices only the equity and ignores the debt — this map places every company once leverage is included, and ranks the stocks that trade cheap against a five-model fair value."}
        </p>
      </div>

      {/* tabs */}
      <div className="flex flex-wrap items-center gap-1.5 border-b pb-2">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                active ? "border-foreground/20 bg-secondary font-semibold" : "border-transparent text-muted-foreground hover:bg-accent"
              }`}
              aria-current={active ? "page" : undefined}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {lang === "ar" ? t.ar : t.en}
              {t.count != null && <span className="tabular-nums text-muted-foreground">· {t.count}</span>}
            </button>
          );
        })}
      </div>

      {/* sector filter (shared across the three tabs) */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => setSector("all")}
          className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
            sector === "all" ? "border-foreground/20 bg-secondary font-semibold" : "border-transparent text-muted-foreground hover:bg-accent"
          }`}
        >
          {lang === "ar" ? `جميع القطاعات` : `All sectors`} · {data.total}
        </button>
        {data.sectors.slice(0, 14).map((s) => (
          <button
            key={s.sectorAr}
            onClick={() => setSector(s.sectorAr === sector ? "all" : s.sectorAr)}
            className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
              sector === s.sectorAr ? "border-foreground/20 bg-secondary font-semibold" : "border-transparent text-muted-foreground hover:bg-accent"
            }`}
          >
            {lang === "ar" ? s.sectorAr : s.sector} · {s.count}
          </button>
        ))}
      </div>

      {tab === "map" && <ValuationMapTab data={data} rows={mapRows} />}
      {tab === "cheap" && <ValuationCheapTab data={data} rows={rows} />}
      {tab === "debt" && <ValuationDebtTab rows={rows} />}
    </div>
  );
}
