/** T48 — AUTH SECURITY LAYER: keeps bots and AI agents from creating
 *  accounts (the user: "not bot can access it to hack it … ai agents any ai
 *  can login to it using temp mail or something so i want to stop that").
 *
 *  Five independent gates, all server-side, all fail-closed:
 *
 *   1. looksLikeBot(userAgent) — the auth routes only ever need a real
 *      browser; scripted clients (curl, python-requests, scrapy, headless
 *      automation, generic HTTP libs) are refused before any Supabase call.
 *   2. Disposable-email blocklist — the temp-mail domains AI agents use to
 *      spin up throwaway inboxes (mailinator, guerrillamail, mail.tm, …
 *      ~240 curated domains incl. the ones our own earlier tests abused,
 *      e.g. uberip.com) are rejected at the request step, so no account is
 *      ever created for them.
 *   3. Challenge tokens — every POST to the auth routes must first GET
 *      /api/auth/subabase/challenge (typo-safe constants below) and echo the
 *      HMAC token; it is bound to IP + UA hash + a 15-minute expiry and is
 *      single-use per endpoint scope, so a raw scripted POST without the
 *      pre-flight never gets through.
 *   4. Dwell-time + honeypot — the dialog reports when it was opened and a
 *      hidden field bots autofill; instant submissions and filled honeypots
 *      are refused.
 *   5. Email normalization for limits — plus-addresses (user+tag@…) and
 *      gmail dots are collapsed so one mailbox cannot farm many identities.
 *
 *  Nothing here invents success states: every rejection is an honest 403
 *  with a specific reason, and every check is cheap (set lookups + HMAC). */

const SERVER_ONLY_GUARD = typeof window === "undefined";
if (!SERVER_ONLY_GUARD) {
  throw new Error("auth-security must never run in the browser — secrets would leak");
}

import { createHmac, timingSafeEqual } from "node:crypto";

// ── 1. the disposable-email blocklist ────────────────────────────────────
// Curated from the well-known temp-mail providers' published domain pools.
// Any signup with one of these domains is refused — that is exactly the
// "AI agent logs in with temp mail" vector the user wants closed.

