"use client";

/** T35 — anti-staleness VERSION GUARD.
 *
 *  WHY: a user was stuck on a v2.21-era cached app shell (service-worker
 *  cache + CDN/browser HTTP cache) while the server had moved on to v2.24 —
 *  so they saw a model switcher with only 2 entries and a dead GPT-OSS 20B
 *  route, even though the live build ships 20 curated models + a 1,008-model
 *  catalog. Navigations are network-first in the SW, but a browser that
 *  never revisits (installed PWA, long-lived tab, aggressive proxy cache)
 *  can keep serving yesterday's chunks indefinitely.
 *
 *  HOW: every app boot compares the EMBEDDED build version (APP_VERSION,
 *  baked into this JS chunk) with the server's own version from
 *  /api/health (never cached — the SW treats /api/* as network-only).
 *  If the page is OLDER than the server, the guard:
 *    1. unregisters every service worker,
 *    2. wipes every Cache Storage entry (old shell + old chunks),
 *    3. reloads the page ONCE (a sessionStorage flag prevents loops).
 *  A tiny toast is surfaced through the app's own event so the reload is
 *  never a mystery. Version equality (or an unreachable health check)
 *  no-ops — the guard can never break a healthy session.
 */

import { APP_VERSION } from "@/lib/version";

const RELOAD_FLAG = "egx-version-guard-reloaded";
/** Bumped with APP_VERSION when the guard itself changes semantics. */
const GUARD_KEY = "egx-version-guard";

type HealthShape = { version?: string };

/** numeric-aware compare: "2.9.1" vs "2.24.0" → compares number parts,
 *  missing parts = 0. Returns true when `server` is strictly newer. */
export function isServerNewer(local: string, server: string): boolean {
  const parse = (v: string) =>
    v
      .split(".")
      .map((p) => parseInt(p, 10) || 0)
      .slice(0, 3);
  const a = parse(local);
  const b = parse(server);
  for (let i = 0; i < 3; i++) {
    if ((b[i] ?? 0) !== (a[i] ?? 0)) return (b[i] ?? 0) > (a[i] ?? 0);
  }
  return false;
}

/** sessionStorage-safe flag read (never throws). */
function alreadyReloaded(): boolean {
  try {
    return sessionStorage.getItem(RELOAD_FLAG) === GUARD_KEY;
  } catch {
    return false;
  }
}

function markReloaded() {
  try {
    sessionStorage.setItem(RELOAD_FLAG, GUARD_KEY);
  } catch {}
}

/** Wipe every service worker + cache so the reload can't re-serve the
 *  stale shell. Best-effort — failures still allow the plain reload. */
async function purgeCaches(): Promise<void> {
  try {
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {}
  try {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch {}
}

/** Boot the guard. Safe to call repeatedly; resolves quickly, never throws.
 *  Returns "reloaded" when it triggered a self-heal reload. */
export async function runVersionGuard(): Promise<"noop" | "reloaded" | "stale-unrecovered"> {
  if (typeof window === "undefined") return "noop";
  if (alreadyReloaded()) return "noop";
  try {
    const res = await fetch("/api/health", { cache: "no-store" });
    if (!res.ok) return "noop";
    const health = (await res.json()) as HealthShape;
    const server = health.version;
    if (typeof server !== "string" || !server) return "noop";
    if (!isServerNewer(APP_VERSION, server)) return "noop";

    // this shell is older than the server — self-heal
    window.dispatchEvent(new CustomEvent("egx-stale-shell", { detail: { page: APP_VERSION, server } }));
    await purgeCaches();
    markReloaded();
    window.location.reload();
    return "reloaded";
  } catch {
    return "noop";
  }
}
