"use client";

/** T60 — المستجدات → الأخبار: the esthmr "today screen" clone.
 *
 *  A single vertical feed of everything the Egyptian financial outlets ran
 *  today, newest first — each card attributed to the outlet that ran it,
 *  linked to the original article ("اقرأ في المصدر"), classified by event
 *  type with a per-type financial-impact explainer, tagged with the EGX
 *  companies it plausibly names, and honest about unusual session volume
 *  for those names (2× threshold, the source model's own).
 *
 *  Cloned honesty furniture:
 *   - "N من M عنواناً، الأحدث أولاً" count header — the list is visibly a
 *     window, never "the news";
 *   - duplicates the outlets ran on one story MERGED, every source link kept;
 *   - recommendation-carrying headlines withheld (counted in the footer);
 *   - unreachable outlets named in the provenance line, never silently
 *     dropped;
 *   - 🔊 استمع speaks the card (browser TTS, Arabic) — the source model's
 *     audio affordance, minus any cloud dependency;
 *   - day tabs (اليوم / هذا الأسبوع / هذا الشهر / الكل) + outlet filter chips. */

import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../market/app-context";
import { T, tt } from "@/lib/i18n";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ExternalLink, Newspaper, Volume2, VolumeX, Radar, Users, Link2, AlertTriangle } from "lucide-react";

type FeedItem = {
  id: string;
  headline: string;
  link: string;
  published: string;
  image: string | null;
  snippet: string | null;
  sources: { id: string; name: string; link: string }[];
  event: string;
  eventLabelAr: string;
  eventLabelEn: string;
  meaningAr: string;
  meaningEn: string;
  tickers: string[];
  weight: "named" | "check" | null;
  volumeNoteAr: string | null;
  volumeNoteEn: string | null;
  volumeRatio: number | null;
};

type Provenance = {
  generatedAt: string;
  outlets: { id: string; name: string; nameAr: string; home: string }[];
  unreachable: { id: string; nameAr: string; note: string }[];
  mergedCount: number;
  withheldCount: number;
  itemCount: number;
  /** outlets served from the daily snapshot when the runtime network lost them */
  archivedFrom?: { outlets: string[]; asOf: string };
};

type FeedData = { provenance: Provenance; items: FeedItem[] };

const EVENT_COLORS: Record<string, string> = {
  results: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border-emerald-500/25",
  assembly: "bg-violet-500/12 text-violet-700 dark:text-violet-300 border-violet-500/25",
  board: "bg-sky-500/12 text-sky-700 dark:text-sky-300 border-sky-500/25",
  dividend: "bg-amber-500/12 text-amber-700 dark:text-amber-300 border-amber-500/25",
  capital: "bg-rose-500/12 text-rose-700 dark:text-rose-300 border-rose-500/25",
  debt: "bg-orange-500/12 text-orange-700 dark:text-orange-300 border-orange-500/25",
  deal: "bg-teal-500/12 text-teal-700 dark:text-teal-300 border-teal-500/25",
  macro: "bg-blue-500/12 text-blue-700 dark:text-blue-300 border-blue-500/25",
  general: "bg-secondary text-muted-foreground border-border",
};

const fmtDay = (iso: string, lang: "ar" | "en"): string => {
  const d = new Date(iso);
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-EG" : "en-GB", { day: "numeric", month: "long" }).format(d);
};
const fmtTime = (iso: string, lang: "ar" | "en"): string => {
  const d = new Date(iso);
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-EG" : "en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
};

const DAY_TABS = [
  { id: "today", ar: "اليوم", en: "Today", days: 1 },
  { id: "week", ar: "هذا الأسبوع", en: "This week", days: 7 },
  { id: "month", ar: "هذا الشهر", en: "This month", days: 31 },
  { id: "all", ar: "الكل", en: "All", days: 3650 },
] as const;

const PAGE = 40;

