"use client";

/** T60 — المستجدات → ربط النقاط (connecting the dots), cloned from the
 *  source model's crossings screen.
 *
 *  For each listed company over the chosen window: how many news items
 *  named it, how many disclosures it filed — and when BOTH are non-zero the
 *  card says "وردت في الأخبار والإفصاحات" and shows every piece of evidence
 *  with its source link (outlet article or EGX bulletin).
 *
 *  The causality honesty line is permanent furniture, not a tooltip:
 *  appearing in both feeds does not establish that the news caused the
 *  filing, or the filing the volume. */

import { useEffect, useState } from "react";
import { useApp } from "../market/app-context";
import { Skeleton } from "@/components/ui/skeleton";
import { UpdatesSubnav } from "./updates-subnav";
import { Link2, ExternalLink, Newspaper, FileText, ChevronDown, ChevronUp } from "lucide-react";

type Evidence = { kind: "news"; date: string; title: string; link: string; who: string };
type FilingEv = { kind: "filing"; date: string; title: string; link: string; who: string; eventLabelAr: string; eventLabelEn: string };

type Company = {
  ticker: string;
  nameAr: string;
  nameEn: string;
  newsCount: number;
  filingCount: number;
  both: boolean;
  lastDate: string;
  news: Evidence[];
  filings: FilingEv[];
};

type Data = {
  asOf: string;
  window: { days: number; start: string; end: string };
  totals: { news: number; filings: number; companies: number; bothSources: number };
  companies: Company[];
};

const TABS = [
  { id: 1, ar: "اليوم", en: "Today" },
  { id: 7, ar: "هذا الأسبوع", en: "This week" },
  { id: 30, ar: "هذا الشهر", en: "This month" },
] as const;

