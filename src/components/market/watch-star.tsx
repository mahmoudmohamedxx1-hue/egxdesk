"use client";

import { useApp } from "./app-context";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

export function WatchStar({ ticker, className }: { ticker: string; className?: string }) {
  const { isWatched, toggleWatch, auth, lang } = useApp();
  const watched = isWatched(ticker);
  return (
    <button
      type="button"
      aria-label={watched ? "إزالة من المتابعة" : "أضف للمتابعة"}
      title={
        !auth.email
          ? lang === "ar" ? "سجّل الدخول للمتابعة" : "Sign in to follow"
          : watched
          ? lang === "ar" ? "إزالة من المتابعة" : "Remove from watchlist"
          : lang === "ar" ? "أضف للمتابعة" : "Add to watchlist"
      }
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
