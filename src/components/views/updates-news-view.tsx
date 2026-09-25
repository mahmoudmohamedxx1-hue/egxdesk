"use client";

/** T63 — المستجدات → الأخبار: the esthmr today-screen clone, rebuilt card
 *  for card from the source terminal's own published template (template.html
 *  2026-09-25) after a deep audit found the clone had drifted:
 *
 *   - the source lays the feed out as a responsive GRID, not a column —
 *     `repeat(auto-fill,minmax(324px,1fr))`, three cards across on a wide
 *     screen, "forty stories stacked one to a row is a scroll; the same
 *     forty three across is a page you can scan";
 *   - every card carries a 16:9 PICTURE FRAME on top — the outlet's own
 *     photo layered over a designed fallback frame (an image glyph + the
 *     words "صورة الجهة الناشرة" + the outlet's name), so a story with no
 *     picture, or one the CDN refuses, still shows the frame rather than a
 *     hole ("a broken image is worse than none");
 *   - the pictures ride a server-side proxy (/api/img?u=… — the source's
 *     own /esthmr/api/img route cloned exactly), because every outlet CDN
 *     in the feed 403s cross-origin browser hotlinks — which is why the
 *     previous clone showed no photos at all;
 *   - the card's own anatomy: mono uppercase kind pill, 21px/500 headline
 *     with pretty wrapping, a RULED (not boxed) "الأثر المالي" section, the
 *     evidence chip that states when it ran and who ran it, pill buttons at
 *     44px touch height, ticker pills in the accent tint;
 *   - no day tabs and no outlet chips — the source's feed is one river,
 *     forty at a time behind a centered "عرض المزيد" pill, with the
 *     provenance sentence as a plain faint line under it.
 *
 *  Kept from the earlier clone (the source's own honesty furniture):
 *  duplicates merged across outlets with every source link kept,
 *  recommendation-carrying headlines withheld and counted, per-event-type
 *  financial-impact explainers, ticker attribution with the volume context,
 *  and 🔊 استمع (browser TTS, ar-EG) speaking headline + impact. */

import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../market/app-context";
import { Skeleton } from "@/components/ui/skeleton";
import { UpdatesSubnav } from "./updates-subnav";

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

/** The source's kind pill: a TINT and a colour per event, mono uppercase —
 *  no border, the fill is the shape. "Other" draws nothing at all rather
 *  than a chip reading OTHER, because it says nothing. */
const EVENT_COLORS: Record<string, string> = {
  results: "bg-primary/10 text-primary",
  assembly: "bg-violet-500/12 text-violet-700 dark:text-violet-300",
  board: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  dividend: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
  capital: "bg-rose-500/12 text-rose-700 dark:text-rose-300",
  debt: "bg-orange-500/12 text-orange-700 dark:text-orange-300",
  deal: "bg-teal-500/12 text-teal-700 dark:text-teal-300",
  macro: "bg-blue-500/12 text-blue-700 dark:text-blue-300",
  general: "", // "عام" says nothing — no pill at all, the source's own rule
};

/** The source's dayLabel: day + short month, Latin digits in Arabic. */
const dayLabel = (iso: string, lang: "ar" | "en"): string => {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(d);
};

/** The source's hhmm — Cairo, explicitly, so a story filed between 21:00 and
 *  midnight UTC does not show a date from one day and a time from the next. */
const hhmm = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const dateOnly = /T00:00:00(?:\.0+)?(?:Z|\+00:00)$/.test(String(iso || ""));
  if (dateOnly) return ""; // a bare date states no time of day
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Cairo" }).format(d);
};

/** One stamp: "25 سبتمبر · 14:20". */
const when = (iso: string, lang: "ar" | "en"): string => {
  const day = dayLabel(iso, lang);
  const time = hhmm(iso);
  return day + (time ? ` · ${time}` : "");
};

const longDate = (iso: string, lang: "ar" | "en"): string => {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
};

/** The source's imageSrc, verbatim in behaviour: every https picture rides
 *  the proxy route, and a URL that has already been through it must not go
 *  through it twice. */
