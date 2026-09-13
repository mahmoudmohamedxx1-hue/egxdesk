"use client";

/** Paper-trading view (T27 — P2-3): a virtual EGP 100k account that buys and
 *  sells at the SAME delayed quotes every other number in the app uses.
 *  Positions recompute live P&L from the quote table; every ticket carries
 *  the 0.25% (min 5 EGP) commission; the trade log keeps realized P&L.
 *  State lives on the device (no account). The one thing it cannot simulate
 *  — order-book execution, queue position, partial fills — is labeled. */

import { useEffect, useMemo, useState } from "react";
import { useApp } from "../market/app-context";
import { useLiveData } from "../market/use-live-data";
import type { CompanyRow, SessionMeta } from "../market/types";
import { T, tt, dn } from "@/lib/i18n";
import { fmtNum, fmtValue, fmtInt, directionClass } from "@/lib/format";
import { ChangeCell } from "../market/change-cell";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NotebookPen, Plus, TrendingDown, TrendingUp, Trash2, RotateCcw, Wallet, Receipt } from "lucide-react";
import {
  loadBook,
  saveBook,
  clearBook,
  emptyBook,
  buy,
  sell,
  tradeFee,
  tradeErrText,
  PAPER_START_CASH,
  type PaperBook,
} from "@/lib/paper";
import { downloadCsv } from "@/lib/export";

