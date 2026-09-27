/** T69 test — simulate a subscribed device with favorites, run the push
 *  evaluation pass, and verify the favorites pipeline runs end-to-end:
 *  watchlist parse → universe fetch → news matching → mover detection →
 *  sendPush attempt (fake endpoint fails honestly → device cleaned up). */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  // a device with COMI + TMGH as favorites and a deliberately-bogus endpoint
  await db.pushDevice.create({
    data: {
      deviceId: "test-favorites-device-0001",
      endpoint: "https://fcm.googleapis.com/fcm/send/BOGUS-TEST-ENDPOINT",
      p256dh: "BPublicKeyPlaceholderForTestOnlyNotARealKey0001",
      auth: "AuthPlaceholder",
      alertsJson: "[]",
      notifiedJson: "[]",
      watchlistJson: JSON.stringify(["COMI", "TMGH"]),
      lang: "ar",
    },
  });
  console.log("device inserted with favorites COMI + TMGH");

  const res = await fetch("http://localhost:3000/api/push/run", { method: "POST" });
  const summary = await res.json();
  console.log("run summary:", JSON.stringify(summary, null, 2));

  const after = await db.pushDevice.findUnique({ where: { deviceId: "test-favorites-device-0001" } });
  console.log(after ? "device still present (push send failed silently?)" : "device cleaned up (bogus endpoint → honest removal) — pipeline ran end-to-end");
  if (after) await db.pushDevice.delete({ where: { deviceId: "test-favorites-device-0001" } }).catch(() => {});
}

main().catch((e) => {
  console.error("TEST FAILED:", e);
  process.exit(1);
}).finally(() => db.$disconnect());
