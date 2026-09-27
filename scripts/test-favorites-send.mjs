/** T69 test 2 — the SEND path: a device whose favorite (RAYA) has fresh
 *  news, with a cursor 3h in the past so the news counts as fresh. The
 *  bogus endpoint makes sendPush fail → the device row is honestly removed
 *  (the documented cleanup). Run via the ROUTE so the DB path matches the
 *  dev server exactly. */
const DEV = "test-favorites-send-0002";

async function main() {
  // subscribe through the ROUTE (right DB), with RAYA as favorite
  const sub = await fetch("http://localhost:3000/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      deviceId: DEV,
      subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/BOGUS-SEND-TEST", keys: { p256dh: "BPubSend", auth: "AuthSend" } },
      watchlist: ["RAYA"],
      lang: "ar",
    }),
  });
  console.log("subscribe:", JSON.stringify(await sub.json()));

  // age the cursor 3h back via the same absolute DB the server uses
  const { PrismaClient } = await import("@prisma/client");
  const path = await import("node:path");
  const db = new PrismaClient({ datasources: { db: { url: `file:${path.resolve("db/custom.db")}` } } });
  await db.pushDevice.update({
    where: { deviceId: DEV },
    data: { watchlistNotifiedAt: new Date(Date.now() - 3 * 60 * 60_000) },
  });
  console.log("cursor aged 3h");
  await db.$disconnect();

  const run = await fetch("http://localhost:3000/api/push/run", { method: "POST" });
  const summary = await run.json();
  console.log("run:", JSON.stringify(summary));

  // expect: favorites.notified ≥ 1 (RAYA news is fresher than the cursor)
  // and the bogus endpoint → send fails → device removed
  const check = await fetch("http://localhost:3000/api/health");
  console.log("health ok:", (await check.json()).ok);
}

main().catch((e) => { console.error("TEST FAILED:", e); process.exit(1); });