const imageSrc = (raw: string): string => {
  if (!raw) return "";
  if (!/^https:\/\//i.test(raw)) return raw;
  if (/\/api\/img\?u=/.test(raw)) return raw;
  return `/api/img?u=${encodeURIComponent(raw)}`;
};

const PAGE = 40;

export function UpdatesNewsView() {
  const { lang, navigate } = useApp();
  const [data, setData] = useState<FeedData | null>(null);
  const [error, setError] = useState(false);
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

  const items = useMemo(() => (data ? data.items : []), [data]);

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
      const impact = lang === "ar" ? it.meaningAr : it.meaningEn;
      const volume = lang === "ar" ? it.volumeNoteAr : it.volumeNoteEn;
      const u = new SpeechSynthesisUtterance(`${it.headline}. ${impact}${volume ? `. ${volume}` : ""}`);
      u.lang = lang === "ar" ? "ar-EG" : "en-US";
      u.onend = () => setSpeaking((cur) => (cur === it.id ? null : cur));
      u.onerror = () => setSpeaking((cur) => (cur === it.id ? null : cur));
      setSpeaking(it.id);
      synth.speak(u);
    } catch {}
  };

  if (error || !data) {
    return (
      <div className="space-y-4">
        <UpdatesSubnav current="today" />
        {error ? (
          <div className="space-y-3 p-4">
            <h1 className="text-lg font-bold">{lang === "ar" ? "الأخبار" : "News"}</h1>
            <p className="text-sm text-muted-foreground">
              {lang === "ar" ? "تعذّر الوصول إلى مصادر الأخبار الآن — أعد المحاولة." : "News sources unreachable right now — try again."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-4 w-80" />
            <div className="grid items-start gap-4 [grid-template-columns:repeat(auto-fill,minmax(324px,1fr))]">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex min-w-0 flex-col-reverse gap-3.5 rounded-xl border bg-card px-4 pb-4 pt-4">
                  <div className="space-y-3">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-6 w-4/5" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-9 w-full rounded-lg" />
                  </div>
                  <Skeleton className="aspect-video w-full rounded-lg" />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  const p = data.provenance;
  const shownItems = items.slice(0, shown);
  const marketDate = longDate(new Date().toISOString().slice(0, 10), lang);
  const outletList = p.outlets;
  const unreachable = p.unreachable;

  return (
    <div className="flex flex-col gap-4">
      {/* the subnav strip — the Updates group's three destinations */}
      <UpdatesSubnav current="today" />

      {/* screen-head — dateline + title + lead, the source's own shapes */}
      <header className="pt-1.5">
        <p className="mb-1.5 flex flex-wrap items-baseline justify-between gap-3 font-mono text-xs leading-relaxed text-muted-foreground/70">
          <span>
            {marketDate}
            {" · "}
            {items.length
              ? lang === "ar"
                ? `${shownItems.length} من ${items.length} عنواناً، الأحدث أولاً.`
                : `${shownItems.length} of ${items.length} headlines, newest first.`
              : ""}
          </span>
        </p>
        <h1 className="m-0 text-[21px] font-semibold leading-[1.3] tracking-[-.01em]">
          {lang === "ar" ? "الأخبار" : "News"}
        </h1>
        <p className="m-1.5 max-w-[78ch] text-sm leading-[1.55] text-muted-foreground [text-wrap:pretty]">
          {lang === "ar" ? "ما حدث اليوم، مرتّباً بالأحدث." : "What happened today, newest first."}
        </p>
      </header>

      {/* THE GRID — the source's own comment: "A grid, not a column. Forty
          stories stacked one to a row is a scroll; the same forty three
          across is a page you can scan." */}
      <div className="grid items-start gap-4 [grid-template-columns:repeat(auto-fill,minmax(324px,1fr))]">
        {shownItems.map((it, idx) => {
          const pill = EVENT_COLORS[it.event] ?? "";
          const hasKind = Boolean(pill); // "عام" draws nothing at all
          const whenStamp = when(it.published, lang);
          const sourceName = it.sources.map((s) => s.name).join(" · ");
          const impact = lang === "ar" ? it.meaningAr : it.meaningEn;
          const volume = lang === "ar" ? it.volumeNoteAr : it.volumeNoteEn;
          const isSpeaking = speaking === it.id;
          return (
            <article key={it.id} className="flex min-w-0 flex-col-reverse gap-3.5 rounded-xl border bg-card px-4 pb-4 pt-4">
              {/* — the text half (first in the DOM; column-reverse puts the
                   picture above it, which is what the phone layer did) — */}
              <div className="min-w-0">
                {/* kind pill + when — the source's meta row */}
                <div className="flex flex-wrap items-center gap-2.5">
                  {hasKind && (
                    <span className={`inline-flex rounded-full px-2.5 py-[3px] font-mono text-[11px] uppercase tracking-[.11em] ${pill}`}>
                      {lang === "ar" ? it.eventLabelAr : it.eventLabelEn}
                    </span>
                  )}
                  {whenStamp && <span className="font-mono text-[11px] text-muted-foreground/70">{whenStamp}</span>}
                </div>

                {/* the headline — 21px/500, tight, pretty-wrapped */}
                <a
                  href={it.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  dir="auto"
                  className="mt-2.5 block text-[21px] font-medium leading-[1.28] tracking-[-.02em] [text-wrap:pretty] hover:text-primary"
                >
                  {it.headline}
                </a>

                {/* الأثر المالي — RULED, not boxed: "a tinted panel with an
                    accent rail reads as the card's own conclusion; a hairline
                    and a label read as a second field on the same record" */}
                {impact && (
                  <div className="mt-3 border-t pt-3 text-sm leading-[1.58] text-muted-foreground [text-wrap:pretty]">
                    <span className="mb-1.5 block font-mono text-[11px] uppercase tracking-[.09em] text-muted-foreground/70">
                      {lang === "ar" ? "الأثر المالي" : "Market impact"}
                    </span>
                    {impact}
                  </div>
                )}

                {/* the measured volume context — the sunk panel the source
                    puts only where it is measured */}
                {volume && (
                  <div className="mt-[11px] rounded-lg bg-secondary/60 px-3.5 py-3 text-sm leading-[1.6] text-muted-foreground [text-wrap:pretty]">
                    {volume}
                    {it.weight === "check" && it.volumeRatio ? (
                      <span className="text-muted-foreground/70"> ({lang === "ar" ? "حجم التداول" : "volume"} {it.volumeRatio.toFixed(1)}×)</span>
                    ) : null}
                  </div>
                )}

                {/* the evidence section — when it ran, who ran it, one line
                    and one link, then the row of 44px actions */}
                <div className="mt-3.5 flex flex-col gap-[9px] border-t pt-3">
                  <a
                    href={it.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-11 items-center gap-1.5 rounded-lg border bg-secondary/60 px-3 py-2 font-mono text-xs leading-[1.45] text-muted-foreground/70 hover:border-primary hover:text-primary"
                  >
                    <span className="min-w-0 truncate">
                      {whenStamp} · {sourceName}
                    </span>
                    <span className="shrink-0 whitespace-nowrap">↗</span>
                  </a>
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={it.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-11 items-center rounded-lg border bg-secondary/60 px-3.5 text-sm font-semibold text-foreground hover:border-primary hover:text-primary"
                    >
                      {lang === "ar" ? "اقرأ في المصدر" : "Read at source"} →
                    </a>
                    <button
                      onClick={() => speak(it)}
                      className="inline-flex min-h-11 items-center gap-[7px] rounded-lg border px-3.5 text-sm text-muted-foreground hover:text-foreground"
                      aria-label={isSpeaking ? (lang === "ar" ? "إيقاف" : "Stop") : lang === "ar" ? "استمع" : "Listen"}
                    >
                      {/* the source's speaker glyph, 15px */}
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
                        <path d="M11 5 6 9H3v6h3l5 4z" />
                        {isSpeaking ? (
                          <>
                            <path d="M15.5 9.5 20 14.5" />
                            <path d="M20 9.5 15.5 14.5" />
                          </>
                        ) : (
                          <path d="M15.4 8.6a4.8 4.8 0 0 1 0 6.8" />
                        )}
                      </svg>
                      <span>{isSpeaking ? (lang === "ar" ? "إيقاف" : "Stop") : lang === "ar" ? "استمع" : "Listen"}</span>
                    </button>
                    {it.tickers.map((t) => (
                      <button
                        key={t}
                        onClick={() => navigate("company", { ticker: t })}
                        className="cursor-pointer rounded-full bg-primary/10 px-[11px] py-1.5 font-mono text-[11px] font-semibold text-primary hover:bg-primary/20"
                        title={lang === "ar" ? `افتح صفحة ${t}` : `open ${t}`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* — the picture half: a 16:9 frame on every card, the outlet's
                   own photo LAYERED over it — "a picture that 404s or is
                   blocked leaves the frame showing through". The picture is a
                   link; no referrer is sent; the first four load eager and
                   high-priority, the rest lazy. — */}
              <div className="relative flex aspect-video flex-col justify-end gap-1.5 overflow-hidden rounded-lg border bg-secondary/60 p-2.5">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px] text-muted-foreground/50" aria-hidden="true">
                  <path d="M4 5.5h16v13H4zM4 15l4.5-4.2 4 3.6 3-2.6L20 15M15.6 9.2h.01" />
                </svg>
                <div className="font-mono text-[11px] uppercase leading-[1.5] tracking-[.09em] text-muted-foreground/70">
                  {lang === "ar" ? "صورة الجهة الناشرة" : "Outlet picture"}
                  <br />
                  {sourceName}
                </div>
                {it.image && (
                  <a href={it.link} target="_blank" rel="noreferrer" className="absolute inset-0 block">
                    <img
                      src={imageSrc(it.image)}
                      alt={it.headline}
                      loading={idx < 4 ? "eager" : "lazy"}
                      fetchPriority={idx < 4 ? "high" : "auto"}
                      decoding="async"
                      referrerPolicy="no-referrer"
                      onLoad={(e) => {
                        e.currentTarget.style.opacity = "1";
                      }}
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                      className="block h-full w-full object-cover opacity-0 transition-opacity duration-300"
                    />
                  </a>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {items.length === 0 && (
        <div className="px-3.5 py-4 text-sm text-muted-foreground/70">
          {lang === "ar" ? "لم يُنشر شيء لهذا بعد." : "Nothing published for this yet."}
        </div>
      )}

      {/* a page at a time — the centered pill, not an outline button */}
      {shown < items.length && (
        <div className="flex justify-center">
          <button
            onClick={() => setShown((s) => s + PAGE)}
            className="rounded-full border bg-card px-[22px] py-2.5 text-sm text-muted-foreground shadow-sm hover:text-foreground"
          >
            {lang === "ar" ? "عرض المزيد" : "Show more"}
          </button>
        </div>
      )}

      {/* the provenance sentence — a plain faint line under the feed, the
          source's own wording, never boxed */}
      <p className="px-2.5 pt-1 text-xs leading-[1.65] text-muted-foreground/70 [text-wrap:pretty]">
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
              <> وصلت أخبار {p.archivedFrom.outlets.join(" و")} من لقطة اليوم المؤرشفة ({p.archivedFrom.asOf.slice(0, 10)}) لأن الشبكة الحالية لا تصلها الآن.</>
            )}
            {unreachable.length > 0 && (
              <>
                {" "}تعذّر الوصول اليوم إلى: {unreachable.map((u) => u.nameAr).join("، ")}.
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
              <> {p.archivedFrom.outlets.join(" and ")} arrived from today's archived snapshot ({p.archivedFrom.asOf.slice(0, 10)}) — the live network cannot reach them right now.</>
            )}
            {unreachable.length > 0 && (
              <>
                {" "}Not reachable today: {unreachable.map((u) => u.nameAr).join(", ")}.
              </>
            )}
          </>
        )}
      </p>
    </div>
  );
}
