"use client";

import { useEffect, useRef, useState } from "react";
import { useApp } from "./app-context";
import { T, tt, dn } from "@/lib/i18n";
import { fmtNum, fmtPct, directionClass } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { Search, X, SlidersHorizontal } from "lucide-react";

/**
 * Inline header search — the field lives INSIDE the header row: the icon
 * button expands in place into a text input (animated width), and results
 * drop down anchored to the field. No modal, no overlay, the page stays
 * exactly where it is. Closes on Escape, outside click, selection, or the
 * clear button. "/" opens it from anywhere.
 */

type Result = {
  ticker: string;
  name: string;
  nameAr?: string | null;
  sectorAr: string;
  sectorEn: string;
  close: number;
  changePct: number;
};

export function HeaderSearch() {
  const { lang, navigate } = useApp();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // reset the keyboard cursor whenever the result set changes
  useEffect(() => {
    setActiveIdx(0);
  }, [results]);

  // "/" opens the field from anywhere on the page
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing = target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
      if (e.key === "/" && !typing && !open) {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // outside click closes
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrap.current && !wrap.current.contains(e.target as Node)) {
        setOpen(false);
        setQ("");
        setResults([]);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim() || !open) {
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
    }, 200);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q, open]);

  function close() {
    setOpen(false);
    setQ("");
    setResults([]);
    setActiveIdx(0);
  }

  function go(ticker: string) {
    close();
    navigate("company", { ticker, panel: "overview" });
  }

  /** Investing.com-style keyboard nav: ↑/↓ move, Enter opens, Esc closes. */
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (results.length === 0) return;
      e.preventDefault();
      setActiveIdx((i) => {
        const next = e.key === "ArrowDown" ? i + 1 : i - 1;
        return (next + results.length) % results.length;
      });
      requestAnimationFrame(() => {
        document.getElementById(`hs-opt-${activeIdxRef.current}`)?.scrollIntoView({ block: "nearest" });
      });
      return;
    }
    if (e.key === "Enter") {
      const target = results[activeIdxRef.current] ?? results[0];
      if (target) {
        e.preventDefault();
        go(target.ticker);
      }
    }
  }

  // keeps the latest cursor index accessible inside onKeyDown without
  // stale-closure re-binding on every keystroke
  const activeIdxRef = useRef(0);
  activeIdxRef.current = activeIdx;

  const showPanel = open && (q.trim().length > 0 || loading);

  return (
    <div ref={wrap} className="relative flex items-center">
      {/* expanding field — lives in the header flex row itself */}
      <div
        className={`flex items-center transition-[width] duration-300 ease-out ${
          open ? "w-44 sm:w-60 md:w-72" : "w-9"
        }`}
      >
        {open ? (
          <div className="relative w-full">
            <Input
              ref={inputRef}
              autoFocus
              dir="auto"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={lang === "ar" ? "الرمز أو الاسم…" : "Ticker or name…"}
              className="h-8 pe-7 ps-8 text-xs"
              aria-label={tt(T.searchCompany, lang)}
              role="combobox"
              aria-expanded={showPanel}
              aria-controls="header-search-listbox"
              aria-activedescendant={results[activeIdx] ? `hs-opt-${activeIdx}` : undefined}
            />
            <Search className="absolute start-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            {q && (
              <button
                onClick={close}
                aria-label={lang === "ar" ? "إغلاق البحث" : "Close search"}
                className="absolute end-1.5 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ) : (
          <button
            onClick={() => {
              setOpen(true);
              requestAnimationFrame(() => inputRef.current?.focus());
            }}
            aria-label={tt(T.searchCompany, lang)}
            title={`${tt(T.searchCompany, lang)}  ·  /`}
            className="flex h-8 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Search className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* results dropdown — anchored to the field, never a modal */}
      {showPanel && (
        <div
          dir={lang === "ar" ? "rtl" : "ltr"}
          className="absolute top-full z-50 mt-2 end-0 w-72 sm:w-80 rounded-lg border bg-popover shadow-lg overflow-hidden"
          role="listbox"
          id="header-search-listbox"
          aria-label={tt(T.searchCompany, lang)}
        >
          <div className="max-h-80 overflow-y-auto thin-scroll divide-y">
            {loading && (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">…</p>
            )}
            {!loading && q && results.length === 0 && (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                {lang === "ar" ? "لا نتائج" : "No results"}
              </p>
            )}
            {results.map((r, i) => (
              <button
                key={r.ticker}
                id={`hs-opt-${i}`}
                role="option"
                aria-selected={i === activeIdx}
                onClick={() => go(r.ticker)}
                onMouseEnter={() => setActiveIdx(i)}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-start transition-colors ${
                  i === activeIdx ? "bg-accent/70" : "hover:bg-accent/50"
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="num text-xs font-semibold">{r.ticker}</span>
                    <span className="truncate text-[10px] text-muted-foreground">
                      {lang === "ar" ? r.sectorAr : r.sectorEn}
                    </span>
                  </div>
                  <p className="truncate text-xs">{dn(r, lang)}</p>
                </div>
                <div className="text-end shrink-0">
                  <div className="num text-xs font-medium">{fmtNum(r.close)}</div>
                  <div className={`num text-[10px] ${directionClass(r.changePct)}`}>{fmtPct(r.changePct)}</div>
                </div>
              </button>
            ))}
          </div>
          <button
            onClick={() => {
              close();
              navigate("screener");
            }}
            className="flex w-full items-center gap-2 border-t bg-secondary/40 px-3 py-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors text-start"
          >
            <SlidersHorizontal className="h-3 w-3 shrink-0" />
            {tt(T.openScreener, lang)}
          </button>
        </div>
      )}
    </div>
  );
}
