"use client";

/** T60 — المستجدات → الإفصاحات: the disclosures agenda (esthmr's calendar
 *  screen, cloned). A month strip with per-month counts, a day grid with
 *  per-day counts, and the filings themselves — every row links to the
 *  exchange's own bulletin page, because the filing IS the source.
 *
 *  Honesty furniture:
 *   - "عرض أحدث 60 من N إفصاحاً" — the list is a window, never "everything";
 *   - the archive grows one day at a time (the daily workflow merges by
 *     filing id) and says what it covers, not what it doesn't;
 *   - companies with no filed disclosure don't appear here at all — that is
 *     a fact about the archive, not about their ownership. */

import { useEffect, useMemo, useState } from "react";
import { useApp } from "../market/app-context";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { CalendarDays, ExternalLink, FileText, ChevronLeft, ChevronRight } from "lucide-react";
import { UpdatesSubnav } from "./updates-subnav";

type Item = {
  id: string;
  title: string;
  titleEn: string | null;
  date: string;
  link: string;
  tickers: string[];
  event: string;
  eventLabelAr: string;
  eventLabelEn: string;
};

type Data = {
  asOf: string;
  total: number;
  months: { month: string; count: number }[];
  grid: { month: string; days: { day: string; count: number }[] };
  shown: number;
  items: Item[];
  truncated: boolean;
};

const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const monthLabel = (m: string, lang: "ar" | "en"): string => {
  const [y, mm] = m.split("-");
  const idx = Number(mm) - 1;
  return lang === "ar" ? `${MONTHS_AR[idx]} ${y}` : `${MONTHS_EN[idx]} ${y}`;
};

const EVENT_COLORS: Record<string, string> = {
  dividend: "bg-amber-500/12 text-amber-700 dark:text-amber-300 border-amber-500/25",
  insider: "bg-rose-500/12 text-rose-700 dark:text-rose-300 border-rose-500/25",
  board: "bg-sky-500/12 text-sky-700 dark:text-sky-300 border-sky-500/25",
  assembly: "bg-violet-500/12 text-violet-700 dark:text-violet-300 border-violet-500/25",
  results: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border-emerald-500/25",
  statement: "bg-teal-500/12 text-teal-700 dark:text-teal-300 border-teal-500/25",
  listing: "bg-blue-500/12 text-blue-700 dark:text-blue-300 border-blue-500/25",
  funding: "bg-orange-500/12 text-orange-700 dark:text-orange-300 border-orange-500/25",
  auditor: "bg-cyan-500/12 text-cyan-700 dark:text-cyan-300 border-cyan-500/25",
  regulator: "bg-slate-500/12 text-slate-700 dark:text-slate-300 border-slate-500/25",
  contract: "bg-indigo-500/12 text-indigo-700 dark:text-indigo-300 border-indigo-500/25",
  other: "bg-secondary text-muted-foreground border-border",
};

/** Egypt's week starts Saturday; the exchange trades Sunday–Thursday. */
const WEEKDAYS: { ar: string; en: string; weekend: boolean }[] = [
  { ar: "سبت", en: "Sat", weekend: true },
  { ar: "أحد", en: "Sun", weekend: false },
  { ar: "اثنين", en: "Mon", weekend: false },
  { ar: "ثلاثاء", en: "Tue", weekend: false },
  { ar: "أربعاء", en: "Wed", weekend: false },
  { ar: "خميس", en: "Thu", weekend: false },
  { ar: "جمعة", en: "Fri", weekend: true },
];

const LIMIT = 60;

