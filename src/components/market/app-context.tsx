"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Lang } from "@/lib/i18n";
import { marketStatus, type MarketStatus } from "@/lib/market-status";
import {
  loadAlerts,
  saveAlerts,
  conditionHolds,
  observedValue,
  alertText,
  notify,
  dateArrived,
  type AlertCond,
  type PriceAlert,
} from "@/lib/alerts";
import type { CompanyRow } from "./types";

type WatchState = {
  tickers: string[];
  ready: boolean;
};

type AlertsState = {
  list: PriceAlert[];
  ready: boolean;
};

type View = {
  name: string; // home | market | activity | heat | sectors | today | watchlist | tools | company | search
  ticker?: string;
  panel?: string;
};

type Ctx = {
  watch: WatchState;
  lang: Lang;
  setLang: (l: Lang) => void;
  view: View;
  navigate: (v: string, extra?: { ticker?: string; panel?: string }) => void;
  toggleWatch: (ticker: string) => void;
  isWatched: (ticker: string) => boolean;
  toast: (msg: string) => void;
  /** null until mounted — the live status is time-derived and must not
   *  render during SSR/prerender or hydration text mismatches result
   *  (React #418) because the prerendered HTML freezes build-time text. */
  status: MarketStatus | null;
  /** G1 price alerts — stored on-device, evaluated here against the
   *  60-second quote refresh, each firing exactly once. */
  alerts: AlertsState;
  addAlert: (ticker: string, cond: AlertCond, value: number, date?: string) => void;
  removeAlert: (id: string) => void;
};

const AppCtx = createContext<Ctx | null>(null);
const WATCH_KEY = "egx-watchlist";

/** Internal view names understood by the app shell. */
const KNOWN_VIEWS = new Set([
  "home", "market", "screener", "sectors", "heat", "activity",
  "investors", "today", "watchlist", "tools", "exchange", "company",
  "calendar", "compare", "api",
]);

/** Public URL aliases -> internal view names. ?view=news and ?view=overview
 *  are the public-facing spellings; the shell branches on internal names. */
const VIEW_ALIASES: Record<string, string> = {
  news: "today",
  overview: "home",
};

function normalizeView(v: string | null): string {
  const raw = (v ?? "home").toLowerCase();
  const name = VIEW_ALIASES[raw] ?? raw;
  return KNOWN_VIEWS.has(name) ? name : "home";
}

function viewFromParams(params: URLSearchParams): View {
  return {
    name: normalizeView(params.get("view")),
    ticker: params.get("ticker") ?? undefined,
    panel: params.get("panel") ?? undefined,
  };
}

