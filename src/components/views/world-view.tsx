"use client";

/** T60 — المزيد → مرصد العالم (the world monitor): currencies, oil, metals
 *  and the world's indices — each move measured against its OWN two years
 *  of same-length moves (rare vs ordinary is a percentile of history), then
 *  the same measure applied to the EGX indices for comparison, plus the
 *  price-of-money block (CBE rates) — cloned from the source model's screen
 *  layout, on our own Yahoo history and rates document. */

import { useEffect, useState } from "react";
import { useApp } from "../market/app-context";
import { Skeleton } from "@/components/ui/skeleton";
import { Globe2 } from "lucide-react";

type Row = {
  id: string;
  labelAr: string;
  labelEn: string;
  group: "currency" | "commodity" | "index";
  unitAr: string;
  unitEn: string;
  level: number;
  levelEgp: number | null;
  levelDisplay: string;
  asOf: string;
  movePct: number;
  percentile: number;
  typicalPct: number;
  band: "rare" | "unusual" | "ordinary";
};

type Window = { id: string; labelAr: string; labelEn: string; sessions: number; rows: Row[] };
type Data = {
  asOf: string;
  basis: { ar: string; en: string };
  windows: Window[];
};

type RatesData = {
  rows: { key: string; value: number; previous: number | null; reference: string; meaningAr: string; meaningEn: string }[];
};

const GROUPS: { id: Row["group"]; ar: string; en: string }[] = [
  { id: "currency", ar: "العملات مقابل الجنيه", en: "Currencies vs the pound" },
  { id: "commodity", ar: "النفط والمعادن", en: "Oil & metals" },
  { id: "index", ar: "البورصات الكبرى", en: "Major indices" },
];

const BAND_LABEL = (band: Row["band"], lang: "ar" | "en") =>
  band === "rare"
    ? lang === "ar"
      ? "حركة نادرة"
      : "Rare move"
    : band === "unusual"
      ? lang === "ar"
        ? "حركة غير معتادة"
        : "Unusual move"
      : lang === "ar"
        ? "حركة عادية"
        : "Ordinary move";

