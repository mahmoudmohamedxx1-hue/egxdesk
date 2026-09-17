"use client";

import { useApp } from "./app-context";
import { T, tt } from "@/lib/i18n";
import { HeaderSearch } from "./header-search";
import { AlertsBell } from "./alerts-panel";
import { PwaRegister, InstallButton } from "./pwa-register";
import { ShareButton } from "./share-button";
import { AiAssistantLazy } from "./ai-assistant-lazy";
import dynamic from "next/dynamic";
import { useEffect } from "react";
import { APP_VERSION, BUILD_DATE } from "@/lib/version";
import { runVersionGuard } from "@/lib/version-guard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Languages, Moon, Sun, ChevronDown, ChevronRight,
  LayoutDashboard, CandlestickChart, SlidersHorizontal, Radar,
  Flame, Layers, Users, Zap, CalendarDays, Scale, PiggyBank,
  Newspaper, NotebookPen, ListChecks, Wrench, Bot, Globe2, LineChart,
} from "lucide-react";
import { useTheme } from "next-themes";

/* T34 — FAST LOAD: the 22 views used to ship in ONE ~1.7MB chunk (every
 * screen + recharts + markdown + framer-motion downloaded before anything
 * painted). Every view is now its own lazy chunk: the first load ships only
 * the shell + the ACTIVE view, and the rest are warmed in idle time after
 * first paint (staggered, saveData-aware) so navigation stays instant —
 * download later, never wait later. */

const ViewBoot = () => (
  <div className="space-y-4" aria-busy="true">
    <Skeleton className="h-8 w-64" />
    <div className="grid gap-4 md:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)}</div>
    <Skeleton className="h-40" />
  </div>
);

const OverviewView = dynamic(() => import("@/components/views/overview-view").then((m) => ({ default: m.OverviewView })), { loading: ViewBoot });
const MarketView = dynamic(() => import("@/components/views/market-view").then((m) => ({ default: m.MarketView })), { loading: ViewBoot });
const ScreenerView = dynamic(() => import("@/components/views/screener-view").then((m) => ({ default: m.ScreenerView })), { loading: ViewBoot });
const SectorsView = dynamic(() => import("@/components/views/sectors-view").then((m) => ({ default: m.SectorsView })), { loading: ViewBoot });
const HeatView = dynamic(() => import("@/components/views/heat-view").then((m) => ({ default: m.HeatView })), { loading: ViewBoot });
const ActivityView = dynamic(() => import("@/components/views/activity-view").then((m) => ({ default: m.ActivityView })), { loading: ViewBoot });
const InvestorsView = dynamic(() => import("@/components/views/investors-view").then((m) => ({ default: m.InvestorsView })), { loading: ViewBoot });
const NewsView = dynamic(() => import("@/components/views/news-view").then((m) => ({ default: m.NewsView })), { loading: ViewBoot });
const WatchlistView = dynamic(() => import("@/components/views/watchlist-view").then((m) => ({ default: m.WatchlistView })), { loading: ViewBoot });
const ToolsView = dynamic(() => import("@/components/views/tools-view").then((m) => ({ default: m.ToolsView })), { loading: ViewBoot });
const CompanyView = dynamic(() => import("@/components/views/company-view").then((m) => ({ default: m.CompanyView })), { loading: ViewBoot });
const ExchangeView = dynamic(() => import("@/components/views/exchange-view").then((m) => ({ default: m.ExchangeView })), { loading: ViewBoot });
const CalendarView = dynamic(() => import("@/components/views/calendar-view").then((m) => ({ default: m.CalendarView })), { loading: ViewBoot });
const CompareView = dynamic(() => import("@/components/views/compare-view").then((m) => ({ default: m.CompareView })), { loading: ViewBoot });
const ApiDocsView = dynamic(() => import("@/components/views/api-docs-view").then((m) => ({ default: m.ApiDocsView })), { loading: ViewBoot });
const SignalsView = dynamic(() => import("@/components/views/signals-view").then((m) => ({ default: m.SignalsView })), { loading: ViewBoot });
const StrategyLabView = dynamic(() => import("@/components/views/strategy-lab-view").then((m) => ({ default: m.StrategyLabView })), { loading: ViewBoot });
const FundsView = dynamic(() => import("@/components/views/funds-view").then((m) => ({ default: m.FundsView })), { loading: ViewBoot });
const AgentView = dynamic(() => import("@/components/views/agent-view").then((m) => ({ default: m.AgentView })), { loading: () => <div className="h-dvh bg-background" aria-busy="true" /> });
const ReportsView = dynamic(() => import("@/components/views/reports-view").then((m) => ({ default: m.ReportsView })), { loading: ViewBoot });
const GccView = dynamic(() => import("@/components/views/gcc-view").then((m) => ({ default: m.GccView })), { loading: ViewBoot });
const PaperView = dynamic(() => import("@/components/views/paper-view").then((m) => ({ default: m.PaperView })), { loading: ViewBoot });

