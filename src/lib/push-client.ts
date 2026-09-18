/** CLIENT-side web-push helpers (G1 mobile): subscribe the installed PWA to
 *  server notifications, mirror the device's alert list server-side on every
 *  change, and send a test notification right after enabling.
 *
 *  Device identity: a uuid in localStorage (egx-device-id) — the server row
 *  (PushDevice) is keyed by it, so re-enabling or re-syncing is an upsert and
 *  never duplicates notifications. iOS requires the subscription to be
 *  created INSIDE the installed app (Add to Home Screen, iOS 16.4+) — the
 *  UI checks standalone mode and guides the user when needed. */

export const DEVICE_ID_KEY = "egx-device-id";
export const PUSH_ENABLED_KEY = "egx-push-enabled";

type PushSubscriptionJSON = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export type PushEnableResult =
  | { ok: true }
  | { ok: false; reason: "unsupported" | "notInstalled" | "denied" | "server" | "network"; message?: string };

export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return "anonymous";
  }
}

export function isPushEnabled(): boolean {
  try {
    return localStorage.getItem(PUSH_ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

/** True when running as an installed app (home-screen PWA / dock app). */
export function isStandalone(): boolean {
  try {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}

function isIOS(): boolean {
  try {
    const ua = navigator.userAgent;
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  } catch {
    return false;
  }
}

/** VAPID public key → the Uint8Array PushManager.subscribe expects. */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const buf = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Mirror the device's alert list to the server (upsert). Fire-and-forget:
 *  called from app-context on every alert change when push is enabled. */
export async function syncPushAlerts(
  alerts: unknown[],
  lang: "ar" | "en"
): Promise<void> {
  if (!isPushEnabled()) return;
  const deviceId = getDeviceId();
  try {
    const reg = await navigator.serviceWorker?.ready;
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId, subscription: sub.toJSON(), alerts, lang }),
    });
  } catch {
    // best-effort sync — the next alert change retries
  }
}

/** T44 — opt this device INTO (or out of) LIVE SIGNAL notifications:
 *  new picks, tracked outcomes and self-validation pushes on top of the
 *  personal price alerts. Works when push is already enabled; returns
 *  false when the subscription is not available (the UI then keeps the
 *  in-tab browser notifications only). */
export async function setSignalOptIn(optIn: boolean, lang: "ar" | "en"): Promise<boolean> {
  try {
    const deviceId = getDeviceId();
    const reg = await navigator.serviceWorker?.ready;
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return false;
    // preserve the device's CURRENT alert list (the subscribe route mirrors
    // whatever it receives — passing [] would wipe the user's price alerts)
    let alerts: unknown[] = [];
    try {
      const raw = localStorage.getItem("egx-alerts");
      if (raw) alerts = JSON.parse(raw);
    } catch {}
    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId, subscription: sub.toJSON(), alerts, lang, signalsOptIn: optIn }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** The full enable flow: permission → subscribe → register server-side. */
export async function enablePush(lang: "ar" | "en"): Promise<PushEnableResult> {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      return { ok: false, reason: "unsupported" };
    }
    if (isIOS() && !isStandalone()) {
      // iOS only allows push inside the installed PWA — guide, don't fail silently
      return { ok: false, reason: "notInstalled" };
    }

    const perm = await Notification.requestPermission();
    if (perm !== "granted") {
      return { ok: false, reason: "denied" };
    }

    const keyRes = await fetch("/api/push/key");
    if (!keyRes.ok) {
      return { ok: false, reason: "server" };
    }
    const { publicKey } = (await keyRes.json()) as { publicKey: string };

    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    const deviceId = getDeviceId();
    // alerts are passed by the caller via localStorage read in the UI layer
    let alerts: unknown[] = [];
    try {
      const raw = localStorage.getItem("egx-alerts");
      if (raw) alerts = JSON.parse(raw);
    } catch {}

    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId, subscription: sub.toJSON(), alerts, lang }),
    });
    if (!res.ok) {
      return { ok: false, reason: "server" };
    }

    try {
      localStorage.setItem(PUSH_ENABLED_KEY, "1");
    } catch {}
    return { ok: true };
  } catch {
    return { ok: false, reason: "network" };
  }
}

/** Stop server notifications for this device (subscription is also removed
 *  from the browser so the OS prompt state resets cleanly). */
export async function disablePush(): Promise<void> {
  try {
    const deviceId = getDeviceId();
    const reg = await navigator.serviceWorker?.ready;
    const sub = await reg?.pushManager.getSubscription();
    if (sub) await sub.unsubscribe().catch(() => {});
    await fetch("/api/push/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId }),
    }).catch(() => {});
  } catch {}
  try {
    localStorage.removeItem(PUSH_ENABLED_KEY);
  } catch {}
}

/** One harmless notification, seconds after enabling — proves the chain. */
export async function sendTestPush(lang: "ar" | "en"): Promise<boolean> {
  try {
    const res = await fetch("/api/push/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: getDeviceId(), lang }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export type { PushSubscriptionJSON };
