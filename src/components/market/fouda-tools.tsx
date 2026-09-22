"use client";

import { useEffect, useMemo, useState } from "react";
import { useApp } from "../market/app-context";
import { dn } from "@/lib/i18n";

/** T58 — FoudaLens Tier-1 calculators (pure math on data we already hold):
 *   1. FairValueLab — four classic valuation methods side by side with live
 *      assumption sliders (Graham number, P/E×sector median, P/B×sector
 *      median, Gordon DDM).
 *   2. ZakatCalc — stock zakat (2.5775% of market value after a hawl).
 *   3. DcaCalc — dollar-cost averaging into one EGX stock over N months on
 *      REAL daily closes from the app's own chart API.
 *   4. CertificateYieldCalc — bank savings-certificate maturity math (gross
 *      and net of the standard 20% withholding tax).
 *  Educational framing throughout — never a recommendation. */

type Row = {
  ticker: string;
  name: string;
  nameAr: string;
  sectorEn: string;
  sectorAr: string;
  close: number | null;
  pe: number | null;
  pb: number | null;
  eps: number | null;
  divYield: number | null;
  payoutRatio: number | null;
  marketCap: number | null;
};

const fmt2 = (v: number | null | undefined) =>
  typeof v === "number" && Number.isFinite(v) ? v.toLocaleString("en-GB", { maximumFractionDigits: 2, minimumFractionDigits: 2 }) : "—";
const fmt1 = (v: number | null | undefined) =>
  typeof v === "number" && Number.isFinite(v) ? v.toLocaleString("en-GB", { maximumFractionDigits: 1 }) : "—";
