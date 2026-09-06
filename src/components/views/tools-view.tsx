"use client";

import { useEffect, useMemo, useState } from "react";
import { useApp } from "../market/app-context";
import { T, tt } from "@/lib/i18n";
import { fmtNum, fmtPct } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { Calculator, TrendingUp } from "lucide-react";

type Row = { ticker: string; nameAr: string; nameEn: string; close: number; divYield: number | null };

export function ToolsView() {
  const { lang, auth } = useApp();
  const [companies, setCompanies] = useState<Row[]>([]);
  const [amount, setAmount] = useState<number>(100000);
  const [price, setPrice] = useState<number>(0);
  const [coupon, setCoupon] = useState<number>(0);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/api/companies")
      .then((r) => r.json())
      .then((d) => setCompanies(d.rows ?? []))
      .catch(() => setCompanies([]));
  }, [auth.email]);

  const matches = useMemo(() => {
    if (!query.trim()) return [];
    const s = query.trim().toLowerCase();
    return companies
      .filter((c) => c.ticker.toLowerCase().includes(s) || c.nameAr.includes(s) || c.nameEn.toLowerCase().includes(s))
      .slice(0, 6);
  }, [query, companies]);

  function pick(c: Row) {
    setPrice(+c.close.toFixed(2));
    // derive a plausible annual coupon from yield if present
    setCoupon(c.divYield ? +(c.close * (c.divYield / 100)).toFixed(2) : 0);
    setQuery(`${c.ticker} — ${c.nameAr}`);
  }

  const shares = price > 0 ? Math.floor(amount / price) : 0;
  const income = shares * coupon;
  const invested = shares * price;
  const yieldOnCost = invested > 0 && coupon > 0 ? (coupon / price) * 100 : null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{tt(T.toolsTitle, lang)}</h1>
        <p className="mt-1 text-sm text-muted-foreground max-w-2xl leading-relaxed">{tt(T.toolsNote, lang)}</p>
      </div>

      <section className="rounded-lg border bg-card">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Calculator className="h-4 w-4 text-muted-foreground" aria-hidden />
          <h2 className="font-bold">{tt(T.couponCalc, lang)}</h2>
        </div>

        <div className="p-4 grid gap-6 md:grid-cols-2">
          {/* inputs */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="amount" className="text-sm font-medium">{tt(T.amountInvested, lang)}</label>
              <Input id="amount" type="number" min={0} className="num" value={amount || ""} onChange={(e) => setAmount(Number(e.target.value) || 0)} dir="ltr" />
              <div className="flex gap-1.5 pt-1">
                {[50000, 100000, 250000, 500000].map((v) => (
                  <button key={v} onClick={() => setAmount(v)} className={`num rounded-md border px-2 py-1 text-xs transition-colors ${amount === v ? "bg-secondary font-semibold" : "hover:bg-accent/50"}`}>
                    {v.toLocaleString("en-US")}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5 relative">
              <label htmlFor="picker" className="text-sm font-medium">{tt(T.sharePrice, lang)}</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    id="picker"
                    className="h-9 w-full rounded-md border bg-transparent px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                    placeholder={lang === "ar" ? "املأ من شركة مقيدة…" : "Fill from a listed company…"}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  {matches.length > 0 && (
                    <div className="absolute z-20 mt-1 w-full rounded-md border bg-popover shadow-md divide-y overflow-hidden">
                      {matches.map((m) => (
                        <button key={m.ticker} onClick={() => pick(m)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-xs hover:bg-accent/50">
                          <span className="min-w-0 truncate">
                            <span className="num font-semibold">{m.ticker}</span> · {m.nameAr}
                          </span>
                          <span className="num shrink-0 text-muted-foreground">{fmtNum(m.close)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <Input type="number" min={0} step={0.01} className="num w-28" value={price || ""} onChange={(e) => setPrice(Number(e.target.value) || 0)} dir="ltr" aria-label={tt(T.sharePrice, lang)} />
              </div>
              <p className="text-[10px] text-muted-foreground">
                {lang === "ar" ? "النتائج مرتبة حسب مطابقة النص لا حسب أي مقياس." : "Matches are by text, not by any metric."}
              </p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="coupon" className="text-sm font-medium">{tt(T.annualCoupon, lang)}</label>
              <Input id="coupon" type="number" min={0} step={0.01} className="num" value={coupon || ""} onChange={(e) => setCoupon(Number(e.target.value) || 0)} dir="ltr" />
              <p className="text-[10px] text-muted-foreground">
                {lang === "ar"
                  ? "هل التوزيع مدعوم بأرباح وتدفقات قوية — أم ناتج عن هبوط السعر؟"
                  : "Is the payout backed by earnings & cash flow — or just a fallen price?"}
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">{tt(T.sharesOwned, lang)}</label>
              <p className="num h-9 rounded-md border bg-secondary/50 px-3 leading-9 text-sm">{shares.toLocaleString("en-US")}</p>
            </div>
          </div>

          {/* results */}
          <div className="space-y-3">
            <div className="rounded-lg bg-secondary/70 p-4">
              <p className="text-xs text-muted-foreground mb-1">{tt(T.couponIncome, lang)}</p>
              <p className="num text-3xl font-bold tracking-tight">
                {income.toLocaleString("en-US", { maximumFractionDigits: 0 })}{" "}
                <span className="text-sm font-medium text-muted-foreground">EGP</span>
              </p>
            </div>
            <div className="rounded-lg border p-4 flex items-center gap-3">
              <TrendingUp className="h-5 w-5 text-up" aria-hidden />
              <div>
                <p className="text-xs text-muted-foreground">{tt(T.effectiveYield, lang)}</p>
                <p className="num text-xl font-bold text-up">{yieldOnCost !== null ? fmtPct(yieldOnCost, false) : "—"}</p>
              </div>
            </div>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between border-b border-dotted pb-2">
                <dt className="text-muted-foreground">{lang === "ar" ? "المبلغ المستثمر فعلياً" : "Actually invested"}</dt>
                <dd className="num font-medium">EGP {invested.toLocaleString("en-US")}</dd>
              </div>
              <div className="flex justify-between border-b border-dotted pb-2">
                <dt className="text-muted-foreground">{lang === "ar" ? "المتبقي نقداً" : "Cash left over"}</dt>
                <dd className="num font-medium">EGP {(amount - invested).toLocaleString("en-US")}</dd>
              </div>
              <div className="flex justify-between border-b border-dotted pb-2">
                <dt className="text-muted-foreground">{lang === "ar" ? "كوبون السهم الواحد" : "Coupon per share"}</dt>
                <dd className="num font-medium">EGP {fmtNum(coupon)}</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>
    </div>
  );
}
