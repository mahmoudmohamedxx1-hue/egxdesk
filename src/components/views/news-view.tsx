"use client";

import { useState } from "react";
import { useApp } from "../market/app-context";
import { useLiveData } from "../market/use-live-data";
import type { NewsRow, SessionMeta } from "../market/types";
import { T, tt } from "@/lib/i18n";
import { fmtDateAr, fmtTimeAr } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { Volume2, ExternalLink, Newspaper } from "lucide-react";

export function NewsView() {
  const { lang } = useApp();
  const { data } = useLiveData<{ session: SessionMeta; total: number; shown: number; items: NewsRow[] }>("/api/news?limit=40");
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const items = data?.items ?? null;

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
          <span className="font-semibold">{items?.length ?? 0}</span> {tt(T.headlinesShown, lang)}
        </p>
      </div>

      {/* source chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        {["جريدة البورصة", "أموال الغد"].map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs text-muted-foreground">
            <Newspaper className="h-3 w-3" />
            {s}
          </span>
        ))}
        <span className="text-[11px] text-muted-foreground">{tt(T.liveNote, lang)}</span>
      </div>

      {!items ? (
        <div className="space-y-3">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-32" />)}</div>
      ) : (
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
        </div>
      )}
    </div>
  );
}
