"use client";

import { fmtPct, directionClass } from "@/lib/format";
import { cn } from "@/lib/utils";

export function ChangeCell({ pct, size = "sm" }: { pct: number | null | undefined; size?: "sm" | "md" }) {
  const cls = directionClass(pct);
  return (
    <span
      dir="ltr"
      className={cn(
        "num inline-block rounded-sm px-1.5 py-0.5",
        size === "md" ? "text-sm font-semibold" : "text-xs font-medium",
        cls,
        typeof pct === "number" && pct > 0 && "bg-up-soft",
        typeof pct === "number" && pct < 0 && "bg-down-soft"
      )}
    >
      {fmtPct(pct)}
    </span>
  );
}