export function PaperView() {
  const { lang, navigate, toast } = useApp();
  const { data } = useLiveData<{ session: SessionMeta; total: number; rows: CompanyRow[] }>("/api/companies");

  const [book, setBook] = useState<PaperBook | null>(null);
  useEffect(() => {
    // SSR-safe device restore; first visit starts a fresh 100k account
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBook(loadBook() ?? emptyBook());
  }, []);

  const persist = (next: PaperBook) => {
    setBook(next);
    saveBook(next);
  };

  // order ticket state
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [q, setQ] = useState("");
  const [shares, setShares] = useState("");
  const [err, setErr] = useState("");

  const suggestions = useMemo(() => {
    if (!data || q.trim().length < 1) return [];
    const needle = q.trim().toLowerCase();
    const ar = /[\u0600-\u06FF]/.test(needle);
    return data.rows
      .filter((r) => {
        if (r.ticker.toLowerCase().startsWith(needle)) return true;
        if (!ar && r.name.toLowerCase().includes(needle)) return true;
        if (ar && (r.nameAr ?? "").includes(q.trim())) return true;
        return false;
      })
      .slice(0, 7);
  }, [data, q]);

  const byTicker = useMemo(() => new Map((data?.rows ?? []).map((r) => [r.ticker, r] as const)), [data]);
  const picked = q.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const pickedRow = picked ? byTicker.get(picked) ?? null : null;
  const price = pickedRow?.close ?? null;

  // joined positions + aggregates
  const joined = useMemo(() => {
    if (!book) return null;
    const rows = book.positions.map((p) => {
      const r = byTicker.get(p.ticker) ?? null;
      const live = r?.close ?? p.avgPrice;
      const value = p.qty * live;
      const cost = p.qty * p.avgPrice;
      return { p, r, live, value, cost, pl: value - cost, plPct: cost > 0 ? ((value - cost) / cost) * 100 : null };
    });
    const marketValue = rows.reduce((s, x) => s + x.value, 0);
    const cost = rows.reduce((s, x) => s + x.cost, 0);
    const equity = (book?.cash ?? 0) + marketValue;
    const realized = book?.trades.reduce((s, t) => s + (t.realizedPl ?? 0), 0) ?? 0;
    const unrealized = marketValue - cost;
    const totalPl = equity - (book?.startCash ?? PAPER_START_CASH);
    const fees = book?.trades.reduce((s, t) => s + (t.fee ?? 0), 0) ?? 0;
    return { rows, marketValue, cost, equity, realized, unrealized, totalPl, fees };
  }, [book, byTicker]);

  const doTrade = () => {
    if (!book || !picked) {
      setErr(tt({ ar: "اختر رمزًا", en: "Pick a ticker" }, lang));
      return;
    }
    const qty = Number(shares);
    if (!Number.isFinite(qty) || qty < 1) {
      setErr(tradeErrText("badQty", lang));
      return;
    }
    if (price == null) {
      setErr(tradeErrText("badPrice", lang));
      return;
    }
    const res = side === "buy" ? buy(book, picked, qty, price) : sell(book, picked, qty, price);
    if (!res.ok) {
      setErr(tradeErrText(res.reason, lang));
      return;
    }
    persist(res.book);
    setErr("");
    setShares("");
    toast(
      lang === "ar"
        ? `${side === "buy" ? "شراء" : "بيع"} ${qty} ${picked} @ ${fmtNum(price)} جنيه`
        : `${side === "buy" ? "Bought" : "Sold"} ${qty} ${picked} @ ${fmtNum(price)} EGP`,
    );
  };

  if (!book || !joined) {
    return <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}</div>;
  }

  const equityPct = book.startCash > 0 ? (joined.totalPl / book.startCash) * 100 : null;
  const previewQty = Number(shares);
  const previewGross = Number.isFinite(previewQty) && previewQty > 0 && price != null ? previewQty * price : null;
  const previewFee = previewGross != null ? tradeFee(previewGross) : null;
  const previewTotal = previewGross != null && previewFee != null ? side === "buy" ? previewGross + previewFee : previewGross - previewFee : null;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <NotebookPen className="h-5 w-5 text-primary" />
          {tt({ ar: "التداول التجريبي", en: "Paper Trading" }, lang)}
        </h1>
        <p className="num text-xs text-muted-foreground">
          {tt({ ar: "محفظة افتراضية", en: "Virtual account" }, lang)} · {fmtValue(book.startCash)} EGP ·{" "}
          {tt({ ar: "بدأ", en: "started" }, lang)} {new Date(book.startedAt).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB")}
        </p>
      </div>
      <p className="text-sm text-muted-foreground max-w-3xl leading-relaxed">
        {tt(
          {
            ar: "درّب نفسك بمال افتراضي على نفس الأسعار المتداولة في الموقع (مؤجلة ~١٥ دقيقة) بعمولة واقعية ٠٫٢٥٪ (بحد أدنى ٥ جنيهات). كل شيء يُحفظ على جهازك فقط — ما لا يحاكيه هذا النظام هو التنفيذ نفسه (ترتيب في قائمة الأوامر وتنفيذ جزئي)، لأنه لا دفتر أوامر حقيقي هنا.",
            en: "Practice with virtual money on the same delayed (~15 min) quotes the whole site uses, with a realistic 0.25% commission (5 EGP minimum). Everything is stored on your device only — the one thing this cannot simulate is execution itself (queue position, partial fills), because there is no real order book here.",
          },
          lang,
        )}
      </p>

      {/* summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {[
          {
            label: tt({ ar: "القيمة الإجمالية", en: "Total equity" }, lang),
            value: `${fmtValue(joined.equity)} EGP`,
            sub: equityPct != null ? `${equityPct >= 0 ? "+" : ""}${equityPct.toFixed(2)}%` : undefined,
            cls: (equityPct ?? 0) >= 0 ? "text-up" : "text-down",
            icon: Wallet,
          },
          { label: tt({ ar: "النقد", en: "Cash" }, lang), value: `${fmtValue(book.cash)} EGP`, icon: Wallet },
          { label: tt({ ar: "قيمة المراكز", en: "Positions value" }, lang), value: `${fmtValue(joined.marketValue)} EGP`, icon: TrendingUp },
          {
            label: tt({ ar: "أرباح غير محققة", en: "Unrealized P&L" }, lang),
            value: `${joined.unrealized >= 0 ? "+" : ""}${fmtValue(joined.unrealized)}`,
            cls: joined.unrealized >= 0 ? "text-up" : "text-down",
            icon: joined.unrealized >= 0 ? TrendingUp : TrendingDown,
          },
          {
            label: tt({ ar: "أرباح محققة", en: "Realized P&L" }, lang),
            value: `${joined.realized >= 0 ? "+" : ""}${fmtValue(joined.realized)}`,
            cls: joined.realized >= 0 ? "text-up" : "text-down",
            icon: Receipt,
          },
          { label: tt({ ar: "إجمالي العمولات", en: "Total commissions" }, lang), value: `${fmtValue(joined.fees)} EGP`, icon: Receipt },
        ].map((c, i) => (
          <div key={i} className="rounded-lg border bg-card p-2.5">
            <p className="text-[10px] text-muted-foreground flex items-center gap-1">
              <c.icon className="h-3 w-3" aria-hidden />
              {c.label}
            </p>
            <p className={`num text-sm font-bold mt-1 ${c.cls ?? ""}`}>{c.value}</p>
            {c.sub && <p className={`num text-[10px] ${c.cls ?? ""}`}>{c.sub}</p>}
          </div>
        ))}
      </div>

      <div className="lg:grid lg:grid-cols-[minmax(0,380px)_1fr] lg:items-start lg:gap-4 space-y-4 lg:space-y-0">
        {/* order ticket */}
        <div className="rounded-lg border bg-card p-3 space-y-2.5">
          <p className="text-xs font-semibold">{tt({ ar: "أمر تداول تجريبي", en: "Paper order ticket" }, lang)}</p>
          <div className="flex gap-1.5">
            <button
              onClick={() => {
                setSide("buy");
                setErr("");
              }}
              aria-pressed={side === "buy"}
              className={`flex-1 rounded-md border py-1.5 text-xs font-semibold transition-colors ${
                side === "buy" ? "bg-up-soft border-up/40 text-up" : "text-muted-foreground hover:bg-accent/50"
              }`}
            >
              {tt({ ar: "شراء", en: "Buy" }, lang)}
            </button>
            <button
              onClick={() => {
                setSide("sell");
                setErr("");
              }}
              aria-pressed={side === "sell"}
              className={`flex-1 rounded-md border py-1.5 text-xs font-semibold transition-colors ${
                side === "sell" ? "bg-down-soft border-down/40 text-down" : "text-muted-foreground hover:bg-accent/50"
              }`}
            >
              {tt({ ar: "بيع", en: "Sell" }, lang)}
            </button>
          </div>

          <div className="relative">
            <Input
              dir="ltr"
              value={q}
              onChange={(e) => setQ(e.target.value.toUpperCase())}
              placeholder={tt(T.colTicker, lang)}
              aria-label={tt(T.portfolioTicker, lang)}
              className="h-9 text-xs num"
            />
            {suggestions.length > 0 && (
              <ul className="absolute z-20 mt-1 w-full rounded-md border bg-card shadow-md overflow-hidden" role="listbox">
                {suggestions.map((r) => (
                  <li key={r.ticker}>
                    <button
                      className="w-full text-start px-2 py-1.5 text-[11px] hover:bg-accent/50 flex items-baseline justify-between gap-2"
                      onClick={() => setQ(r.ticker)}
                    >
                      <span className="num font-bold">{r.ticker}</span>
                      <span className="text-muted-foreground truncate">{dn(r, lang)}</span>
                      <span className="num text-muted-foreground shrink-0">{fmtNum(r.close)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Input
              dir="ltr"
              inputMode="numeric"
              value={shares}
              onChange={(e) => setShares(e.target.value)}
              placeholder={tt({ ar: "الكمية (أسهم)", en: "Quantity (shares)" }, lang)}
              aria-label={tt({ ar: "الكمية", en: "Quantity" }, lang)}
              className="h-9 text-xs num w-32"
            />
            {price != null && (
              <div className="text-[11px] text-muted-foreground num leading-snug">
                @ {fmtNum(price)} EGP
                <br />
                {pickedRow && <ChangeCell pct={pickedRow.changePct} />}
              </div>
            )}
          </div>

          {previewTotal != null && (
            <p className="num text-[10px] text-muted-foreground">
              {side === "buy"
                ? tt({ ar: "التكلفة شاملة العمولة", en: "Total cost incl. fee" }, lang)
                : tt({ ar: "الصافي بعد العمولة", en: "Net proceeds after fee" }, lang)}
              : {fmtValue(previewTotal)} EGP{" "}
              {previewFee != null && `(${tt({ ar: "عمولة", en: "fee" }, lang)} ${fmtNum(previewFee, 2)})`}
            </p>
          )}
          {err && <p className="text-[11px] text-down">{err}</p>}

          <div className="flex gap-1.5">
            <Button size="sm" className={`flex-1 gap-1 ${side === "buy" ? "" : "bg-down hover:bg-down/90"}`} onClick={doTrade}>
              <Plus className="h-3.5 w-3.5" />
              {side === "buy" ? tt({ ar: "تنفيذ شراء تجريبي", en: "Execute paper buy" }, lang) : tt({ ar: "تنفيذ بيع تجريبي", en: "Execute paper sell" }, lang)}
            </Button>
            <Button
              variant="outline"
              size="sm"
              title={tt({ ar: "إعادة تعيين الحساب التجريبي", en: "Reset the paper account" }, lang)}
              onClick={() => {
                if (typeof window !== "undefined" && !window.confirm(lang === "ar" ? "إعادة تعيين الحساب التجريبي بالكامل؟" : "Reset the whole paper account?")) return;
                clearBook();
                const fresh = emptyBook();
                setBook(fresh);
                saveBook(fresh);
                toast(tt({ ar: "أُعيد تعيين الحساب التجريبي", en: "Paper account reset" }, lang));
              }}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* positions */}
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="px-4 py-2.5 border-b flex items-center justify-between flex-wrap gap-2">
            <p className="font-semibold text-sm">
              {tt({ ar: "المراكز المفتوحة", en: "Open positions" }, lang)}{" "}
              <span className="num text-[10px] text-muted-foreground">({book.positions.length})</span>
            </p>
            <p className="num text-[10px] text-muted-foreground">
              {tt({ ar: "متوسط التكلفة شامل العمولة", en: "Avg cost incl. commission" }, lang)}
            </p>
          </div>
          {joined.rows.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              {tt({ ar: "لا مراكز بعد — نفّذ أول أمر تجريبي", en: "No positions yet — execute your first paper order" }, lang)}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground text-[10px]">
                    <th className="text-start px-3 py-2 font-medium">{tt(T.colTicker, lang)}</th>
                    <th className="text-end px-3 py-2 font-medium">{tt({ ar: "الكمية", en: "Qty" }, lang)}</th>
                    <th className="text-end px-3 py-2 font-medium">{tt({ ar: "متوسط التكلفة", en: "Avg cost" }, lang)}</th>
                    <th className="text-end px-3 py-2 font-medium">{tt({ ar: "آخر سعر", en: "Last" }, lang)}</th>
                    <th className="text-end px-3 py-2 font-medium">{tt({ ar: "القيمة", en: "Value" }, lang)}</th>
                    <th className="text-end px-3 py-2 font-medium">{tt({ ar: "ربح/خسارة", en: "P&L" }, lang)}</th>
                    <th className="text-end px-3 py-2 font-medium">{tt({ ar: "٪", en: "%" }, lang)}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {joined.rows.map(({ p, r, live, value, pl, plPct }) => (
                    <tr key={p.id} className="hover:bg-accent/30">
                      <td className="px-3 py-2">
                        <button
                          className="num font-bold hover:text-primary"
                          onClick={() => navigate("company", { ticker: p.ticker, panel: "overview" })}
                        >
                          {p.ticker}
                        </button>
                      </td>
                      <td className="num text-end px-3 py-2">{fmtInt(p.qty)}</td>
                      <td className="num text-end px-3 py-2">{fmtNum(p.avgPrice)}</td>
                      <td className="num text-end px-3 py-2">
                        {fmtNum(live)}
                        {r && <ChangeCell pct={r.changePct} />}
                      </td>
                      <td className="num text-end px-3 py-2">{fmtValue(value)}</td>
                      <td className={`num text-end px-3 py-2 font-semibold ${directionClass(pl)}`}>
                        {pl >= 0 ? "+" : ""}
                        {fmtValue(pl)}
                      </td>
                      <td className={`num text-end px-3 py-2 ${directionClass(pl)}`}>{plPct != null ? `${plPct >= 0 ? "+" : ""}${plPct.toFixed(1)}%` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* trade log */}
      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="px-4 py-2.5 border-b flex items-center justify-between flex-wrap gap-2">
          <p className="font-semibold text-sm flex items-center gap-1.5">
            <Receipt className="h-3.5 w-3.5 text-primary" />
            {tt({ ar: "سجل الصفقات", en: "Trade log" }, lang)}{" "}
            <span className="num text-[10px] text-muted-foreground">({book.trades.length})</span>
          </p>
          {book.trades.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[11px]"
              onClick={() => {
                downloadCsv(
                  "egx-paper-trades",
                  ["date", "ticker", "side", "qty", "price", "fee", "realizedPl"],
                  book.trades.map((t) => [t.at, t.ticker, t.side, t.qty, t.price, t.fee, t.realizedPl ?? ""]),
                );
              }}
            >
              {tt({ ar: "تصدير CSV", en: "Export CSV" }, lang)}
            </Button>
          )}
        </div>
        {book.trades.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">{tt({ ar: "لا صفقات بعد", en: "No trades yet" }, lang)}</p>
        ) : (
          <div className="max-h-72 overflow-auto thin-scroll">
            <div className="divide-y">
              {[...book.trades].reverse().map((t) => (
                <div key={t.id} className="px-4 py-2 flex items-center gap-2.5 text-xs hover:bg-accent/30">
                  <span className="num text-[10px] text-muted-foreground shrink-0 w-32" title={t.at}>
                    {new Date(t.at).toLocaleString(lang === "ar" ? "ar-EG" : "en-GB", { dateStyle: "short", timeStyle: "short" })}
                  </span>
                  <span
                    className={`num text-[10px] px-1.5 py-0.5 rounded-full font-semibold shrink-0 ${
                      t.side === "buy" ? "bg-up-soft text-up" : "bg-down-soft text-down"
                    }`}
                  >
                    {t.side === "buy" ? tt({ ar: "شراء", en: "BUY" }, lang) : tt({ ar: "بيع", en: "SELL" }, lang)}
                  </span>
                  <button
                    className="num font-bold hover:text-primary shrink-0"
                    onClick={() => navigate("company", { ticker: t.ticker, panel: "overview" })}
                  >
                    {t.ticker}
                  </button>
                  <span className="num text-muted-foreground shrink-0">
                    {fmtInt(t.qty)} @ {fmtNum(t.price)}
                  </span>
                  <span className="num text-[10px] text-muted-foreground shrink-0">
                    {tt({ ar: "عمولة", en: "fee" }, lang)} {fmtNum(t.fee, 2)}
                  </span>
                  <span className="flex-1" />
                  {t.realizedPl != null && (
                    <span className={`num text-[11px] font-semibold shrink-0 ${directionClass(t.realizedPl)}`}>
                      {t.realizedPl >= 0 ? "+" : ""}
                      {fmtValue(t.realizedPl)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground leading-relaxed">
        {tt(T.priceChartNote, lang)} ·{" "}
        {tt(
          {
            ar: "التنفيذ بأحدث سعر معروض مؤجل ~١٥ دقيقة، بعمولة ٠٫٢٥٪ (بحد أدنى ٥ جنيهات) — بدون دفتر أوامر أو انزلاق سعري.",
            en: "Execution happens at the latest displayed delayed (~15 min) quote with a 0.25% commission (5 EGP minimum) — no order book, no slippage.",
          },
          lang,
        )}
      </p>
    </div>
  );
}
