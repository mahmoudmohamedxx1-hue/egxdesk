"use client";

/** Shareable-URL state helpers (Task 21-c).
 *
 *  The whole app lives on the single `/` route; every view is addressed by
 *  `?view=…` plus a small set of per-view state params (tab, filters,
 *  tickers…). These helpers keep the URL in sync with in-page state so any
 *  page can be copied/shared and reopens exactly as the sharer left it.
 *
 *  Semantics (deliberate):
 *  - `navigate()` (app-context) PUSHES a new history entry when the view
 *    changes — real back/forward routing between pages.
 *  - `patchUrlParams()` REPLACES the current entry when state inside a view
 *    changes — filters/tabs never spam the history stack, and the Back
 *    button still lands on the previous *view* with that view's own params.
 *  - Views read their params once on mount (`bootParam`) — that covers both
 *    a cold load of a shared link and Back/Forward returning to a remounted
 *    view, because a replaceState'd entry keeps its patched params.
 */

/** Read one param from the CURRENT url (client only; "" on the server). */
export function currentParam(key: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(key);
}

/** Read one param at MOUNT time (call inside useEffect). Returns null when
 *  absent — callers treat null as "no URL override, keep local default". */
export function bootParam(key: string): string | null {
  return currentParam(key);
}

/** Merge params into the current URL without navigation (history.replaceState).
 *  A `null`/"" value removes the param. Returns the final query string. */
export function patchUrlParams(patch: Record<string, string | null | undefined>): string {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(patch)) {
    const val = v === null || v === undefined || v === "" ? null : String(v);
    if (val === null) params.delete(k);
    else params.set(k, val);
  }
  const qs = params.toString();
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  try {
    window.history.replaceState(null, "", url);
  } catch {
    /* replaceState can throw on exotic embedders — sharing still works via
     * the live URL, just without param cleanup */
  }
  return qs;
}

/** Build the canonical shareable URL for the current page (with params). */
export function currentShareUrl(): string {
  if (typeof window === "undefined") return "";
  const qs = window.location.search;
  return `${window.location.origin}${window.location.pathname}${qs}`;
}

/** Copy text to the clipboard with a legacy fallback. Returns success. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
