/** SERVER-side web-push engine (G1 mobile): sends real system notifications
 *  to installed PWA instances (iOS 16.4+ / Android / desktop) even when the
 *  app is closed. Each device's alert list is synced from the client on every
 *  change (upsert), and THIS module re-evaluates the conditions against the
 *  same delayed quotes the app shows — mirroring the client engine in
 *  lib/alerts.ts (kept in sync deliberately; that file is client-only so the
 *  small condition math is duplicated here rather than imported).
 *
 *  Notifications fire at most once per alert per device: `notifiedJson` on
 *  the PushDevice row records ids the server already pushed, and the client
 *  stops syncing an alert once it has triggered locally. */

import fs from "node:fs";
import path from "node:path";
import webpush from "web-push";
import { db } from "@/lib/db";
import { fetchUniverse, type Stock } from "@/lib/market";
import { resolveTicker } from "@/lib/ticker-aliases";

// ── VAPID keys (server-secrets/vapid.json locally; data/push-vapid.json is
// the committed app identity that reaches Vercel — see getVapid below) ──

type VapidKeys = { publicKey: string; privateKey: string };

let vapid: VapidKeys | null = null;

/** T69 — VAPID resolution, in priority order:
 *  1. VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY env vars (the rotate-anytime
 *     override — set them on the host and they win over every file),
 *  2. server-secrets/vapid.json (the local dev box's own pair, gitignored),
 *  3. data/push-vapid.json — the app's COMMITTED Web-Push identity.
 *
 *  Why commit a pair at all: the deploy workflow is git-push → Vercel, and
 *  a gitignored file never reaches the server, so push notifications were
 *  silently DEAD on production (GET /api/push/key → "push not configured").
 *  A VAPID keypair is an APPLICATION IDENTITY for Web Push, not an access
 *  credential: the private half only SIGNS push requests to the push
 *  services, and reaching any device additionally requires that device's
 *  subscription endpoint + p256dh + auth secrets, which never leave the
 *  server. Env vars remain the first-class override for rotation. */
function getVapid(): VapidKeys | null {
  if (vapid) return vapid;
  const envPub = process.env.VAPID_PUBLIC_KEY;
  const envPriv = process.env.VAPID_PRIVATE_KEY;
  if (envPub && envPriv) {
    vapid = { publicKey: envPub, privateKey: envPriv };
  } else {
    // same launch-dir robustness as lib/db.ts: project root, one level
    // below, .next/standalone, or derived from the server entry's location
    const cwd = process.cwd();
    const argv1 = process.argv[1] ?? "";
    const serverDir = path.dirname(path.resolve(argv1));
    const bases = [cwd, path.join(cwd, ".."), path.join(cwd, "..", ".."), serverDir];
    outer: for (const rel of ["server-secrets/vapid.json", "data/push-vapid.json"]) {
      for (const base of bases) {
        try {
          const raw = fs.readFileSync(path.join(base, rel), "utf8");
          const parsed = JSON.parse(raw) as VapidKeys;
          if (parsed.publicKey && parsed.privateKey) {
            vapid = parsed;
            break outer;
          }
        } catch {}
      }
    }
  }
  if (vapid) {
    webpush.setVapidDetails("mailto:egx-desk@localhost", vapid.publicKey, vapid.privateKey);
  }
  return vapid;
}

export function vapidPublicKey(): string | null {
  return getVapid()?.publicKey ?? null;
}

// ── sending ──

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  lang?: string;
};

/** Send one notification. Returns false when the subscription is gone
 *  (404/410) — the caller then deletes the device row. */