export function DisclosuresView() {
  const { lang, navigate } = useApp();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState(false);
  const [month, setMonth] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [shown, setShown] = useState(LIMIT);

  useEffect(() => {
    fetch("/api/disclosures")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("x"))))
      .then((d: Data) => setData(d))
      .catch(() => setError(true));
  }, []);

  useEffect(() => {
    setShown(LIMIT);
  }, [month, day]);

  // re-fetch when month/day changes (server slices, keeps payloads small)
  useEffect(() => {
    if (!data) return;
    const params = new URLSearchParams();
    if (month) params.set("month", month);
    if (day) params.set("day", day);
    fetch(`/api/disclosures${params.size ? `?${params}` : ""}`)
      .then((r) => r.json())
      .then((d: Data) => setData(d))
      .catch(() => {});
  }, [month, day]);

  const gridCells = useMemo(() => {
    if (!data) return [];
    const [y, m] = data.grid.month.split("-").map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1));
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const lead = first.getUTCDay(); // 0=Sun…6=Sat — our grid starts Saturday
    const leadSat = (lead + 1) % 7;
    const counts = new Map(data.grid.days.map((d) => [d.day.slice(8), d.count]));
    const cells: { key: string; day: number | null; count: number; date: string | null }[] = [];
    for (let i = 0; i < leadSat; i++) cells.push({ key: `lead-${i}`, day: null, count: 0, date: null });
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${data.grid.month}-${String(d).padStart(2, "0")}`;
      cells.push({ key: date, day: d, count: counts.get(String(d).padStart(2, "0")) ?? 0, date });
    }
    return cells;
  }, [data]);

  if (error || !data) {
    return (
      <div className="space-y-4">
        <UpdatesSubnav current="disclosures" />
        {error ? (
          <div className="space-y-3 p-4">
            <h1 className="text-lg font-bold">{lang === "ar" ? "الإفصاحات" : "Disclosures"}</h1>
            <p className="text-sm text-muted-foreground">{lang === "ar" ? "تعذّر تحميل الأرشيف." : "Archive unavailable."}</p>
          </div>
        ) : (
          <div className="space-y-3 p-4">
            <Skeleton className="h-9 w-72" />
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        )}
      </div>
    );
  }

  const items = data.items.slice(0, shown);
  const activeMonthLabel = monthLabel(data.grid.month, lang);

  return (
    <div className="space-y-4">
      {/* the Updates group's subnav strip — the source renders it on every
          screen of the group, so the three destinations are one click apart
          wherever the reader lands */}
      <UpdatesSubnav current="disclosures" />

      {/* header */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-primary" aria-hidden />
          <h1 className="text-lg font-bold">{lang === "ar" ? "أجندة الإفصاحات والمواعيد" : "Disclosures & dates agenda"}</h1>
        </div>
        <p className="text-xs text-muted-foreground">
          {lang === "ar"
            ? `كل ما أودعته الشركات للبورصة المصرية من إفصاحات — ${data.total} إفصاحًا في الأرشيف، محدَّث ${data.asOf.slice(0, 10)}.`
            : `Everything companies filed with the Egyptian Exchange — ${data.total} disclosures archived, updated ${data.asOf.slice(0, 10)}.`}
        </p>
      </div>

      {/* month strip */}
      <div className="flex flex-wrap items-center gap-1.5">
        {data.months.map(({ month: m, count }) => (
          <button
            key={m}
            onClick={() => {
              setMonth(m === month ? null : m);
              setDay(null);
            }}
            className={`rounded-full border px-2.5 py-1 text-[11px] tabular-nums transition-colors ${
              (month ?? data.grid.month) === m ? "border-foreground/20 bg-secondary font-semibold" : "border-transparent text-muted-foreground hover:bg-accent"
            }`}
          >
            {monthLabel(m, lang)} · {count}
          </button>
        ))}
      </div>

      {/* day grid */}
      <div className="rounded-xl border bg-card p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold">{lang === "ar" ? "اختر يوماً" : "Pick a day"}</span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              aria-label={lang === "ar" ? "الشهر السابق" : "Previous month"}
              onClick={() => {
                const idx = data.months.findIndex((x) => x.month === (month ?? data.grid.month));
                const prev = data.months[idx - 1];
                if (prev) {
                  setMonth(prev.month);
                  setDay(null);
                }
              }}
            >
              {lang === "ar" ? <ChevronRight className="h-3.5 w-3.5" aria-hidden /> : <ChevronLeft className="h-3.5 w-3.5" aria-hidden />}
            </Button>
            <span className="text-xs font-medium">{activeMonthLabel}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              aria-label={lang === "ar" ? "الشهر التالي" : "Next month"}
              onClick={() => {
                const idx = data.months.findIndex((x) => x.month === (month ?? data.grid.month));
                const next = data.months[idx + 1];
                if (next) {
                  setMonth(next.month);
                  setDay(null);
                }
              }}
            >
              {lang === "ar" ? <ChevronLeft className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center">
          {WEEKDAYS.map((w) => (
            <span key={w.en} className={`py-0.5 text-[10px] font-medium ${w.weekend ? "text-muted-foreground/60" : "text-muted-foreground"}`}>
              {lang === "ar" ? w.ar : w.en}
            </span>
          ))}
          {gridCells.map((c) =>
            c.day === null ? (
              <span key={c.key} />
            ) : (
              <button
                key={c.key}
                disabled={c.count === 0}
                onClick={() => setDay(c.date === day ? null : c.date)}
                className={`relative rounded-md py-1.5 text-xs tabular-nums transition-colors ${
                  c.count === 0
                    ? "text-muted-foreground/30"
                    : c.date === day
                      ? "bg-primary font-bold text-primary-foreground"
                      : "hover:bg-accent"
                }`}
                title={c.count > 0 ? (lang === "ar" ? `${c.count} إفصاحًا` : `${c.count} filings`) : ""}
              >
                {c.day}
                {c.count > 0 && c.date !== day && (
                  <span className="absolute -top-0.5 -end-0.5 rounded-full bg-primary px-1 text-[8px] font-bold leading-tight text-primary-foreground">
                    {c.count > 99 ? "99+" : c.count}
                  </span>
                )}
              </button>
            ),
          )}
        </div>
      </div>

      {/* the list */}
      <p className="text-xs text-muted-foreground">
        {day
          ? lang === "ar"
            ? `إفصاحات ${day} — ${data.shown} إفصاحًا.`
            : `Filings on ${day} — ${data.shown}.`
          : lang === "ar"
            ? `عرض أحدث ${Math.min(shown, data.shown)} من ${data.shown} إفصاحًا${month ? ` نُشرت في ${activeMonthLabel}` : ""}.`
            : `Showing the latest ${Math.min(shown, data.shown)} of ${data.shown} filings${month ? ` published in ${activeMonthLabel}` : ""}.`}
      </p>

      <div className="space-y-1.5">
        {items.map((it) => {
          const badge = EVENT_COLORS[it.event] ?? EVENT_COLORS.other;
          return (
            <div key={it.id} className="flex items-start gap-2.5 rounded-lg border bg-card p-2.5">
              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="tabular-nums">{it.date}</span>
                  <span className={`rounded-full border px-1.5 py-0.5 font-semibold ${badge}`}>
                    {lang === "ar" ? it.eventLabelAr : it.eventLabelEn}
                  </span>
                  {it.tickers.map((t) => (
                    <button
                      key={t}
                      onClick={() => navigate("company", { ticker: t })}
                      className="rounded-full border border-ring/40 bg-secondary/60 px-1.5 py-0.5 font-bold hover:bg-accent"
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <a
                  href={it.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 block text-sm font-medium leading-snug hover:text-primary"
                >
                  {it.title}
                  <ExternalLink className="ms-1 inline h-3 w-3 align-middle text-muted-foreground" aria-hidden />
                </a>
              </div>
            </div>
          );
        })}
      </div>

      {shown < data.items.length && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={() => setShown((s) => s + LIMIT)}>
            {lang === "ar" ? "عرض المزيد" : "Show more"}
          </Button>
        </div>
      )}
    </div>
  );
}
