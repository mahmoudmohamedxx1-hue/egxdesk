"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
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
import { syncPushAlerts } from "@/lib/push-client";

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
  "calendar", "compare", "api", "signals", "agent", "reports",
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

/** Build the shareable query string for a view (always carries the lang so a
 *  shared link opens in the language the sharer was reading). */
function viewParams(name: string, extra: { ticker?: string; panel?: string } | undefined, lang: Lang): string {
  const params = new URLSearchParams();
  params.set("view", name);
  if (extra?.ticker) params.set("ticker", extra.ticker);
  if (extra?.panel) params.set("panel", extra.panel);
  params.set("lang", lang);
  return params.toString();
}

/** T25 — every view change must land with the HEADER at the top of the
 *  viewport (the user's "load the header by default" requirement). Runs as a
 *  layout effect AFTER the new view is committed but BEFORE paint, so it
 *  never scrolls against the outgoing view's DOM and never flashes. Plain
 *  useEffect on the server/prerender (useLayoutEffect is a no-op there and
 *  would log a warning). */
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

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
    // T25 — take scroll control away from the browser: with "auto" it
    // restores the stale offset saved on each history entry, so back/forward
    // reopened pages at the FOOTER and reloads landed mid-page. "manual" +
    // the scroll-on-view-change effect below makes every page open at the
    // header, deterministically, across every entry path (nav click, browser
    // back/forward, shared links, reloads, restored tabs/PWA launches).
    try {
      window.history.scrollRestoration = "manual";
    } catch {}
    const params = new URLSearchParams(window.location.search);
    try {
      const stored = localStorage.getItem("egx-lang") as Lang | null;
      // a shared link carries ?lang= — the URL wins over the stored choice so
      // the recipient opens the page in the sharer's language
      const urlLang = params.get("lang");
      const boot: Lang = urlLang === "ar" || urlLang === "en" ? urlLang : stored === "ar" || stored === "en" ? stored : "ar";
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (boot !== "ar") setLangState(boot);
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
    setView(viewFromParams(params));
    // if the link had no lang param, stamp it once so every shared URL from
    // here on opens in the visitor's chosen language
    if (!params.get("lang")) {
      try {
        params.set("lang", langRef.current);
        window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
      } catch {}
    }
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
    langRef.current = l;
    try {
      localStorage.setItem("egx-lang", l);
    } catch {}
    // keep the shareable URL in the chosen language (merge, never navigate)
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      params.set("lang", l);
      try {
        window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
      } catch {}
    }
  }, []);

  const navigate = useCallback(
    (name: string, extra?: { ticker?: string; panel?: string }) => {
      const next: View = { name, ...(extra ?? {}) };
      setView(next);
      // PUSH (not replace): back/forward move between pages — this is the
      // routing entry; in-page state changes later replaceState onto it.
      // (Scroll-to-header now happens in the layout effect on [view] AFTER
      // the new view commits — scrolling here would run against the OLD
      // view's DOM and fight the re-render; see useIsoLayoutEffect below.)
      const qs = viewParams(name, extra, langRef.current);
      try {
        window.history.pushState(null, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
      } catch {}
    },
    []
  );

  // T25 — the deterministic "header by default" rule: whenever the view
  // changes (nav click, company/symbol jump, browser back/forward, boot from
  // a shared URL, restored tab) the window scrolls to the very top so the
  // header is the first thing on screen — exactly like opening a fresh page
  // on a multi-page site. Instant (not smooth): it lands before paint, and
  // flying content on every navigation would read as lag. `view` is a fresh
  // object on every navigate/popstate/boot, so this fires on each change;
  // in-page state (lang swap, panel tabs, report id) never touches `view`, so
  // those keep their reading position.
  useIsoLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [view]);

  // listen to browser back/forward — the target entry carries its own view
  // AND its own lang (each pushed entry froze the sharer's language choice)
  useEffect(() => {
    const onPop = () => {
      const params = new URLSearchParams(window.location.search);
      setView(viewFromParams(params));
      const l = params.get("lang");
      if ((l === "ar" || l === "en") && l !== langRef.current) {
        setLangState(l);
        langRef.current = l;
        try {
          localStorage.setItem("egx-lang", l);
        } catch {}
      }
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
    // mirror the list to the server when phone notifications are enabled —
    // the server-side loop then evaluates these alerts every 5 minutes and
    // pushes system notifications even while the app is closed (G1 mobile)
    void syncPushAlerts(next, langRef.current).catch(() => {});
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
