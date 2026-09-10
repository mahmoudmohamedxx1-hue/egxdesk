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

type ServerAlert = {
  id: string;
  ticker: string;
  cond: "above" | "below" | "risePct" | "fallPct" | "onDate";
  value: number;
  date?: string;
};

/** Today's date in Africa/Cairo as YYYY-MM-DD (server runs in UTC). */
export function cairoTodayStr(): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function holdsServer(a: ServerAlert, s: Stock | undefined): boolean {
  switch (a.cond) {
    case "above":
      return s !== undefined && s.close >= a.value;
    case "below":
      return s !== undefined && s.close <= a.value;
    case "risePct":
      return s !== undefined && s.changePct >= a.value;
    case "fallPct":
      return s !== undefined && s.changePct <= -a.value;
    case "onDate":
      return typeof a.date === "string" && a.date <= cairoTodayStr();
  }
}

function observedServer(a: ServerAlert, s: Stock | undefined): number | null {
  if (a.cond === "above" || a.cond === "below") return s?.close ?? null;
  if (a.cond === "onDate") return null;
  return s?.changePct ?? null;
}

function alertBodyServer(a: ServerAlert, observed: number | null | undefined, lang: string): string {
  const t = a.ticker;
  if (lang === "en") {
    switch (a.cond) {
      case "above":
        return `${t} crossed above ${a.value} — now ${observed ?? "?"} EGP`;
      case "below":
        return `${t} crossed below ${a.value} — now ${observed ?? "?"} EGP`;
      case "risePct":
        return `${t} is up ${observed?.toFixed(2) ?? "?"}% today`;
      case "fallPct":
        return `${t} is down ${Math.abs(observed ?? 0).toFixed(2)}% today`;
      case "onDate":
        return `Reminder for ${t} — ${a.date ?? ""}`;
    }
  }
  switch (a.cond) {
    case "above":
      return `${t} عبر أعلى ${a.value} — السعر الآن ${observed ?? "?"} جنيه`;
    case "below":
      return `${t} عبر أدنى ${a.value} — السعر الآن ${observed ?? "?"} جنيه`;
    case "risePct":
      return `${t} يصعد ${observed?.toFixed(2) ?? "?"}% في الجلسة`;
    case "fallPct":
      return `${t} يهبط ${Math.abs(observed ?? 0).toFixed(2)}% في الجلسة`;
    case "onDate":
      return `تذكير اليوم بـ${t} — ${a.date ?? ""}`;
  }
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
  for (const d of devices) {
    try {
      for (const a of JSON.parse(d.alertsJson) as ServerAlert[]) tickers.add(a.ticker);
    } catch {}
  }
  if (tickers.size === 0) return summary;

  const universe = await fetchUniverse();
  const byTicker = new Map(universe.map((s) => [s.ticker, s] as const));

  for (const d of devices) {
    let alerts: ServerAlert[] = [];
    let notifiedIds: string[] = [];
    try {
      alerts = (JSON.parse(d.alertsJson) as ServerAlert[]).filter(
        (a) => a && typeof a.ticker === "string" && typeof a.value === "number"
      );
    } catch {}
    try {
      notifiedIds = JSON.parse(d.notifiedJson) as string[];
    } catch {}
    const notifiedSet = new Set(notifiedIds);
    const fired: ServerAlert[] = [];

    for (const a of alerts) {
      if (notifiedSet.has(a.id)) continue; // already pushed — never repeat
      summary.checkedAlerts++;
      const s = byTicker.get(a.ticker);
      // date reminders need no quote (s may be undefined); price alerts need it
      if (holdsServer(a, s)) {
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
              ? alertBodyServer(fired[0], observedServer(fired[0], byTicker.get(fired[0].ticker)), d.lang)
              : fired.map((a) => alertBodyServer(a, undefined, d.lang)).join(" • ").slice(0, 180),
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