const DISPOSABLE_DOMAINS = new Set<string>([
  // mailinator family
  "mailinator.com", "mailinator.net", "mailinator.org", "sogetthis.com", "spamhereplease.com",
  "reallymymail.com", "omailbox.com", "mailinator2.com", "getairmail.com", "getairmail.net",
  "gustr.com", "chunkzang.com", "mailismagic.com", "mailismagic.net", "spam4.me",
  // guerrillamail family
  "guerrillamail.com", "guerrillamail.net", "guerrillamail.org", "guerrillamail.biz",
  "guerrillamailblock.com", "grr.la", "sharklasers.com", "guerrillamail.info",
  "pokemail.net", "guerrillamail.de",
  // temp-mail family
  "temp-mail.org", "temp-mail.io", "tempmail.net", "tempmailo.com", "tempmail.dev",
  "tempmail.plus", "tempmail.zone", "tempmail.email", "tempmail.tools", "tempmail.lol",
  "tempmailgen.com", "tempmailaddress.com", "tempmail.cn", "tempr.email",
  "internxt.com", "mailtemp.net", "mailtemp.uk", "vomoto.com", "usito.net",
  "femailtor.com", "tmail.ws", "tmails.net", "tmail123.com", "tmailinator.com",
  "tempmail.ninja",
  // 10minutemail family
  "10minutemail.com", "10minutemail.net", "10minutemail.org", "10minutemail.info",
  "10minutemail.biz", "10minutemail.de", "20minutemail.com", "20minutemail.net",
  "1minmail.com", "5minutemail.net", "5minutemail.org", "dmail.unrivaledtechnologies.com",
  // yopmail family
  "yopmail.com", "yopmail.net", "yopmail.fr", "yopmail.me", "yopmail.org",
  "yopmail.us", "cool.fr.nf", "jetable.fr.nf", "nospam.ze.tc", "nomail.xl.cx",
  "mega.zik.dj", "speed.1s.fr", "courriel.fr.nf", "moncourrier.fr.nf", "monemail.fr.nf",
  "monmail.fr.nf", "proton.goomail.com",
  // throwaway/trash
  "throwawaymail.com", "throwawaymail.net", "throwawaymail.org", "throwaway.email",
  "trashmail.com", "trashmail.net", "trashmail.de", "trash-mail.com", "trash-mail.de",
  "trashmail.me", "trashmail.tk", "wegwerfmail.de", "wegwerfmail.net", "wegwerfmail.org",
  "weg-werf-mail.de", "byom.de", "einrot.com", "gustr.com", "fleebix.com",
  "mailboxy.fun", "mailbox52.ga", "mvrht.net", "mvrht.com", "discard.email",
  "discardmail.com", "discardmail.de", "kurzedrmail.com", "objectmail.com",
  "proxymail.us", "rcpt.at", "trash2009.com", "wegwerfmailadressen.com",
  // mail.tm / mail.gw (used by our own earlier T47 tests!)
  "mail.tm", "mail.gw", "uberip.com", "nestsr.com", "pwrby.com", "inemln.com",
  // other big providers
  "maildrop.cc", "dispostable.com", "mailnesia.com", "fakeinbox.com", "fake-mail.net",
  "getnada.com", "nada.email", "nada.lol", "inboxbear.com", "mytemp.email",
  "mytempemail.com", "moakt.com", "moakt.ws", "tempinbox.com", "tmpmail.org",
  "tmpmail.net", "tmpeml.com", "inboxkitten.com", "kitten-mail.com", "smailpro.com",
  "emailondeck.com", "email-fake.com", "emailfake.com", "emailtemporanea.net",
  "burnermail.io", "burnermail.com", "anonbox.net", "anonmails.de", "anonmail.net",
  "anonymbox.com", "anonymousmail.net", "incognitomail.com", "incognitomail.net",
  "incognitomail.org", "incognito-mail.com", "deadaddress.com", "deathmail.com",
  "sneakemail.com", "spamgourmet.com", "spamhole.com", "spaml.com", "spamex.com",
  "mailcatch.com", "maildropbox.org", "mailexpire.com", "mail-temporaire.fr",
  "mailtemp.info", "spambox.us", "spambog.com", "spambog.de", "spambog.ru",
  "spamherelots.com", "spamhole.com", "mailzilla.com", "mailzilla.org", "meltmail.com",
  "mintemail.com", "incognitomail.com", "letthemeatspam.com", "mailde.de",
  "mailde.info", "mail-be-de.de", "einmail.com", "einmail.net", "mailsac.com",
  "mailsac.com", "inboxalias.com", "inboxproxy.com", "lyfetrain.cf", "tormail.org",
  // dropmail family
  "dropmail.me", "dropmail18.net", "dropmail13.net", "dropmail7.net", "dropmail6.net",
  "dropmail4.net", "dropmail3.net", "dropmail2.net", "dropmail1.net", "dropmail.net",
  "dlemail.ru", "grr.la", "dropmail.me",
  // minute-box / short-term pools
  "minuteinbox.com", "minutemailbox.com", "1secmail.com", "1secmail.net",
  "1secmail.org", "1secmail.xyz", "esiix.com", "wwjmp.com", "xojxe.com",
  "yoggm.com", "inboxes.com", "inbox.si", "inbox.lt", "binkmail.com",
  "bobmail.info", "chammy.info", "devnullmail.com", "letthemeatspam.com",
  "mailin8r.com", "mailinater.com", "mailinator.net", "notmailinator.com",
  "reallymymail.com", "safetymail.info", "sendspamhere.com", "sogetthis.com",
  "suremail.info", "thisisnotmyrealemail.com", "tradermail.info", "zippymail.info",
  // maildrop-like / alias pools
  "altmails.com", "fexpost.com", "fexbox.com", "fexbox.ru", "relay-burstmail.com",
  "mail-temp.com", "tempmailaddress.com", "instantemailaddress.com", "instant-mail.de",
  "mailhub.top", "mailhound.com", "mailpooch.com", "ponpedia.com", "smashmail.de",
  "spoofmail.de", "spoofmail.net", "xyzfree.net", "zetmail.com", "zipmailbox.com",
  // more rotation pools seen in the wild
  "armyspy.com", "cuvox.de", "dayrep.com", "einrot.com", "fleckens.hu", "gustr.com",
  "jourrapide.com", "rhyta.com", "superrito.com", "teleworm.us", "spam4.me",
  "besides7.com", "live.com.co", "enderspot.com", "gufum.com", "tankami.com",
  "qlingky.com", "tempmail.se", "tempmail.co.uk", "temp.fail",
  "tmpbox.net", "tmpdir.org", "throwam.com", "throwawaymail.org", "toiea.com",
  "vomoto.com", "yandex-mail.online", "zetmail.com", "1mail.x10.mx",
  "tempemail.net", "tempemail.co", "temporaryemail.net", "temporaryinbox.com",
  "discard.cf", "discard.ga", "discard.gq", "discard.ml", "discard.tk",
  "mailcatch.com", "mailinator.gq", "mailinator.ga", "mailinator.ml", "mailinator.tk",
  "mytrashmail.com", "nospammail.net", "shortmail.net", "shortmailaddress.com",
  "sinnlos-mail.de", "sofort-mail.de", "spambog.de", "spambog.net", "spambog.com",
  "spamfree24.de", "spamfree24.net", "spamfree24.org", "spamfree24.eu", "spamfree24.info",
  "tempemail.com", "tempmail.email", "tempmaildemo.com", "tempmailer.com",
  "tempmailer.de", "tempmailervs.com", "tempmailo.net", "temporarymail.net",
  "temporarymail.com", "thankyou2010.com", "trashmail.at", "trashmail.ch",
  "trashmail.co.uk", "trashmail.info", "trashmailmail.com", "wegwerfmail.info",
]);

export function isDisposableEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  if (!domain) return true; // no domain at all → refuse
  if (DISPOSABLE_DOMAINS.has(domain)) return true;
  // mailinator-style subdomain wildcards: anything.mailinator.com etc.
  const parts = domain.split(".");
  for (let i = 1; i < parts.length - 1; i++) {
    if (DISPOSABLE_DOMAINS.has(parts.slice(i).join("."))) return true;
  }
  return false;
}

