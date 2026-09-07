"use client";

import { useApp } from "./app-context";
import { T, tt } from "@/lib/i18n";
import { HeaderSearch } from "./header-search";
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

const PRIMARY_NAV = [
  { key: "overview", view: "home", t: T.overview },
  { key: "explore", view: "market", t: T.explore },
  { key: "news", view: "today", t: T.news },
  { key: "investors", view: "investors", t: T.investors },
  { key: "watch", view: "watchlist", t: T.watchlist },
  { key: "tools", view: "tools", t: T.tools },
];

/** Section tabs shown under the header, changing per context. */
function sectionTabs(currentView: string) {
  const all = [
    { view: "market", t: T.market },
    { view: "screener", t: { ar: "الفرز", en: "Screener" } },
    { view: "investors", t: T.investors },
    { view: "activity", t: T.activity },
    { view: "heat", t: T.map },
    { view: "sectors", t: T.sectors },
  ];
  if (currentView === "company") {
    return [{ view: "market", t: T.market }, { view: "company", t: { ar: "شركة", en: "Company" } }];
  }
  return all;
}

export function AppShell() {
  const { lang, setLang, view, navigate, status } = useApp();
  const { theme, setTheme } = useTheme();

  return (
    <div className="min-h-screen flex flex-col">
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
              {/* inline header search — expands inside the header, never a modal */}
              <HeaderSearch />

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
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
                    {theme === "dark" ? <Sun className="h-4 w-4 me-2" /> : <Moon className="h-4 w-4 me-2" />}
                    {theme === "dark" ? (lang === "ar" ? "المظهر النهاري" : "Light theme") : lang === "ar" ? "المظهر الليلي" : "Dark theme"}
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

          {/* primary nav */}
          <nav aria-label={lang === "ar" ? "التنقل الرئيسي" : "Main navigation"} className="flex items-center gap-1 overflow-x-auto thin-scroll pb-px">
            {PRIMARY_NAV.map((item) => {
              const active =
                (item.view === "home" && (view.name === "home" || view.name === "exchange")) ||
                (item.view === "market" &&
                  (view.name === "market" || view.name === "company" || view.name === "screener")) ||
                view.name === item.view;
              return (
                <button
                  key={item.key}
                  onClick={() => navigate(item.view)}
                  className={`relative whitespace-nowrap px-3 py-2 text-sm transition-colors hover:text-foreground ${
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

      {/* section tabs */}
      <nav aria-label={lang === "ar" ? "أقسام الصفحة" : "Page sections"} className="border-b bg-background/80 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 flex items-center gap-1 overflow-x-auto thin-scroll">
          {sectionTabs(view.name).map((tab) => {
            const active = view.name === tab.view;
            return (
              <button
                key={tab.view}
                onClick={() => (tab.view === "company" ? navigate("company", { ticker: view.ticker, panel: view.panel }) : navigate(tab.view))}
                className={`whitespace-nowrap px-3 py-1.5 text-xs rounded-t-sm transition-colors ${
                  active ? "bg-secondary font-semibold" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tt(tab.t, lang)}
              </button>
            );
          })}
        </div>
      </nav>

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
        </div>
      </main>

      {/* footer */}
      <footer className="mt-auto border-t bg-card">
        <div className="mx-auto max-w-6xl px-4 py-5 text-xs text-muted-foreground leading-relaxed">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="flex h-5 w-5 items-center justify-center rounded-sm bg-primary text-primary-foreground text-[10px] font-bold num">X</span>
            <span className="font-semibold text-foreground">{tt(T.brand, lang)}</span>
          </div>
          {tt(T.footerNote, lang)}
        </div>
      </footer>

    </div>
  );
}