export async function sendPush(
  device: { endpoint: string; p256dh: string; auth: string },
  payload: PushPayload
): Promise<boolean> {
  if (!getVapid()) return false;
  try {
    await webpush.sendNotification(
      { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
      JSON.stringify(payload),
      { TTL: 24 * 3600, urgency: "high" }
    );
    return true;
  } catch (err: unknown) {
    const status =
      typeof err === "object" && err !== null && "statusCode" in err
        ? Number((err as { statusCode?: number }).statusCode)
        : 0;
    if (status === 404 || status === 410) return false; // subscription expired
    // transient push-service error — retry on the next tick
    return true;
  }
}

// ── alert evaluation (mirror of the client engine — see file header) ──
// T27: multi-condition format. An alert is either the legacy single-cond
// shape (cond/value) or the modern shape (conditions: [{kind, value}] with
// AND semantics). Indicator conditions are evaluated from the same cached
// Yahoo candles /api/chart uses, with the shared indicators math.

type CondKindServer =
  | "priceAbove" | "priceBelow" | "chgAbove" | "chgBelow"
  | "rsiAbove" | "rsiBelow" | "macdAbove" | "macdBelow"
  | "maCrossUp" | "maCrossDown" | "volRatioAbove" | "onDate";

type ServerAlert = {
  id: string;
  ticker: string;
  /** modern format */
  conditions?: { kind: CondKindServer; value: number }[];
  /** legacy format (migrated on read) */
  cond?: "above" | "below" | "risePct" | "fallPct" | "onDate";
  value?: number;
  date?: string;
};

type NormCond = { kind: CondKindServer; value: number };

/** Today's date in Africa/Cairo as YYYY-MM-DD (server runs in UTC).
 * T70: accepts an explicit `now` so the move engine (and its tests) can
 * reason about a specific moment in Cairo time. */
export function cairoTodayStr(now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

const LEGACY_SERVER: Record<string, NormCond[]> = {
  above: [{ kind: "priceAbove", value: 0 }],
  below: [{ kind: "priceBelow", value: 0 }],
  risePct: [{ kind: "chgAbove", value: 0 }],
  fallPct: [{ kind: "chgBelow", value: 0 }],
  onDate: [{ kind: "onDate", value: 0 }],
};

function normalizeAlert(a: ServerAlert): { ticker: string; date?: string; conds: NormCond[] } | null {
  if (!a || typeof a.ticker !== "string" || !a.ticker) return null;
  let conds: NormCond[] = Array.isArray(a.conditions)
    ? a.conditions.filter((c) => c && typeof c.kind === "string" && typeof c.value === "number" && Number.isFinite(c.value))
    : [];
  if (conds.length === 0 && typeof a.cond === "string") {
    const mapped = LEGACY_SERVER[a.cond] ?? [];
    const value = typeof a.value === "number" ? a.value : 0;
    conds = mapped.map((c) => ({ ...c, value: a.cond === "fallPct" ? -Math.abs(value) : value }));
  }
  if (conds.length === 0) return null;
  return { ticker: resolveTicker(a.ticker.toUpperCase()), date: a.date, conds }; // T38 — legacy ISIN alerts resolve to the Reuters ticker
}

const IND_KINDS_SERVER = new Set<CondKindServer>(["rsiAbove", "rsiBelow", "macdAbove", "macdBelow", "maCrossUp", "maCrossDown", "volRatioAbove"]);

/** Indicator snapshot cache (mirrors client indicatorSnapshot) — keyed by
 *  ticker, 10-minute TTL because the 5-min loop re-reads the same set. */
const snapCacheServer = new Map<string, { snap: SnapServer; at: number }>();
type SnapServer = {
  rsi: number | null;
  macd: number | null;
  maShort: number | null;
  maLong: number | null;
  maShortPrev: number | null;
  maLongPrev: number | null;
  volRatio: number | null;
};

async function snapshotServer(ticker: string): Promise<SnapServer | null> {
  const hit = snapCacheServer.get(ticker);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.snap;
  try {
    const { fetchStockChart } = await import("./history");
    const chart = await fetchStockChart(ticker, "6M");
    const pts = chart.points;
    const n = pts.length;
    if (n < 2) return null;
    const closes = pts.map((p) => p.close);
    const last = n - 1;
    const { rsiSeries, macdSeries, smaSeries } = await import("./indicators");
    const snap: SnapServer = {
      rsi: null,
      macd: null,
      maShort: null,
      maLong: null,
      maShortPrev: null,
      maLongPrev: null,
      volRatio: null,
    };
    if (n >= 15) snap.rsi = rsiSeries(closes, 14)[last] ?? null;
    if (n >= 36) {
      const m = macdSeries(closes);
      snap.macd = m.macd[last] ?? null;
    }
    if (n >= 21) {
      const s = smaSeries(closes, 20);
      snap.maShort = s[last] ?? null;
      snap.maShortPrev = s[last - 1] ?? null;
    }
    if (n >= 51) {
      const l = smaSeries(closes, 50);
      snap.maLong = l[last] ?? null;
      snap.maLongPrev = l[last - 1] ?? null;
    }
    const vols = pts.map((p) => p.volume);
    const lastVol = vols[last];
    if (lastVol != null && lastVol > 0) {
      const vals = vols.slice(Math.max(0, last - 19), last + 1).filter((v): v is number => v != null && v > 0);
      if (vals.length >= 5) {
        const mean = vals.reduce((x, v) => x + v, 0) / vals.length;
        if (mean > 0) snap.volRatio = lastVol / mean;
      }
    }
    snapCacheServer.set(ticker, { snap, at: Date.now() });
    return snap;
  } catch {
    return null;
  }
}

function condHoldsServer(c: NormCond, s: Stock | undefined, snap: SnapServer | null, date: string | undefined): boolean {
  switch (c.kind) {
    case "priceAbove":
      return s !== undefined && s.close >= c.value;
    case "priceBelow":
      return s !== undefined && s.close <= c.value;
    case "chgAbove":
      return s !== undefined && s.changePct >= c.value;
    case "chgBelow":
      return s !== undefined && s.changePct <= c.value;
    case "rsiAbove":
      return snap?.rsi != null && snap.rsi >= c.value;
    case "rsiBelow":
      return snap?.rsi != null && snap.rsi <= c.value;
    case "macdAbove":
      return snap?.macd != null && snap.macd >= c.value;
    case "macdBelow":
      return snap?.macd != null && snap.macd <= c.value;
    case "maCrossUp":
      return (
        snap?.maShort != null && snap?.maLong != null && snap?.maShortPrev != null && snap?.maLongPrev != null &&
        snap.maShortPrev <= snap.maLongPrev && snap.maShort > snap.maLong
      );
    case "maCrossDown":
      return (
        snap?.maShort != null && snap?.maLong != null && snap?.maShortPrev != null && snap?.maLongPrev != null &&
        snap.maShortPrev >= snap.maLongPrev && snap.maShort < snap.maLong
      );
    case "volRatioAbove":
      return snap?.volRatio != null && snap.volRatio >= c.value;
    case "onDate":
      return typeof date === "string" && date <= cairoTodayStr();
  }
}

const COND_LABELS_SERVER: Record<CondKindServer, { ar: string; en: string }> = {
  priceAbove: { ar: "السعر أعلى من", en: "price above" },
  priceBelow: { ar: "السعر أدنى من", en: "price below" },
  chgAbove: { ar: "الصعود أكثر من", en: "up more than" },
  chgBelow: { ar: "الهبوط أكثر من", en: "down more than" },
  rsiAbove: { ar: "‏RSI أعلى من", en: "RSI above" },
  rsiBelow: { ar: "‏RSI أدنى من", en: "RSI below" },
  macdAbove: { ar: "‏MACD أعلى من", en: "MACD above" },
  macdBelow: { ar: "‏MACD أدنى من", en: "MACD below" },
  maCrossUp: { ar: "‏MA20 يعبر صاعدًا فوق MA50", en: "MA20 crossed above MA50" },
  maCrossDown: { ar: "‏MA20 يعبر هابطًا تحت MA50", en: "MA20 crossed below MA50" },
  volRatioAbove: { ar: "الحجم أعلى من", en: "volume above" },
  onDate: { ar: "في تاريخ", en: "on date" },
};

function alertBodyServer(a: ServerAlert, observed: number | null | undefined, lang: string, conds: NormCond[]): string {
  const t = a.ticker;
  const isReminder = conds.length === 1 && conds[0].kind === "onDate";
  if (isReminder) {
    return lang === "en" ? `Reminder for ${t} — ${a.date ?? ""}` : `تذكير اليوم بـ${t} — ${a.date ?? ""}`;
  }
  const parts = conds.map((c) => {
    const v =
      c.kind === "chgAbove" || c.kind === "chgBelow"
        ? `${Math.abs(c.value)}%`
        : c.kind === "rsiAbove" || c.kind === "rsiBelow"
          ? `${c.value}`
          : c.kind === "volRatioAbove"
            ? `${c.value}× avg`
            : c.kind === "maCrossUp" || c.kind === "maCrossDown"
              ? ""
              : String(c.value);
    const label = lang === "en" ? COND_LABELS_SERVER[c.kind].en : COND_LABELS_SERVER[c.kind].ar;
    return v ? `${label} ${v}` : label;
  });
  const priceNote = observed != null ? (lang === "en" ? ` — now ${observed} EGP` : ` — الآن ${observed} جنيه`) : "";
  return `${t}: ${parts.join(lang === "en" ? " and " : " و")}${priceNote}`;
}

// ── the loop body: evaluate every subscribed device ──

export type EvalSummary = {
  devices: number;
  checkedAlerts: number;
  notified: number;
  removedSubscriptions: number;
  ranAt: string;
};

export async function evaluateDevices(): Promise<EvalSummary> {
  const summary: EvalSummary = {
    devices: 0,
    checkedAlerts: 0,
    notified: 0,
    removedSubscriptions: 0,
    ranAt: new Date().toISOString(),
  };
  if (!getVapid()) return summary;

  const devices = await db.pushDevice.findMany();
  summary.devices = devices.length;
  if (devices.length === 0) return summary;

  // the set of tickers any device is watching — one shared universe fetch
  const tickers = new Set<string>();
  const indTickers = new Set<string>();
  for (const d of devices) {
    try {
      for (const a of JSON.parse(d.alertsJson) as ServerAlert[]) {
        const norm = normalizeAlert(a);
        if (!norm) continue;
        tickers.add(norm.ticker);
        if (norm.conds.some((c) => IND_KINDS_SERVER.has(c.kind))) indTickers.add(norm.ticker);
      }
    } catch {}
  }
  if (tickers.size === 0) return summary;

  const universe = await fetchUniverse();
  const byTicker = new Map(universe.map((s) => [s.ticker, s] as const));
  // indicator conditions: shared snapshot fetch per distinct ticker
  const snaps = new Map<string, SnapServer | null>();
  await Promise.all(
    [...indTickers].map(async (t) => {
      snaps.set(t, await snapshotServer(t));
    }),
  );

  for (const d of devices) {
    let alerts: ServerAlert[] = [];
    let notifiedIds: string[] = [];
    try {
      alerts = (JSON.parse(d.alertsJson) as ServerAlert[]).filter((a) => normalizeAlert(a) !== null);
    } catch {}
    try {
      notifiedIds = JSON.parse(d.notifiedJson) as string[];
    } catch {}
    const notifiedSet = new Set(notifiedIds);
    const fired: ServerAlert[] = [];

    for (const a of alerts) {
      if (notifiedSet.has(a.id)) continue; // already pushed — never repeat
      summary.checkedAlerts++;
      const norm = normalizeAlert(a);
      if (!norm) continue;
      const s = byTicker.get(norm.ticker);
      const snap = snaps.get(norm.ticker) ?? null;
      // date reminders need no quote (s may be undefined); price alerts need it
      if (norm.conds.every((c) => condHoldsServer(c, s, snap, norm.date))) {
        fired.push(a);
      }
    }

    if (fired.length > 0) {
      const ok = await sendPush(
        { endpoint: d.endpoint, p256dh: d.p256dh, auth: d.auth },
        {
          title:
            fired.length === 1 ? `EGX Desk — ${fired[0].ticker}` : `EGX Desk — ${fired.length} تنبيهات`,
          body:
            fired.length === 1
              ? alertBodyServer(
                  fired[0],
                  byTicker.get(fired[0].ticker)?.close ?? null,
                  d.lang,
                  normalizeAlert(fired[0])?.conds ?? [],
                )
              : fired
                  .map((a) => alertBodyServer(a, undefined, d.lang, normalizeAlert(a)?.conds ?? []))
                  .join(" • ")
                  .slice(0, 180),
          url: `/?view=company&ticker=${fired[0].ticker}&panel=overview`,
          tag: `egx-${fired[0].id}`,
          lang: d.lang,
        }
      );
      if (!ok) {
        // subscription gone (uninstalled / expired) — clean it up
        await db.pushDevice.delete({ where: { id: d.id } }).catch(() => {});
        summary.removedSubscriptions++;
        continue;
      }
      summary.notified += fired.length;
      await db.pushDevice.update({
        where: { id: d.id },
        data: {
          notifiedJson: JSON.stringify([...notifiedIds, ...fired.map((a) => a.id)]),
          lastNotifiedAt: new Date(),
        },
      });
    }
  }
  return summary;
}

// ── T44: LIVE SIGNAL-EVENT push (new picks / outcomes / self-checks) ──

/** Push the signal events that arrived since each device's last
 *  signalsNotifiedAt to every device that opted into signal notifications
 *  (PushDevice.signalsOptIn). Capped at 3 events per device per tick (the
 *  feed accumulates honestly — a burst never spams), newest first; the
 *  device's cursor then jumps to the newest event we actually sent. */
export async function pushSignalEvents(): Promise<{ devices: number; notified: number }> {
  const out = { devices: 0, notified: 0 };
  if (!getVapid()) return out;
  let devices: Awaited<ReturnType<typeof db.pushDevice.findMany>> = [];
  try {
    devices = await db.pushDevice.findMany({ where: { signalsOptIn: true } });
  } catch {
    return out;
  }
  out.devices = devices.length;
  if (!devices.length) return out;

  // the newest events any device could need (bounded window)
  const events = await db.signalEvent
    .findMany({ orderBy: { createdAt: "desc" }, take: 30 })
    .catch(() => []);
  if (!events.length) return out;
  const newestAt = events[0].createdAt;

  for (const d of devices) {
    const since = d.signalsNotifiedAt ?? new Date(0);
    const fresh = events.filter((e) => e.createdAt > since).slice(0, 3); // newest first
    if (!fresh.length) continue;
    const top = fresh[0];
    const single = fresh.length === 1;
    const ok = await sendPush(
      { endpoint: d.endpoint, p256dh: d.p256dh, auth: d.auth },
      {
        title: single
          ? d.lang === "en"
            ? top.titleEn
            : top.titleAr
          : d.lang === "en"
            ? `EGX Desk — ${fresh.length} signal updates`
            : `EGX Desk — ${fresh.length} تحديثات إشارات`,
        body: single
          ? (d.lang === "en" ? top.bodyEn : top.bodyAr).slice(0, 180)
          : fresh
              .map((e) => (d.lang === "en" ? e.titleEn : e.titleAr))
              .join(" • ")
              .slice(0, 180),
        url: top.ticker
          ? `/?view=company&ticker=${top.ticker}&panel=signals`
          : "/?view=signals&mode=ai",
        tag: "egx-signal-events",
        lang: d.lang,
      }
    );
    if (!ok) {
      await db.pushDevice.delete({ where: { id: d.id } }).catch(() => {});
      continue;
    }
    out.notified += fresh.length;
    await db.pushDevice
      .update({ where: { id: d.id }, data: { signalsNotifiedAt: newestAt, lastNotifiedAt: new Date() } })
      .catch(() => {});
  }
  return out;
}

// ── T69: FAVORITE-STOCK notifications (the user's ask: "a notification for
// every stock i made as a favorite") ────────────────────────────────────────

/** Favorited tickers earn TWO notification kinds, both honest about the
 *  ~15-min quote delay:
 *
 *  1. FRESH NEWS naming a favorite — the enriched multi-outlet feed the
 *     news screen reads, matched by its own ticker attribution. Deduped by
 *     a per-device cursor (watchlistNotifiedAt = published time of the
 *     newest item already pushed). A null cursor starts at now-45min, so
 *     enabling notifications never replays the day's backlog as spam.
 *
 *  2. STEP MOVES — every 0.5% a favorite climbs or falls vs the previous
 *     close (T70: the user's "notification for every 0.5% up or down",
 *     which SUPERSEDED the old coarse |chg| ≥ 4% same-day marker — the
 *     4% case is now just the 8th step of the same engine, and keeping
 *     both would double-notify). Owns its own engine (pushWatchlistMoves
 *     below) with per-device persisted band state in PushDevice.movesJson.
 *
 *  This function keeps only the NEWS half. ONE combined notification per
 *  device per tick (the alert engine's own pacing discipline), capped at 3
 *  headlines in the body. Runs in the same 5-minute loop. */
export async function pushWatchlistNews(): Promise<{ devices: number; notified: number }> {
  const out = { devices: 0, notified: 0 };
  if (!getVapid()) return out;
  let devices: Awaited<ReturnType<typeof db.pushDevice.findMany>> = [];
  try {
    devices = await db.pushDevice.findMany();
  } catch {
    return out;
  }
  // only devices that actually mirrored favorites
  const withWatch = devices.filter((d) => {
    try {
      return (JSON.parse(d.watchlistJson) as string[]).length > 0;
    } catch {
      return false;
    }
  });
  out.devices = withWatch.length;
  if (!withWatch.length) return out;

  // the union of every favorite + one shared universe fetch
  const allFavs = new Set<string>();
  for (const d of withWatch) {
    try {
      for (const t of JSON.parse(d.watchlistJson) as string[]) allFavs.add(t);
    } catch {}
  }

  // T70 — step moves moved to their own engine (pushWatchlistMoves): every
  // 0.5% crossing vs the previous close, per-stock notifications, persisted
  // band state. The old |chg| ≥ 4% same-day markers were retired with it.
  const universe = await fetchUniverse().catch(() => [] as Stock[]);

  // fresh news naming a favorite — the same enriched feed the news screen
  // reads (5-min shared cache, outlets fetched once)
  type FeedItemLite = { id?: unknown; headline?: unknown; published?: unknown; tickers?: unknown; sources?: { name?: unknown }[] };
  let feedItems: FeedItemLite[] = [];
  if (allFavs.size > 0) {
    try {
      const { getEnrichedFeedCached } = await import("@/lib/news-sources");
      const snapshotMod = (await import("@/data/news-snapshot.json").catch(() => null)) as unknown;
      const feed = await getEnrichedFeedCached(
        async () => universe.map((s) => ({ ticker: s.ticker, name: s.name, volume: s.volume, avgVolume: s.avgVolume })),
        (snapshotMod ?? undefined) as never,
      );
      feedItems = (feed.items ?? []) as FeedItemLite[];
    } catch {
      feedItems = [];
    }
  }
  const newsByTicker = new Map<string, FeedItemLite[]>();
  for (const it of feedItems) {
    const tks = Array.isArray(it.tickers) ? (it.tickers as string[]) : [];
    const pub = typeof it.published === "string" ? it.published : "";
    if (!pub || !tks.length) continue;
    for (const t of tks) {
      if (!allFavs.has(t)) continue;
      const arr = newsByTicker.get(t) ?? [];
      arr.push(it);
      newsByTicker.set(t, arr);
    }
  }

  for (const d of withWatch) {
    let favs: string[] = [];
    try {
      favs = JSON.parse(d.watchlistJson) as string[];
    } catch {}
    if (!favs.length) continue;
    const en = d.lang === "en";

    // 1) fresh news for this device's favorites
    const cursor = d.watchlistNotifiedAt ?? new Date(Date.now() - 45 * 60_000);
    const freshNews: { ticker: string; headline: string; publishedAt: Date; source: string }[] = [];
    let newestPub = d.watchlistNotifiedAt ?? null;
    for (const t of favs) {
      for (const it of newsByTicker.get(t) ?? []) {
        const pub = typeof it.published === "string" ? new Date(it.published) : null;
        if (!pub || Number.isNaN(pub.getTime())) continue;
        if (pub <= cursor) continue;
        if (newestPub === null || pub > newestPub) newestPub = pub;
        freshNews.push({
          ticker: t,
          headline: typeof it.headline === "string" ? it.headline : "",
          publishedAt: pub,
          source: typeof it.sources?.[0]?.name === "string" ? String(it.sources[0].name) : "",
        });
      }
    }
    freshNews.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());

    if (!freshNews.length) continue;

    // ONE combined news notification per device per tick
    const top = freshNews[0];
    const title = en
      ? `EGX Desk — news for your favorites`
      : `EGX Desk — أخبار عن أسهمك المفضلة`;
    const parts: string[] = [];
    for (const n of freshNews.slice(0, 3)) {
      parts.push(`${en ? n.ticker : n.ticker}: ${n.headline}`.slice(0, 110));
    }
    const url = top
      ? `/?view=company&ticker=${encodeURIComponent(top.ticker)}&panel=overview`
      : "/?view=watchlist";
    const ok = await sendPush(
      { endpoint: d.endpoint, p256dh: d.p256dh, auth: d.auth },
      {
        title,
        body: parts.join(" • ").slice(0, 200) || (en ? "favorite stock update" : "تحديث سهم مفضل"),
        url,
        tag: "egx-favorites",
        lang: d.lang,
      }
    );
    if (!ok) {
      await db.pushDevice.delete({ where: { id: d.id } }).catch(() => {});
      continue;
    }
    out.notified += freshNews.length;
    await db.pushDevice
      .update({
        where: { id: d.id },
        data: {
          ...(newestPub ? { watchlistNotifiedAt: newestPub } : {}),
          lastNotifiedAt: new Date(),
        },
      })
      .catch(() => {});
  }
  return out;
}

// ── T70: STEP-MOVE notifications — "a notification for every 0.5% up or
// down" on every favorite stock ────────────────────────────────────────────

/** The step size in percentage points of the day's change (vs previous
 *  close). Every crossing of a ±0.5k% milestone is one notification. */
export const MOVE_STEP_PCT = 0.5;

/** Band index of a signed day-change: how many FULL 0.5% steps the quote
 *  sits past the previous close, truncated toward zero (band 1 = "at least
 *  +0.5%", band -2 = "at least -1.0%", band 0 = the flat zone ±0.5%). */
export function moveBand(changePct: number, step: number = MOVE_STEP_PCT): number {
  if (!Number.isFinite(changePct)) return 0;
  return changePct >= 0 ? Math.floor(changePct / step) : Math.ceil(changePct / step);
}

/** The milestone LEVELS (in pct, e.g. +0.5, +1.0) passed when a favorite
 *  moves from band f to band t. Band 0 is two-sided (−0.5 … +0.5), and
 *  negative bands span [(b−1)·0.5, b·0.5) — so the boundary depends on
 *  the crossing direction: climbing INTO band b crosses its lower edge,
 *  falling INTO band b crosses its upper edge. Listed by ascending |level|
 * ("crossed +0.5% and +1.0%" reads the same in both directions). */
export function moveLevelsCrossed(fromBand: number, toBand: number, step: number = MOVE_STEP_PCT): number[] {
  const levels: number[] = [];
  if (toBand > fromBand) {
    // climbing: entering band b from below crosses b's LOWER edge
    for (let b = fromBand + 1; b <= toBand; b++) {
      levels.push(b >= 1 ? b * step : b === 0 ? -step : (b - 1) * step);
    }
  } else if (toBand < fromBand) {
    // falling: entering band b from above crosses b's UPPER edge
    for (let b = fromBand - 1; b >= toBand; b--) {
      levels.push(b >= 1 ? (b + 1) * step : b === 0 ? step : b * step);
    }
  }
  return levels.sort((a, b) => Math.abs(a) - Math.abs(b));
}

/** Persisted per-device tracker state (PushDevice.movesJson):
 *  date = the Cairo session the bands belong to; a new session day resets
 *  every tracker so cross-day moves are never fabricated. */
export type MovesState = { date: string; bands: Record<string, number> };

export type MoveNote = {
  ticker: string;
  fromBand: number;
  toBand: number;
  /** milestone levels crossed, ascending (may span both signs) */
  levels: number[];
  changePct: number;
  close: number;
};

export type QuoteLite = { changePct: number; close: number };

/** Pure decision core (exported for tests): given a device's favorites,
 *  the current quotes and its persisted state, decide which step-move
 *  notifications to fire and what the next state is.
 *
 *  Rules:
 *  - first sighting of the session (no band recorded): notify when the
 *    opening/day reading already sits past a milestone (an opening gap of
 *    +1.2% is genuinely "three 0.5% steps up since the previous close");
 *  - afterwards: notify on EVERY band change that lands outside band 0 —
 *    climbing (+0.5 → +1.0 …) and falling (losing +1.0, clearing −0.5 …)
 *    alike, because the user asked for every 0.5% up OR down;
 *  - returning into the flat band 0 records silently (no milestone lives
 *    there) — the next crossing re-announces honestly;
 *  - a favorite with no/invalid quote keeps its previous band (a data
 *    hiccup must never reset a tracker mid-session). */
export function buildMoveNotifications(
  favorites: string[],
  quotes: Map<string, QuoteLite>,
  state: MovesState,
  today: string,
): { notes: MoveNote[]; nextState: MovesState } {
  const sameDay = state.date === today;
  const nextState: MovesState = { date: today, bands: {} };
  const notes: MoveNote[] = [];
  for (const t of favorites) {
    const q = quotes.get(t);
    if (!q || !Number.isFinite(q.changePct)) {
      // keep the tracker where it was — but only if it belongs to today
      if (sameDay && typeof state.bands[t] === "number") nextState.bands[t] = state.bands[t];
      continue;
    }
    const band = moveBand(q.changePct);
    const prev = sameDay ? state.bands[t] : undefined;
    if (prev === undefined) {
      if (band !== 0) {
        notes.push({ ticker: t, fromBand: 0, toBand: band, levels: moveLevelsCrossed(0, band), changePct: q.changePct, close: q.close });
      }
    } else if (band !== prev && band !== 0) {
      notes.push({ ticker: t, fromBand: prev, toBand: band, levels: moveLevelsCrossed(prev, band), changePct: q.changePct, close: q.close });
    }
    nextState.bands[t] = band; // always record — band 0 included, so re-crossings re-fire
  }
  notes.sort((a, b) => Math.abs(b.toBand - b.fromBand) - Math.abs(a.toBand - a.fromBand));
  return { notes, nextState };
}

const MINUS = "\u2212"; // typographic minus, matches the app's formatting

function fmtStep(v: number): string {
  return `${v > 0 ? "+" : v < 0 ? MINUS : ""}${Math.abs(v).toFixed(1)}%`;
}

/** Compose the per-stock notification (one per crossing, AR or EN). The
 *  ARROW carries the crossing direction (▲ climbed a milestone / ▼ lost
 *  one) while the SIGNED PERCENT is always the honest day change vs the
 *  previous close — a pullback from +1.0% to +0.8% reads "▼ +0.80%". */
export function movePushPayload(n: MoveNote, lang: string): PushPayload {
  const en = lang === "en";
  const rose = n.toBand > n.fromBand;
  const arrow = rose ? "\u25B2" : "\u25BC";
  const pct = `${n.changePct >= 0 ? "+" : MINUS}${Math.abs(n.changePct).toFixed(2)}%`;
  const levels = n.levels.map(fmtStep).join(en ? " and " : " و");
  const price = n.close.toFixed(2);
  const title = `EGX Desk — ${n.ticker} ${arrow} ${pct}`;
  const body = rose || n.fromBand === 0
    ? en
      ? `Crossed ${levels} since previous close — now ${price} EGP`
      : `تجاوز ${levels} منذ الإغلاق السابق — الآن ${price} جنيه`
    : en
      ? `Fell below ${levels} — now ${price} EGP`
      : `تراجع دون ${levels} — الآن ${price} جنيه`;
  return {
    title,
    body,
    url: `/?view=company&ticker=${encodeURIComponent(n.ticker)}&panel=overview`,
    // one live OS tile per stock per milestone — a re-crossing REPLACES its
    // own tile (renotify pops it again) instead of stacking duplicates
    tag: `mv-${n.ticker}-${Math.abs(n.toBand)}${n.toBand < 0 ? "n" : ""}`,
    lang,
  };
}

/** Live-session gate with an honest post-close grace: crossings that only
 *  appear in the FINAL delayed quote (~15 min lag) still notify until
 *  15:00 Cairo; after that the last session's bands are frozen (and the
 *  next trading day resets them via the date check). */
async function movesSessionLive(now: Date): Promise<{ live: boolean; today: string }> {
  const { marketStatus } = await import("@/lib/market-status");
  const st = marketStatus(now);
  const today = cairoTodayStr(now);
  if (st.lastSession !== today) return { live: false, today }; // weekend / pre-open / holiday: quotes are a previous session's
  if (st.open) return { live: true, today };
  const [h, m] = st.cairoTime.split(":").map(Number);
  const minutes = (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
  return { live: minutes < 15 * 60, today }; // closed but within the final-quote grace window
}

/** The T70 engine: ONE notification PER FAVORITE STOCK for every 0.5% step
 *  it climbs or falls vs the previous close, while the EGX session is live
 *  (plus the final-quote grace). Band state persists per device in
 *  PushDevice.movesJson, so restarts / re-runs can never double-notify. */
export async function pushWatchlistMoves(now: Date = new Date()): Promise<{ devices: number; notified: number }> {
  const out = { devices: 0, notified: 0 };
  if (!getVapid()) return out;
  const { live: sessionLive, today } = await movesSessionLive(now);
  if (!sessionLive) return out; // nothing to evaluate — and NO state writes (yesterday's bands stay frozen)

  let devices: Awaited<ReturnType<typeof db.pushDevice.findMany>> = [];
  try {
    devices = await db.pushDevice.findMany();
  } catch {
    return out;
  }
  const withWatch = devices.filter((d) => {
    try {
      return (JSON.parse(d.watchlistJson) as string[]).length > 0;
    } catch {
      return false;
    }
  });
  out.devices = withWatch.length;
  if (!withWatch.length) return out;

  const universe = await fetchUniverse().catch(() => [] as Stock[]);
  const quotes = new Map<string, QuoteLite>();
  for (const s of universe) {
    if (Number.isFinite(s.changePct)) quotes.set(s.ticker, { changePct: s.changePct, close: s.close });
  }

  for (const d of withWatch) {
    let favs: string[] = [];
    try {
      favs = JSON.parse(d.watchlistJson) as string[];
    } catch {}
    if (!favs.length) continue;
    let state: MovesState = { date: "", bands: {} };
    try {
      const parsed = JSON.parse(d.movesJson) as MovesState;
      if (parsed && typeof parsed.date === "string" && parsed.bands && typeof parsed.bands === "object") {
        state = { date: parsed.date, bands: {} };
        for (const [k, v] of Object.entries(parsed.bands)) {
          if (typeof v === "number" && Number.isFinite(v)) state.bands[k] = Math.trunc(v);
        }
      }
    } catch {}

    const { notes, nextState } = buildMoveNotifications(favs, quotes, state, today);

    // safety pacing: at most 30 per-stock notifications per device per tick
    // (an 80-favorite watchlist gapping at the open still lands sanely);
    // the FULL state is recorded either way, so skipped notes never re-fire
    let sent = 0;
    let alive = true;
    for (const n of notes.slice(0, 30)) {
      const ok = await sendPush({ endpoint: d.endpoint, p256dh: d.p256dh, auth: d.auth }, movePushPayload(n, d.lang));
      if (!ok) {
        // subscription gone — clean the row up and stop
        await db.pushDevice.delete({ where: { id: d.id } }).catch(() => {});
        alive = false;
        break;
      }
      sent++;
    }
    if (!alive) continue;
    if (sent > 0 || JSON.stringify(nextState) !== JSON.stringify(state)) {
      await db.pushDevice
        .update({ where: { id: d.id }, data: { movesJson: JSON.stringify(nextState), ...(sent > 0 ? { lastNotifiedAt: new Date() } : {}) } })
        .catch(() => {});
    }
    out.notified += sent;
  }
  return out;
}
