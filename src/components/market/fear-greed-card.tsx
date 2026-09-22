"use client";

import { useEffect, useState } from "react";
import { useApp } from "./app-context";
import { tt, T } from "@/lib/i18n";

/** T57 — مؤشر الخوف والطمع (Fear & Greed), foudalens-parity.
 *  A compact gauge on the overview, fed by /api/fear-greed: a transparent
 *  composite of four REAL components (breadth, EGX30 momentum, 52-week
 *  position, foreign flows) whose weights and raw values are shown right
 *  on the card — no black box. */

type FG = {
  ok: boolean;
  score: number;
  bucket: string;
  asOf: string;
  components: { key: string; weight: number; raw: number | null; score: number | null; missing: boolean }[];
};

const BUCKETS: Record<string, { ar: string; en: string; color: string }> = {
  "extreme-fear": { ar: "خوف شديد", en: "Extreme fear", color: "oklch(0.55 0.2 25)" },
  fear: { ar: "خوف", en: "Fear", color: "oklch(0.62 0.16 40)" },
  neutral: { ar: "حياد", en: "Neutral", color: "oklch(0.7 0.09 85)" },
  greed: { ar: "طمع", en: "Greed", color: "oklch(0.68 0.14 140)" },
  "extreme-greed": { ar: "طمع شديد", en: "Extreme greed", color: "oklch(0.6 0.18 150)" },
};

const COMP_LABELS: Record<string, { ar: string; en: string }> = {
  breadth: { ar: "اتساع السوق", en: "Breadth" },
  momentum: { ar: "زخم EGX30 (شهر)", en: "EGX30 1M momentum" },
  range52: { ar: "مدى ٥٢ أسبوعًا", en: "52-week position" },
  foreign: { ar: "تدفقات الأجانب", en: "Foreign flows" },
};

export function FearGreedCard() {
  const { lang } = useApp();
  const [d, setD] = useState<FG | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/fear-greed", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: FG) => alive && j.ok && setD(j))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!d) return null;
  const bucket = BUCKETS[d.bucket] ?? BUCKETS.neutral;

  return (
    <section aria-label={tt({ ar: "مؤشر الخوف والطمع", en: "Fear & Greed index" }, lang)} className="rounded-lg border bg-card p-4">
      <div className="flex items-baseline justify-between mb-2 flex-wrap gap-1">
        <h2 className="text-lg font-bold">{tt({ ar: "مؤشر الخوف والطمع", en: "Fear & Greed index" }, lang)}</h2>
        <p className="text-[10px] text-muted-foreground">{tt(T.compositeNote, lang)}</p>
      </div>
      <div className="flex items-center gap-4 flex-wrap">
        {/* score dial */}
        <div className="flex flex-col items-center shrink-0">
          <div
            className="size-20 rounded-full border-4 flex items-center justify-center"
            style={{ borderColor: bucket.color, boxShadow: `inset 0 0 12px ${bucket.color.replace("oklch(", "oklch(").replace(")", " / 0.25)")}` }}
          >
            <span className="num text-2xl font-bold" style={{ color: bucket.color }}>
              {d.score}
            </span>
          </div>
          <p className="text-sm font-semibold mt-1" style={{ color: bucket.color }}>
            {tt(bucket, lang)}
          </p>
        </div>
        {/* the 0-100 bar */}
        <div className="flex-1 min-w-[240px] space-y-2">
          <div className="relative h-3 rounded-full overflow-hidden" style={{ background: "linear-gradient(90deg, oklch(0.55 0.2 25), oklch(0.7 0.09 85), oklch(0.6 0.18 150))" }}>
            <div className="absolute top-0 bottom-0 w-[3px] bg-foreground rounded-full" style={{ insetInlineStart: `${d.score}%` }} />
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>{lang === "ar" ? "خوف شديد" : "0 · extreme fear"}</span>
            <span>{lang === "ar" ? "حياد" : "50 · neutral"}</span>
            <span>{lang === "ar" ? "طمع شديد" : "100 · extreme greed"}</span>
          </div>
          {/* components */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            {d.components.map((c) => (
              <span key={c.key} className="inline-flex items-center gap-1">
                <span className="inline-block size-1.5 rounded-full" style={{ background: c.missing ? "var(--muted-foreground)" : `oklch(${0.45 + (c.score ?? 0) / 220} 0.12 ${(c.score ?? 50) > 50 ? 150 : 25})` }} />
                {tt(COMP_LABELS[c.key] ?? { ar: c.key, en: c.key }, lang)}
                <span className="num">{c.missing ? "—" : c.score}</span>
                <span className="opacity-60 num">({Math.round(c.weight * 100)}%)</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