export function UpdatesNewsView() {
  const { lang, navigate } = useApp();
  const [data, setData] = useState<FeedData | null>(null);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<(typeof DAY_TABS)[number]["id"]>("all");
  const [outlet, setOutlet] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [speaking, setSpeaking] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    fetch("/api/news-feed")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("feed"))))
      .then((d: FeedData) => {
        if (mounted.current) setData(d);
      })
      .catch(() => {
        if (mounted.current) setError(true);
      });
    return () => {
      mounted.current = false;
    };
  }, []);

  // stop TTS on unmount
  useEffect(() => () => {
    try {
      window.speechSynthesis?.cancel();
    } catch {}
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    const tabDef = DAY_TABS.find((t) => t.id === tab) ?? DAY_TABS[3];
    const cutoff = Date.now() - tabDef.days * 86_400_000;
    return data.items.filter((it) => {
      if (tabDef.days < 3650 && Date.parse(it.published) < cutoff) return false;
      if (outlet && !it.sources.some((s) => s.id === outlet)) return false;
      return true;
    });
  }, [data, tab, outlet]);

  const outletCounts = useMemo(() => {
    if (!data) return new Map<string, number>();
    const m = new Map<string, number>();
    for (const it of data.items) for (const s of it.sources) m.set(s.id, (m.get(s.id) ?? 0) + 1);
    return m;
  }, [data]);

  const speak = (it: FeedItem) => {
    try {
      const synth = window.speechSynthesis;
      if (!synth) return;
      if (speaking === it.id) {
        synth.cancel();
        setSpeaking(null);
        return;
      }
      synth.cancel();
      const u = new SpeechSynthesisUtterance(`${it.headline}. ${lang === "ar" ? it.meaningAr : it.meaningEn}`);
      u.lang = lang === "ar" ? "ar-EG" : "en-US";
      u.onend = () => setSpeaking((cur) => (cur === it.id ? null : cur));
      u.onerror = () => setSpeaking((cur) => (cur === it.id ? null : cur));
      setSpeaking(it.id);
      synth.speak(u);
    } catch {}
  };

  if (error) {
    return (
      <div className="space-y-3 p-4">
        <h1 className="text-lg font-bold">{tt(T.news, lang)}</h1>
        <p className="text-sm text-muted-foreground">
          {lang === "ar" ? "تعذّر الوصول إلى مصادر الأخبار الآن — أعد المحاولة." : "News sources unreachable right now — try again."}
        </p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-7 w-52" />
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  const shownItems = filtered.slice(0, shown);
  const p = data.provenance;
  const outletList = p.outlets.filter((o) => (outletCounts.get(o.id) ?? 0) > 0 || o.id === outlet);
  const unreachable = p.unreachable;

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Newspaper className="h-5 w-5 text-primary" aria-hidden />
          <h1 className="text-lg font-bold">{lang === "ar" ? "الأخبار" : "News"}</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {lang === "ar" ? "ما حدث اليوم، مرتّباً بالأحدث." : "What happened today, newest first."}
        </p>
        <p className="text-xs tabular-nums text-muted-foreground">
          {new Intl.DateTimeFormat(lang === "ar" ? "ar-EG" : "en-GB", { dateStyle: "long" }).format(new Date(p.generatedAt))}
          {" · "}
          {lang === "ar"
            ? `${shownItems.length} من ${filtered.length} عنواناً، الأحدث أولاً.`
            : `${shownItems.length} of ${filtered.length} headlines, newest first.`}
        </p>
      </div>

      {/* cross-links — the two companion screens of the Updates group */}
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          onClick={() => navigate("crossings")}
          className="group flex items-start gap-3 rounded-xl border bg-card p-3 text-start transition-colors hover:bg-accent"
        >
          <Radar className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0">
            <span className="block text-sm font-semibold">
              {lang === "ar" ? "ربط النقاط" : "Connecting the dots"}
            </span>
            <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
              {lang === "ar"
                ? "الشركات التي وردت في الأخبار والإفصاحات معاً خلال الأيام الأخيرة."
                : "Companies that appeared in both the news and the filings this week."}
            </span>
          </span>
          <Link2 className="ms-auto h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden />
        </button>
        <button
          onClick={() => navigate("disclosures")}
          className="group flex items-start gap-3 rounded-xl border bg-card p-3 text-start transition-colors hover:bg-accent"
        >
          <Users className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0">
            <span className="block text-sm font-semibold">
              {lang === "ar" ? "أجندة الإفصاحات" : "Disclosures agenda"}
            </span>
            <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
              {lang === "ar"
                ? "كل ما أودعته الشركات للبورصة من إفصاحات، بالشهر واليوم."
                : "Everything companies filed with the exchange, by month and day."}
            </span>
          </span>
          <Link2 className="ms-auto h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden />
        </button>
      </div>

      {/* day tabs + outlet chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        {DAY_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setTab(t.id);
              setShown(PAGE);
            }}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              tab === t.id ? "border-foreground/20 bg-secondary" : "border-transparent text-muted-foreground hover:bg-accent"
            }`}
          >
            {lang === "ar" ? t.ar : t.en}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => setOutlet(null)}
          className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
            outlet === null ? "border-foreground/20 bg-secondary font-semibold" : "border-transparent text-muted-foreground hover:bg-accent"
          }`}
        >
          {lang === "ar" ? "الكل" : "All"} · {filtered.length}
        </button>
        {outletList.map((o) => (
          <button
            key={o.id}
            onClick={() => {
              setOutlet(outlet === o.id ? null : o.id);
              setShown(PAGE);
            }}
            className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
              outlet === o.id ? "border-foreground/20 bg-secondary font-semibold" : "border-transparent text-muted-foreground hover:bg-accent"
            }`}
          >
            {lang === "ar" ? o.nameAr : o.name} · {outletCounts.get(o.id) ?? 0}
          </button>
        ))}
      </div>

      {/* the feed */}
      <div className="space-y-3">
        {shownItems.map((it) => {
          const badge = EVENT_COLORS[it.event] ?? EVENT_COLORS.general;
          const hasCheck = it.weight === "check";
          return (
            <article key={it.id} className="rounded-xl border bg-card p-3.5">
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className={`rounded-full border px-2 py-0.5 font-semibold ${badge}`}>
                  {lang === "ar" ? it.eventLabelAr : it.eventLabelEn}
                </span>
                <span className="tabular-nums">
                  {fmtDay(it.published, lang)} · {fmtTime(it.published, lang)}
                </span>
                {hasCheck && (
                  <span className="flex items-center gap-1 rounded-full bg-amber-500/12 px-2 py-0.5 font-semibold text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="h-3 w-3" aria-hidden />
                    {it.volumeRatio ? `${it.volumeRatio.toFixed(1)}×` : ""} {lang === "ar" ? "حجم" : "vol"}
                  </span>
                )}
              </div>

              <div className="mt-2 flex gap-3">
                <div className="min-w-0 flex-1">
                  <a
                    href={it.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-[15px] font-bold leading-snug hover:text-primary"
                  >
                    {it.headline}
                  </a>

                  {/* الأثر المالي — per-event-type explainer */}
                  <div className="mt-2 rounded-lg bg-secondary/60 p-2.5">
                    <span className="block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                      {lang === "ar" ? "الأثر المالي" : "Financial impact"}
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                      {lang === "ar" ? it.meaningAr : it.meaningEn}
                    </span>
                  </div>

                  {/* ticker pills + volume context */}
                  {(it.tickers.length > 0 || it.volumeNoteAr) && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {it.tickers.map((t) => (
                        <button
                          key={t}
                          onClick={() => navigate("company", { ticker: t })}
                          className="rounded-full border border-ring/40 bg-secondary/60 px-2 py-0.5 text-[10px] font-bold hover:bg-accent"
                          title={lang === "ar" ? `افتح صفحة ${t}` : `open ${t}`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  )}
                  {(it.tickers.length > 0 && (lang === "ar" ? it.volumeNoteAr : it.volumeNoteEn)) && (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                      {lang === "ar" ? it.volumeNoteAr : it.volumeNoteEn}
                    </p>
                  )}

                  {/* sources + listen */}
                  <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]">
                    {it.sources.map((s) => (
                      <a
                        key={s.id + s.link}
                        href={s.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-muted-foreground hover:text-primary"
                      >
                        {s.name} ↗
                      </a>
                    ))}
                    <a
                      href={it.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                    >
                      {lang === "ar" ? "اقرأ في المصدر" : "Read at the source"}
                      <ExternalLink className="h-3 w-3" aria-hidden />
                    </a>
                    <button
                      onClick={() => speak(it)}
                      className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                      aria-label={speaking === it.id ? (lang === "ar" ? "إيقاف" : "Stop") : lang === "ar" ? "استمع" : "Listen"}
                    >
                      {speaking === it.id ? <VolumeX className="h-3.5 w-3.5" aria-hidden /> : <Volume2 className="h-3.5 w-3.5" aria-hidden />}
                      {speaking === it.id ? (lang === "ar" ? "⏸ إيقاف" : "⏸ Stop") : lang === "ar" ? "🔊 استمع" : "🔊 Listen"}
                    </button>
                  </div>
                </div>

                {/* publisher image */}
                {it.image && (
                   
                  <img
                    src={it.image}
                    alt={lang === "ar" ? "صورة الجهة الناشرة" : "Publisher image"}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="hidden h-28 w-44 shrink-0 rounded-lg border object-cover sm:block"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                )}
              </div>
            </article>
          );
        })}
      </div>

      {shown < filtered.length && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={() => setShown((s) => s + PAGE)}>
            {lang === "ar" ? "عرض المزيد" : "Show more"} ({filtered.length - shown})
          </Button>
        </div>
      )}

      {/* provenance footer — the source model's honesty line, verbatim in spirit */}
      <footer className="rounded-xl border bg-card/60 p-3 text-[11px] leading-relaxed text-muted-foreground">
        {lang === "ar" ? (
          <>
            عناوين من{" "}
            {outletList.map((o, i) => (
              <a key={o.id} href={o.home} target="_blank" rel="noopener noreferrer" className="font-medium hover:text-primary">
                {o.nameAr}
                {i < outletList.length - 1 ? "، " : ""}
              </a>
            ))}
            ، كل واحد منها موصول بالجهة التي نشرته.
            {p.mergedCount > 0 && <> دُمج {p.mergedCount} خبرًا مكررًا.</>}
            {p.withheldCount > 0 && <> حُجب {p.withheldCount} خبرًا لاحتوائه على توصية.</>}
            {p.archivedFrom && p.archivedFrom.outlets.length > 0 && (
              <>
                {" "}
                وصلت أخبار {p.archivedFrom.outlets.join(" و")} من لقطة اليوم المؤرشفة ({p.archivedFrom.asOf.slice(0, 10)}) لأن الشبكة الحالية لا تصلها الآن.
              </>
            )}
            {unreachable.length > 0 && (
              <>
                {" "}
                تعذّر الوصول اليوم إلى:{" "}
                {unreachable.map((u, i) => (
                  <span key={u.id} className="font-medium">
                    {u.nameAr}
                    {i < unreachable.length - 1 ? "، " : ""}
                  </span>
                ))}
                .
              </>
            )}
          </>
        ) : (
          <>
            Headlines from{" "}
            {outletList.map((o, i) => (
              <a key={o.id} href={o.home} target="_blank" rel="noopener noreferrer" className="font-medium hover:text-primary">
                {o.name}
                {i < outletList.length - 1 ? ", " : ""}
              </a>
            ))}
            , each linked to the outlet that ran it.
            {p.mergedCount > 0 && <> {p.mergedCount} duplicates merged.</>}
            {p.withheldCount > 0 && <> {p.withheldCount} withheld for carrying a recommendation.</>}
            {p.archivedFrom && p.archivedFrom.outlets.length > 0 && (
              <>
                {" "}
                {p.archivedFrom.outlets.join(" and ")} arrived from today's archived snapshot ({p.archivedFrom.asOf.slice(0, 10)}) — the live network cannot reach them right now.
              </>
            )}
            {unreachable.length > 0 && (
              <>
                {" "}
                Not reachable today:{" "}
                {unreachable.map((u, i) => (
                  <span key={u.id} className="font-medium">
                    {u.nameAr}
                    {i < unreachable.length - 1 ? ", " : ""}
                  </span>
                ))}
                .
              </>
            )}
          </>
        )}
      </footer>
    </div>
  );
}
