"use client";

import { useEffect, useState } from "react";
import { useApp } from "../market/app-context";
import { holderColor } from "@/lib/holder-color";
import { dn, type Lang } from "@/lib/i18n";

/** T58 — the company-page OWNERSHIP card (الملكية), the esthmr-style equity
 *  summary: top filed holders as a share bar + the hatched "غير معلن"
 *  remainder (never normalized away) + the latest filing date, plus a link
 *  that opens the عدسة الملكية focused on this company. Pure display of
 *  official EGX disclosure data — every position links to its bulletin. */

type Profile = {
  ok: boolean;
  ticker: string;
  name: string;
  nameAr: string;
  holders: { holder: string; holderEn: string | null; kind: "p" | "f"; pct: number; asOf: string | null; basis: "r" | "t"; filingId: string | null; bulletin: string | null }[];
  disclosedPct: number;
  remainderPct: number;
  latestAsOf: string | null;
  crossOut: { held: string; pct: number | null; valueEgp: number | null; bulletin: string | null }[];
  crossIn: { owner: string; pct: number | null; valueEgp: number | null; bulletin: string | null }[];
  sourceAr: string;
  source: string;
};

export function OwnershipCard({ ticker, lang }: { ticker: string; lang: Lang }) {
  const { navigate } = useApp();
  const [p, setP] = useState<Profile | null>(null);
  // T73 — a load FAILURE is no longer allowed to masquerade as "no filed
  // stakes": the old code swallowed every error and rendered NOTHING, which
  // on a data-honesty product reads as "this company has no disclosures".
  // Only a definitive ok:false (unknown ticker → genuinely no archive row)
  // keeps the card hidden; a network/5xx failure shows an honest error row
  // with a retry.
  const [failed, setFailed] = useState(false);
  // T73 — retry tick: bumps the fetch effect so the error row's button
  // actually re-fires the request (no page reload needed)
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    fetch(`/api/ownership-lens?ticker=${encodeURIComponent(ticker)}`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok && r.status >= 500) throw new Error(String(r.status));
        return r.json();
      })
      .then((j: Profile) => {
        if (alive && j.ok) setP(j);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [ticker, retryTick]);

  if (failed) {
    return (
      <section className="rounded-lg border border-dashed bg-card p-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="font-bold">{lang === "ar" ? "الملكية" : "Ownership"}</h2>
          <button
            className="text-xs underline text-muted-foreground hover:text-foreground"
            onClick={() => {
              setFailed(false);
              setP(null);
              setRetryTick((t) => t + 1);
            }}
          >
            {lang === "ar" ? "أعد المحاولة" : "retry"}
          </button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {lang === "ar"
            ? "تعذّر تحميل بيانات الملكية الآن — وقد تكون موجودة فعلًا؛ أعد المحاولة أو افتح العدسة."
            : "Ownership data could not load right now — it may well exist; retry or open the lens."}
        </p>
      </section>
    );
  }

  if (!p || p.holders.length === 0) return null; // companies with no filed stakes show nothing

  const holderName = (h: Profile["holders"][number]) => (lang === "ar" || !h.holderEn ? h.holder : h.holderEn);
  const basis = (b: "r" | "t") => (b === "r" ? (lang === "ar" ? "سجل الملكية" : "register") : lang === "ar" ? "صفقة" : "trade");
  const top = p.holders.slice(0, 4);

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <h2 className="font-bold">{lang === "ar" ? "الملكية" : "Ownership"}</h2>
        <button
          className="text-xs underline text-muted-foreground hover:text-foreground"
          onClick={() => navigate("lens", { focus: `t:${ticker}` })}
          title={lang === "ar" ? "افتح عدسة الملكية" : "open the Ownership Lens"}
        >
          {lang === "ar" ? "افتح العدسة ↗" : "open the lens ↗"}
        </button>
      </div>
      {/* share bar: top holders + hatched not-disclosed remainder */}
      <div className="flex h-5 w-full overflow-hidden rounded-md border">
        {top.map((h) => (
          <div key={h.holder} style={{ width: `${Math.max(0.5, Math.min(100, h.pct))}%`, backgroundColor: holderColor(h.holder) }} title={`${holderName(h)} · ${h.pct}%`} />
        ))}
        {p.remainderPct > 0 && <div style={{ width: `${p.remainderPct}%` }} className="hatch-bg" />}
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        {lang === "ar" ? "من رأس مال الشركة" : "of the company's share capital"} ·{" "}
        {lang === "ar" ? "آخر إفصاح ملكية" : "latest ownership filing"} {p.latestAsOf ?? "—"}
      </p>
      <div className="mt-2 space-y-1">
        {top.map((h) => (
          <div key={h.holder} className="flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: holderColor(h.holder) }} />
              <span className="truncate">{holderName(h)}</span>
            </span>
            <span className="num shrink-0">
              <b>{h.pct.toFixed(h.pct < 10 ? 2 : 1)}%</b>
              <span className="text-[10px] text-muted-foreground ms-1.5">{basis(h.basis)}</span>
            </span>
          </div>
        ))}
        {p.remainderPct > 0 && (
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="hatch-bg size-2 shrink-0 rounded-sm border" />
              {lang === "ar" ? "غير معلن" : "not disclosed"}
            </span>
            <span className="num">
              <b>{p.remainderPct.toFixed(1)}%</b>
            </span>
          </div>
        )}
      </div>
      {(p.crossOut.length > 0 || p.crossIn.length > 0) && (
        <p className="mt-2 text-[11px] text-muted-foreground leading-relaxed">
          {p.crossOut.length > 0 &&
            `${lang === "ar" ? "تملك:" : "owns:"} ${p.crossOut.map((c) => `${c.held}${c.pct != null ? ` ${c.pct}%` : ""}`).join(" · ")}`}
          {p.crossOut.length > 0 && p.crossIn.length > 0 && " · "}
          {p.crossIn.length > 0 && `${lang === "ar" ? "تملكها:" : "held by:"} ${p.crossIn.map((c) => `${c.owner}${c.pct != null ? ` ${c.pct}%` : ""}`).join(" · ")}`}
        </p>
      )}
    </section>
  );
}