export function useApp() {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error("useApp outside provider");
  return ctx;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [watch, setWatch] = useState<WatchState>({ tickers: [], ready: false });
  const [lang, setLangState] = useState<Lang>("ar");
  const [view, setView] = useState<View>({ name: "home" });
  const [toasts, setToasts] = useState<{ id: number; msg: string }[]>([]);
  const [status, setStatus] = useState<MarketStatus | null>(null);
  const [alerts, setAlertsState] = useState<AlertsState>({ list: [], ready: false });
  const alertsRef = useRef<AlertsState>({ list: [], ready: false });
  const langRef = useRef<Lang>("ar");

  // one-time hydration init from browser-only stores (localStorage + URL) —
  // cannot run in render because this component is also server-rendered
  useEffect(() => {
    try {
      const stored = localStorage.getItem("egx-lang") as Lang | null;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (stored === "ar" || stored === "en") setLangState(stored);
      const raw = localStorage.getItem(WATCH_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) setWatch({ tickers: arr.filter((x) => typeof x === "string"), ready: true });
        else setWatch((w) => ({ ...w, ready: true }));
      } else {
        setWatch((w) => ({ ...w, ready: true }));
      }
      // G1 — restore alerts from the device
      const restoredAlerts = loadAlerts();
      alertsRef.current = { list: restoredAlerts, ready: true };
      setAlertsState({ list: restoredAlerts, ready: true });
    } catch {}
    const params = new URLSearchParams(window.location.search);
    setView(viewFromParams(params));
    // live market status only after mount (see Ctx.status note)
    setStatus(marketStatus());
  }, []);

  // keep market status fresh (every minute)
  useEffect(() => {
    const t = setInterval(() => setStatus(marketStatus()), 60_000);
    return () => clearInterval(t);
  }, []);

  // sync dir/lang on the document (and a ref the alert engine can read)
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    langRef.current = lang;
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem("egx-lang", l);
    } catch {}
  }, []);

  const navigate = useCallback(
    (name: string, extra?: { ticker?: string; panel?: string }) => {
      const next: View = { name, ...(extra ?? {}) };
      setView(next);
      const params = new URLSearchParams();
      params.set("view", name);
      if (extra?.ticker) params.set("ticker", extra.ticker);
      if (extra?.panel) params.set("panel", extra.panel);
      const url = `${window.location.pathname}?${params.toString()}`;
      window.history.replaceState(null, "", url);
      document.getElementById("main-content")?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    []
  );

  // listen to browser back/forward
  useEffect(() => {
    const onPop = () => {
      setView(viewFromParams(new URLSearchParams(window.location.search)));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const toast = useCallback((msg: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  const toggleWatch = useCallback(
    (ticker: string) => {
      const t = ticker.toUpperCase();
      setWatch((w) => {
        const next = w.tickers.includes(t)
          ? w.tickers.filter((x) => x !== t)
          : [...w.tickers, t];
        try {
          localStorage.setItem(WATCH_KEY, JSON.stringify(next));
        } catch {}
        toast(
          next.includes(t)
            ? lang === "ar" ? `أُضيف ${t} إلى المتابعة` : `${t} added to watchlist`
            : lang === "ar" ? `أُزيل ${t} من المتابعة` : `${t} removed from watchlist`
        );
        return { tickers: next, ready: true };
      });
    },
    [toast, lang]
  );

  const isWatched = useCallback(
    (ticker: string) => watch.tickers.includes(ticker.toUpperCase()),
    [watch.tickers]
  );

  // ── G1 price alerts: CRUD + evaluation engine ──

  const applyAlerts = useCallback((next: PriceAlert[]) => {
    saveAlerts(next);
    alertsRef.current = { list: next, ready: true };
    setAlertsState({ list: next, ready: true });
  }, []);

  const addAlert = useCallback(
    (ticker: string, cond: AlertCond, value: number, date?: string) => {
      const t = ticker.toUpperCase().replace(/[^A-Z0-9]/g, "");
      const isReminder = cond === "onDate";
      if (!t || (!isReminder && !Number.isFinite(value)) || (isReminder && !date)) return;
      const a: PriceAlert = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        ticker: t,
        cond,
        value: isReminder ? 0 : value,
        ...(isReminder ? { date } : {}),
        createdAt: new Date().toISOString(),
        triggeredAt: null,
        triggeredValue: null,
      };
      applyAlerts([...alertsRef.current.list, a]);
      toast(alertText(a, langRef.current));
    },
    [applyAlerts, toast]
  );

  const removeAlert = useCallback(
    (id: string) => {
      applyAlerts(alertsRef.current.list.filter((a) => a.id !== id));
    },
    [applyAlerts]
  );

  /** Evaluation engine: once a minute while untriggered alerts exist.
   *  Date reminders are checked against the local calendar day (no network);
   *  price conditions poll /api/companies and flip each alert to triggered
   *  exactly once, firing an in-app toast + browser notification. Quotes are
   *  ~15-min delayed — honest by design. */
  useEffect(() => {
    const tick = async () => {
      const current = alertsRef.current;
      if (!current.ready) return;
      const pending = current.list.filter((a) => !a.triggeredAt);
      if (pending.length === 0) return; // nothing to watch — skip entirely

      // 1) date reminders — no quotes needed, fire when the day arrives
      const dueNow = pending.filter(dateArrived);
      let next = current.list;
      if (dueNow.length) {
        next = next.map((a) =>
          dueNow.includes(a)
            ? { ...a, triggeredAt: new Date().toISOString(), triggeredValue: null }
            : a
        );
        applyAlerts(next);
        const l = langRef.current;
        for (const a of dueNow) {
          toast(
            l === "ar" ? `تذكير اليوم: ${a.ticker}` : `Reminder today: ${a.ticker}`
          );
          notify(`EGX Desk — ${a.ticker}`, alertText(a, l));
        }
      }

      // 2) price conditions — fetch quotes only when at least one is pending
      const pricePending = next.filter((a) => !a.triggeredAt && a.cond !== "onDate");
      if (pricePending.length === 0) return;
      try {
        const res = await fetch("/api/companies", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { rows?: CompanyRow[] };
        const rows = json.rows ?? [];
        const byTicker = new Map(rows.map((r) => [r.ticker, r] as const));
        const fired: PriceAlert[] = [];
        const after = next.map((a) => {
          if (a.triggeredAt || a.cond === "onDate") return a;
          const row = byTicker.get(a.ticker);
          if (!row || !conditionHolds(a, row)) return a;
          fired.push(a);
          return {
            ...a,
            triggeredAt: new Date().toISOString(),
            triggeredValue: observedValue(a, row),
          };
        });
        if (fired.length) {
          applyAlerts(after);
          const lang = langRef.current;
          for (const a of fired) {
            const seen = a.triggeredValue ?? a.value;
            const valText =
              a.cond === "above" || a.cond === "below"
                ? String(seen)
                : `${Number.isFinite(seen) ? (seen as number).toFixed(2) : ""}%`;
            toast(
              lang === "ar"
                ? `تنبيه: ${a.ticker} — تحقّق الشرط عند ${valText}`
                : `Alert: ${a.ticker} — condition met at ${valText}`
            );
            notify(`EGX Desk — ${a.ticker}`, alertText(a, lang));
          }
        }
      } catch {
        // network hiccup — the next tick retries; alerts never fire on errors
      }
    };
    const t = setInterval(tick, 60_000);
    // evaluate once shortly after mount / after adding an alert
    const warm = setTimeout(tick, 2_500);
    return () => {
      clearInterval(t);
      clearTimeout(warm);
    };
  }, [applyAlerts, toast, alerts.ready, alerts.list.length]);

  const value = useMemo<Ctx>(
    () => ({
      watch,
      lang,
      setLang,
      view,
      navigate,
      toggleWatch,
      isWatched,
      toast,
      status,
      alerts,
      addAlert,
      removeAlert,
    }),
    [watch, lang, setLang, view, navigate, toggleWatch, isWatched, toast, status, alerts, addAlert, removeAlert]
  );

  return (
    <AppCtx.Provider value={value}>
      {children}
      {/* lightweight toasts */}
      <div className="fixed bottom-4 inset-x-0 z-[100] flex flex-col items-center gap-2 px-4 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto rounded-md border bg-card px-4 py-2 text-sm shadow-md animate-in fade-in slide-in-from-bottom-2"
          >
            {t.msg}
          </div>
        ))}
      </div>
    </AppCtx.Provider>
  );
}
