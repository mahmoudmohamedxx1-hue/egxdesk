"use client";

/** T69 — the App-Router ERROR BOUNDARY (the "opening news the website
 *  crashes" fix). Next.js App Router wraps each route segment in an implicit
 *  error boundary — but ONLY if an error.tsx exists; without one, a render
 *  throw anywhere unmounts the whole tree to a BLANK page, which on a PWA
 *  reads as "the website crashed". This boundary catches ANY view-level
 *  crash (unexpected API shape, a bad news item, a chart edge case) and
 *  shows an honest bilingual recover screen instead: reload the view, or
 *  hard-reset the app shell (clears only the CACHED shell + chunks, never
 *  the user's watchlist/alerts/chats in localStorage).
 *
 *  The error is ALSO reported to the server crash log so the failure is
 *  diagnosable from the dev log / Vercel logs — no more invisible crashes. */

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // surface it in the console + best-effort server-side crash note
    console.error("[egx-desk] view crashed:", error);
    try {
      fetch("/api/client-crash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "client-crash", msg: String(error?.message ?? error).slice(0, 300), at: new Date().toISOString() }),
      }).catch(() => {});
    } catch {}
  }, [error]);

  const hardReset = () => {
    try {
      // drop the cached service-worker shell + chunks only — user data
      // (watchlist, alerts, chats) lives in localStorage and survives
      if ("caches" in window) {
        void caches.keys().then((keys) => {
          for (const k of keys) void caches.delete(k);
        });
      }
    } catch {}
    location.replace("/");
    location.reload();
  };

  return (
    <div dir="auto" className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="rounded-full border bg-card px-4 py-1.5 text-xs text-muted-foreground">
        EGX Desk · <span dir="ltr">error boundary</span>
      </div>
      <h1 className="text-xl font-bold">حدث خطأ غير متوقع — والصفحة لم تُفقد</h1>
      <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
        تعطّل جزء من الواجهة أثناء العرض. بياناتك المحلية (المتابعة والتنبيهات والمحادثات) سليمة تمامًا.
        أعد تحميل العرض من الزر أدناه، أو أعد ضبط الواجهة إذا استمر الخطأ.
      </p>
      {error?.message && (
        <code dir="ltr" className="max-w-md truncate rounded-md border bg-secondary/60 px-3 py-1.5 text-[11px] text-muted-foreground">
          {String(error.message).slice(0, 160)}
        </code>
      )}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          onClick={reset}
          className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:opacity-90"
        >
          إعادة تحميل العرض
        </button>
        <button
          onClick={hardReset}
          className="rounded-lg border px-5 py-2.5 text-sm text-muted-foreground hover:text-foreground"
        >
          إعادة ضبط الواجهة
        </button>
      </div>
    </div>
  );
}