export function WorldView() {
  const { lang } = useApp();
  const [win, setWin] = useState("week");
  const [data, setData] = useState<Data | null>(null);
  const [rates, setRates] = useState<RatesData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/world-monitor")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("x"))))
      .then((d: Data) => setData(d))
      .catch(() => setError(true));
    fetch("/api/rates")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("x"))))
      .then((d: RatesData) => setRates(d))
      .catch(() => {});
  }, []);

  if (error) {
    return (
      <div className="space-y-3 p-4">
        <h1 className="text-lg font-bold">{lang === "ar" ? "مرصد العالم" : "World monitor"}</h1>
        <p className="text-sm text-muted-foreground">{lang === "ar" ? "تعذّر التحميل." : "Unavailable."}</p>
      </div>
    );
  }

  const active = data?.windows.find((w) => w.id === win) ?? data?.windows[0];

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Globe2 className="h-5 w-5 text-primary" aria-hidden />
          <h1 className="text-lg font-bold">{lang === "ar" ? "مرصد العالم" : "World monitor"}</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {lang === "ar" ? "ما الذي تحرك، وأين يصل" : "What moved, and where it reaches"}
        </p>
        <p className="text-[11px] leading-relaxed text-muted-foreground">{data ? (lang === "ar" ? data.basis.ar : data.basis.en) : ""}</p>
      </div>

      {/* window tabs */}
      <div className="flex flex-wrap items-center gap-1.5">
        {(data?.windows ?? []).map((w) => (
          <button
            key={w.id}
            onClick={() => setWin(w.id)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              win === w.id ? "border-foreground/20 bg-secondary" : "border-transparent text-muted-foreground hover:bg-accent"
            }`}
          >
            {lang === "ar" ? w.labelAr : w.labelEn}
          </button>
        ))}
      </div>

      {/* price of money block (CBE rates) */}
      {rates && (
        <div className="rounded-xl border bg-card p-3">
          <h2 className="text-sm font-bold">{lang === "ar" ? "سعر المال في مصر" : "The price of money in Egypt"}</h2>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {rates.rows
              .filter((r) => ["policy", "lending", "interbank"].includes(r.key))
              .map((r) => (
                <div key={r.key} className="rounded-lg bg-secondary/50 p-2.5">
                  <p className="text-[11px] text-muted-foreground">
                    {r.key === "policy"
                      ? lang === "ar"
                        ? "سعر الإيداع لليلة واحدة"
                        : "Overnight deposit rate"
                      : r.key === "lending"
                        ? lang === "ar"
                          ? "سعر الإقراض لليلة واحدة"
                          : "Overnight lending rate"
                        : lang === "ar"
                          ? "سعر الإقراض بين البنوك"
                          : "Interbank overnight"}
                  </p>
                  <p className="mt-0.5 text-lg font-bold tabular-nums">{r.value.toFixed(r.key === "interbank" ? 3 : 2)}%</p>
                  <p className="text-[10px] text-muted-foreground">{r.reference}</p>
                </div>
              ))}
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
            {rates.rows.find((r) => r.key === "policy")?.[lang === "ar" ? "meaningAr" : "meaningEn"]}
          </p>
        </div>
      )}

      {/* asset groups */}
      {!active ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        GROUPS.map((g) => {
          const rows = active.rows.filter((r) => r.group === g.id);
          if (!rows.length) return null;
          return (
            <div key={g.id} className="rounded-xl border bg-card p-3">
              <h2 className="mb-2 text-sm font-bold">{lang === "ar" ? g.ar : g.en}</h2>
              <div className="space-y-1.5">
                {rows.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-1.5 text-xs hover:bg-accent/40">
                    <span className="w-32 shrink-0 font-semibold">{lang === "ar" ? r.labelAr : r.labelEn}</span>
                    <span className="w-24 shrink-0 tabular-nums text-muted-foreground">
                      {r.asOf} · {r.levelDisplay}
                    </span>
                    <span
                      className={`w-16 shrink-0 rounded px-1.5 py-0.5 text-center font-bold tabular-nums ${
                        r.movePct > 0
                          ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                          : r.movePct < 0
                            ? "bg-rose-500/12 text-rose-700 dark:text-rose-300"
                            : "bg-secondary text-muted-foreground"
                      }`}
                    >
                      {r.movePct >= 0 ? "+" : ""}
                      {r.movePct.toFixed(2)}%
                    </span>
                    <span
                      className={`min-w-0 flex-1 rounded px-1.5 py-0.5 text-[10px] leading-relaxed ${
                        r.band === "rare"
                          ? "bg-amber-500/12 font-semibold text-amber-700 dark:text-amber-300"
                          : r.band === "unusual"
                            ? "bg-sky-500/12 font-medium text-sky-700 dark:text-sky-300"
                            : "text-muted-foreground"
                      }`}
                    >
                      {BAND_LABEL(r.band, lang)}:{" "}
                      {lang === "ar" ? "أكبر، صعوداً أو هبوطاً، من" : "bigger, up or down, than"} {r.percentile}%{" "}
                      {lang === "ar" ? "من حركات السنتين الماضيتين؛ والمعتاد" : "of the last two years' moves; typical is"}{" "}
                      {r.typicalPct}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}

      {/* the comparison pointer */}
      {active && (
        <div className="rounded-xl border bg-card/60 p-3 text-[11px] leading-relaxed text-muted-foreground">
          {lang === "ar" ? (
            <>
              <b className="text-foreground">وهل تحركت البورصة المصرية بقدر مماثل؟</b> افتح «البورصة» في مجموعة المزيد — المؤشرات
              المحلية بالقياس نفسه مقابل تاريخها — أو شاشة «نظرة عامة» لأحدث إغلاق. المقارنة هي المقصد: أسبوع استثنائي للنفط
              وعادي هنا ليس كأسبوع استثنائي لكليهما.
            </>
          ) : (
            <>
              <b className="text-foreground">Did the Egyptian exchange move as much?</b> Open “Exchange” in the More group — the local
              indices under the same measure against their own history. The comparison is the point: an exceptional oil week and an
              ordinary one here is not the same as both exceptional.
            </>
          )}
        </div>
      )}
    </div>
  );
}
