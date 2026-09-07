"use client";

import { useMemo, useState } from "react";
import { useApp } from "../market/app-context";
import { useLiveData } from "../market/use-live-data";
import { T, tt, dn } from "@/lib/i18n";
import { fmtInt, fmtDateAr } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ShieldCheck, ArrowDownRight, ArrowUpRight, Landmark, ExternalLink } from "lucide-react";

/**
 * Insider & treasury-share dealing log — real filed disclosures from the
 * Egyptian Exchange (harvested 2026-09-07): who inside the company or among
 * its major holders bought or sold, and what companies did with their own
 * shares. Esthmr-style: filter chips, honest source line, official EGX
 * document links. It is a filing record, not a signal — the header says so.
 */

type Item = {
  id: string;
  filingId: string;
  date: string;
  ticker: string;
  companyAr: string;
  company: string;
  sectorAr: string;
  action: string;
  actionLabelAr: string;
  actionLabel: string;
  relationshipLabelAr: string;
  relationshipLabel: string;
  positionRaw: string | null;
  shares: number | null;
  title: string;
  titleEn: string;
  link: string;
};

type InsidersData = {
  asOf: string;
  source: string;
  sourceAr: string;
  basisAr: string;
  summary: {
    totalRecords: number;
    buyCount: number;
    sellCount: number;
    treasuryBuyCount: number;
    treasurySellCount: number;
    totalBuyShares: number;
    totalSellShares: number;
    activeCompaniesCount: number;
    activeTreasuryCompanies: string[];
    latestSession: string;
    earliestSession: string;
  };
  total: number;
  items: Item[];
};

const FILTERS = [
  { key: "all", ar: "الكل", en: "All" },
  { key: "buys", ar: "شراء الداخليين", en: "Insider buys" },
  { key: "sells", ar: "مبيعات وتخارج", en: "Insider sells" },
  { key: "treasury", ar: "أسهم الخزينة", en: "Treasury shares" },
] as const;

