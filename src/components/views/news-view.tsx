"use client";

import { useEffect, useState } from "react";
import { useApp } from "../market/app-context";
import { T, tt } from "@/lib/i18n";
import { fmtDateAr, fmtTimeAr } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { Volume2, ExternalLink, Newspaper, FileText, Link2 } from "lucide-react";

type NewsItem = {
  id: string; title: string; impact: string; publisher: string;
  category: string; publishedAt: string; sourceUrl: string | null;
};

export function NewsView() {
  const { lang } = useApp();
  const [items, setItems] = useState<NewsItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [speakingId, setSpeakingId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/news?limit=40")
      .then((r) => r.json())
      .then((d) => { setItems(d.items ?? []); setTotal(d.total ?? 0); })
      .catch(() => setItems([]));
  }, []);

  function speak(item: NewsItem) {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    if (speakingId === item.id) {
      window.speechSynthesis.cancel();
      setSpeakingId(null);
      return;
    }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(`${item.title}. ${item.impact}`);
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
          <span className="font-semibold">{items?.length ?? 0}</span> {lang === "ar" ? "من" : "of"} <span className="font-semibold">{total}</span> {tt(T.headlinesShown, lang)}
        </p>
      </div>

      {/* category chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        {[T.filings, T.connectDots, T.newsTitle].map((c, i) => (
          <span key={i} className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs text-muted-foreground">
            {i === 0 ? <FileText className="h-3 w-3" /> : i === 1 ? <Link2 className="h-3 w-3" /> : <Newspaper className="h-3 w-3" />}
            {tt(c, lang)}
          </span>
        ))}
      </div>

      {!items ? (
        <div className="space-y-3">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-32" />)}</div>
      ) : (
        <div className="space-y-3">
          {items.map((n) => (
            <article key={n.id} className="rounded-lg border bg-card p-4">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className={`rounded-sm px-1.5 py-0.5 text-[10px] font-medium ${
                  n.category === "صمت" ? "bg-secondary text-muted-foreground" :
                  n.category === "إفصاح" ? "bg-accent text-accent-foreground" : "bg-up-soft text-up"
                }`}>
                  {n.category}
                </span>
                <span className="num text-[11px] text-muted-foreground">
                  {fmtDateAr(n.publishedAt)} · {fmtTimeAr(n.publishedAt)}
                </span>
              </div>

              <h2 className="text-base font-semibold leading-snug">{n.title}</h2>

              <div className="mt-2 rounded-md bg-secondary/70 p-2.5">
                <p className="text-[10px] font-medium text-muted-foreground mb-0.5">{tt(T.financialImpact, lang)}</p>
                <p className="text-xs leading-relaxed text-secondary-foreground">{n.impact}</p>
              </div>

              <div className="mt-3 flex items-center justify-between flex-wrap gap-2">
                <span className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[9px] font-bold text-primary" aria-hidden>
                    {n.publisher.slice(0, 1)}
                  </span>
                  {n.publisher}
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
                  {n.sourceUrl && (
                    <a href={n.sourceUrl} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent/50 transition-colors">
                      <ExternalLink className="h-3.5 w-3.5" />
                      {tt(T.readSource, lang)}
                    </a>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
