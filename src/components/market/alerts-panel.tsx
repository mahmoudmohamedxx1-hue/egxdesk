"use client";

/** Alerts & reminders UI (G1, upgraded T27 to multi-condition technical
 *  alerts — P1-4). The header bell + manager popover, and the reusable
 *  create form (also mounted on company pages pre-filled with the ticker).
 *  The builder stacks conditions (price / day-change / RSI / MACD / MA
 *  cross / volume surge) with AND semantics — "COMI above 90 AND RSI below
 *  30". Alerts live on the device; the app-context engine evaluates them
 *  every minute (quotes + /api/chart candles), and the server push loop
 *  mirrors the same math for closed-app notifications. */

import { useEffect, useMemo, useState } from "react";
import { useApp } from "./app-context";
import { useLiveData } from "./use-live-data";
import type { CompanyRow } from "./types";
import { T, tt, dn } from "@/lib/i18n";
import { fmtNum } from "@/lib/format";
import {
  alertText,
  requestNotifyPermission,
  todayStr,
  kindLabel,
  BUILDABLE_KINDS,
  isReminder,
  type CondKind,
  type PriceAlert,
} from "@/lib/alerts";
import { enablePush, disablePush, sendTestPush, isPushEnabled } from "@/lib/push-client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Bell, BellPlus, BellRing, CalendarClock, Check, Smartphone, Trash2, Plus, X } from "lucide-react";

/** Suggest tickers from the live table as the user types. */
function useTickerSuggestions(q: string): CompanyRow[] {
  const { data } = useLiveData<{ rows: CompanyRow[] }>("/api/companies", 5 * 60_000);
  return useMemo(() => {
    if (!data || q.trim().length < 1) return [];
    const needle = q.trim().toLowerCase();
    const ar = /[\u0600-\u06FF]/.test(needle);
    const out = data.rows.filter((r) => {
      if (r.ticker.toLowerCase().startsWith(needle)) return true;
      if (!ar && r.name.toLowerCase().includes(needle)) return true;
      if (ar && (r.nameAr ?? "").includes(q.trim())) return true;
      return false;
    });
    return out.slice(0, 7);
  }, [data, q]);
}

/** One editable condition row in the builder. */
type DraftCond = { kind: CondKind; value: string };

/** Create-alert/reminder form. `fixedTicker` (company page) locks the symbol.
 *  T27: multi-condition builder — every row is (kind, value); ALL must hold. */