/* The same import specifiers the dynamic() loaders use — firing one in idle
 * time warms exactly the chunk dynamic() will need, without rendering it. */
const VIEW_IMPORTS: { name: string; load: () => Promise<unknown> }[] = [
  { name: "market", load: () => import("@/components/views/market-view") },
  { name: "screener", load: () => import("@/components/views/screener-view") },
  { name: "signals", load: () => import("@/components/views/signals-view") },
  { name: "today", load: () => import("@/components/views/news-view") },
  { name: "company", load: () => import("@/components/views/company-view") },
  { name: "agent", load: () => import("@/components/views/agent-view") },
  { name: "watchlist", load: () => import("@/components/views/watchlist-view") },
  { name: "heat", load: () => import("@/components/views/heat-view") },
  { name: "sectors", load: () => import("@/components/views/sectors-view") },
  { name: "calendar", load: () => import("@/components/views/calendar-view") },
  { name: "tools", load: () => import("@/components/views/tools-view") },
  { name: "compare", load: () => import("@/components/views/compare-view") },
  { name: "exchange", load: () => import("@/components/views/exchange-view") },
  { name: "activity", load: () => import("@/components/views/activity-view") },
  { name: "investors", load: () => import("@/components/views/investors-view") },
  { name: "funds", load: () => import("@/components/views/funds-view") },
  { name: "gcc", load: () => import("@/components/views/gcc-view") },
  { name: "lab", load: () => import("@/components/views/strategy-lab-view") },
  { name: "reports", load: () => import("@/components/views/reports-view") },
  { name: "paper", load: () => import("@/components/views/paper-view") },
  { name: "api", load: () => import("@/components/views/api-docs-view") },
];

/** Warm the not-yet-loaded view chunks AFTER first paint, one per idle slot
 *  (direct-nav surfaces first). Skipped entirely when the user has data-saver
 *  on — their bytes are theirs. Identical imports dedupe with dynamic(), so
 *  this only ever downloads each chunk once. */