export function CrossingsView() {
  const { lang, navigate } = useApp();
  const [days, setDays] = useState<number>(7);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  // reset the loaded document when the window changes — during render (the
  // codebase's convention), so the skeleton shows without an extra paint
  const [lastDays, setLastDays] = useState(days);
  if (lastDays !== days) {
    setLastDays(days);
    setData(null);
  }

  useEffect(() => {
    fetch(`/api/crossings?days=${days}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("x"))))
      .then((d: Data) => setData(d))
      .catch(() => setError(true));
  }, [days]);

  if (error) {
    return (
      <div className="space-y-4">
        <UpdatesSubnav current="crossings" />
        <div className="space-y-3 p-4">
          <h1 className="text-lg font-bold">{lang === "ar" ? "ربط النقاط" : "Connecting the dots"}</h1>
          <p className="text-sm text-muted-foreground">{lang === "ar" ? "تعذّر التحميل الآن." : "Unavailable right now."}</p>
        </div>
      </div>
    );
  }

  const fmtDate = (d: string) =>
    new Intl.DateTimeFormat(lang === "ar" ? "ar-EG" : "en-GB", { day: "numeric", month: "long" }).format(new Date(d));

  return (
    <div className="space-y-4">
      {/* the Updates group's subnav strip — same on every screen of the group */}
      <UpdatesSubnav current="crossings" />

      {/* header */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Link2 className="h-5 w-5 text-primary" aria-hidden />
          <h1 className="text-lg font-bold">{lang === "ar" ? "ربط النقاط" : "Connecting the dots"}</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {lang === "ar"
            ? "الشركات التي وردت في الأخبار والإفصاحات معاً — والشركات في مصدر واحد."
            : "Companies that appeared in both the news and the filings — and in one source."}
        </p>
      </div>

      {/* window tabs */}
      <div className="flex flex-wrap items-center gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setDays(t.id)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              days === t.id ? "border-foreground/20 bg-secondary" : "border-transparent text-muted-foreground hover:bg-accent"
            }`}
          >
            {lang === "ar" ? t.ar : t.en}
          </button>
        ))}
      </div>

      {!data ? (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full rounded-xl" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          {/* stats chips */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border bg-card px-3 py-1 text-xs tabular-nums">
              {data.totals.news}{" "}
              <span className="text-muted-foreground">{lang === "ar" ? "أخبار" : "news"}</span> ＋
            </span>
            <span className="rounded-full border bg-card px-3 py-1 text-xs tabular-nums">
              {data.totals.filings}{" "}
              <span className="text-muted-foreground">{lang === "ar" ? "إفصاحات" : "filings"}</span> ↔
            </span>
            <span className="rounded-full border bg-primary/20 px-3 py-1 text-xs font-semibold tabular-nums text-primary">
              {data.totals.bothSources}{" "}
              {lang === "ar" ? "شركة في المصدرين معاً" : "companies in both sources"}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {data.window.start} — {data.window.end}
            </span>
          </div>

          {/* the permanent honesty line */}
          <p className="rounded-lg border bg-card/60 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
            {lang === "ar"
              ? "الربط يعني ورود الشركة في المصدرين خلال الفترة؛ لا يثبت أن الخبر أو الإفصاح سبّب حركة السعر."
              : "Being connected means the company appeared in both sources within the window; it does not prove the news or the filing caused the price move."}
          </p>

          {/* company cards */}
          <div className="space-y-2.5">
            {data.companies.map((c) => {
              const open = expanded === c.ticker;
              const allNews = c.news;
              const allFilings = c.filings;
              return (
                <div
                  key={c.ticker}
                  className={`rounded-xl border bg-card p-3 ${c.both ? "border-primary/30" : ""}`}
                >
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => navigate("company", { ticker: c.ticker })}
                      className="rounded-full border border-ring/40 bg-secondary/60 px-2 py-0.5 text-[11px] font-bold hover:bg-accent"
                    >
                      {c.ticker}
                    </button>
                    <button
                      onClick={() => navigate("company", { ticker: c.ticker })}
                      className="min-w-0 flex-1 truncate text-start text-sm font-semibold hover:text-primary"
                    >
                      {lang === "ar" ? c.nameAr : c.nameEn}
                    </button>
                    <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{fmtDate(c.lastDate)}</span>
                  </div>

                  <p className="mt-1.5 text-xs font-medium">
                    {c.both
                      ? lang === "ar"
                        ? "وردت في الأخبار والإفصاحات"
                        : "appeared in both the news and the filings"
                      : lang === "ar"
                        ? "وردت في مصدر واحد من المصدرين"
                        : "appeared in one of the two sources"}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                    {c.newsCount} {lang === "ar" ? "أخبار" : "news"} · {c.filingCount}{" "}
                    {lang === "ar" ? "إفصاحات" : "filings"}
                  </p>

                  {/* evidence: first 2 rows, expandable to all */}
                  <div className="mt-2 space-y-1">
                    {[
                      ...allNews.slice(0, open ? allNews.length : 2).map((e) => ({ ...e, kind: "news" as const })),
                      ...allFilings.slice(0, open ? allFilings.length : 2).map((e) => ({ ...e, kind: "filing" as const })),
                    ]
                      .sort((a, b) => b.date.localeCompare(a.date))
                      .map((e, i) => (
                        <div key={`${e.kind}-${i}`} className="flex items-start gap-2 text-[11px] leading-relaxed">
                          {e.kind === "news" ? (
                            <Newspaper className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                          ) : (
                            <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                          )}
                          <a
                            href={e.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="min-w-0 flex-1 hover:text-primary"
                          >
                            <span className="text-muted-foreground">
                              {e.kind === "news"
                                ? lang === "ar"
                                  ? "خبر"
                                  : "news"
                                : lang === "ar"
                                  ? "إفصاح رسمي"
                                  : "filing"}{" "}
                              · {e.date} ·{" "}
                            </span>
                            {e.title}
                            <ExternalLink className="ms-1 inline h-2.5 w-2.5 align-middle" aria-hidden />
                            <span className="text-muted-foreground"> · {e.who}</span>
                          </a>
                        </div>
                      ))}
                  </div>

                  {(allNews.length + allFilings.length) > 4 && (
                    <button
                      onClick={() => setExpanded(open ? null : c.ticker)}
                      className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                    >
                      {open ? <ChevronUp className="h-3 w-3" aria-hidden /> : <ChevronDown className="h-3 w-3" aria-hidden />}
                      {open
                        ? lang === "ar"
                          ? "أقل"
                          : "less"
                        : lang === "ar"
                          ? `كل المصادر (${allNews.length + allFilings.length})`
                          : `all sources (${allNews.length + allFilings.length})`}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
