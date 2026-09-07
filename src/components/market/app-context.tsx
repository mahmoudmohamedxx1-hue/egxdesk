"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Lang } from "@/lib/i18n";
import { marketStatus, type MarketStatus } from "@/lib/market-status";

type WatchState = {
  tickers: string[];
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
};

const AppCtx = createContext<Ctx | null>(null);
const WATCH_KEY = "egx-watchlist";

/** Internal view names understood by the app shell. */
const KNOWN_VIEWS = new Set([
  "home", "market", "screener", "sectors", "heat", "activity",
  "investors", "today", "watchlist", "tools", "exchange", "company",
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

  // sync dir/lang on the document
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
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
    }),
    [watch, lang, setLang, view, navigate, toggleWatch, isWatched, toast, status]
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
