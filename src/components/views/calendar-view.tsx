"use client";

/** Events calendar view (G5): a month grid with event dots plus an upcoming
 *  agenda. Everything shown is either an ANNOUNCED date (EGX-disclosure
 *  corporate actions, live dividend ex/pay dates, press-announced assemblies)
 *  or a clearly-flagged EXPECTED results date derived from filing history.
 *  Data: /api/calendar. */

import { useMemo, useState } from "react";
import { useApp } from "../market/app-context";
import { useLiveData } from "../market/use-live-data";
import { T, tt, dn } from "@/lib/i18n";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { CalendarDays, ChevronRight, ChevronLeft, ExternalLink, TrendingUp } from "lucide-react";

type CalendarEvent = {
  date: string;
  type: "earnings" | "dividend" | "assembly" | "rights";
  ticker: string | null;
  estimated?: boolean;
  amount?: number;
  labelAr: string;
  labelEn: string;
  url: string | null;
  source: string;
};

type CalendarData = {
  asOf: string;
  events: CalendarEvent[];
  counts: { earnings: number; dividend: number; assembly: number; rights: number };
};

const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

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

const TYPE_STYLE: Record<CalendarEvent["type"], { dot: string; chip: string; t: { ar: string; en: string } }> = {
  earnings: { dot: "bg-primary", chip: "bg-primary/15 text-primary", t: T.evEarnings },
  dividend: { dot: "bg-up", chip: "bg-up-soft text-up", t: T.evDividend },
  assembly: { dot: "bg-chart-3", chip: "bg-secondary text-foreground/70", t: T.evAssembly },
  rights: { dot: "bg-chart-4", chip: "bg-secondary text-foreground/70", t: { ar: "حق اكتتاب", en: "Rights" } },
};