function useIdleViewPrefetch(activeView: string) {
  useEffect(() => {
    try {
      const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
      if (nav.connection?.saveData) return;
    } catch {}
    const ric =
      (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback ??
      ((cb: () => void) => window.setTimeout(cb, 250));
    const order = VIEW_IMPORTS.filter((v) => v.name !== activeView);
    let i = 0;
    const step = () => {
      const next = order[i++];
      if (!next) return;
      void next.load().catch(() => {});
      if (i < order.length) ric(step, { timeout: 4000 });
    };
    ric(step, { timeout: 3000 });
    // no cleanup on purpose: AppShell never unmounts, and a duplicated import
    // just resolves to the same cached module promise
  }, [activeView]);
}

/** T27 — the header tabs, rebuilt as a compact grouped navigation
 *  (TradingView-style): direct tabs for the daily drivers + grouped
 *  dropdowns for the analytical surfaces, every item with an icon. One row,
 *  scales with new features (GCC + Paper arrived in this task), keyboard
 *  accessible, active-group highlighting, and the "current page" underline
 *  survives inside groups. Mobile keeps the horizontal scroll with the
 *  same groups collapsed into the dropdowns. */
type NavItem = { view: string; t: { ar: string; en: string }; icon: typeof LayoutDashboard };
type NavGroup = { key: string; t: { ar: string; en: string }; icon: typeof LayoutDashboard; items: NavItem[] };

const DIRECT_NAV: NavItem[] = [
  { view: "home", t: T.overview, icon: LayoutDashboard },
  { view: "market", t: T.market, icon: CandlestickChart },
  { view: "screener", t: { ar: "الفرز", en: "Screener" }, icon: SlidersHorizontal },
  { view: "signals", t: T.signalsNav, icon: Radar },
  { view: "today", t: T.news, icon: Newspaper },
  { view: "agent", t: T.agentNav, icon: Bot },
];

const NAV_GROUPS: NavGroup[] = [
  {
    key: "markets",
    t: { ar: "الأسواق", en: "Markets" },
    icon: Layers,
    items: [
      { view: "heat", t: T.map, icon: Flame },
      { view: "sectors", t: T.sectors, icon: Layers },
      { view: "investors", t: { ar: "المستثمرون", en: "Investors" }, icon: Users },
      { view: "activity", t: T.activity, icon: Zap },
      { view: "calendar", t: { ar: "التقويم", en: "Calendar" }, icon: CalendarDays },
      { view: "funds", t: T.fundsNav, icon: PiggyBank },
      { view: "compare", t: { ar: "المقارنة", en: "Compare" }, icon: Scale },
      { view: "gcc", t: { ar: "الخليج", en: "GCC" }, icon: Globe2 },
    ],
  },
  {
    key: "intel",
    t: { ar: "التحليلات", en: "Intelligence" },
    icon: LineChart,
    items: [
      { view: "lab", t: T.labNav, icon: LineChart },
      { view: "reports", t: T.reportsNav, icon: NotebookPen },
    ],
  },
  {
    key: "tools",
    t: { ar: "أدواتي", en: "My tools" },
    icon: ListChecks,
    items: [
      { view: "watchlist", t: T.watchlist, icon: ListChecks },
      { view: "paper", t: { ar: "تجريبي", en: "Paper" }, icon: Wrench },
      { view: "tools", t: T.tools, icon: Wrench },
    ],
  },
];

/** Which nav surface (direct tab or group) is highlighted for a view. */
function navActive(navView: string, current: string): boolean {
  if (navView === "home") return current === "home" || current === "exchange";
  if (navView === "market") return current === "market" || current === "company";
  return navView === current;
}

function groupActive(group: NavGroup, current: string): boolean {
  return group.items.some((it) => navActive(it.view, current));
}

export function AppShell() {
  const { lang, setLang, view, navigate, status, toast } = useApp();
  const { theme, setTheme } = useTheme();
  // T34 — warm the other view chunks in idle time (after first paint)
  useIdleViewPrefetch(view.name);

  // T40 — the document metadata (tab title + meta description) is static
  // Arabic in layout.tsx because this is a single-page app, so an English
  // visitor's tab, bookmark and history entry stayed Arabic. Keep the
  // crawler-facing static tags (the site's primary audience is Arabic) but
  // make what the USER sees follow the interface language, live.
  useEffect(() => {
    document.title =
      lang === "ar"
        ? "EGX Desk — بيانات حية للبورصة المصرية"
        : "EGX Desk — Live Egyptian Exchange data";
    const meta = document.querySelector('meta[name="description"]');
    if (meta) {
      meta.setAttribute(
        "content",
        lang === "ar"
          ? "بيانات حية مؤجلة للبورصة المصرية: المؤشرات، ٢٩٦ شركة مقيدة بأسعار ومقاييس فعلية، أداء القطاعات، الخريطة الحرارية، أخبار السوق المصرية من مصادر عامة، ومتابعة محلية بلا تسجيل دخول."
          : "Delayed live data for the Egyptian Exchange: indices, 296 listed companies with real prices and metrics, sector performance, the heatmap, Egyptian market news from public sources — local tracking with no sign-up.",
      );
    }
  }, [lang]);

  // T35 — anti-staleness version guard: if this cached shell is older than
  // the server (installed PWA / long-lived tab / proxy cache holding an old
  // build), unregister the SW, wipe the caches and self-heal with one reload
  // — the user can never be stuck on yesterday's model list again.
  useEffect(() => {
    const onStale = (e: Event) => {
      const d = (e as CustomEvent<{ page?: string; server?: string }>).detail ?? {};
      toast(
        lang === "ar"
          ? `تحديث التطبيق إلى الإصدار ${d.server ?? "الأحدث"}…`
          : `Updating the app to ${d.server ?? "the latest"} version…`,
      );
    };
    window.addEventListener("egx-stale-shell", onStale);
    void runVersionGuard();
    return () => window.removeEventListener("egx-stale-shell", onStale);
  }, []);

  // One-time theme migration: the old default was LIGHT and next-themes
  // auto-stored it for visitors who never explicitly chose a theme. Dark is
  // now the default — flip via setTheme (keeps provider state in sync) once;
  // an explicit toggle sets egx-theme-chosen and is respected forever after.
  useEffect(() => {
    try {
      const chosen = localStorage.getItem("egx-theme-chosen");
      if (!chosen && (theme ?? "dark") === "light") {
        setTheme("dark");
      }
    } catch {}
  }, []);

  // Task 23 — the AI agent view takes over the WHOLE page: no header, no nav
  // row, no footer, no max-width padding. AgentView is a self-sufficient
  // h-dvh chat canvas with its own top bar (back-to-desk + logo + history +
  // new chat + theme + language), exactly like a standalone chat app. The
  // PWA registration still runs — installed apps keep offline/push behavior.
  if (view.name === "agent") {
    return (
      <>
        <PwaRegister />
        <AgentView />
      </>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* G14 — service-worker registration (app shell cache; API never cached) */}
      <PwaRegister />
      {/* T28 — the floating AI assistant popup (Ctrl+K): executes any site
          action + free model switcher (Instant / Cloud GLM / Puter cloud).
          T34: mounted lazily on first open — framer-motion + the markdown
          renderer no longer ship with every first page load. */}
      <AiAssistantLazy />
      {/* header */}
      <header className="border-b bg-card sticky top-0 z-40">
        <div className="mx-auto max-w-6xl px-4">
          {/* top row */}
          <div className="flex items-center justify-between gap-3 py-2.5">
            <div className="flex items-center gap-3 min-w-0">
              <button onClick={() => navigate("home")} className="flex items-center shrink-0" aria-label="EGX Desk home">
                {/* the official EGXDesk mark+wordmark (from the supplied artwork,
                    checkerboard removed, cropped to logo+text) — one file per theme */}
                <img src="/logo.png?v=224" alt="EGX Desk" width={38} height={30} className="h-[30px] w-auto dark:hidden" />
                <img src="/logo-dark.png?v=224" alt="EGX Desk" width={38} height={30} className="hidden h-[30px] w-auto dark:block" />
              </button>
              <span className="hidden sm:block text-[11px] text-muted-foreground border-s ps-3 leading-snug">
                {tt(T.tagline, lang)}
                <br />
                <span className="num">
                  {status ? (
                    <>
                      {tt(T.session, lang)} {status.lastSession} ·{" "}
                      <span className={status.open ? "text-up font-medium" : "text-muted-foreground font-medium"}>
                        {tt(status.open ? T.marketOpen : T.marketClosed, lang)}
                      </span>{" "}
                      · {tt(T.delayed, lang)}
                    </>
                  ) : (
                    <>{tt(T.delayed, lang)}</>
                  )}
                </span>
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              {/* 21-c — share this exact page-state via its unique URL */}
              <ShareButton />

              {/* inline header search — expands inside the header, never a modal */}
              <HeaderSearch />

              {/* G1 price alerts — device-stored, evaluated on quote refresh */}
              <AlertsBell />

              {/* direct light/dark toggle — dark is the default. BOTH icons are
                  rendered and switched with the html.dark CSS class (set by
                  next-themes' pre-hydration script), so server and client
                  markup match exactly — no hydration mismatch on the icon or
                  the label. */}
              <Button
                variant="ghost"
                size="sm"
                suppressHydrationWarning
                aria-label={tt((theme ?? "dark") === "dark" ? T.switchToLight : T.switchToDark, lang)}
                title={tt((theme ?? "dark") === "dark" ? T.switchToLight : T.switchToDark, lang)}
                onClick={() => {
                  try {
                    localStorage.setItem("egx-theme-chosen", "1");
                  } catch {}
                  setTheme((theme ?? "dark") === "dark" ? "light" : "dark");
                }}
              >
                <Sun className="hidden h-4 w-4 dark:block" aria-hidden />
                <Moon className="block h-4 w-4 dark:hidden" aria-hidden />
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" aria-label={tt(T.langAppearance, lang)}>
                    <Languages className="h-4 w-4" />
                    <span className="hidden md:inline text-xs">{lang === "ar" ? "ع/EN" : "EN/ع"}</span>
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>{tt(T.langAppearance, lang)}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setLang("ar")}>
                    العربية {lang === "ar" && "✓"}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setLang("en")}>
                    English {lang === "en" && "✓"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* live status chip — renders a neutral placeholder until the
                  client mounts so prerendered HTML always matches hydration */}
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                  status?.open ? "text-up bg-up-soft border-up/20" : "text-muted-foreground bg-secondary"
                }`}
                title={tt(T.delayed, lang)}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${status?.open ? "bg-up animate-pulse" : "bg-muted-foreground"}`} aria-hidden />
                <span className="num">{status?.cairoTime ?? "--:--"}</span>
                {tt(T.cairoTime, lang)}
              </span>
            </div>
          </div>

          {/* the one and only nav row — T27 grouped navigation · T30 pill
              styling + scroll-edge fades: the active surface pops as a filled
              pill, hovers acknowledge, and the fades signal more to scroll */}
          <nav
            aria-label={lang === "ar" ? "التنقل الرئيسي" : "Main navigation"}
            className="relative flex items-center gap-1 overflow-x-auto thin-scroll px-1 pb-1.5 pt-1 [--edge:12px] [mask-image:linear-gradient(to_left,transparent,black_var(--edge),black_calc(100%-var(--edge)),transparent)] rtl:[mask-image:linear-gradient(to_right,transparent,black_var(--edge),black_calc(100%-var(--edge)),transparent)]"
          >
            {DIRECT_NAV.map((item) => {
              const active = navActive(item.view, view.name);
              const Icon = item.icon;
              return (
                <button
                  key={item.view}
                  onClick={() => navigate(item.view)}
                  className={`whitespace-nowrap inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12.5px] leading-none transition-all hover:bg-secondary ${
                    active ? "bg-primary text-primary-foreground font-semibold shadow-sm" : "text-muted-foreground"
                  }`}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                  {tt(item.t, lang)}
                </button>
              );
            })}
            {NAV_GROUPS.map((group) => {
              const active = groupActive(group, view.name);
              const GroupIcon = group.icon;
              const activeItem = group.items.find((it) => navActive(it.view, view.name));
              return (
                <DropdownMenu key={group.key}>
                  <DropdownMenuTrigger asChild>
                    <button
                      className={`whitespace-nowrap inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[12.5px] leading-none transition-all hover:bg-secondary ${
                        active ? "bg-primary text-primary-foreground font-semibold shadow-sm" : "text-muted-foreground"
                      }`}
                      aria-current={active ? "page" : undefined}
                      aria-haspopup="menu"
                    >
                      <GroupIcon className="h-3.5 w-3.5" aria-hidden />
                      {tt(group.t, lang)}
                      <ChevronDown className="h-3 w-3 opacity-60" aria-hidden />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="min-w-44">
                    {group.items.map((it) => {
                      const ItemIcon = it.icon;
                      const itemActive = navActive(it.view, view.name);
                      return (
                        <DropdownMenuItem
                          key={it.view}
                          onClick={() => navigate(it.view)}
                          className={`gap-2 ${itemActive ? "font-semibold" : ""}`}
                          aria-current={itemActive ? "page" : undefined}
                        >
                          <ItemIcon className="h-3.5 w-3.5" aria-hidden />
                          {tt(it.t, lang)}
                          {itemActive && <ChevronRight className="h-3 w-3 ms-auto text-primary rtl:rotate-180" aria-hidden />}
                        </DropdownMenuItem>
                      );
                    })}
                    {activeItem && (
                      <>
                        <DropdownMenuSeparator />
                        <div className="px-2 py-1 text-[10px] text-muted-foreground">
                          {tt({ ar: "أنت في", en: "You are on" }, lang)}: {tt(activeItem.t, lang)}
                        </div>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            })}
          </nav>
        </div>
      </header>

      {/* main */}
      <main id="main-content" className="flex-1">
        <div className="mx-auto max-w-6xl px-4 py-6">
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-card focus:px-3 focus:py-2 focus:rounded-md focus:border"
          >
            {tt(T.skipToContent, lang)}
          </a>
          {view.name === "home" && <OverviewView />}
          {view.name === "market" && <MarketView />}
          {view.name === "screener" && <ScreenerView />}
          {view.name === "sectors" && <SectorsView />}
          {view.name === "heat" && <HeatView />}
          {view.name === "activity" && <ActivityView />}
          {view.name === "investors" && <InvestorsView />}
          {view.name === "today" && <NewsView />}
          {view.name === "watchlist" && <WatchlistView />}
          {view.name === "tools" && <ToolsView />}
          {view.name === "company" && <CompanyView ticker={view.ticker ?? "COMI"} panel={view.panel ?? "overview"} />}
          {view.name === "exchange" && <ExchangeView />}
          {view.name === "calendar" && <CalendarView />}
          {view.name === "compare" && <CompareView />}
          {view.name === "signals" && <SignalsView />}
          {view.name === "lab" && <StrategyLabView />}
          {view.name === "funds" && <FundsView />}
          {view.name === "gcc" && <GccView />}
          {view.name === "paper" && <PaperView />}
          {view.name === "reports" && <ReportsView />}
          {view.name === "agent" && <AgentView />}
          {view.name === "api" && <ApiDocsView />}
        </div>
      </main>

      {/* footer */}
      <footer className="mt-auto border-t bg-card">
        <div className="mx-auto max-w-6xl px-4 py-5 text-xs text-muted-foreground leading-relaxed">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <img src="/logo.png?v=224" alt="EGX Desk" width={27} height={22} className="h-[22px] w-auto dark:hidden" />
            <img src="/logo-dark.png?v=224" alt="EGX Desk" width={27} height={22} className="hidden h-[22px] w-auto dark:block" />
            <button
              onClick={() => navigate("api")}
              className="ms-auto text-[11px] hover:text-primary hover:underline"
            >
              {tt(T.apiDocsTitle, lang)}
            </button>
            {/* G14 — install the app (footer placement keeps the 390px header
                cluster within bounds; appears only when the browser offers it) */}
            <InstallButton />
            {/* visible version so installed-PWA users can tell old from new */}
            <span className="num text-[10px] text-muted-foreground" title={`${tt(T.versionLabel, lang)} — ${BUILD_DATE}`}>
              v{APP_VERSION}
            </span>
          </div>
          {tt(T.footerNote, lang)}
        </div>
      </footer>

    </div>
  );
}