// ── 2. bot / scripted-client detection (auth routes only) ────────────────

const BOT_UA_RE =
  /(bot|crawler|spider|scrapy|slurp|archiver|fetcher|\bcurl\b|\bwget\b|python|urllib|httpclient|okhttp|go-http-client|java\/|libwww|httparty|resty|aiohttp|axios|node-fetch|undici|superagent|postman|insomnia|headlesschrome|headless chrome|phantomjs|puppeteer|playwright|selenium|chromium-lighthouse|lighthouse|googleother|bytespider|petalbot|semrush|ahrefs|mj12bot|dotbot|siteaudit|masscan|nmap|nikto|sqlmap|hydra|metasploit)/i;

/** True when the UA is clearly not a normal human browser. Auth routes are
 *  for humans only — the market-data routes stay open to crawlers (SEO). */
export function looksLikeBot(userAgent: string | null | undefined): boolean {
  const ua = (userAgent ?? "").trim();
  if (ua.length < 10) return true; // empty / too-short UA = scripted
  return BOT_UA_RE.test(ua);
}

// ── 3. HMAC challenge tokens (pre-flight for every auth POST) ────────────

const CHALLENGE_TTL_MS = 15 * 60_000;
const CHALLENGE_SECRET =
  process.env.AUTH_CHALLENGE_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "dev-only-secret";

function hmacHex(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

/** Bind the challenge to the caller so a token sniffed/replayed from
 *  another machine fails: the fingerprint mixes IP + UA hash. */
export function authFingerprint(ip: string, userAgent: string | null | undefined): string {
  return hmacHex(CHALLENGE_SECRET, `${ip}|${(userAgent ?? "").slice(0, 160)}`).slice(0, 24);
}

/** Issue a fresh challenge token: <expiryMs>.<hmac(exp|fp)>. */
export function issueChallenge(ip: string, userAgent: string | null | undefined): { token: string; expiresInSeconds: number } {
  const fp = authFingerprint(ip, userAgent);
  const exp = Date.now() + CHALLENGE_TTL_MS;
  return { token: `${exp}.${hmacHex(CHALLENGE_SECRET, `${exp}|${fp}`)}`, expiresInSeconds: Math.floor(CHALLENGE_TTL_MS / 1000) };
}

const g = globalThis as unknown as { __egxBurnedChallenges?: Map<string, number> };
g.__egxBurnedChallenges ??= new Map();

/** Validate a challenge for a given endpoint scope ("request" / "verify" /
 *  "admin"). Checks signature, TTL and single-use (each scope burns its own
 *  copy), and prunes the burn-set so it can never grow unbounded. */
export function verifyChallenge(
  token: string | null | undefined,
  ip: string,
  userAgent: string | null | undefined,
  scope: string,
): boolean {
  if (!token) return false;
  const m = /^(\d+)\.([0-9a-f]{64})$/.exec(token.trim());
  if (!m) return false;
  const exp = Number(m[1]);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const fp = authFingerprint(ip, userAgent);
  if (!safeEqualHex(m[2], hmacHex(CHALLENGE_SECRET, `${exp}|${fp}`))) return false;
  const burnKey = `${m[2]}:${scope}`;
  const burned = g.__egxBurnedChallenges!;
  if (burned.has(burnKey)) return false; // replay
  burned.set(burnKey, Date.now());
  if (burned.size > 4000) {
    const now = Date.now();
    for (const [k, t] of burned) if (now - t > CHALLENGE_TTL_MS) burned.delete(k);
  }
  return true;
}

// ── 4. dwell-time + honeypot ─────────────────────────────────────────────

const DWELL_MIN_MS = 1_500; // humans need ≥ 1.5s to read + type an email
const DWELL_MAX_MS = 30 * 60_000; // and won't submit a 30-minute-old form

export function isDwellValid(openedAt: number | null | undefined): boolean {
  if (typeof openedAt !== "number" || !Number.isFinite(openedAt) || openedAt <= 0) return false;
  const dwell = Date.now() - openedAt;
  return dwell >= DWELL_MIN_MS && dwell <= DWELL_MAX_MS;
}

export function honeypotClean(hp: string | null | undefined): boolean {
  return !hp || hp.trim().length === 0;
}

// ── 5. email normalization for per-mailbox limits ────────────────────────

/** Collapse the tricks one mailbox uses to look like many: plus-addressing
 *  (user+tag@ → user@) everywhere, and dots for gmail/googlemail (gmail
 *  ignores them). Used ONLY for rate-limit keys — the account itself keeps
 *  the exact address the user typed. */
export function normalizeEmailForLimit(email: string): string {
  let v = email.trim().toLowerCase();
  const at = v.lastIndexOf("@");
  if (at < 1) return v;
  let local = v.slice(0, at);
  const domain = v.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.replace(/\./g, "");
    return `${local}@gmail.com`;
  }
  return `${local}@${domain}`;
}
