"use client";

/** T69 — the ROOT global error boundary (html-level). error.tsx catches
 *  route-segment crashes; global-error.tsx catches failures in the root
 *  LAYOUT itself (theme provider, shell bootstrap). Without it, a root
 *  throw shows the browser's dead blank document. It must render its own
 *  <html><body> — App Router requirement. */

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ar" dir="rtl">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#faf7ef", color: "#1c1917", margin: 0 }}>
        <div style={{ display: "flex", minHeight: "100vh", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 32, textAlign: "center" }}>
          <div style={{ fontSize: 12, color: "#78716c", border: "1px solid #e7e0d2", borderRadius: 999, padding: "4px 14px", background: "#fff" }}>
            EGX Desk · global error
          </div>
          <h1 style={{ fontSize: 20, margin: 0, fontWeight: 700 }}>حدث خطأ في هيكل التطبيق</h1>
          <p style={{ fontSize: 14, color: "#78716c", maxWidth: 460, lineHeight: 1.7, margin: 0 }}>
            تعذّر تشغيل الواجهة الأساسية. بياناتك المحفوظة محليًا في أمان. اضغط إعادة المحاولة — وإن استمر الأمر أعد تثبيت التطبيق من المتصفح.
          </p>
          {error?.digest ? (
            <code dir="ltr" style={{ fontSize: 11, color: "#78716c", background: "#f1ece0", borderRadius: 6, padding: "6px 12px" }}>
              {String(error.digest).slice(0, 120)}
            </code>
          ) : null}
          <button
            onClick={reset}
            style={{ fontSize: 14, fontWeight: 600, background: "#1c1917", color: "#faf7ef", border: 0, borderRadius: 10, padding: "10px 26px", cursor: "pointer" }}
          >
            إعادة المحاولة
          </button>
        </div>
      </body>
    </html>
  );
}
