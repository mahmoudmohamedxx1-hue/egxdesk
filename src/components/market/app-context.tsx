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

type AuthState = {
  email: string | null;
  loading: boolean;
};

type WatchState = {
  tickers: string[];
  loading: boolean;
};

type View = {
  name: string; // home | market | investors | heat | sectors | exchange | today | watchlist | tools | company | search
  ticker?: string;
  panel?: string;
};

type Ctx = {
  auth: AuthState;
  watch: WatchState;
  lang: Lang;
  setLang: (l: Lang) => void;
  view: View;
  navigate: (v: string, extra?: { ticker?: string; panel?: string }) => void;
  refreshAuth: () => Promise<void>;
  refreshWatch: () => Promise<void>;
  toggleWatch: (ticker: string) => Promise<void>;
  isWatched: (ticker: string) => boolean;
  toast: (msg: string) => void;
};

const AppCtx = createContext<Ctx | null>(null);

export function useApp() {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error("useApp outside provider");
  return ctx;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<AuthState>({ email: null, loading: true });
  const [watch, setWatch] = useState<WatchState>({ tickers: [], loading: true });
  const [lang, setLangState] = useState<Lang>("ar");
  const [view, setView] = useState<View>({ name: "home" });
  const [toasts, setToasts] = useState<{ id: number; msg: string }[]>([]);

  // initial language + view from URL/localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem("egx-lang") as Lang | null;
      if (stored === "ar" || stored === "en") setLangState(stored);
    } catch {}
    const params = new URLSearchParams(window.location.search);
    const v = params.get("view") ?? "home";
    const ticker = params.get("ticker") ?? undefined;
    const panel = params.get("panel") ?? undefined;
    if (v) setView({ name: v, ticker, panel });
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
      const params = new URLSearchParams(window.location.search);
      const v = params.get("view") ?? "home";
      setView({
        name: v,
        ticker: params.get("ticker") ?? undefined,
        panel: params.get("panel") ?? undefined,
      });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const refreshAuth = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me");
      if (res.ok) {
        const data = await res.json();
        setAuth({ email: data.email, loading: false });
      } else {
        setAuth({ email: null, loading: false });
      }
    } catch {
      setAuth({ email: null, loading: false });
    }
  }, []);

  const refreshWatch = useCallback(async () => {
    try {
      const res = await fetch("/api/watchlist");
      if (res.ok) {
        const data = await res.json();
        setWatch({ tickers: data.tickers ?? [], loading: false });
      } else {
        setWatch({ tickers: [], loading: false });
      }
    } catch {
      setWatch({ tickers: [], loading: false });
    }
  }, []);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  useEffect(() => {
    if (auth.email) refreshWatch();
    else setWatch({ tickers: [], loading: false });
  }, [auth.email, refreshWatch]);

  const toast = useCallback((msg: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  const toggleWatch = useCallback(
    async (ticker: string) => {
      if (!auth.email) {
        toast(lang === "ar" ? "سجّل الدخول أولاً لاستخدام المتابعة" : "Sign in first to use the watchlist");
        return;
      }
      const t = ticker.toUpperCase();
      const next = watch.tickers.includes(t)
        ? watch.tickers.filter((x) => x !== t)
        : [...watch.tickers, t];
      // optimistic
      setWatch({ tickers: next, loading: false });
      try {
        const res = await fetch("/api/watchlist", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tickers: next }),
        });
        if (!res.ok) throw new Error();
        toast(
          next.includes(t)
            ? lang === "ar" ? `أُضيف ${t} إلى المتابعة` : `${t} added to watchlist`
            : lang === "ar" ? `أُزيل ${t} من المتابعة` : `${t} removed from watchlist`
        );
      } catch {
        setWatch({ tickers: watch.tickers, loading: false });
        toast(lang === "ar" ? "تعذر حفظ المتابعة" : "Could not save the watchlist");
      }
    },
    [auth.email, watch.tickers, toast, lang]
  );

  const isWatched = useCallback(
    (ticker: string) => watch.tickers.includes(ticker.toUpperCase()),
    [watch.tickers]
  );

  const value = useMemo<Ctx>(
    () => ({
      auth,
      watch,
      lang,
      setLang,
      view,
      navigate,
      refreshAuth,
      refreshWatch,
      toggleWatch,
      isWatched,
      toast,
    }),
    [auth, watch, lang, setLang, view, navigate, refreshAuth, refreshWatch, toggleWatch, isWatched, toast]
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
