"use client";

import { useApp } from "../market/app-context";
import { useLiveData } from "../market/use-live-data";
import type { IndexRow, SessionMeta } from "../market/types";
import { T, tt } from "@/lib/i18n";
import { fmtNum, fmtPct, fmtValue, directionClass } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ArrowUpRight, ArrowDownRight, RefreshCw, Coins, Globe2 } from "lucide-react";

type FxRate = {
  code: string;
  nameAr: string;
  nameEn: string;
  egpPer: number | null;
  usdPer: number | null;
};

type EconomyData = {
  fx: FxRate[];
  gold: {
    usdPerOunce: number | null;
    egpPerGram: number | null;
    egpPerGram21: number | null;
    asOf: string | null;
  };
  fxUpdatedAt: string | null;
  sources: { name: string; url: string; role: string }[];
  fxNote: { ar: string; en: string };
  goldNote: { ar: string; en: string };
};

type OverviewLite = {
  session: SessionMeta;
  indices: IndexRow[];
  totals: { valueTraded: number; volume: number; marketCap: number };
};

export function ExchangeView() {
  const { lang, navigate } = useApp();
  const { data, error, refresh } = useLiveData<EconomyData>("/api/economy", 600_000);
  const { data: mkt } = useLiveData<OverviewLite>("/api/overview", 60_000);

  if (error && !data) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center space-y-3">
        <p className="font-medium">{tt(T.errorLoad, lang)}</p>
        <Button size="sm" onClick={refresh}>
          <RefreshCw className="h-3.5 w-3.5 me-1.5" />
          {tt(T.retry, lang)}
        </Button>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-72" />
        <div className="grid gap-3 sm:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}</div>
        <Skeleton className="h-40" />
        <Skeleton className="h-56" />
      </div>
    );
  }

  const usd = data.fx.find((f) => f.code === "USD");

  return (
    <div className="space-y-6">
      {/* heading */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold tracking-tight">{tt(T.exchangeTitle, lang)}</h1>
        <Button variant="ghost" size="sm" onClick={refresh} aria-label="refresh">
          <RefreshCw className="h-3.5 w-3.5" />
          <span className="text-xs ms-1">{tt(T.updated, lang)}</span>
        </Button>
      </div>
      <p className="text-xs text-muted-foreground -mt-4">{tt(T.exchangeNote, lang)}</p>

      {/* indices + traded value */}
      {mkt && (
        <section aria-label="indices" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {mkt.indices.map((ix) => (
            <div key={ix.code} className="rounded-lg border bg-card p-4">
              <p className="text-sm text-muted-foreground">{ix.name}</p>
              <p className="num text-2xl font-bold tracking-tight">{fmtNum(ix.close, 1)}</p>
              <p className={`num text-sm font-medium ${directionClass(ix.changePct)} flex items-center gap-1`}>
                {ix.changePct >= 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                {fmtNum(ix.changeAbs, 1)} ({fmtPct(ix.changePct)})
              </p>
            </div>
          ))}
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">{tt(T.sessionTradedValue, lang)}</p>
            <p className="num text-2xl font-bold tracking-tight">EGP {fmtValue(mkt.totals.valueTraded)}</p>
            <p className="num text-[11px] text-muted-foreground">{mkt.session.lastSession} · {tt(T.delayed, lang)}</p>
          </div>
        </section>
      )}

      {/* gold */}
      <section aria-label="gold" className="rounded-lg border bg-card p-4">
        <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Coins className="h-4 w-4 text-primary" />
            {tt(T.goldTitle, lang)}
          </h2>
          {data.gold.asOf && (
            <span className="num text-[11px] text-muted-foreground">
              {new Date(data.gold.asOf).toLocaleString(lang === "ar" ? "ar-EG" : "en-GB", { dateStyle: "medium", timeStyle: "short" })}
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <GoldStat label={tt(T.goldPerGram21, lang)} value={data.gold.egpPerGram21} unit={lang === "ar" ? "ج.م" : "EGP"} highlight />
          <GoldStat label={tt(T.goldPerGram24, lang)} value={data.gold.egpPerGram} unit={lang === "ar" ? "ج.م" : "EGP"} />
          <GoldStat label={tt(T.goldUsdOunce, lang)} value={data.gold.usdPerOunce} unit="$" />
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">{tt(data.goldNote, lang)}</p>
      </section>

      {/* FX table */}
      <section aria-label="fx rates" className="rounded-lg border bg-card overflow-hidden">
        <div className="border-b px-4 py-3 flex items-baseline justify-between flex-wrap gap-2">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Globe2 className="h-4 w-4 text-primary" />
            {tt(T.exchangeRates, lang)}
          </h2>
          <span className="num text-[11px] text-muted-foreground">
            USD/EGP {usd?.egpPer ? fmtNum(usd.egpPer, 3) : "—"}
            {data.fxUpdatedAt ? ` · ${data.fxUpdatedAt}` : ""}
          </span>
        </div>
        <div className="overflow-x-auto thin-scroll">
          <table className="w-full text-sm">
            <thead className="border-b bg-card">
              <tr className="text-[11px] text-muted-foreground">
                <th className="text-start font-medium px-4 py-2">{tt(T.fxColCurrency, lang)}</th>
                <th className="text-end font-medium px-4 py-2">{tt(T.fxColEgp, lang)}</th>
                <th className="text-end font-medium px-4 py-2 hidden sm:table-cell">USD</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.fx.map((f) => (
                <tr key={f.code} className="hover:bg-accent/30 transition-colors">
                  <td className="px-4 py-2.5">
                    <span className="num font-bold">{f.code}</span>
                    <span className="ms-2 text-xs text-muted-foreground">{lang === "ar" ? f.nameAr : f.nameEn}</span>
                  </td>
                  <td className="num px-4 py-2.5 text-end font-medium">
                    {f.egpPer !== null ? fmtNum(f.egpPer, f.egpPer < 10 ? 3 : 2) : "—"}
                  </td>
                  <td className="num px-4 py-2.5 text-end hidden sm:table-cell text-muted-foreground">
                    {f.usdPer !== null ? fmtNum(f.usdPer, f.usdPer < 10 ? 3 : 2) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-2.5 text-[11px] text-muted-foreground border-t">{tt(data.fxNote, lang)}</p>
      </section>

      {/* sources */}
      <section aria-label="economy sources" className="rounded-lg border bg-card p-4">
        <h2 className="font-bold mb-2">{tt(T.econSources, lang)}</h2>
        <ul className="space-y-1.5">
          {data.sources.map((s) => (
            <li key={s.url} className="text-xs text-muted-foreground">
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                {s.name}
              </a>{" "}
              — {s.role}
            </li>
          ))}
        </ul>
      </section>

      <button onClick={() => navigate("investors")} className="text-sm text-primary hover:underline">
        {tt(T.seeInvestorFlows, lang)}
      </button>
    </div>
  );
}

function GoldStat({ label, value, unit, highlight }: { label: string; value: number | null; unit: string; highlight?: boolean }) {
  return (
    <div className={`rounded-md p-3 ${highlight ? "bg-secondary/70" : "bg-secondary/40"}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="num text-xl font-bold tracking-tight">
        {value !== null ? fmtNum(value, value < 1000 ? 2 : 0) : "—"}
        <span className="text-xs font-normal text-muted-foreground ms-1">{unit}</span>
      </p>
    </div>
  );
}
