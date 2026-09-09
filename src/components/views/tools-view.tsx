"use client";

import { useEffect, useMemo, useState } from "react";
import { useApp } from "../market/app-context";
import { useLiveData } from "../market/use-live-data";
import { T, tt, dn } from "@/lib/i18n";
import { fmtNum, fmtPct } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { Calculator, TrendingUp, Scale, BookOpen, Landmark, PiggyBank } from "lucide-react";

type Row = { ticker: string; name: string; nameAr?: string; close: number; divYield: number | null; changePct?: number | null };

type RatesLite = {
  rows: { key: "policy" | "lending" | "interbank"; value: number; reference: string }[];
  source: string;
};

/** Listed closed-end funds & REITs we carry live quotes for (G13). */
const LISTED_FUNDS = ["EGREF"];

export function ToolsView() {
  const { lang, navigate } = useApp();
  const [companies, setCompanies] = useState<Row[]>([]);
  const [amount, setAmount] = useState<number>(100000);
  const [price, setPrice] = useState<number>(0);
  const [coupon, setCoupon] = useState<number>(0);
  const [query, setQuery] = useState("");

  // G12 — live policy rate anchors the bank row of the comparison
  const { data: rates } = useLiveData<RatesLite>("/api/rates", 300_000);
  const policyRate = rates?.rows.find((r) => r.key === "policy")?.value ?? null;

  useEffect(() => {
    fetch("/api/companies")
      .then((r) => r.json())
      .then((d) => setCompanies(d.rows ?? []))
      .catch(() => setCompanies([]));
  }, []);

  const listedFunds = useMemo(
    () => companies.filter((c) => LISTED_FUNDS.includes(c.ticker)),
    [companies]
  );

  const matches = useMemo(() => {
    if (!query.trim()) return [];
    const s = query.trim().toLowerCase();
    return companies
      .filter((c) => c.ticker.toLowerCase().includes(s) || c.name.toLowerCase().includes(s) || (c.nameAr ?? "").includes(query.trim()))
      .slice(0, 6);
  }, [query, companies]);

  function pick(c: Row) {
    setPrice(+c.close.toFixed(2));
    // derive a plausible annual coupon from yield if present
    setCoupon(c.divYield ? +(c.close * (c.divYield / 100)).toFixed(2) : 0);
    setQuery(`${c.ticker} — ${dn(c, lang)}`);
  }

  const shares = price > 0 ? Math.floor(amount / price) : 0;
  const income = shares * coupon;
  const invested = shares * price;
  const yieldOnCost = invested > 0 && coupon > 0 ? (coupon / price) * 100 : null;
  const monthly = income / 12;
  const paybackYears = income > 0 && invested > 0 ? invested / income : null;

  // comparison calculator state (hypothetical, compounded) — the bank row
  // follows the LIVE policy rate: render-phase sync whenever a new reading
  // arrives from /api/rates (official React "adjust state during render")
  const [rateStocks, setRateStocks] = useState(28);
  const [rateBank, setRateBank] = useState(23.5);
  const [rateGold, setRateGold] = useState(25);
  const [appliedPolicy, setAppliedPolicy] = useState<number | null>(null);
  if (policyRate != null && appliedPolicy !== policyRate) {
    setAppliedPolicy(policyRate);
    setRateBank(+policyRate.toFixed(1));
  }
  const comp = (ratePct: number, years: number) => amount * Math.pow(1 + ratePct / 100, years);

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
                            <span className="num font-semibold">{m.ticker}</span> · {dn(m, lang)}
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
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">{tt(T.monthlyEquivalent, lang)}</p>
                <p className="num text-lg font-bold">{monthly.toLocaleString("en-US", { maximumFractionDigits: 0 })} <span className="text-xs font-normal text-muted-foreground">EGP/mo</span></p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">{tt(T.paybackPeriod, lang)}</p>
                <p className="num text-lg font-bold">
                  {paybackYears !== null ? `${fmtNum(paybackYears, 1)} ${tt(T.yearsUnit, lang)}` : "—"}
                </p>
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

      {/* comparison calculator */}
      <section className="rounded-lg border bg-card">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Scale className="h-4 w-4 text-muted-foreground" aria-hidden />
          <h2 className="font-bold">{tt(T.comparisonTitle, lang)}</h2>
        </div>
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {([
              [tt(T.compStocks, lang), rateStocks, setRateStocks, null],
              [tt(T.compBank, lang), rateBank, setRateBank, policyRate],
              [tt(T.compGold, lang), rateGold, setRateGold, null],
            ] as const).map(([label, val, set, live]) => (
              <div key={label} className="rounded-lg border p-3 space-y-1.5">
                <p className="text-xs font-medium flex items-center gap-1.5 flex-wrap">
                  {label} · {tt(T.customRate, lang)}
                  {live != null && (
                    <span className="num text-[10px] text-primary font-semibold" title={rates?.source}>
                      {lang === "ar" ? "حقيقي من المركزي" : "live from CBE data"}: {fmtNum(live, 2)}%
                    </span>
                  )}
                </p>
                <Input
                  type="number"
                  step={0.5}
                  min={-50}
                  max={100}
                  className="num h-8"
                  value={val}
                  onChange={(e) => set(Number(e.target.value) || 0)}
                  dir="ltr"
                  aria-label={`${label} ${tt(T.customRate, lang)}`}
                />
              </div>
            ))}
          </div>
          <div className="overflow-x-auto thin-scroll">
            <table className="w-full text-sm">
              <thead className="border-b">
                <tr className="text-[11px] text-muted-foreground">
                  <th className="text-start font-medium py-2">{tt(T.stock, lang)}</th>
                  <th className="text-end font-medium px-3 py-2">{tt(T.after1y, lang)}</th>
                  <th className="text-end font-medium px-3 py-2">{tt(T.after3y, lang)}</th>
                  <th className="text-end font-medium px-3 py-2 hidden sm:table-cell">{tt(T.effectiveYield, lang)}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {([
                  [tt(T.compStocks, lang), rateStocks, "text-primary"],
                  [tt(T.compBank, lang), rateBank, ""],
                  [tt(T.compGold, lang), rateGold, ""],
                ] as const).map(([label, rate, cls]) => (
                  <tr key={label}>
                    <td className="py-2.5 font-medium">{label}</td>
                    <td className={`num px-3 py-2.5 text-end font-semibold ${cls}`}>
                      EGP {comp(rate, 1).toLocaleString("en-US", { maximumFractionDigits: 0 })}
                    </td>
                    <td className={`num px-3 py-2.5 text-end font-semibold ${cls}`}>
                      EGP {comp(rate, 3).toLocaleString("en-US", { maximumFractionDigits: 0 })}
                    </td>
                    <td className="num px-3 py-2.5 text-end hidden sm:table-cell text-muted-foreground">
                      {fmtPct(rate, false)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground">{tt(T.comparisonNote, lang)}</p>
        </div>
      </section>

      {/* G13 — funds & investment vehicles in Egypt */}
      <section className="rounded-lg border bg-card">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <PiggyBank className="h-4 w-4 text-muted-foreground" aria-hidden />
          <h2 className="font-bold">{tt(T.fundsTitle, lang)}</h2>
        </div>
        <div className="p-4 space-y-4">
          <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">{tt(T.fundsNote, lang)}</p>

          {/* listed funds with live quotes (the exchange-traded ones) */}
          <div className="rounded-lg border p-3">
            <p className="text-xs font-semibold mb-1">{tt(T.vehicleListedFunds, lang)}</p>
            <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">{tt(T.vehicleListedFundsNote, lang)}</p>
            {listedFunds.length > 0 ? (
              <div className="divide-y">
                {listedFunds.map((f) => (
                  <button
                    key={f.ticker}
                    onClick={() => navigate("company", { ticker: f.ticker, panel: "overview" })}
                    className="w-full flex items-center justify-between gap-2 py-2 hover:text-primary text-start"
                  >
                    <span className="min-w-0 truncate text-sm">
                      <span className="num font-bold">{f.ticker}</span> · {dn(f, lang)}
                    </span>
                    <span className="num shrink-0 text-sm font-semibold">{fmtNum(f.close)} EGP</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="num text-[11px] text-muted-foreground">…</p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border p-3">
              <p className="text-xs font-semibold mb-1">{tt(T.vehicleBankCerts, lang)}</p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">{tt(T.vehicleBankCertsNote, lang)}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs font-semibold mb-1">{tt(T.vehicleMutualFunds, lang)}</p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">{tt(T.vehicleMutualFundsNote, lang)}</p>
            </div>
          </div>
        </div>
      </section>

      {/* glossary */}
      <section className="rounded-lg border bg-card">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <BookOpen className="h-4 w-4 text-muted-foreground" aria-hidden />
          <h2 className="font-bold">{tt(T.glossaryTitle, lang)}</h2>
        </div>
        <dl className="p-4 divide-y">
          {GLOSSARY.map((g) => (
            <div key={g.title.en} className="py-3 first:pt-0 last:pb-0">
              <dt className="text-sm font-bold">{lang === "ar" ? g.title.ar : g.title.en}</dt>
              <dd className="mt-1 text-sm text-muted-foreground leading-relaxed">{lang === "ar" ? g.body.ar : g.body.en}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

const GLOSSARY = [
  {
    title: { ar: "مكرر الربحية (P/E)", en: "Price-to-earnings (P/E)" },
    body: {
      ar: "القيمة السوقية مقسومة على الربح: كم تدفع مقابل كل جنيه تربحه الشركة. انخفاض المضاعف قد يعني أن السعر رخص أو أن الأرباح تحسّنت، وهما حكايتان مختلفتان. لا تقرأه أبداً بمعزل عن سطر الأرباح تحته.",
      en: "Market cap divided by earnings: how much you pay for each pound the company earns. A low multiple can mean a cheap price or improved earnings — two different stories. Never read it apart from the earnings line below it.",
    },
  },
  {
    title: { ar: "مضاعف القيمة الدفترية (P/B)", en: "Price-to-book (P/B)" },
    body: {
      ar: "القيمة السوقية مقسومة على حقوق المساهمين. أقل من ١ يعني أن السوق يقيّم الشركة دون حقوق ملكيتها الدفترية — وهذا لا يكون فرصة إلا إذا كانت الأصول منتِجة. اقرأه بجوار العائد على حقوق الملكية.",
      en: "Market cap divided by shareholders' equity. Below 1 means the market values the company under its book equity — only a bargain if the assets are productive. Read it next to ROE.",
    },
  },
  {
    title: { ar: "العائد على حقوق الملكية (ROE)", en: "Return on equity (ROE)" },
    body: {
      ar: "الربح منسوباً إلى حقوق المساهمين. والعائد المرتفع ليس مبهراً بالضرورة — فالاقتراض يُصغّر حقوق الملكية فترتفع النسبة دون أن يتحسّن النشاط. اقرأه دائماً بجوار نسبة الدين إلى حقوق الملكية.",
      en: "Earnings relative to shareholders' equity. A high return isn't necessarily impressive — borrowing shrinks equity and lifts the ratio without improving the business. Always read it beside debt-to-equity.",
    },
  },
  {
    title: { ar: "جودة الأرباح والتدفق النقدي", en: "Earnings quality & cash flow" },
    body: {
      ar: "التدفق النقدي التشغيلي مقارناً بالربح المعلن. حين يصعد الربح ولا يتبعه نقد، فذلك ما يستحق البحث — والتدفق يشغّل التوزيعات، لا الربح المحاسبي.",
      en: "Operating cash flow compared to reported profit. When earnings climb without cash following, that's what deserves a look — dividends run on cash flow, not accounting profit.",
    },
  },
  {
    title: { ar: "الحجم غير المعتاد", en: "Unusual volume" },
    body: {
      ar: "حجم الجلسة مقسوماً على متوسط ١٠ جلسات. عند ٢× فأكثر يكون النشاط استثنائياً — وهو مقياس اهتمام لا إشارة شراء أو بيع.",
      en: "Session volume divided by the 10-session average. At 2× or more the activity is exceptional — an interest gauge, not a buy or sell signal.",
    },
  },
];
