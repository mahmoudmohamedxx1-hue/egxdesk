import type { NextConfig } from "next";

/** T48 — baseline hardening headers on every response:
 *  • CSP: everything the app loads is same-origin (next/font self-hosts the
 *    fonts, images/charts are local or /api-generated) — external scripts,
 *    styles, frames and connects are simply refused, which kills the classic
 *    XSS-injection vector. 'unsafe-inline' stays for script/style because
 *    Next's hydration + Tailwind need it (nonce-based CSP would be the next
 *    step, not a today risk). frame-ancestors 'none' locks clickjacking out.
 *  • X-Frame-Options / nosniff / Referrer-Policy / Permissions-Policy — the
 *    standard belt-and-braces set.
 *  • Cross-Origin-* headers keep shared-bucket subresources isolated. */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  output: "standalone",
  /* T55 — pin the Turbopack workspace root to this project dir. With more
   * than one lockfile present (bun.lock + package-lock.json) Turbopack
   * "infers" the root and can nest the standalone output under a wrong
   * parent (seen in the clean-room build test); an explicit root makes the
   * build layout deterministic on every host. */
  turbopack: {
    root: process.cwd(),
  },
  /* Task 20: ignoreBuildErrors removed — the production build must fail
   * loudly on type errors instead of shipping them (tsc is clean). */
  reactStrictMode: false,
  /* T50 — carry the SQLite file into every serverless function bundle
   * (Vercel traces imports but a runtime `file:` path is invisible to it).
   * At runtime src/lib/db.ts copies it to /tmp — the only writable dir on
   * a serverless instance — so all read-backed features work on Vercel. */
  outputFileTracingIncludes: {
    "/api/**": ["./db/custom.db"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
