import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/** POST /api/push/subscribe — register (or refresh) this device's push
 *  subscription and mirror its alert list server-side. Called when the user
 *  enables phone notifications AND on every alert change afterwards
 *  (upsert: same deviceId → same row). Alert shape mirrors the client's
 *  localStorage list; validation is deliberately lenient (unknown fields
 *  dropped, bad rows filtered) so a client version skew can never 500. */

type AlertIn = {
  id?: unknown;
  ticker?: unknown;
  cond?: unknown;
  value?: unknown;
  date?: unknown;
  triggeredAt?: unknown;
};

type Body = {
  deviceId?: unknown;
  subscription?: {
    endpoint?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown };
  };
  alerts?: unknown;
  lang?: unknown;
  signalsOptIn?: unknown; // T44 — live signal-event notifications opt-in
};

const VALID_CONDS = new Set(["above", "below", "risePct", "fallPct", "onDate"]);

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const deviceId = typeof body.deviceId === "string" ? body.deviceId.slice(0, 128) : "";
  const endpoint = typeof body.subscription?.endpoint === "string" ? body.subscription.endpoint : "";
  const p256dh = typeof body.subscription?.keys?.p256dh === "string" ? body.subscription.keys.p256dh : "";
  const auth = typeof body.subscription?.keys?.auth === "string" ? body.subscription.keys.auth : "";
  const lang = body.lang === "en" ? "en" : "ar";
  const userAgent = req.headers.get("user-agent")?.slice(0, 250) ?? null;

  if (!deviceId || !endpoint.startsWith("https://") || !p256dh || !auth) {
    return NextResponse.json({ error: "deviceId + subscription required" }, { status: 400 });
  }

  // sanitize the mirrored alert list (server only needs the evaluatable core)
  const alerts = Array.isArray(body.alerts)
    ? (body.alerts as AlertIn[])
        .filter(
          (a) =>
            a &&
            typeof a === "object" &&
            typeof a.id === "string" &&
            typeof a.ticker === "string" &&
            typeof a.value === "number" &&
            Number.isFinite(a.value) &&
            VALID_CONDS.has(String(a.cond)) &&
            (a.cond !== "onDate" || typeof a.date === "string")
        )
        .slice(0, 50)
        .map((a) => ({
          id: a.id as string,
          ticker: (a.ticker as string).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12),
          cond: a.cond as string,
          value: a.value as number,
          ...(a.cond === "onDate" ? { date: a.date as string } : {}),
        }))
    : [];

  // a fresh subscribe resets server-side "already notified" bookkeeping for
  // alerts that are no longer triggered client-side (e.g. user re-created it)
  const device = await db.pushDevice.findUnique({ where: { deviceId } });
  const prevNotified: string[] = (() => {
    try {
      return JSON.parse(device?.notifiedJson ?? "[]") as string[];
    } catch {
      return [];
    }
  })();
  const stillActiveIds = new Set(alerts.map((a) => a.id));
  const notified = prevNotified.filter((id) => stillActiveIds.has(id));

  const data = {
    endpoint,
    p256dh,
    auth,
    alertsJson: JSON.stringify(alerts),
    notifiedJson: JSON.stringify(notified),
    // T44 — live signal notifications: EXPLICIT opt-in flag from the AI
    // signals panel's bell toggle; absent (undefined) keeps the stored
    // value so the legacy alert sync path never silently switches it off
    ...(typeof body.signalsOptIn === "boolean" ? { signalsOptIn: body.signalsOptIn } : {}),
    lang,
    userAgent,
    lastSeenAt: new Date(),
  };

  const saved = await db.pushDevice.upsert({
    where: { deviceId },
    create: { deviceId, ...data },
    update: data,
  });

  return NextResponse.json(
    { ok: true, deviceId: saved.deviceId, alerts: alerts.length, signalsOptIn: saved.signalsOptIn },
    { headers: { "Cache-Control": "no-store" } }
  );
}