const fmtPct = (v: number | null | undefined) =>
  typeof v === "number" && Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(1)}%` : "—";

function median(nums: number[]): number | null {
  const v = nums.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
}

// ── 1. Fair Value Lab ───────────────────────────────────────────────────────

export function FairValueLab() {
  const { lang } = useApp();
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [ticker, setTicker] = useState("COMI");
  const [g, setG] = useState(4); // Gordon growth %
  const [r, setR] = useState(11); // discount rate %
  useEffect(() => {
    fetch("/api/companies", { cache: "no-store" })
      .then((r2) => r2.json())
      .then((j) => setRows(j.companies ?? j.rows ?? []))
      .catch(() => {});
  }, []);
  const ar = lang === "ar";
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return rows
      .filter((c) => c.ticker.toLowerCase().includes(needle) || c.nameAr.includes(q.trim()) || (c.name ?? "").toLowerCase().includes(needle))
      .slice(0, 8);
  }, [q, rows]);
  const c = rows.find((x) => x.ticker === ticker) ?? null;

  const sectorRows = useMemo(() => rows.filter((x) => x.sectorEn === c?.sectorEn), [rows, c]);
  const medPe = useMemo(() => median(sectorRows.map((x) => x.pe).filter((v): v is number => v != null)), [sectorRows]);
  const medPb = useMemo(() => median(sectorRows.map((x) => x.pb).filter((v): v is number => v != null)), [sectorRows]);

  const methods = useMemo(() => {
    if (!c) return [];
    const bvps = c.pb && c.pb > 0 && c.close ? c.close / c.pb : null;
    const dps = c.divYield && c.close ? (c.divYield / 100) * c.close : null;
    const out: { name: string; nameAr: string; value: number | null; note: string; noteAr: string }[] = [];
    if (c.eps != null && bvps != null)
      out.push({
        name: "Graham number",
        nameAr: "رقم جراهام",
        value: Math.sqrt(22.5 * Math.max(0, c.eps) * Math.max(0, bvps)),
        note: "√(22.5 × EPS × BVPS)",
        noteAr: "√(22.5 × ربح السهم × قيمة السهم الدفترية)",
      });
    if (medPe != null && c.eps != null)
      out.push({
        name: "P/E × sector median",
        nameAr: "مضاعف القطاع × ربح السهم",
        value: medPe * c.eps,
        note: `sector median P/E ${fmt1(medPe)} × EPS ${fmt2(c.eps)}`,
        noteAr: `وسيط مضاعف القطاع ${fmt1(medPe)} × ربح السهم ${fmt2(c.eps)}`,
      });
    if (medPb != null && bvps != null)
      out.push({
        name: "P/B × sector median",
        nameAr: "مضاعف القطاع × القيمة الدفترية",
        value: medPb * bvps,
        note: `sector median P/B ${fmt1(medPb)} × BVPS ${fmt2(bvps)}`,
        noteAr: `وسيط مضاعف القطاع ${fmt1(medPb)} × القيمة الدفترية ${fmt2(bvps)}`,
      });
    if (dps != null)
      out.push({
        name: "Gordon DDM",
        nameAr: "نموذج جوردون للتوزيعات",
        value: r > g ? (dps * (1 + g / 100)) / ((r - g) / 100) : null,
        note: `D₀ ${fmt2(dps)} · g ${g}% · r ${r}%`,
        noteAr: `توزيع السهم ${fmt2(dps)} · نمو ${g}% · خصم ${r}%`,
      });
    return out;
  }, [c, medPe, medPb, g, r]);

  const fairVals = methods.map((m) => m.value).filter((v): v is number => v != null && Number.isFinite(v) && v > 0);
  const avgFair = fairVals.length ? fairVals.reduce((a, b) => a + b, 0) / fairVals.length : null;
  const upside = avgFair && c?.close ? ((avgFair - c.close) / c.close) * 100 : null;

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <h2 className="font-bold">{ar ? "مختبر القيمة العادلة" : "Fair Value Lab"}</h2>
        <span className="text-[11px] text-muted-foreground">{ar ? "٤ طرق كلاسيكية جنبًا إلى جنب — لأغراض تعليمية" : "four classic methods side by side — educational"}</span>
      </div>
      <div className="relative mb-3 max-w-xs">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={ar ? "اختر سهمًا (ابحث بالاسم أو الرمز)…" : "pick a stock (name or ticker)…"}
          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
        {q && (
          <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-lg max-h-56 overflow-auto">
            {matches.map((m) => (
              <button
                key={m.ticker}
                className="block w-full text-start px-2 py-1.5 text-sm hover:bg-accent"
                onClick={() => {
                  setTicker(m.ticker);
                  setQ("");
                }}
              >
                <b>{m.ticker}</b> · {dn(m, lang)}
              </button>
            ))}
            {!matches.length && <p className="px-2 py-2 text-xs text-muted-foreground">{ar ? "لا نتائج" : "no matches"}</p>}
          </div>
        )}
      </div>
      {c ? (
        <>
          <p className="text-xs text-muted-foreground mb-3">
            {c.ticker} · {dn(c, lang)} · {ar ? c.sectorAr : c.sectorEn} — {ar ? "السعر الحالي" : "current price"} <b className="num">{fmt2(c.close)}</b> EGP
          </p>
          <div className="grid gap-3 sm:grid-cols-2 mb-3">
            <label className="text-xs">
              {ar ? `نمو التوزيعات (g): ${g}%` : `dividend growth (g): ${g}%`}
              <input type="range" min={0} max={10} step={0.5} value={g} onChange={(e) => setG(Number(e.target.value))} className="w-full accent-primary" />
            </label>
            <label className="text-xs">
              {ar ? `معدل الخصم (r): ${r}%` : `discount rate (r): ${r}%`}
              <input type="range" min={6} max={20} step={0.5} value={r} onChange={(e) => setR(Number(e.target.value))} className="w-full accent-primary" />
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b">
                  <th className="text-start py-1.5 pe-2">{ar ? "الطريقة" : "Method"}</th>
                  <th className="text-end py-1.5 px-2">{ar ? "القيمة العادلة" : "Fair value"}</th>
                  <th className="text-end py-1.5 px-2">{ar ? "فرق السعر" : "vs price"}</th>
                  <th className="text-start py-1.5 ps-2">{ar ? "الأساس" : "Basis"}</th>
                </tr>
              </thead>
              <tbody>
                {methods.map((m) => {
                  const diff = m.value && c.close ? ((m.value - c.close) / c.close) * 100 : null;
                  return (
                    <tr key={m.name} className="border-b last:border-0">
                      <td className="py-1.5 pe-2 font-medium">{ar ? m.nameAr : m.name}</td>
                      <td className="num text-end py-1.5 px-2 font-semibold">{m.value != null ? fmt2(m.value) : "—"}</td>
                      <td className={`num text-end py-1.5 px-2 ${diff == null ? "" : diff >= 0 ? "text-green-500" : "text-red-500"}`}>{fmtPct(diff)}</td>
                      <td className="text-xs text-muted-foreground py-1.5 ps-2">{ar ? m.noteAr : m.note}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {avgFair != null && (
            <p className="mt-2 text-sm">
              {ar ? "متوسط الطرق المتاحة" : "average of available methods"}: <b className="num">{fmt2(avgFair)}</b> EGP{" "}
              <span className={upside == null ? "" : upside >= 0 ? "text-green-500" : "text-red-500"}>({fmtPct(upside)} {ar ? "عن السعر الحالي" : "vs current"})</span>
            </p>
          )}
          <p className="mt-1 text-[10px] text-muted-foreground leading-relaxed">
            {ar
              ? "نماذج تعليمية تقليدية على بيانات مؤجلة — ليست توصية شراء أو بيع، والقيمة الدفترية مشتقة من مضاعف القيمة الدفترية المنشور."
              : "Traditional educational models on delayed data — not a buy/sell recommendation; book value is derived from the published P/B multiple."}
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{ar ? "جارٍ التحميل…" : "loading…"}</p>
      )}
    </section>
  );
}

// ── 2. Zakat calculator ─────────────────────────────────────────────────────

export function ZakatCalc() {
  const { lang } = useApp();
  const ar = lang === "ar";
  const [amount, setAmount] = useState("");
  const [ticker, setTicker] = useState("");
  const [shares, setShares] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    fetch("/api/companies", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setRows(j.companies ?? j.rows ?? []))
      .catch(() => {});
  }, []);
  const picked = rows.find((x) => x.ticker.toUpperCase() === ticker.trim().toUpperCase());
  const marketValue = picked && Number(shares) > 0 && picked.close ? Number(shares) * picked.close : Number(amount) > 0 ? Number(amount) : null;
  const ZAKAT_RATE = 0.025775;
  const zakat = marketValue != null ? marketValue * ZAKAT_RATE : null;

  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="font-bold mb-1">{ar ? "حاسبة زكاة الأسهم" : "Stock zakat calculator"}</h2>
      <p className="text-xs text-muted-foreground mb-3">
        {ar ? "زكاة النقد وأوراقه المالية بعد حول هجري كامل: ٢.٥٧٧٥٪ من القيمة السوقية." : "Zakat on cash and securities after a full lunar year: 2.5775% of market value."}
      </p>
      <div className="grid gap-2 sm:grid-cols-2 mb-3">
        <label className="text-xs">
          {ar ? "القيمة السوقية للمحفظة (جنيه)" : "portfolio market value (EGP)"}
          <input
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value.replace(/[^\d.]/g, ""));
              setTicker("");
              setShares("");
            }}
            inputMode="decimal"
            placeholder="100000"
            className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm num outline-none focus:ring-1 focus:ring-ring"
          />
        </label>
        <div className="text-xs text-muted-foreground">{ar ? "أو احسب من الأسهم:" : "or compute from holdings:"}</div>
        <label className="text-xs">
          {ar ? "الرمز" : "ticker"}
          <input
            value={ticker}
            onChange={(e) => {
              setTicker(e.target.value.toUpperCase().slice(0, 6));
              setAmount("");
            }}
            placeholder="COMI"
            className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm num outline-none focus:ring-1 focus:ring-ring"
          />
        </label>
        <label className="text-xs">
          {ar ? "عدد الأسهم" : "shares"}
          <input
            value={shares}
            onChange={(e) => {
              setShares(e.target.value.replace(/[^\d]/g, ""));
              setAmount("");
            }}
            inputMode="numeric"
            placeholder="1000"
            className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm num outline-none focus:ring-1 focus:ring-ring"
          />
        </label>
      </div>
      {picked && Number(shares) > 0 && picked.close && (
        <p className="text-xs text-muted-foreground mb-2">
          {picked.ticker} × {Number(shares).toLocaleString("en-GB")} {ar ? "سهم" : "shares"} @ {fmt2(picked.close)} EGP ={" "}
          <b className="num">{(Number(shares) * (picked.close ?? 0)).toLocaleString("en-GB")}</b> EGP
        </p>
      )}
      {zakat != null ? (
        <p className="rounded-lg bg-primary/10 border border-primary/25 px-3 py-2 text-sm">
          {ar ? "الزكاة الواجبة" : "zakat due"}: <b className="num">{zakat.toLocaleString("en-GB", { maximumFractionDigits: 2 })}</b> EGP{" "}
          <span className="text-xs text-muted-foreground">
            ({ar ? "عن محفظة بقيمة" : "on a portfolio of"} {marketValue?.toLocaleString("en-GB")} EGP)
          </span>
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">{ar ? "أدخل قيمة المحفظة أو أسهمك." : "enter a value or your holdings."}</p>
      )}
    </section>
  );
}

// ── 3. DCA calculator (real closes from the chart API) ──────────────────────

type ChartPoint = { date: string; close: number };

export function DcaCalc() {
  const { lang } = useApp();
  const ar = lang === "ar";
  const [ticker, setTicker] = useState("COMI");
  const [monthly, setMonthly] = useState("1000");
  const [months, setMonths] = useState(24);
  const [pts, setPts] = useState<ChartPoint[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPts(null);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setErr(null);
    fetch(`/api/chart?symbol=${encodeURIComponent(ticker)}&range=5Y`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setPts(j.points ?? j.closes ?? null))
      .catch(() => setErr("chart unavailable"));
  }, [ticker]);

  const result = useMemo(() => {
    if (!pts || pts.length < 10) return null;
    const m = Math.max(1, Math.min(60, months));
    const byMonth = new Map<string, ChartPoint>();
    for (const p of pts) {
      const key = p.date.slice(0, 7); // "YYYY-MM"
      if (!byMonth.has(key)) byMonth.set(key, p); // first close of the month
    }
    const monthlyKeys = [...byMonth.keys()].sort().slice(-m);
    const invest = Number(monthly) || 0;
    if (!invest) return null;
    let sharesTotal = 0;
    let invested = 0;
    for (const k of monthlyKeys) {
      const p = byMonth.get(k)!;
      sharesTotal += invest / p.close;
      invested += invest;
    }
    const last = pts[pts.length - 1];
    const value = sharesTotal * last.close;
    return {
      months: monthlyKeys.length,
      invested,
      shares: sharesTotal,
      value,
      pnl: value - invested,
      pnlPct: invested > 0 ? ((value - invested) / invested) * 100 : 0,
      first: monthlyKeys[0],
      lastClose: last.close,
    };
  }, [pts, months, monthly]);

  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="font-bold mb-1">{ar ? "حاسبة الاستثمار الدوري (DCA)" : "DCA calculator"}</h2>
      <p className="text-xs text-muted-foreground mb-3">
        {ar ? "مبلغ ثابت شهريًا في سهم واحد، على أسعار الإغلاق الفعلية." : "a fixed monthly amount into one stock, at actual closes."}
      </p>
      <div className="grid gap-2 sm:grid-cols-3 mb-3">
        <label className="text-xs">
          {ar ? "الرمز" : "ticker"}
          <input
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase().slice(0, 6))}
            className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm num outline-none focus:ring-1 focus:ring-ring"
          />
        </label>
        <label className="text-xs">
          {ar ? "المبلغ الشهري (جنيه)" : "monthly amount (EGP)"}
          <input
            value={monthly}
            onChange={(e) => setMonthly(e.target.value.replace(/[^\d.]/g, ""))}
            inputMode="decimal"
            className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm num outline-none focus:ring-1 focus:ring-ring"
          />
        </label>
        <label className="text-xs">
          {ar ? `عدد الأشهر: ${months}` : `months: ${months}`}
          <input type="range" min={6} max={60} step={6} value={months} onChange={(e) => setMonths(Number(e.target.value))} className="mt-3 w-full accent-primary" />
        </label>
      </div>
      {err && <p className="text-xs text-red-500">{err}</p>}
      {result ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
          <div className="rounded-lg border bg-background/60 px-2.5 py-2">
            <p className="text-[10px] text-muted-foreground">{ar ? "المستثمر إجمالًا" : "total invested"}</p>
            <p className="num font-semibold">{result.invested.toLocaleString("en-GB")} EGP</p>
          </div>
          <div className="rounded-lg border bg-background/60 px-2.5 py-2">
            <p className="text-[10px] text-muted-foreground">{ar ? "عدد الأسهم" : "shares bought"}</p>
            <p className="num font-semibold">{result.shares.toFixed(2)}</p>
          </div>
          <div className="rounded-lg border bg-background/60 px-2.5 py-2">
            <p className="text-[10px] text-muted-foreground">{ar ? "القيمة الآن" : "value now"}</p>
            <p className="num font-semibold">{result.value.toLocaleString("en-GB", { maximumFractionDigits: 0 })} EGP</p>
          </div>
          <div className={`rounded-lg border px-2.5 py-2 ${result.pnl >= 0 ? "bg-green-500/10 border-green-500/25" : "bg-red-500/10 border-red-500/25"}`}>
            <p className="text-[10px] text-muted-foreground">{ar ? "الربح/الخسارة" : "P/L"}</p>
            <p className="num font-semibold">
              {result.pnl >= 0 ? "+" : ""}
              {result.pnl.toLocaleString("en-GB", { maximumFractionDigits: 0 })} EGP ({fmtPct(result.pnlPct)})
            </p>
          </div>
          <p className="col-span-2 sm:col-span-4 text-[10px] text-muted-foreground">
            {ar
              ? `استثمار أول الشهر لأول إغلاق كل شهر على مدى ${result.months} شهرًا، والقيمة بآخر إغلاق (${fmt2(result.lastClose)} EGP) — بيانات مؤجلة وليست توصية.`
              : `buys at the first close of each month over ${result.months} months, valued at the latest close (${fmt2(result.lastClose)} EGP) — delayed data, not advice.`}
          </p>
        </div>
      ) : (
        !err && <p className="text-sm text-muted-foreground">{ar ? "جارٍ تحميل الأسعار…" : "loading prices…"}</p>
      )}
    </section>
  );
}

// ── 4. Certificate yield calculator ─────────────────────────────────────────

export function CertificateYieldCalc() {
  const { lang } = useApp();
  const ar = lang === "ar";
  const [principal, setPrincipal] = useState("100000");
  const [rate, setRate] = useState(20);
  const [years, setYears] = useState(3);
  const [monthlyPayout, setMonthlyPayout] = useState(true);

  const p = Number(principal) || 0;
  const monthlyInterest = (p * (rate / 100)) / 12;
  const totalMonths = years * 12;
  const grossTotal = monthlyPayout ? p + monthlyInterest * totalMonths : p * Math.pow(1 + rate / 100, years);
  const taxRate = 0.2; // standard Egyptian withholding on certificate interest
  const interestGross = grossTotal - p;
  const netTotal = p + interestGross * (1 - taxRate);

  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="font-bold mb-1">{ar ? "حاسبة عائد الشهادات" : "Certificate yield calculator"}</h2>
      <p className="text-xs text-muted-foreground mb-3">
        {ar ? "شهادات الادخار البنكية — صافي العائد بعد ضريبة الدخل (٢٠٪)." : "bank savings certificates — net yield after the 20% income-tax withholding."}
      </p>
      <div className="grid gap-2 sm:grid-cols-3 mb-3">
        <label className="text-xs">
          {ar ? "المبلغ (جنيه)" : "principal (EGP)"}
          <input
            value={principal}
            onChange={(e) => setPrincipal(e.target.value.replace(/[^\d.]/g, ""))}
            inputMode="decimal"
            className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm num outline-none focus:ring-1 focus:ring-ring"
          />
        </label>
        <label className="text-xs">
          {ar ? `العائد السنوي: ${rate}%` : `annual rate: ${rate}%`}
          <input type="range" min={5} max={30} step={0.25} value={rate} onChange={(e) => setRate(Number(e.target.value))} className="mt-3 w-full accent-primary" />
        </label>
        <label className="text-xs">
          {ar ? `المدة: ${years} ${years === 1 ? "سنة" : "سنوات"}` : `term: ${years} ${years === 1 ? "year" : "years"}`}
          <input type="range" min={1} max={10} step={1} value={years} onChange={(e) => setYears(Number(e.target.value))} className="mt-3 w-full accent-primary" />
        </label>
      </div>
      <div className="flex items-center gap-2 text-xs mb-3">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={monthlyPayout} onChange={(e) => setMonthlyPayout(e.target.checked)} className="accent-primary" />
          {ar ? "عائد شهري (بدل تراكمي)" : "monthly payout (vs cumulative)"}
        </label>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
        <div className="rounded-lg border bg-background/60 px-2.5 py-2">
          <p className="text-[10px] text-muted-foreground">{ar ? "العائد الشهري" : "monthly interest"}</p>
          <p className="num font-semibold">{monthlyInterest.toLocaleString("en-GB", { maximumFractionDigits: 0 })} EGP</p>
        </div>
        <div className="rounded-lg border bg-background/60 px-2.5 py-2">
          <p className="text-[10px] text-muted-foreground">{ar ? "إجمالي العائد (قبل الضريبة)" : "gross interest"}</p>
          <p className="num font-semibold">{interestGross.toLocaleString("en-GB", { maximumFractionDigits: 0 })} EGP</p>
        </div>
        <div className="rounded-lg border bg-background/60 px-2.5 py-2">
          <p className="text-[10px] text-muted-foreground">{ar ? "الضريبة (٢٠٪)" : "tax (20%)"}</p>
          <p className="num font-semibold">{(interestGross * taxRate).toLocaleString("en-GB", { maximumFractionDigits: 0 })} EGP</p>
        </div>
        <div className="rounded-lg border bg-primary/25 px-2.5 py-2">
          <p className="text-[10px] text-muted-foreground">{ar ? "القيمة النهائية الصافية" : "net maturity value"}</p>
          <p className="num font-semibold">{netTotal.toLocaleString("en-GB", { maximumFractionDigits: 0 })} EGP</p>
        </div>
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground leading-relaxed">
        {ar
          ? "التراكمي يفترض إعادة استثمار العائد سنويًا بنفس السعر — تقدير تعليمي، والضريبة الفعلية تُطبق عند الصرف."
          : "cumulative assumes annual reinvestment at the same rate — an educational estimate; the actual tax applies at payout."}
      </p>
    </section>
  );
}
