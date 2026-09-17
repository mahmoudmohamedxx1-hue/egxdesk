"use client";

import { useApp } from "./app-context";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

export function WatchStar({ ticker, className }: { ticker: string; className?: string }) {
  const { isWatched, toggleWatch, lang } = useApp();
  const watched = isWatched(ticker);
  // T40 — the aria-label was hardcoded Arabic, so screen-reader users in
  // the English interface heard an Arabic announcement for every star.
  const label = watched
    ? lang === "ar" ? "إزالة من المتابعة" : "Remove from watchlist"
    : lang === "ar" ? "أضف للمتابعة" : "Add to watchlist";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        toggleWatch(ticker);
      }}
      className={cn("inline-flex h-8 w-8 items-center justify-center rounded-sm transition-colors hover:bg-accent", className)}
    >
      <Star
        className={cn("h-4 w-4 transition-colors", watched ? "fill-[#c90] text-[#c90]" : "text-muted-foreground")}
        aria-hidden
      />
    </button>
  );
}
