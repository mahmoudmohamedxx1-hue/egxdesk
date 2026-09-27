"use client";

import { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { useApp } from "../market/app-context";
import { T, tt } from "@/lib/i18n";
import { fmtNum, fmtPct, fmtInt, fmtValue, directionClass } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { PiggyBank, Landmark, LineChart, ShieldAlert } from "lucide-react";

/** T26 — Funds & income instruments view: the "certificate alternative"
 *  shelf for the Egyptian saver. Everything here is either LIVE from our own
 *  data (listed closed-end funds quotes, EGX 30 level/performance/history,
 *  CBE policy rate, gold, FX) or a clearly-dated verified snapshot (the
 *  EGX30 ETF price — no free feed serves its tape). Fund-family names are
 *  reference entries only, never priced — honesty over theater. */

type FundsData = {
  etf: {
    snapshot: { price: number; date: string; source: string };
    underlying: {
      code: string;
      nameAr: string;
      nameEn: string;
      close: number;
      changePct: number;
      perfYTD: number | null;
      perf1Y: number | null;
      perf6M: number | null;
      perf1M: number | null;
    } | null;
    history: { date: string; close: number }[];
  };
  listedFunds: {
    ticker: string;
    name: string;
    close: number;
    changePct: number;
    volume: number;
    valueTraded: number;
  }[];
  families: { nameEn: string; nameAr: string }[];
  saver: {
    policy: { value: number; reference: string } | null;
    interbank: { value: number; reference: string } | null;
    gold21: number | null;
    usd: number | null;
    egx30Ytd: number | null;
    egx301Y: number | null;
  };
  error?: string;
};

export function FundsView() {
  const { lang, navigate } = useApp();
  const [data, setData] = useState<FundsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/funds", { cache: "no-store" });
        const json = (await res.json()) as FundsData;
        if (!res.ok || json.error) throw new Error(json.error ?? `funds ${res.status}`);
        if (!cancelled) {
          setData(json);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "funds unavailable");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {tt(T.errorLoad, lang)} {error ? `— ${error}` : ""}
      </p>
    );
  }

  const u = data.etf.underlying;

  return (
    <div className="space-y-5">
      {/* header */}
      <section className="rounded-lg border bg-card p-4 sm:p-5">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <PiggyBank className="h-5 w-5 text-primary" />
          {tt(T.fundsViewTitle, lang)}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground max-w-3xl leading-relaxed">{tt(T.fundsViewNote, lang)}</p>
      </section>

      {/* EGX30 ETF card */}
      <section className="rounded-lg border bg-card p-4 sm:p-5">
        <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
          <h2 className="text-lg font-bold">{tt(T.fundsEtfTitle, lang)}</h2>
          {u && (
            <span className="num text-[11px] text-muted-foreground">
              {tt(T.fundsUnderlying, lang)}: {fmtNum(u.close, 1)}{" "}
              <span className={directionClass(u.changePct)}>({fmtPct(u.changePct)})</span>
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground max-w-3xl leading-relaxed mb-4">{tt(T.fundsEtfDesc, lang)}</p>

        <div className="grid gap-4 lg:grid-cols-[20rem_1fr] items-start">
          {/* snapshot + underlying stats */}
          <div className="space-y-3">
            <div className="rounded-lg border bg-secondary/40 p-3">
              <p className="text-[10px] text-muted-foreground leading-tight">{tt(T.fundsVerifiedPrice, lang)}</p>
              <p className="num text-2xl font-bold">{fmtNum(data.etf.snapshot.price)} <span className="text-xs font-normal text-muted-foreground">EGP</span></p>
              <p className="num text-[10px] text-muted-foreground">
                {data.etf.snapshot.date} · {data.etf.snapshot.source}
              </p>
            </div>
            {u && (
              <div className="rounded-lg border bg-secondary/40 p-3 space-y-1.5 text-[11px]">
                <p className="font-semibold text-foreground/80">{tt(T.fundsUnderlying, lang)}</p>
                {(
                  [
                    [T.ytd, u.perfYTD],
                    [T.period6M, u.perf6M],
                    [T.period1M, u.perf1M],
                    [T.period1Y, u.perf1Y],
                  ] as [typeof T.ytd, number | null][]
                ).map(([key, v]) => (
                  <p key={key.en} className="num text-muted-foreground flex justify-between">
                    <span>{tt(key, lang)}</span>
                    <b className={v != null ? directionClass(v) : ""}>{v != null ? fmtPct(v) : "—"}</b>
                  </p>
                ))}
                <p className="text-[10px] text-muted-foreground pt-1 leading-relaxed">{tt(T.fundsPerfNote, lang)}</p>
              </div>
            )}
          </div>

          {/* underlying index history */}
          {data.etf.history.length > 3 && (
            <div>
              <div className="h-56" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data.etf.history} margin={{ top: 8, right: 8, bottom: 0, left: -6 }}>
                    <defs>
                      <linearGradient id="funds-egx30" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--c1)" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="var(--c1)" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                      tickLine={false}
                      axisLine={{ stroke: "var(--border)" }}
                      minTickGap={48}
                      tickFormatter={(d: string) => d.slice(2)}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                      tickLine={false}
                      axisLine={false}
                      width={56}
                      domain={["auto", "auto"]}
                      tickFormatter={(v: number) => fmtNum(v, 0)}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "var(--popover)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        fontSize: 12,
                        color: "var(--popover-foreground)",
                      }}
                      labelStyle={{ color: "var(--muted-foreground)" }}
                      formatter={(value: number) => [fmtNum(value, 1), lang === "ar" ? "إيجي إكس ٣٠" : "EGX 30"]}
                    />
                    <Area
                      type="monotone"
                      dataKey="close"
                      stroke="var(--c1)"
                      strokeWidth={2}
                      fill="url(#funds-egx30)"
                      isAnimationActive={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed mt-1">
                {tt(T.priceChartNote, lang)} · {data.etf.history[0].date} → {data.etf.history[data.etf.history.length - 1].date}
              </p>
            </div>
          )}
        </div>
      </section>

      {/* listed closed-end funds — live */}
      {data.listedFunds.length > 0 && (
        <section className="rounded-lg border bg-card p-4 sm:p-5">
          <div className="flex items-baseline justify-between mb-1 flex-wrap gap-2">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <LineChart className="h-4 w-4 text-primary" />
              {tt(T.fundsListedTitle, lang)}
            </h2>
            <span className="num text-[11px] text-muted-foreground">{data.listedFunds.length}</span>
          </div>
          <p className="text-xs text-muted-foreground mb-3">{tt(T.fundsListedNote, lang)}</p>
          <div className="overflow-x-auto thin-scroll">
            <table className="w-full text-sm min-w-[520px]">
              <thead className="border-b">
                <tr className="text-[11px] text-muted-foreground">
                  <th className="text-start font-medium px-3 py-2">{tt(T.colTicker, lang)}</th>
                  <th className="text-start font-medium px-3 py-2">{tt(T.colName, lang)}</th>
                  <th className="text-end font-medium px-3 py-2">{tt(T.techColValue, lang)}</th>
                  <th className="text-end font-medium px-3 py-2">{tt(T.colChange, lang)}</th>
                  <th className="text-end font-medium px-3 py-2 hidden sm:table-cell">{tt(T.colVolumeShort, lang)}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.listedFunds.map((f) => (
                  <tr
                    key={f.ticker}
                    className="hover:bg-accent/30 transition-colors cursor-pointer"
                    onClick={() => navigate("company", { ticker: f.ticker })}
                  >
                    <td className="num px-3 py-2 font-semibold">{f.ticker}</td>
                    <td className="px-3 py-2">{f.name}</td>
                    <td className="num px-3 py-2 text-end font-medium">{fmtNum(f.close)}</td>
                    <td className={`num px-3 py-2 text-end ${directionClass(f.changePct)}`}>{fmtPct(f.changePct)}</td>
                    <td className="num px-3 py-2 text-end text-muted-foreground hidden sm:table-cell">{fmtValue(f.valueTraded)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* the saver's table */}
      <section className="rounded-lg border bg-card p-4 sm:p-5">
        <div className="flex items-baseline justify-between mb-1 flex-wrap gap-2">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Landmark className="h-4 w-4 text-primary" />
            {tt(T.fundsSaverTitle, lang)}
          </h2>
        </div>
        <p className="text-xs text-muted-foreground mb-3">{tt(T.fundsSaverNote, lang)}</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {(
            [
              [T.fundsSaverPolicy, data.saver.policy ? `${fmtNum(data.saver.policy.value, 2)}%` : "—", data.saver.policy?.reference ?? null],
              [T.fundsSaverInterbank, data.saver.interbank ? `${fmtNum(data.saver.interbank.value, 2)}%` : "—", data.saver.interbank?.reference ?? null],
              [T.fundsSaverEgxYtd, data.saver.egx30Ytd != null ? fmtPct(data.saver.egx30Ytd) : "—", null],
              [T.fundsSaverEgx1y, data.saver.egx301Y != null ? fmtPct(data.saver.egx301Y) : "—", null],
              [T.fundsSaverGold, data.saver.gold21 != null ? fmtNum(data.saver.gold21, 0) : "—", "EGP"],
              [T.fundsSaverUsd, data.saver.usd != null ? fmtNum(data.saver.usd, 2) : "—", "EGP"],
            ] as [typeof T.fundsSaverPolicy, string, string | null][]
          ).map(([key, value, note]) => (
            <div key={key.en} className="rounded-md bg-secondary/40 p-2.5">
              <p className="text-[10px] text-muted-foreground leading-tight">{tt(key, lang)}</p>
              <p className="num text-base font-bold">{value}</p>
              {note && <p className="num text-[10px] text-muted-foreground">{note}</p>}
            </div>
          ))}
        </div>
      </section>

      {/* families reference + honesty note */}
      <section className="rounded-lg border bg-card p-4 sm:p-5">
        <h2 className="text-lg font-bold mb-3">{lang === "ar" ? "أبرز مديري صناديق الدخل في مصر (مرجع)" : "Egypt's leading income-fund managers (reference)"}</h2>
        <div className="flex flex-wrap gap-2">
          {data.families.map((f) => (
            <span key={f.nameEn} className="rounded-full border bg-secondary/40 px-3 py-1 text-xs">
              {lang === "ar" ? f.nameAr : f.nameEn}
            </span>
          ))}
        </div>
        <div className="mt-4 flex gap-2.5 rounded-md bg-secondary/40 p-3">
          <ShieldAlert className="h-4 w-4 text-primary shrink-0 mt-0.5" aria-hidden />
          <p className="text-xs text-muted-foreground leading-relaxed">{tt(T.fundsNoLiveNav, lang)}</p>
        </div>
      </section>
    </div>
  );
}