export function AlertCreateForm({
  fixedTicker,
  close,
  onSaved,
}: {
  fixedTicker?: string;
  close?: number | null;
  onSaved?: () => void;
}) {
  const { lang, addAlert, toast } = useApp();
  const [ticker, setTicker] = useState(fixedTicker ?? "");
  const [rows, setRows] = useState<DraftCond[]>([{ kind: "priceAbove", value: "" }]);
  const [date, setDate] = useState("");
  const suggestions = useTickerSuggestions(fixedTicker ? "" : ticker);

  // render-phase sync (official React pattern): when the parent swaps the
  // locked ticker, reset the form without an effect
  const [prevFixed, setPrevFixed] = useState(fixedTicker);
  if (prevFixed !== fixedTicker) {
    setPrevFixed(fixedTicker);
    setTicker(fixedTicker ?? "");
  }

  const reminderOnly = rows.length === 1 && rows[0].kind === "onDate";

  const save = async () => {
    const t = (fixedTicker ?? ticker).toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!t || rows.length === 0) return;
    if (reminderOnly) {
      if (!date) return;
      addAlert(t, [{ kind: "onDate", value: 0 }], date);
    } else {
      const conds = rows
        .filter((r) => r.kind !== "onDate")
        .map((r) => ({ kind: r.kind, value: Number(r.value) }))
        .filter((c) => Number.isFinite(c.value));
      if (conds.length === 0) return;
      addAlert(t, conds);
    }
    // ask for browser notifications on first alert (grants persist)
    const perm = await requestNotifyPermission();
    if (perm === "denied") toast(tt(T.notifyBlocked, lang));
    setRows([{ kind: "priceAbove", value: "" }]);
    setDate("");
    onSaved?.();
  };

  return (
    <div className="space-y-2">
      {!fixedTicker && (
        <div className="relative">
          <input
            dir="ltr"
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            placeholder={tt(T.colTicker, lang)}
            aria-label={tt(T.portfolioTicker, lang)}
            className="h-8 w-full rounded-md border bg-card px-2 text-xs num"
          />
          {suggestions.length > 0 && (
            <ul className="absolute z-20 mt-1 w-full rounded-md border bg-card shadow-md overflow-hidden" role="listbox">
              {suggestions.map((r) => (
                <li key={r.ticker}>
                  <button
                    className="w-full text-start px-2 py-1.5 text-[11px] hover:bg-accent/50 flex items-baseline justify-between gap-2"
                    onClick={() => {
                      setTicker(r.ticker);
                      setRows((rs) => rs.map((x, i) => (i === 0 && !x.value && r.close != null ? { ...x, value: String(r.close) } : x)));
                    }}
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
      )}

      {/* condition rows — AND semantics */}
      <div className="space-y-1.5">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <select
              value={r.kind}
              onChange={(e) => {
                const kind = e.target.value as CondKind;
                setRows((rs) => rs.map((x, j) => (j === i ? { ...x, kind } : x)));
              }}
              className="h-8 flex-1 min-w-0 rounded-md border bg-card px-1 text-[11px]"
              aria-label={tt(T.alertCondAbove, lang)}
            >
              <option value={r.kind}>{kindLabel(r.kind, lang)}</option>
              {BUILDABLE_KINDS.filter((k) => k !== r.kind).map((k) => (
                <option key={k} value={k}>
                  {kindLabel(k, lang)}
                </option>
              ))}
              <option value="onDate">{kindLabel("onDate", lang)}</option>
            </select>
            {r.kind === "onDate" ? (
              <input
                dir="ltr"
                type="date"
                min={todayStr()}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                aria-label={tt(T.reminderDateLabel, lang)}
                title={tt(T.reminderDateLabel, lang)}
                className="h-8 w-32 rounded-md border bg-card px-2 text-xs num"
              />
            ) : r.kind === "maCrossUp" || r.kind === "maCrossDown" ? (
              <span className="h-8 flex items-center text-[10px] text-muted-foreground px-1 shrink-0">
                {tt({ ar: "تلقائي", en: "auto" }, lang)}
              </span>
            ) : (
              <input
                dir="ltr"
                inputMode="decimal"
                value={r.value}
                onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                placeholder={
                  r.kind === "priceAbove" || r.kind === "priceBelow"
                    ? close != null
                      ? String(close)
                      : "0.00"
                    : r.kind === "rsiAbove" || r.kind === "rsiBelow"
                      ? "30"
                      : r.kind === "volRatioAbove"
                        ? "2"
                        : r.kind === "chgAbove" || r.kind === "chgBelow"
                          ? "5"
                          : "0"
                }
                aria-label={tt(T.alertValueLabel, lang)}
                className="h-8 w-20 rounded-md border bg-card px-2 text-xs num"
              />
            )}
            {rows.length > 1 && (
              <button
                onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                aria-label={tt(T.alertRemove, lang)}
                className="text-muted-foreground hover:text-down shrink-0 h-8 w-6 flex items-center justify-center"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          className="h-8 px-2 text-[11px] gap-1"
          onClick={() => setRows((rs) => [...rs.filter((r) => r.kind !== "onDate"), { kind: "rsiBelow", value: "" }])}
          title={tt({ ar: "أضف شرطًا آخر (يجب تحقق جميع الشروط)", en: "Add another condition (ALL must hold)" }, lang)}
        >
          <Plus className="h-3 w-3" />
          {tt({ ar: "شرط", en: "Condition" }, lang)}
        </Button>
        <Button size="sm" className="h-8 px-2.5 text-[11px] gap-1 shrink-0 ms-auto" onClick={save}>
          {reminderOnly ? <CalendarClock className="h-3 w-3" /> : <BellPlus className="h-3 w-3" />}
          {tt(reminderOnly ? T.reminderSave : T.alertSave, lang)}
        </Button>
      </div>

      {rows.length > 1 && (
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          {tt({ ar: "كل الشروط يجب أن تتحقق في نفس اللحظة (و).", en: "ALL conditions must hold at the same moment (AND)." }, lang)}
        </p>
      )}
      {fixedTicker && close != null && rows.some((r) => r.kind === "priceAbove" || r.kind === "priceBelow") && (
        <p className="num text-[10px] text-muted-foreground">
          {tt(T.alertCurrentPrice, lang)}: {fmtNum(close)}
        </p>
      )}
    </div>
  );
}

function AlertRow({ a }: { a: PriceAlert }) {
  const { lang, removeAlert, navigate } = useApp();
  return (
    <div className="flex items-center gap-2 py-2 border-b last:border-b-0">
      <button
        className="num font-bold text-xs hover:text-primary"
        onClick={() => navigate("company", { ticker: a.ticker, panel: "overview" })}
        title={a.ticker}
      >
        {a.ticker}
      </button>
      <p className="text-[11px] text-muted-foreground flex-1 min-w-0 truncate">
        {isReminder(a) && <CalendarClock className="h-3 w-3 inline me-1 -mt-0.5 text-primary" aria-hidden />}
        {alertText(a, lang)}
      </p>
      {a.triggeredAt ? (
        <span className="inline-flex items-center gap-1 text-[10px] text-up font-semibold shrink-0">
          <Check className="h-3 w-3" />
          {tt(T.alertTriggered, lang)}
          {a.triggeredValue != null && !isReminder(a) && <span className="num">{fmtNum(a.triggeredValue)}</span>}
        </span>
      ) : null}
      <button
        onClick={() => removeAlert(a.id)}
        aria-label={tt(T.alertRemove, lang)}
        title={tt(T.alertRemove, lang)}
        className="text-muted-foreground hover:text-down shrink-0"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** Phone-notifications section (web push): the server checks the device's
 *  mirrored alert list every 5 minutes and pushes real system notifications
 *  — even when the app is closed (installed PWA, iOS 16.4+). One tap to
 *  enable, one tap to prove it works, one tap to turn off. */
function PushPhoneSection() {
  const { lang, toast } = useApp();
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);

  // display-only mount read (localStorage is browser-only)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOn(isPushEnabled());
  }, []);

  const doEnable = async () => {
    setBusy(true);
    const res = await enablePush(lang);
    setBusy(false);
    if (res.ok) {
      setOn(true);
      toast(tt(T.pushOnToast, lang));
    } else if (res.reason === "notInstalled") {
      toast(tt(T.pushIosToast, lang));
    } else if (res.reason === "denied") {
      toast(tt(T.pushDeniedToast, lang));
    } else if (res.reason === "unsupported") {
      toast(tt(T.pushUnsupportedToast, lang));
    } else {
      toast(tt(T.pushServerToast, lang));
    }
  };

  const doTest = async () => {
    setBusy(true);
    const ok = await sendTestPush(lang);
    setBusy(false);
    toast(tt(ok ? T.pushTestSent : T.pushTestFailed, lang));
  };

  const doDisable = async () => {
    setBusy(true);
    await disablePush();
    setBusy(false);
    setOn(false);
    toast(tt(T.pushOffToast, lang));
  };

  return (
    <div className="rounded-md border bg-secondary/30 p-2 space-y-1.5">
      <p className="text-[10px] font-semibold text-foreground/70 flex items-center gap-1">
        <Smartphone className="h-3 w-3 text-primary" />
        {tt(T.pushPhoneTitle, lang)}
        {on && <Check className="h-3 w-3 text-up ms-auto" aria-hidden />}
      </p>
      {on ? (
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-up font-medium flex-1 leading-snug">{tt(T.pushPhoneEnabled, lang)}</span>
          <Button size="sm" variant="outline" className="h-7 px-2 text-[10px] gap-1" disabled={busy} onClick={doTest}>
            <BellRing className="h-3 w-3" />
            {tt(T.pushPhoneTest, lang)}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px] text-muted-foreground" disabled={busy} onClick={doDisable}>
            {tt(T.pushPhoneDisable, lang)}
          </Button>
        </div>
      ) : (
        <Button size="sm" className="h-7 w-full px-2 text-[11px] gap-1" disabled={busy} onClick={doEnable}>
          <Smartphone className="h-3 w-3" />
          {tt(T.pushPhoneEnable, lang)}
        </Button>
      )}
      <p className="text-[10px] text-muted-foreground leading-relaxed">{tt(T.pushPhoneNote, lang)}</p>
    </div>
  );
}

/** Header bell + full alert manager popover. The create form is the FIRST
 *  thing in the popover — creating a reminder is one bell-click away from
 *  anywhere in the app, with a live ticker type-ahead. */
export function AlertsBell() {
  const { lang, alerts } = useApp();
  const [open, setOpen] = useState(false);

  const activeCount = alerts.list.filter((a) => !a.triggeredAt).length;
  const triggeredCount = alerts.list.length - activeCount;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={tt(T.alertsBell, lang)}
          title={tt(T.alertsBell, lang)}
          className="relative"
        >
          <Bell className="h-4 w-4" />
          {alerts.ready && activeCount > 0 && (
            <span className="num absolute -top-0.5 -end-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary text-primary-foreground text-[9px] font-bold px-1">
              {activeCount}
            </span>
          )}
          {alerts.ready && activeCount === 0 && triggeredCount > 0 && (
            <span className="absolute -top-0.5 -end-0.5 h-2 w-2 rounded-full bg-up" aria-hidden />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3 space-y-2">
        <p className="text-xs font-semibold flex items-center gap-1.5">
          <Bell className="h-3.5 w-3.5 text-primary" />
          {tt(T.alertsTitle, lang)}
          <span className="num text-[10px] text-muted-foreground font-normal">
            {activeCount} {tt(T.alertsActiveCount, lang)}
          </span>
        </p>

        {/* create form FIRST — a reminder is one bell-click away */}
        <div className="rounded-md border bg-secondary/40 p-2">
          <p className="text-[10px] font-semibold text-foreground/70 mb-1.5 flex items-center gap-1">
            <BellPlus className="h-3 w-3 text-primary" />
            {tt(T.alertAdd, lang)}
          </p>
          <AlertCreateForm onSaved={() => setOpen(false)} />
        </div>

        {!alerts.ready ? null : alerts.list.length === 0 ? (
          <p className="text-[11px] text-muted-foreground text-center leading-relaxed">
            {tt(T.alertsEmptyHint, lang)}
          </p>
        ) : (
          <div className="max-h-52 overflow-auto thin-scroll -mx-1 px-1">
            {alerts.list.map((a) => (
              <AlertRow key={a.id} a={a} />
            ))}
          </div>
        )}

        {/* phone notifications — server push even with the app closed */}
        <PushPhoneSection />

        <p className="text-[10px] text-muted-foreground leading-relaxed border-t pt-2">{tt(T.alertsNote, lang)}</p>
      </PopoverContent>
    </Popover>
  );
}

/** Company-page entry: "set alert / reminder" button with a pre-filled form popover. */
export function SetAlertButton({ ticker, close }: { ticker: string; close: number | null }) {
  const { lang } = useApp();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent/50 transition-colors">
          <BellPlus className="h-3.5 w-3.5" />
          {lang === "ar" ? "تنبيه أو تذكير" : "Alert or reminder"}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3 space-y-2">
        <p className="text-[10px] font-semibold text-foreground/70">{tt(T.alertAdd, lang)}</p>
        <AlertCreateForm fixedTicker={ticker} close={close} onSaved={() => setOpen(false)} />
        <p className="text-[10px] text-muted-foreground leading-relaxed">{tt(T.alertsNote, lang)}</p>
      </PopoverContent>
    </Popover>
  );
}
