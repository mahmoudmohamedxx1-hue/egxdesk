"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../market/app-context";
import { bootParam, patchUrlParams } from "@/lib/url-state";
import type { NewsRow, SessionMeta } from "../market/types";
import { T, tt } from "@/lib/i18n";
import { fmtDateAr, fmtTimeAr, fmtInt } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Volume2, ExternalLink, Newspaper, History, ChevronUp } from "lucide-react";

type NewsPage = {
  session: SessionMeta;
  total: number;
  page: number;
  hasMore: boolean;
  coverageFrom: string | null;
  shown: number;
  items: NewsRow[];
};

type NewsEnItem = {
  title: string;
  link: string;
  publishedAt: string;
  source: string;
};

type NewsEnData = {
  items: NewsEnItem[];
  total: number;
  fetchedAt: string;
};

const PAGE_SIZE = 40;

export function NewsView() {
  const { lang } = useApp();
  const [items, setItems] = useState<NewsRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [coverageFrom, setCoverageFrom] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const pageRef = useRef(1);
  const mounted = useRef(true);

  // G11 — feed switch: the deep Arabic archive or the live English feed.
  // Defaults to the interface language after mount (SSR renders "ar" so
  // prerendered HTML always matches hydration).
  const [feed, setFeed] = useState<"ar" | "en">("ar");
  // 21-c — a shared ?feed= param overrides the language default once on boot;
  // the [lang] effect must then skip its FIRST run or it would clobber it
  const feedBooted = useRef(false);
  useEffect(() => {
    const f = bootParam("feed");
    if (f === "ar" || f === "en") setFeed(f);
    else setFeed(lang === "en" ? "en" : "ar");
    feedBooted.current = true;
  }, []);
  useEffect(() => {
    if (!feedBooted.current) return;
    setFeed(lang === "en" ? "en" : "ar");
  }, [lang]);
  useEffect(() => {
    if (!feedBooted.current) return;
    patchUrlParams({ feed: feed === (lang === "en" ? "en" : "ar") ? null : feed });
  }, [feed]);
  const [enFeed, setEnFeed] = useState<NewsEnData | null>(null);
  const [enError, setEnError] = useState(false);

  // English feed loader (10-min refresh while mounted on that tab)
  useEffect(() => {
    if (feed !== "en") return;
    let alive = true;
    const loadEn = async () => {
      try {
        const res = await fetch("/api/news-en", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as NewsEnData;
        if (alive) {
          setEnFeed(json);
          setEnError(false);
        }
      } catch {
        if (alive) setEnError(true);
      }
    };
    loadEn();
    const t = setInterval(loadEn, 600_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [feed]);

  const load = useCallback(async (page: number, append: boolean) => {
    try {
      const res = await fetch(`/api/news?page=${page}&limit=${PAGE_SIZE}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as NewsPage;
      if (!mounted.current) return;
      setItems((prev) => (append && prev ? [...prev, ...json.items] : json.items));
      setTotal(json.total);
      setHasMore(json.hasMore);
      setCoverageFrom(json.coverageFrom);
      setError(false);
    } catch {
      if (mounted.current) setError(true);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    pageRef.current = 1;
    load(1, false);
    // silently refresh the loaded pages every 2 minutes
    const t = setInterval(async () => {
      const all: NewsRow[] = [];
      let tot = 0;
      let more = false;
      try {
        for (let p = 1; p <= pageRef.current; p++) {
          const res = await fetch(`/api/news?page=${p}&limit=${PAGE_SIZE}`, { cache: "no-store" });
          if (!res.ok) return;
          const j = (await res.json()) as NewsPage;
          all.push(...j.items);
          tot = j.total;
          more = j.hasMore;
        }
        if (mounted.current && all.length) {
          setItems(all);
          setTotal(tot);
          setHasMore(more);
        }
      } catch {
        /* keep showing what we have */
      }
    }, 120_000);
    return () => {
      mounted.current = false;
      clearInterval(t);
    };
  }, [load]);

  function loadOlder() {
    const next = pageRef.current + 1;
    pageRef.current = next;
    setLoadingMore(true);
    load(next, true).finally(() => setLoadingMore(false));
  }

  const [speakingId, setSpeakingId] = useState<string | null>(null);

  function speak(item: NewsRow) {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    if (speakingId === item.id) {
      window.speechSynthesis.cancel();
      setSpeakingId(null);
      return;
    }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(`${item.title}. ${item.snippet ?? ""}`);
    u.lang = "ar-EG";
    u.rate = 0.95;
    u.onend = () => setSpeakingId(null);
    u.onerror = () => setSpeakingId(null);
    window.speechSynthesis.speak(u);
    setSpeakingId(item.id);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold tracking-tight">{tt(T.newsTitle, lang)}</h1>
        <p className="num text-xs text-muted-foreground">
          {feed === "en"
            ? `${fmtInt(enFeed?.total ?? 0)} ${tt(T.newsEnTitle, lang)}`
            : (<><span className="font-semibold">{fmtInt(total)}</span> {tt(T.headlinesShown, lang)}</>)}
        </p>
      </div>

      {/* G11 — feed source toggle */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] font-medium text-muted-foreground me-1">{tt(T.newsFeedToggle, lang)}:</span>
        {([
          ["ar", T.newsFeedArabic],
          ["en", T.newsFeedEnglish],
        ] as const).map(([k, t]) => (
          <button
            key={k}
            onClick={() => setFeed(k)}
            aria-pressed={feed === k}
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
              feed === k ? "bg-secondary font-semibold border-ring" : "text-muted-foreground hover:bg-accent/50"
            }`}
          >
            {tt(t, lang)}
          </button>
        ))}
      </div>

      {feed === "en" ? (
        /* ── English feed (G11) ── */
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground max-w-2xl leading-relaxed">{tt(T.newsEnNote, lang)}</p>
          {enError && !enFeed && (
            <p className="py-10 text-center text-sm text-muted-foreground">{tt(T.errorLoad, lang)}</p>
          )}
          {!enFeed && !enError && (
            <div className="space-y-3">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20" />)}</div>
          )}
          {enFeed?.items.map((n, i) => (
            <article key={`${n.link}-${i}`} className="rounded-lg border bg-card p-4">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="rounded-sm bg-secondary px-1.5 py-0.5 text-[10px] font-medium">{n.source}</span>
                <span className="num text-[11px] text-muted-foreground">
                  {fmtDateAr(n.publishedAt)} · {fmtTimeAr(n.publishedAt)}
                </span>
              </div>
              <h2 className="text-base font-semibold leading-snug" dir="ltr">{n.title}</h2>
              <a
                href={n.link}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent/50 transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {tt(T.newsEnOpen, lang)}
              </a>
            </article>
          ))}
        </div>
      ) : (
      <>

      {/* archive coverage line */}
      <div className="flex flex-wrap items-center gap-1.5">
        {["جريدة البورصة", "أموال الغد"].map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs text-muted-foreground">
            <Newspaper className="h-3 w-3" />
            {s}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <History className="h-3 w-3" />
          {coverageFrom ? (
            <>
              {tt(T.archiveCovers, lang)} <span className="num">{fmtDateAr(coverageFrom)}</span> → <span className="num">{lang === "ar" ? "اليوم" : "today"}</span>
            </>
          ) : (
            tt(T.liveNote, lang)
          )}
        </span>
      </div>

      {error && !items && (
        <p className="py-10 text-center text-sm text-muted-foreground">{tt(T.errorLoad, lang)}</p>
      )}

      {!items && !error && (
        <div className="space-y-3">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-32" />)}</div>
      )}

      {items && (
        <div className="space-y-3">
          {items.map((n) => (
            <article key={n.id} className="rounded-lg border bg-card p-4">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="rounded-sm bg-secondary px-1.5 py-0.5 text-[10px] font-medium">{n.source}</span>
                {n.categories.map((c) => (
                  <span key={c} className="rounded-sm bg-accent px-1.5 py-0.5 text-[10px] font-medium">{c}</span>
                ))}
                <span className="num text-[11px] text-muted-foreground">
                  {fmtDateAr(n.publishedAt)} · {fmtTimeAr(n.publishedAt)}
                </span>
              </div>

              <h2 className="text-base font-semibold leading-snug">{n.title}</h2>

              {n.snippet && (
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground line-clamp-3">{n.snippet}</p>
              )}

              <div className="mt-3 flex items-center justify-between flex-wrap gap-2">
                <span className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[9px] font-bold text-primary" aria-hidden>
                    {n.source.slice(0, 1)}
                  </span>
                  {n.source}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => speak(n)}
                    aria-label={tt(T.listen, lang)}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
                      speakingId === n.id ? "bg-accent border-ring" : "hover:bg-accent/50"
                    }`}
                  >
                    <Volume2 className={`h-3.5 w-3.5 ${speakingId === n.id ? "animate-pulse" : ""}`} />
                    {tt(T.listen, lang)}
                  </button>
                  <a href={n.link} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent/50 transition-colors">
                    <ExternalLink className="h-3.5 w-3.5" />
                    {tt(T.readSource, lang)}
                  </a>
                </div>
              </div>
            </article>
          ))}

          {items.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">{tt(T.errorLoad, lang)}</p>
          )}

          {/* pager */}
          {items.length > 0 && (
            <div className="flex items-center justify-center gap-3 pt-2">
              {hasMore ? (
                <Button variant="outline" size="sm" onClick={loadOlder} disabled={loadingMore}>
                  {loadingMore ? tt(T.loading, lang) : tt(T.loadOlder, lang)}
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">{tt(T.endOfArchive, lang)}</p>
              )}
              {items.length > PAGE_SIZE && (
                <Button variant="ghost" size="sm" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
                  <ChevronUp className="h-3.5 w-3.5 me-1 rtl:rotate-180" />
                  {tt(T.backToTop, lang)}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      </>
      )}
    </div>
  );
}
