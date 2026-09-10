"use client";

/** Alerts & reminders UI (G1): the header bell + manager popover, and the
 *  reusable create form (also mounted on company pages pre-filled with the
 *  ticker). Alerts live on the device; the app-context engine evaluates
 *  price conditions against the 60-second delayed-quote refresh and date
 *  reminders against the local calendar day, firing toasts + browser
 *  notifications. The create form sits at the TOP of the bell popover so a
 *  reminder is always one bell-click away — no navigation needed. */

import { useEffect, useMemo, useState } from "react";
import { useApp } from "./app-context";
import { useLiveData } from "./use-live-data";
import type { CompanyRow } from "./types";
import { T, tt, dn } from "@/lib/i18n";
import { fmtNum } from "@/lib/format";
import { alertText, requestNotifyPermission, todayStr, type AlertCond, type PriceAlert } from "@/lib/alerts";
import { enablePush, disablePush, sendTestPush, isPushEnabled } from "@/lib/push-client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Bell, BellPlus, BellRing, CalendarClock, Check, Smartphone, Trash2 } from "lucide-react";

const CONDS: { key: AlertCond; t: { ar: string; en: string } }[] = [
  { key: "above", t: T.alertCondAbove },
  { key: "below", t: T.alertCondBelow },
  { key: "risePct", t: T.alertCondRise },
  { key: "fallPct", t: T.alertCondFall },
  { key: "onDate", t: T.alertCondOnDate },
];

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

/** Create-alert/reminder form. `fixedTicker` (company page) locks the symbol. */
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
  const [cond, setCond] = useState<AlertCond>("above");
  const [value, setValue] = useState("");
  const [date, setDate] = useState("");
  const suggestions = useTickerSuggestions(fixedTicker ? "" : ticker);

  // render-phase sync (official React pattern): when the parent swaps the
  // locked ticker, reset the form without an effect
  const [prevFixed, setPrevFixed] = useState(fixedTicker);
  if (prevFixed !== fixedTicker) {
    setPrevFixed(fixedTicker);
    setTicker(fixedTicker ?? "");
  }

  const save = async () => {
    const t = (fixedTicker ?? ticker).toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!t) return;
    if (cond === "onDate") {
      if (!date) return;
      addAlert(t, "onDate", 0, date);
    } else {
      const v = Number(value);
      if (!Number.isFinite(v)) return;
      addAlert(t, cond, v);
    }
    // ask for browser notifications on first alert (grants persist)
    const perm = await requestNotifyPermission();
    if (perm === "denied") toast(tt(T.notifyBlocked, lang));
    setValue("");
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
                      setValue((v) => v || (r.close != null ? String(r.close) : v));
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

      <div className="flex items-center gap-1.5">
        <select
          value={cond}
          onChange={(e) => setCond(e.target.value as AlertCond)}
          className="h-8 flex-1 rounded-md border bg-card px-1.5 text-xs"
          aria-label={tt(T.alertCondAbove, lang)}
        >
          {CONDS.map((c) => (
            <option key={c.key} value={c.key}>
              {tt(c.t, lang)}
            </option>
          ))}
        </select>
        {cond === "onDate" ? (
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
        ) : (
          <input
            dir="ltr"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={cond === "above" || cond === "below" ? (close != null ? String(close) : "0.00") : "5"}
            aria-label={tt(T.alertValueLabel, lang)}
            className="h-8 w-24 rounded-md border bg-card px-2 text-xs num"
          />
        )}
        <Button size="sm" className="h-8 px-2.5 text-[11px] gap-1 shrink-0" onClick={save}>
          {cond === "onDate" ? <CalendarClock className="h-3 w-3" /> : <BellPlus className="h-3 w-3" />}
          {tt(cond === "onDate" ? T.reminderSave : T.alertSave, lang)}
        </Button>
      </div>

      {fixedTicker && close != null && cond !== "onDate" && (
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
        {a.cond === "onDate" && <CalendarClock className="h-3 w-3 inline me-1 -mt-0.5 text-primary" aria-hidden />}
        {alertText(a, lang)}
      </p>
      {a.triggeredAt ? (
        <span className="inline-flex items-center gap-1 text-[10px] text-up font-semibold shrink-0">
          <Check className="h-3 w-3" />
          {tt(T.alertTriggered, lang)}
          {a.cond !== "onDate" && a.triggeredValue != null && (
            <span className="num">{a.cond === "above" || a.cond === "below" ? fmtNum(a.triggeredValue) : `${fmtNum(a.triggeredValue, 2)}%`}</span>
          )}
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
