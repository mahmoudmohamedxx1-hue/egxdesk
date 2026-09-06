"use client";

import { useEffect, useState } from "react";
import { useApp } from "../market/app-context";
import { T, tt } from "@/lib/i18n";
import { fmtValue, fmtNum } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { MoveLeft, MoveRight } from "lucide-react";

type Flow = {
  nameAr: string; nameEn: string; sharePct: number;
  buyValue: number; sellValue: number; netFlow: number;
};

type Investors = {
  asOf: string;
  totalValue: number;
  institutionalShare: number;
  retailShare: number;
  categories: Flow[];
};

export function InvestorsView() {
  const { lang } = useApp();
  const [data, setData] = useState<Investors | null>(null);

  useEffect(() => {
    fetch("/api/investors")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null));
  }, []);

  if (!data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const totalBuy = data.categories.reduce((a, c) => a + c.buyValue, 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{tt(T.traderCats, lang)}</h1>
        <p className="mt-1 text-sm text-muted-foreground max-w-2xl leading-relaxed">
          {lang === "ar"
            ? "تعاملات فئات المستثمرين وأحجام السيولة كما تنشرها البورصة تراكمياً للفترة الحالية."
            : "Investor-category trading and liquidity volumes as published cumulatively by the exchange for the current period."}
        </p>
      </div>

      <p className="text-xs text-muted-foreground num">
        {lang === "ar" ? "بيانات رسمية كما في" : "Official figures as of"} {data.asOf}
      </p>

      {/* totals */}
      <section className="rounded-lg border bg-card p-4 space-y-3">
        <p className="text-sm">
          {lang === "ar" ? "إجمالي قيمة التداول في الفترة:" : "Total traded value in the period:"}{" "}
          <span className="num font-bold">EGP {fmtValue(data.totalValue)}</span>
        </p>
        {/* institutions vs retail */}
        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <span>{lang === "ar" ? "مؤسسات" : "Institutions"} <span className="num font-semibold">{data.institutionalShare}%</span></span>
            <span>{lang === "ar" ? "أفراد" : "Individuals"} <span className="num font-semibold">{data.retailShare}%</span></span>
          </div>
          <div className="h-2.5 rounded-full overflow-hidden bg-down-soft flex" dir="ltr" role="img" aria-label="institutions vs individuals">
            <div className="h-full bg-primary" style={{ width: `${data.institutionalShare}%` }} />
            <div className="h-full bg-[#c90]/70" style={{ width: `${data.retailShare}%` }} />
          </div>
        </div>
        {/* share of trading */}
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{lang === "ar" ? "نسبة الاستحواذ من إجمالي التداول" : "Share of total trading"}</p>
          <div className="flex h-3 rounded-full overflow-hidden" dir="ltr">
            {data.categories.map((c, i) => (
              <div
                key={c.nameAr}
                className={["bg-primary", "bg-[#c90]", "bg-muted-foreground/60"][i % 3]}
                style={{ width: `${c.sharePct}%` }}
                title={`${lang === "ar" ? c.nameAr : c.nameEn} ${c.sharePct}%`}
              />
            ))}
          </div>
        </div>
      </section>

      {/* per-category detail */}
      <section className="grid gap-3 lg:grid-cols-3">
        {data.categories.map((c) => {
          const buyShare = (c.buyValue / totalBuy) * 100;
          const sellShare = (c.sellValue / data.categories.reduce((a, x) => a + x.sellValue, 0)) * 100;
          return (
            <article key={c.nameAr} className="rounded-lg border bg-card p-4 space-y-3">
              <div className="flex items-baseline justify-between">
                <h2 className="font-bold">{lang === "ar" ? c.nameAr : c.nameEn}</h2>
                <span className="num text-lg font-bold">{c.sharePct.toFixed(2)}%</span>
              </div>

              <KV label={lang === "ar" ? "إجمالي الشراء" : "Total buys"} value={`EGP ${fmtValue(c.buyValue)}`} sub={`${buyShare.toFixed(2)}% ${lang === "ar" ? "من إجمالي الشراء" : "of total buys"}`} />
              <KV label={lang === "ar" ? "إجمالي البيع" : "Total sells"} value={`EGP ${fmtValue(c.sellValue)}`} sub={`${sellShare.toFixed(2)}% ${lang === "ar" ? "من إجمالي البيع" : "of total sells"}`} />

              <div className={`flex items-center gap-1.5 rounded-md px-2.5 py-2 ${c.netFlow >= 0 ? "bg-up-soft text-up" : "bg-down-soft text-down"}`}>
                {c.netFlow >= 0 ? <MoveLeft className="h-4 w-4 rtl:rotate-180" /> : <MoveRight className="h-4 w-4 rtl:rotate-180" />}
                <span className="num text-lg font-bold">
                  {c.netFlow > 0 ? "+" : ""}{c.netFlow.toFixed(1)}
                </span>
                <span className="text-xs">{lang === "ar" ? "مليون ج.م (صافي)" : "EGP mn (net)"}</span>
              </div>
            </article>
          );
        })}
      </section>

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        {lang === "ar"
          ? "تنشر البورصة هذه الأرقام تراكمياً وتُحدّث فور إعلان الفترة الجديدة. الأرقام لبيانات العرض في هذه النسخة."
          : "The exchange publishes these figures cumulatively and refreshes them with each new period. Figures here are demo data."}
      </p>
    </div>
  );
}

function KV({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-dotted pb-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-end">
        <span className="num text-sm font-semibold">{value}</span>
        {sub && <span className="block num text-[10px] text-muted-foreground">{sub}</span>}
      </span>
    </div>
  );
}
