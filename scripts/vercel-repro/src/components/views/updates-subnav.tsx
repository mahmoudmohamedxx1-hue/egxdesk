"use client";

/** T63 — the Updates group's subnav strip (esthmr's journal-subnav):
 *  the three destinations of المستجدات — الأخبار / الإفصاحات / ربط النقاط —
 *  with the open one marked `aria-current="page"` and underlined in the
 *  accent, followed by the group's own one-line question (the source's
 *  navAsk: "أخبار اليوم وإفصاحاته، مع سبب أهمية كل خبر."). The source
 *  renders this strip in its chrome on every screen of the group; this app
 *  renders it at the top of each of the three views. */

import { useApp } from "../market/app-context";

export function UpdatesSubnav({ current }: { current: "today" | "disclosures" | "crossings" }) {
  const { lang, navigate } = useApp();
  const tabs = [
    { view: "today", label: lang === "ar" ? "الأخبار" : "News" },
    { view: "disclosures", label: lang === "ar" ? "الإفصاحات" : "Disclosures" },
    { view: "crossings", label: lang === "ar" ? "ربط النقاط" : "Connecting the dots" },
  ] as const;
  return (
    <div className="flex flex-col gap-2">
      <nav aria-label={lang === "ar" ? "المستجدات" : "Updates"} className="flex flex-wrap gap-2">
        {tabs.map((t) => {
          const on = t.view === current;
          return (
            <button
              key={t.view}
              onClick={() => navigate(t.view)}
              aria-current={on ? "page" : undefined}
              className={`min-h-11 rounded-lg border px-4 py-2 text-sm transition-colors ${
                on
                  ? "rounded-none border-b-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </nav>
      <p className="text-sm text-muted-foreground [text-wrap:pretty]">
        {lang === "ar" ? "أخبار اليوم وإفصاحاته، مع سبب أهمية كل خبر." : "Today's news and disclosures, each with why it matters."}
      </p>
    </div>
  );
}
