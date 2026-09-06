"use client";

import { useEffect, useRef, useState } from "react";
import { useApp } from "./app-context";
import { T, tt } from "@/lib/i18n";
import { fmtNum, fmtPct, directionClass } from "@/lib/format";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type Result = {
  ticker: string;
  name: string;
  sectorAr: string;
  sectorEn: string;
  close: number;
  changePct: number;
};

export function SearchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { lang, navigate } = useApp();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function go(ticker: string) {
    onOpenChange(false);
    setQ("");
    navigate("company", { ticker, panel: "overview" });
  }

  function openScreener() {
    onOpenChange(false);
    setQ("");
    navigate("screener");
  }

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setResults(data.results ?? []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" dir={lang === "ar" ? "rtl" : "ltr"} aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">{tt(T.searchCompany, lang)}</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          dir="ltr"
          placeholder={lang === "ar" ? "الرمز أو الاسم…" : "Ticker or name…"}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="num"
        />
        <div className="max-h-80 overflow-y-auto thin-scroll divide-y rounded-md border" role="listbox">
          {loading && <p className="px-3 py-6 text-center text-sm text-muted-foreground">…</p>}
          {!loading && q && results.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {lang === "ar" ? "لا نتائج" : "No results"}
            </p>
          )}
          {results.map((r) => (
            <button
              key={r.ticker}
              role="option"
              aria-selected={false}
              onClick={() => go(r.ticker)}
              className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-start hover:bg-accent/50 transition-colors"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="num text-sm font-semibold">{r.ticker}</span>
                  <span className="truncate text-xs text-muted-foreground">{lang === "ar" ? r.sectorAr : r.sectorEn}</span>
                </div>
                <p className="truncate text-sm">{r.name}</p>
              </div>
              <div className="text-end shrink-0">
                <div className="num text-sm font-medium">{fmtNum(r.close)}</div>
                <div className={`num text-xs ${directionClass(r.changePct)}`}>{fmtPct(r.changePct)}</div>
              </div>
            </button>
          ))}
        </div>
        <button
          onClick={openScreener}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors text-start"
        >
          {tt(T.openScreener, lang)}
        </button>
      </DialogContent>
    </Dialog>
  );
}
