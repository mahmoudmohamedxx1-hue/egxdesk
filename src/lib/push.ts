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

// ── VAPID keys (generated once by scripts/gen-vapid.js) ──

type VapidKeys = { publicKey: string; privateKey: string };

function resolveVapidPath(): string {
  const cwd = process.cwd();
  const argv1 = process.argv[1] ?? "";
  const serverDir = path.dirname(path.resolve(argv1));
  const candidates = [
    path.join(cwd, "server-secrets", "vapid.json"),
    path.join(cwd, "..", "server-secrets", "vapid.json"),
    path.join(cwd, "..", "..", "server-secrets", "vapid.json"),
    path.join(serverDir, "..", "..", "server-secrets", "vapid.json"),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {}
  }
  return candidates[0];
}

let vapid: VapidKeys | null = null;

function getVapid(): VapidKeys | null {
  if (vapid) return vapid;
  try {
    const raw = fs.readFileSync(resolveVapidPath(), "utf8");
    const parsed = JSON.parse(raw) as VapidKeys;
    if (parsed.publicKey && parsed.privateKey) {
      vapid = parsed;
      webpush.setVapidDetails("mailto:egx-desk@localhost", parsed.publicKey, parsed.privateKey);
    }
  } catch {
    // missing/corrupt keys — push disabled; the app still works
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

/** Today's date in Africa/Cairo as YYYY-MM-DD (server runs in UTC). */
export function cairoTodayStr(): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
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
