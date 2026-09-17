/** Single source of truth for the user-visible app version. Bump on every
 *  release so installed PWAs (and the footer chip) can tell old from new —
 *  the service worker VERSION string in public/sw.js must be bumped too. */
export const APP_VERSION = "2.30";

export const BUILD_DATE = "2026-09-17";