function typeOfDate(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

export function CalendarView() {
  const { lang, navigate } = useApp();
  const { data, error } = useLiveData<CalendarData>("/api/calendar", 5 * 60_000);
  const today = data?.asOf ?? new Date().toISOString().slice(0, 10);

  const [monthOffset, setMonthOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [limit, setLimit] = useState(25);

  const byDate = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const e of data?.events ?? []) {
      const arr = m.get(e.date) ?? [];
      arr.push(e);
      m.set(e.date, arr);
    }
    return m;
  }, [data]);

  // month grid
  const grid = useMemo(() => {
    const base = new Date(`${today}T00:00:00Z`);
    const first = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + monthOffset, 1));
    const year = first.getUTCFullYear();
    const month = first.getUTCMonth();
    // leading blanks: Egypt week starts Saturday (getUTCDay: Sat=6)
    const startWeekday = first.getUTCDay(); // 0=Sun … 6=Sat
    const lead = (startWeekday + 1) % 7; // index of Sunday-first? no — Saturday-first grid
    const leadBlanks = (startWeekday === 6 ? 0 : startWeekday + 1);
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const cells: (string | null)[] = Array.from({ length: leadBlanks }, () => null);
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(`${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    }
    while (cells.length % 7 !== 0) cells.push(null);
    return { year, month, cells, lead: lead };
  }, [today, monthOffset]);

  const monthLabel = `${lang === "ar" ? MONTHS_AR[grid.month] : MONTHS_EN[grid.month]} ${grid.year}`;

  // agenda: selected day first, else upcoming
  const agenda = useMemo(() => {
    if (!data) return [];
    if (selected) return (byDate.get(selected) ?? []).slice(0, 50);
    return data.events.filter((e) => e.date >= today).slice(0, limit);
  }, [data, selected, today, limit, byDate]);

  if (error && !data) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
        {tt(T.calendarNoData, lang)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-primary" />
          {tt(T.calendarTitle, lang)}
        </h1>
        {data && (
          <p className="num text-xs text-muted-foreground">
            {data.counts.earnings + data.counts.dividend + data.counts.assembly + data.counts.rights} · {tt(T.ratesAsOf, lang)} {data.asOf}
          </p>
        )}
      </div>
      <p className="text-sm text-muted-foreground max-w-3xl leading-relaxed">{tt(T.calendarNote, lang)}</p>

      {!data ? (
        <div className="space-y-2">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : (
        <>
          {/* month grid */}
          <div className="rounded-lg border bg-card p-3 sm:p-4">
            <div className="flex items-center justify-between mb-3">
              <Button variant="ghost" size="sm" onClick={() => setMonthOffset((m) => m - 1)} aria-label="previous month">
                <ChevronRight className="h-4 w-4 rtl:rotate-0 ltr:rotate-180" />
              </Button>
              <p className="text-sm font-semibold num">{monthLabel}</p>
              <Button variant="ghost" size="sm" onClick={() => setMonthOffset((m) => Math.min(m + 1, 6))} aria-label="next month">
                <ChevronLeft className="h-4 w-4 rtl:rotate-0 ltr:rotate-180" />
              </Button>
            </div>
            <div className="grid grid-cols-7 gap-1" dir="rtl">
              {WEEKDAYS.map((w) => (
                <div key={w.en} className={`text-center text-[10px] py-1 ${w.weekend ? "text-muted-foreground/50" : "text-muted-foreground"}`}>
                  {lang === "ar" ? w.ar : w.en}
                </div>
              ))}
              {grid.cells.map((iso, i) => {
                if (!iso) return <div key={`b${i}`} className="aspect-square" />;
                const evs = byDate.get(iso) ?? [];
                const isToday = iso === today;
                const isSelected = iso === selected;
                const dow = typeOfDate(iso);
                const weekend = dow === 5 || dow === 6; // Fri/Sat
                return (
                  <button
                    key={iso}
                    onClick={() => setSelected(isSelected ? null : iso)}
                    className={`aspect-square rounded-md flex flex-col items-center justify-center gap-1 text-xs num transition-colors border ${
                      isSelected
                        ? "border-primary bg-primary/10 font-bold"
                        : isToday
                        ? "border-primary/40 bg-primary/5 font-semibold"
                        : evs.length
                        ? "border-transparent bg-secondary/60 hover:bg-secondary"
                        : "border-transparent hover:bg-accent/40"
                    } ${weekend ? "text-muted-foreground/60" : ""}`}
                    title={evs.length ? `${evs.length} ${lang === "ar" ? "أحداث" : "events"}` : undefined}
                  >
                    <span>{Number(iso.slice(8))}</span>
                    <span className="flex items-center gap-0.5 h-1.5">
                      {evs.slice(0, 3).map((e, j) => (
                        <span key={j} className={`h-1.5 w-1.5 rounded-full ${TYPE_STYLE[e.type].dot}`} aria-hidden />
                      ))}
                      {evs.length > 3 && <span className="text-[8px] text-muted-foreground">+{evs.length - 3}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
            {/* legend */}
            <div className="flex items-center flex-wrap gap-3 mt-3 pt-2 border-t text-[10px] text-muted-foreground">
              {(["earnings", "dividend", "assembly", "rights"] as const).map((t) => (
                <span key={t} className="inline-flex items-center gap-1">
                  <span className={`h-2 w-2 rounded-full ${TYPE_STYLE[t].dot}`} aria-hidden />
                  {tt(TYPE_STYLE[t].t, lang)}
                </span>
              ))}
            </div>
          </div>

          {/* agenda */}
          <div className="rounded-lg border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b flex items-center justify-between flex-wrap gap-2">
              <p className="font-semibold text-sm flex items-center gap-1.5">
                <TrendingUp className="h-3.5 w-3.5 text-primary" />
                {selected
                  ? `${tt(T.calendarUpcoming, lang)} — ${selected}`
                  : tt(T.calendarUpcoming, lang)}
              </p>
              {selected && (
                <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={() => setSelected(null)}>
                  {tt(T.viewAll, lang)}
                </Button>
              )}
            </div>
            {agenda.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">{tt(T.calendarNone, lang)}</p>
            ) : (
              <div className="divide-y">
                {agenda.map((e, i) => (
                  <div key={`${e.date}-${e.type}-${e.ticker ?? ""}-${i}`} className="px-4 py-2.5 flex items-center gap-2.5 hover:bg-accent/30">
                    <span className="num text-xs text-muted-foreground shrink-0 w-20">{e.date}</span>
                    <span className={`num text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${TYPE_STYLE[e.type].chip}`}>
                      {tt(TYPE_STYLE[e.type].t, lang)}
                    </span>
                    {e.ticker ? (
                      <button
                        className="num text-xs font-bold hover:text-primary shrink-0"
                        onClick={() => navigate("company", { ticker: e.ticker!, panel: "overview" })}
                      >
                        {e.ticker}
                      </button>
                    ) : null}
                    <p className="text-xs text-foreground/80 flex-1 min-w-0 truncate">
                      {lang === "ar" ? e.labelAr : e.labelEn}
                    </p>
                    {e.estimated && (
                      <span className="text-[10px] text-muted-foreground border rounded-full px-1.5 py-0.5 shrink-0">
                        {lang === "ar" ? "تقديري" : "estimated"}
                      </span>
                    )}
                    {e.url && (
                      <a
                        href={e.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-primary shrink-0"
                        title={e.source}
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
            {!selected && data.events.filter((e) => e.date >= today).length > limit && (
              <div className="px-4 py-2.5 border-t text-center">
                <Button variant="ghost" size="sm" className="text-xs" onClick={() => setLimit((l) => l + 25)}>
                  {tt(T.viewAll, lang)}
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
