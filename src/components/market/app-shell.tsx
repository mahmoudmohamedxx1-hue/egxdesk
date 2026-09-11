"use client";

import { useApp } from "./app-context";
import { T, tt } from "@/lib/i18n";
import { HeaderSearch } from "./header-search";
import { AlertsBell } from "./alerts-panel";
import { PwaRegister, InstallButton } from "./pwa-register";
import { ShareButton } from "./share-button";
import { OverviewView } from "@/components/views/overview-view";
import { MarketView } from "@/components/views/market-view";
import { ScreenerView } from "@/components/views/screener-view";
import { SectorsView } from "@/components/views/sectors-view";
import { HeatView } from "@/components/views/heat-view";
import { ActivityView } from "@/components/views/activity-view";
import { InvestorsView } from "@/components/views/investors-view";
import { NewsView } from "@/components/views/news-view";
import { WatchlistView } from "@/components/views/watchlist-view";
import { ToolsView } from "@/components/views/tools-view";
import { CompanyView } from "@/components/views/company-view";
import { ExchangeView } from "@/components/views/exchange-view";
import { CalendarView } from "@/components/views/calendar-view";
import { CompareView } from "@/components/views/compare-view";
import { ApiDocsView } from "@/components/views/api-docs-view";
import { SignalsView } from "@/components/views/signals-view";
import { AgentView } from "@/components/views/agent-view";
import { APP_VERSION, BUILD_DATE } from "@/lib/version";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Languages, Moon, Sun, ChevronDown } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect } from "react";

/** ONE navigation row — every view of the app in a single header line
 *  (the old two-layer primary-nav + section-tabs duplicated "Market" and
 *  "Investors" and pushed the analytical views into a second row users
 *  had to notice; now there is exactly one header and one nav). */
const NAV = [
  { view: "home", t: T.overview },
  { view: "market", t: T.market },
  { view: "screener", t: { ar: "الفرز", en: "Screener" } },
  { view: "signals", t: T.signalsNav },
  { view: "heat", t: T.map },
  { view: "sectors", t: T.sectors },
  { view: "investors", t: { ar: "المستثمرون", en: "Investors" } },
  { view: "activity", t: T.activity },
  { view: "calendar", t: { ar: "التقويم", en: "Calendar" } },
  { view: "compare", t: { ar: "المقارنة", en: "Compare" } },
  { view: "today", t: T.news },
  { view: "agent", t: T.agentNav },
  { view: "watchlist", t: T.watchlist },
  { view: "tools", t: T.tools },
];

/** Which nav item is highlighted for a given view (families stay grouped). */
function navActive(navView: string, current: string): boolean {
  if (navView === "home") return current === "home" || current === "exchange";
  if (navView === "market") return current === "market" || current === "screener" || current === "company";
  return navView === current;
}

export function AppShell() {
  const { lang, setLang, view, navigate, status } = useApp();
  const { theme, setTheme } = useTheme();

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

  return (
    <div className="min-h-screen flex flex-col">
      {/* G14 — service-worker registration (app shell cache; API never cached) */}
      <PwaRegister />
      {/* header */}
      <header className="border-b bg-card sticky top-0 z-40">
        <div className="mx-auto max-w-6xl px-4">
          {/* top row */}
          <div className="flex items-center justify-between gap-3 py-2.5">
            <div className="flex items-center gap-3 min-w-0">
              <button onClick={() => navigate("home")} className="flex items-center gap-2 shrink-0" aria-label="EGX Desk home">
                <span className="flex h-7 w-7 items-center justify-center rounded-sm bg-primary text-primary-foreground text-xs font-bold num">
                  X
                </span>
                <span className="text-sm font-bold tracking-tight">{tt(T.brand, lang)}</span>
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

              {/* direct light/dark toggle — dark is the default; theme state is
                  undefined until mount, so we fall back to "dark" pre-mount to
                  keep prerendered HTML matching hydration */}
              <Button
                variant="ghost"
                size="sm"
                aria-label={tt((theme ?? "dark") === "dark" ? T.switchToLight : T.switchToDark, lang)}
                title={tt((theme ?? "dark") === "dark" ? T.switchToLight : T.switchToDark, lang)}
                onClick={() => {
                  try {
                    localStorage.setItem("egx-theme-chosen", "1");
                  } catch {}
                  setTheme((theme ?? "dark") === "dark" ? "light" : "dark");
                }}
              >
                {(theme ?? "dark") === "dark" ? (
                  <Sun className="h-4 w-4" />
                ) : (
                  <Moon className="h-4 w-4" />
                )}
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

          {/* the one and only nav row */}
          <nav aria-label={lang === "ar" ? "التنقل الرئيسي" : "Main navigation"} className="flex items-center gap-0.5 overflow-x-auto thin-scroll pb-px -mx-1 px-1">
            {NAV.map((item) => {
              const active = navActive(item.view, view.name);
              return (
                <button
                  key={item.view}
                  onClick={() => navigate(item.view)}
                  className={`relative whitespace-nowrap px-2.5 py-2 text-[13px] transition-colors hover:text-foreground ${
                    active ? "font-semibold text-foreground" : "text-muted-foreground"
                  }`}
                  aria-current={active ? "page" : undefined}
                >
                  {tt(item.t, lang)}
                  {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" aria-hidden />}
                </button>
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
          {view.name === "agent" && <AgentView />}
          {view.name === "api" && <ApiDocsView />}
        </div>
      </main>

      {/* footer */}
      <footer className="mt-auto border-t bg-card">
        <div className="mx-auto max-w-6xl px-4 py-5 text-xs text-muted-foreground leading-relaxed">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="flex h-5 w-5 items-center justify-center rounded-sm bg-primary text-primary-foreground text-[10px] font-bold num">X</span>
            <span className="font-semibold text-foreground">{tt(T.brand, lang)}</span>
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