export function InsidersPanel() {
  const { lang, navigate } = useApp();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const [limit, setLimit] = useState(25);
  const { data, loading } = useLiveData<InsidersData>(`/api/insiders?filter=${filter}&limit=400`, 300_000);

  const items = useMemo(() => (data?.items ?? []).slice(0, limit), [data, limit]);

  function actionIcon(a: string) {
    if (a === "bought" || a === "treasury_purchase") return <ArrowUpRight className="h-3.5 w-3.5 text-up" />;
    if (a === "sold" || a === "treasury_sale") return <ArrowDownRight className="h-3.5 w-3.5 text-down" />;
    return <Landmark className="h-3.5 w-3.5 text-muted-foreground" />;
  }

  return (
    <section aria-label="insider dealings" className="rounded-lg border bg-card p-4">
      <div className="flex items-baseline justify-between mb-1 flex-wrap gap-2">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          {lang === "ar" ? "تعاملات الداخليين وأسهم الخزينة" : "Insider & treasury dealings"}
        </h2>
        {data && (
          <p className="text-xs text-muted-foreground num">
            {lang === "ar" ? "آخر تحديث" : "as of"} {data.asOf}
          </p>
        )}
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed mb-3 max-w-3xl">
        {lang === "ar"
          ? "إفصاحات رسمية أودعتها الشركات لدى البورصة المصرية عن تعاملات أعضاء مجالس الإدارة والداخليين وكبار المساهمين والمجموعات المرتبطة وعمليات أسهم الخزينة. سجلُّ إفصاح لا إشارة: الشركة التي لم تُفصح لا يعني ذلك شيئاً عن أدائها."
          : "Official disclosures filed with the Egyptian Exchange for dealings by board members, insiders, major shareholders, related groups and treasury-share operations. A filing record, not a signal."}
      </p>

      {/* summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-4">
        {loading && !data ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)
        ) : (
          data && (
            <>
              <div className="rounded-md border bg-secondary/40 px-3 py-2">
                <p className="text-[11px] text-muted-foreground">{lang === "ar" ? "إجمالي الإفصاحات" : "Total disclosures"}</p>
                <p className="num text-lg font-bold">{fmtInt(data.summary.totalRecords)}</p>
                <p className="text-[10px] text-muted-foreground">
                  {lang === "ar" ? `${data.summary.activeCompaniesCount} شركة لها تعاملات` : `${data.summary.activeCompaniesCount} companies with dealings`}
                </p>
              </div>
              <div className="rounded-md border bg-up-soft px-3 py-2">
                <p className="text-[11px] text-muted-foreground">{lang === "ar" ? "شراء الداخليين" : "Insider buys"}</p>
                <p className="num text-lg font-bold text-up">{fmtInt(data.summary.buyCount)}</p>
                <p className="num text-[10px] text-muted-foreground">↑ {fmtInt(data.summary.totalBuyShares)} {lang === "ar" ? "سهم" : "shares"}</p>
              </div>
              <div className="rounded-md border bg-down-soft px-3 py-2">
                <p className="text-[11px] text-muted-foreground">{lang === "ar" ? "مبيعات الداخليين" : "Insider sells"}</p>
                <p className="num text-lg font-bold text-down">{fmtInt(data.summary.sellCount)}</p>
                <p className="num text-[10px] text-muted-foreground">↓ {fmtInt(data.summary.totalSellShares)} {lang === "ar" ? "سهم" : "shares"}</p>
              </div>
              <div className="rounded-md border bg-secondary/40 px-3 py-2">
                <p className="text-[11px] text-muted-foreground">{lang === "ar" ? "عمليات أسهم الخزينة" : "Treasury operations"}</p>
                <p className="num text-lg font-bold">
                  {fmtInt(data.summary.treasuryBuyCount + data.summary.treasurySellCount)}
                </p>
                <p className="num text-[10px] text-muted-foreground">
                  {data.summary.activeTreasuryCompanies.length > 0
                    ? data.summary.activeTreasuryCompanies.join(" · ")
                    : lang === "ar" ? "لا شركات نشطة" : "none active"}
                </p>
              </div>
            </>
          )
        )}
      </div>

      {/* filter chips */}
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => {
              setFilter(f.key);
              setLimit(25);
            }}
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
              filter === f.key
                ? "bg-primary text-primary-foreground border-primary font-medium"
                : "text-muted-foreground hover:text-foreground hover:border-ring"
            }`}
          >
            {lang === "ar" ? f.ar : f.en}
          </button>
        ))}
      </div>

      {/* table */}
      <div className="overflow-x-auto thin-scroll rounded-md border">
        <table className="w-full text-xs">
          <thead className="bg-secondary/50 text-muted-foreground">
            <tr>
              <th className="text-start font-medium px-3 py-2">{lang === "ar" ? "الجلسة" : "Session"}</th>
              <th className="text-start font-medium px-3 py-2">{lang === "ar" ? "الشركة" : "Company"}</th>
              <th className="text-start font-medium px-3 py-2 hidden md:table-cell">{lang === "ar" ? "نوع التعامل" : "Deal type"}</th>
              <th className="text-start font-medium px-3 py-2 hidden lg:table-cell">{lang === "ar" ? "صفة المتعامل" : "Counterparty"}</th>
              <th className="text-end font-medium px-3 py-2">{lang === "ar" ? "عدد الأسهم" : "Shares"}</th>
              <th className="text-end font-medium px-3 py-2">{lang === "ar" ? "المستند" : "Filing"}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((i) => (
              <tr
                key={i.id}
                className="hover:bg-accent/30 cursor-pointer transition-colors"
                onClick={() => navigate("company", { ticker: i.ticker, panel: "overview" })}
              >
                <td className="num px-3 py-2.5 whitespace-nowrap text-muted-foreground">
                  {lang === "ar" ? fmtDateAr(i.date) : i.date}
                </td>
                <td className="px-3 py-2.5">
                  <span className="num font-bold me-1.5">{i.ticker}</span>
                  <span className="text-muted-foreground max-w-[220px] truncate inline-block align-middle">
                    {lang === "ar" ? i.companyAr : i.company}
                  </span>
                </td>
                <td className="px-3 py-2.5 hidden md:table-cell">
                  <span className="inline-flex items-center gap-1">
                    {actionIcon(i.action)}
                    {lang === "ar" ? i.actionLabelAr : i.actionLabel}
                  </span>
                </td>
                <td className="px-3 py-2.5 hidden lg:table-cell text-muted-foreground">
                  {lang === "ar" ? i.relationshipLabelAr : i.relationshipLabel}
                  {i.positionRaw ? ` · ${i.positionRaw}` : ""}
                </td>
                <td className="num px-3 py-2.5 text-end font-medium">
                  {i.shares !== null && i.shares > 0 ? fmtInt(i.shares) : "—"}
                </td>
                <td className="px-3 py-2.5 text-end">
                  <a
                    href={i.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-primary num"
                    title={lang === "ar" ? i.title : i.titleEn}
                  >
                    egx-{i.filingId}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </td>
              </tr>
            ))}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  {lang === "ar" ? "لا إفصاحات في هذا التصنيف" : "No disclosures in this filter"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {data && data.total > limit && (
        <div className="mt-3 text-center">
          <Button variant="outline" size="sm" onClick={() => setLimit((l) => l + 25)}>
            {lang === "ar" ? "عرض إفصاحات أقدم" : "Show older filings"} ({fmtInt(data.total - limit)})
          </Button>
        </div>
      )}

      <p className="mt-3 text-[10px] text-muted-foreground">
        {lang === "ar"
          ? "المصدر: إفصاحات البورصة المصرية كما نشرها esthmr.com — سجل لحظي حتى تاريخ التحديث أعلاه."
          : "Source: Egyptian Exchange filings as published by esthmr.com — a snapshot as of the date above."}
      </p>
    </section>
  );
}
