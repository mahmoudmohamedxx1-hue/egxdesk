/** T70 test — the 0.5% STEP-MOVE notification engine.
 *
 * Part A (pure): moveBand / moveLevelsCrossed / buildMoveNotifications /
 * movePushPayload semantics — band math, multi-band jumps, day reset,
 * flat-zone silence, re-crossing, pullback wording, dedupe idempotency.
 *
 * Part B (E2E): a real HTTPS endpoint (self-signed) standing in for the
 * push service → a device row pointing at it → the REAL pushWatchlistMoves
 * (real universe quotes, real VAPID signing, real web-push transport) →
 * captured payloads asserted → db band state verified → forced crossing →
 * exactly one new notification. Run with: bun scripts/test-moves-push.ts
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // self-signed test endpoint only

import https from "node:https";
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import ece from "http_ece";

const db = new PrismaClient();

// the engine under test (bun resolves the tsconfig "@/"/"src" paths)
import {
  MOVE_STEP_PCT,
  moveBand,
  moveLevelsCrossed,
  buildMoveNotifications,
  movePushPayload,
  pushWatchlistMoves,
  type MovesState,
  type QuoteLite,
} from "../src/lib/push";

let pass = 0;
let fail = 0;
function ok(cond: boolean, label: string, extra?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}`, extra !== undefined ? JSON.stringify(extra) : "");
  }
}

function approx(a: number[], b: number[]) {
  return a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
}

// ── Part A: pure decision core ────────────────────────────────────────────

function partA() {
  console.log("\n[Part A] band math");
  ok(moveBand(0.49) === 0, "0.49% → band 0 (flat zone)");
  ok(moveBand(0.5) === 1, "0.5% → band 1 (first milestone)");
  ok(moveBand(1.19) === 2, "1.19% → band 2");
  ok(moveBand(1.2) === 2, "1.2% → band 2");
  ok(moveBand(-0.49) === 0, "-0.49% → band 0");
  ok(moveBand(-0.5) === -1, "-0.5% → band -1");
  ok(moveBand(-1.31) === -2, "-1.31% → band -2");
  ok(moveBand(NaN) === 0, "NaN → band 0 (defensive)");

  console.log("\n[Part A] levels crossed");
  ok(approx(moveLevelsCrossed(0, 1), [0.5]), "0→1 crosses +0.5");
  ok(approx(moveLevelsCrossed(0, 3), [0.5, 1, 1.5]), "0→3 crosses +0.5,+1.0,+1.5");
  ok(approx(moveLevelsCrossed(2, 1), [1]), "2→1 loses +1.0");
  ok(approx(moveLevelsCrossed(3, 1), [1, 1.5]), "3→1 loses +1.5 then +1.0");
  ok(approx(moveLevelsCrossed(1, -1), [-0.5, 0.5]) || approx(moveLevelsCrossed(1, -1), [0.5, -0.5]), "1→-1 loses +0.5 and clears -0.5 (both |0.5| — order-free)");
  ok(approx(moveLevelsCrossed(-1, 1), [-0.5, 0.5]), "-1→1 clears -0.5 then +0.5");
  ok(approx(moveLevelsCrossed(-3, -2), [-1.5]), "-3→-2 climbs past −1.5 (negative-band LOWER edge)");
  ok(approx(moveLevelsCrossed(-2, -1), [-1]), "-2→-1 climbs past −1.0");
  ok(approx(moveLevelsCrossed(-2, -3), [-1.5]), "-2→-3 falls past −1.5 (negative-band UPPER edge)");
  ok(approx(moveLevelsCrossed(2, 2), []), "same band crosses nothing");

  console.log("\n[Part A] buildMoveNotifications");
  const T = "2026-09-28";
  const quotes = (m: Record<string, QuoteLite>) => new Map(Object.entries(m));
  const q = (changePct: number, close = 100): QuoteLite => ({ changePct, close });

  // first sighting with an opening gap
  {
    const { notes, nextState } = buildMoveNotifications(["COMI"], quotes({ COMI: q(1.2, 96.5) }), { date: "2026-09-25", bands: {} }, T);
    ok(notes.length === 1 && notes[0].ticker === "COMI" && notes[0].fromBand === 0 && notes[0].toBand === 2, "opening gap +1.2% → one note 0→2", notes);
    ok(approx(notes[0].levels, [0.5, 1]), "opening gap levels +0.5,+1.0");
    ok(nextState.date === T && nextState.bands.COMI === 2, "state recorded for today");
  }
  // first sighting inside the flat zone: silent
  {
    const { notes, nextState } = buildMoveNotifications(["COMI"], quotes({ COMI: q(0.3) }), { date: "", bands: {} }, T);
    ok(notes.length === 0 && nextState.bands.COMI === 0, "first sighting +0.3% → silent, band 0 recorded");
  }
  // climbing a step
  {
    const { notes } = buildMoveNotifications(["COMI"], quotes({ COMI: q(1.05) }), { date: T, bands: { COMI: 2 } }, T);
    ok(notes.length === 0, "1.05% stays in band 2 → silent");
  }
  {
    const { notes, nextState } = buildMoveNotifications(["COMI"], quotes({ COMI: q(1.55) }), { date: T, bands: { COMI: 2 } }, T);
    ok(notes.length === 1 && notes[0].toBand === 3 && approx(notes[0].levels, [1.5]), "1.55% crosses to band 3 → notifies +1.5");
    ok(nextState.bands.COMI === 3, "band advanced");
  }
  // pullback: losing a milestone but still up on the day
  {
    const { notes } = buildMoveNotifications(["COMI"], quotes({ COMI: q(0.8, 95.8) }), { date: T, bands: { COMI: 2 } }, T);
    ok(notes.length === 1 && notes[0].toBand === 1, "0.8% falls to band 1 → notifies");
    const p = movePushPayload(notes[0], "en");
    ok(p.title.includes("▼") && p.title.includes("+0.80%"), "pullback title: ▼ with honest day-change +0.80%", p.title);
    ok(p.body.startsWith("Fell below +1.0%"), "pullback body names the lost milestone", p.body);
  }
  // falling through flat into negative territory
  {
    const { notes } = buildMoveNotifications(["COMI"], quotes({ COMI: q(-0.62, 94.2) }), { date: T, bands: { COMI: 1 } }, T);
    ok(notes.length === 1 && notes[0].toBand === -1, "1→-1 crossing notifies");
    ok(approx([...notes[0].levels].sort((a, b) => a - b), [-0.5, 0.5]), "1→-1 crosses +0.5 and -0.5 (order-free)", notes[0]);
    const p = movePushPayload(notes[0], "en");
    ok(p.title.includes("▼") && p.title.includes("−0.62%"), "down-crossing title ▼ −0.62%", p.title);
  }
  // returning into the flat zone: silent, band recorded as 0
  {
    const { notes, nextState } = buildMoveNotifications(["COMI"], quotes({ COMI: q(0.2) }), { date: T, bands: { COMI: 1 } }, T);
    ok(notes.length === 0 && nextState.bands.COMI === 0, "return to flat → silent, tracker reset to 0");
  }
  // re-crossing after a flat visit fires again
  {
    const { notes } = buildMoveNotifications(["COMI"], quotes({ COMI: q(0.7) }), { date: T, bands: { COMI: 0 } }, T);
    ok(notes.length === 1 && notes[0].toBand === 1, "re-crossing +0.5 after flat → fires again");
  }
  // day reset: yesterday's bands are IGNORED — today's reading stands on
  // its own, so +0.8% today is a genuine +0.5% crossing (one note), never
  // measured against yesterday's band 2
  {
    const { notes, nextState } = buildMoveNotifications(["COMI"], quotes({ COMI: q(0.8) }), { date: "2026-09-27", bands: { COMI: 2 } }, T);
    ok(notes.length === 1 && notes[0].fromBand === 0 && notes[0].toBand === 1, "new session day: +0.8% today notifies from flat (yesterday's band ignored)", notes);
    ok(nextState.bands.COMI === 1, "band recorded for the new day");
  }
  // unchanged favorite + missing quote: silent, tracker preserved
  {
    const { notes, nextState } = buildMoveNotifications(["COMI", "TMGH"], quotes({ COMI: q(1.2) }), { date: T, bands: { COMI: 2, TMGH: 3 } }, T);
    ok(notes.length === 0, "COMI unchanged in band 2, TMGH has no quote → silent");
    ok(nextState.bands.TMGH === 3, "missing quote keeps same-day band (no reset)");
  }
  // removed favorite leaves the state (bounded json)
  {
    const { nextState } = buildMoveNotifications(["COMI"], quotes({ COMI: q(1) }), { date: T, bands: { COMI: 1, GONE: 2 } }, T);
    ok(nextState.bands.GONE === undefined, "de-favorited ticker drops out of the tracker");
  }
  // biggest movers sort first
  {
    const { notes } = buildMoveNotifications(["A", "B", "C"], quotes({ A: q(1.6), B: q(-1.1), C: q(0.6) }), { date: T, bands: { A: 1, B: 1, C: 0 } }, T);
    ok(notes[0].ticker === "B" && notes[1].ticker === "A" && notes[2].ticker === "C", "sorted by step distance desc (B 3 steps, A 2, C 1)", notes.map((n) => n.ticker));
  }
  // arabic wording
  {
    const { notes } = buildMoveNotifications(["COMI"], quotes({ COMI: q(1.2, 96.5) }), { date: T, bands: { COMI: 1 } }, T);
    const p = movePushPayload(notes[0], "ar");
    ok(p.title.includes("▲") && p.title.includes("+1.20%"), "ar title keeps ▲ +1.20%", p.title);
    ok(p.body.includes("تجاوز") && p.body.includes("جنيه"), "ar body: تجاوز … جنيه", p.body);
    ok(p.tag === "mv-COMI-2", "tag names stock+milestone", p.tag);
  }
  // negative milestone tag distinct + first-sighting DOWN uses "Crossed"
  {
    const p = movePushPayload({ ticker: "TMGH", fromBand: 0, toBand: -2, levels: [-1, -0.5], changePct: -1.05, close: 12.3 }, "en");
    ok(p.tag === "mv-TMGH-2n", "negative milestone tag", p.tag);
    ok(p.body.startsWith("Crossed"), "first-sighting down body uses Crossed (opening reading, not an intraday fall)", p.body);
  }
  // intraday down-move keeps "Fell below"
  {
    const p = movePushPayload({ ticker: "TMGH", fromBand: -2, toBand: -3, levels: [-1.5], changePct: -1.53, close: 12.3 }, "en");
    ok(p.body.startsWith("Fell below −1.5%"), "intraday fall names the lost milestone", p.body);
  }
  // climb within negative territory
  {
    const p = movePushPayload({ ticker: "TMGH", fromBand: -3, toBand: -2, levels: [-1.5], changePct: -1.2, close: 12.4 }, "en");
    ok(p.title.includes("▲") && p.title.includes("−1.20%"), "recovery climb: ▲ with honest still-down day change", p.title);
    ok(p.body.startsWith("Crossed −1.5%"), "recovery body names the cleared milestone", p.body);
  }
}

// ── Part B: E2E against a local HTTPS endpoint ────────────────────────────

async function partB() {
  console.log("\n[Part B] E2E — real engine, real VAPID, real web-push transport");
  // each captured push: raw encrypted body + the Crypto-Key dh header, so
  // the payload can be DECRYPTED (http_ece, RFC 8291) with our keypair and
  // the actual notification CONTENT asserted — the full chain a phone runs
  const captured: { body: Buffer; dh: string; salt: string }[] = [];

  const server = https.createServer(
    {
      key: (await import("node:fs")).readFileSync("/tmp/t70-push-key.pem", "utf8"),
      cert: (await import("node:fs")).readFileSync("/tmp/t70-push-cert.pem", "utf8"),
    },
    (req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const cryptoKey = (req.headers["crypto-key"] as string | undefined) ?? "";
        const encryption = (req.headers["encryption"] as string | undefined) ?? "";
        const dh = /dh=([^;,\s]+)/.exec(cryptoKey)?.[1] ?? "";
        const salt = /salt=([^;,\s]+)/.exec(encryption)?.[1] ?? "";
        captured.push({ body: Buffer.concat(chunks), dh, salt });
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end("{}");
      });
    }
  );
  await new Promise<void>((r) => server.listen(8443, "127.0.0.1", r));
  console.log("  · capture endpoint listening on https://127.0.0.1:8443");

  // a REAL browser-grade subscription keypair, so web-push can actually
  // encrypt + POST the payload to the local capture endpoint
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const p256dh = ecdh.getPublicKey().toString("base64url");
  const authKey = crypto.randomBytes(16).toString("base64url");

  /** Decrypt one captured push exactly like the phone's push service +
   *  service worker would (http_ece decrypt with our private key). */
  const decryptAt = (i: number): any => {
    const c = captured[i];
    const plain = ece.decrypt(c.body, {
      version: "aes128gcm",
      dh: c.dh,
      privateKey: ecdh,
      authSecret: authKey,
    });
    return JSON.parse(plain.toString("utf8"));
  };

  const DEV = "t70-moves-e2e-device";
  const endpoint = "https://127.0.0.1:8443/fcm/t70";
  try {
    await db.pushDevice.delete({ where: { deviceId: DEV } }).catch(() => {});

    // a fake "now" inside today's EGX session (today is a trading day; the
    // sandbox clock is after close, so we time-travel to 11:00 Cairo)
    const { marketStatus } = await import("../src/lib/market-status");
    const nowUTC = new Date();
    // Cairo = UTC+2 (no DST in 2026): 11:00 Cairo == 09:00 UTC same date
    const fakeNow = new Date(Date.UTC(nowUTC.getUTCFullYear(), nowUTC.getUTCMonth(), nowUTC.getUTCDate(), 9, 0, 0));
    const st = marketStatus(fakeNow);
    ok(st.open || st.lastSession === new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(fakeNow), "fake now lands in/after a Cairo session", st);
    if (!st.open) {
      console.log("  · note: fake now is after close — engine relies on the 15:00 grace window");
    }

    // real quotes for expectations
    const { fetchUniverse } = await import("../src/lib/market");
    const universe = await fetchUniverse();
    const byT = new Map(universe.map((s) => [s.ticker, s] as const));
    const favs = ["COMI", "TMGH"];
    const expectedBands = favs.map((t) => {
      const s = byT.get(t);
      return s ? moveBand(s.changePct) : null;
    });
    console.log(`  · live quotes: COMI ${byT.get("COMI")?.changePct}% TMGH ${byT.get("TMGH")?.changePct}% → bands ${expectedBands}`);

    await db.pushDevice.create({
      data: {
        deviceId: DEV,
        endpoint,
        p256dh,
        auth: authKey,
        alertsJson: "[]",
        notifiedJson: "[]",
        watchlistJson: JSON.stringify(favs),
        movesJson: "{}",
        lang: "ar",
      },
    });
    console.log("  · device row created (favorites COMI + TMGH, fresh tracker)");

    // run 1 — first sighting: notify every favorite already past a milestone
    captured.length = 0;
    const r1 = await pushWatchlistMoves(fakeNow);
    const firstSightNotes = favs.filter((_, i) => (expectedBands[i] ?? 0) !== 0).length;
    ok(r1.devices === 1, "engine saw the device", r1);
    ok(r1.notified === firstSightNotes && captured.length === firstSightNotes, `first sighting fired exactly ${firstSightNotes} notification(s)`, { r1, captured: captured.length });
    for (let i = 0; i < captured.length; i++) {
      const p = decryptAt(i);
      ok(
        typeof p?.title === "string" &&
          typeof p?.body === "string" &&
          typeof p?.tag === "string" &&
          String(p?.url).startsWith("/?view=company&ticker="),
        `decrypted payload #${i} shape (title/body/tag/url)`,
        p
      );
      ok(typeof p?.lang === "string" && (p.lang === "ar" || p.lang === "en"), `payload #${i} carries lang`, p?.lang);
    }
    const firstTitle = captured.length ? decryptAt(0).title : "";
    ok(firstTitle.includes("TMGH"), "first notification is TMGH (the mover; COMI sits in band 0)", firstTitle);
    const row1 = await db.pushDevice.findUnique({ where: { deviceId: DEV } });
    const state1 = JSON.parse(row1?.movesJson ?? "{}") as MovesState;
    ok(Object.keys(state1.bands ?? {}).length === favs.length, "band state persisted for both favorites", state1);

    // run 2 — same moment: idempotent, nothing new
    captured.length = 0;
    const r2 = await pushWatchlistMoves(fakeNow);
    ok(r2.notified === 0 && captured.length === 0, "re-run is silent (state dedupe)", { r2, captured: captured.length });

    // tamper: force TMGH's band one step ABOVE its real one → the engine
    // must announce exactly that re-crossing (COMI sits in band 0 → silent)
    captured.length = 0;
    const realBandTmhg = expectedBands[1] ?? 0;
    const tampered = { date: state1.date, bands: { ...state1.bands } };
    tampered.bands.TMGH = realBandTmhg + 1;
    await db.pushDevice.update({ where: { deviceId: DEV }, data: { movesJson: JSON.stringify(tampered) } });
    const r3 = await pushWatchlistMoves(fakeNow);
    ok(r3.notified === 1 && captured.length === 1, "forced re-crossing fires exactly one notification", { r3, captured: captured.length });
    if (captured[0]) {
      const p = decryptAt(0);
      // falling from band (real+1) to realBand crosses realBand's upper edge:
      // for realBand=-3 that is −1.5% (= realBand * 0.5)
      const milestone = realBandTmhg * 0.5;
      const milestoneStr = `${milestone > 0 ? "+" : "−"}${Math.abs(milestone).toFixed(1)}%`;
      ok(String(p.body).includes(milestoneStr), `decrypted body names the re-crossed milestone ${milestoneStr}`, p.body);
      ok(p.tag === `mv-TMGH-${Math.abs(realBandTmhg)}${realBandTmhg < 0 ? "n" : ""}`, "decrypted tag matches the milestone", p.tag);
      ok(String(p.title).includes("TMGH"), "decrypted title names the stock", p.title);
    }
    const row3 = await db.pushDevice.findUnique({ where: { deviceId: DEV } });
    const state3 = JSON.parse(row3?.movesJson ?? "{}") as MovesState;
    ok(state3.bands.TMGH === realBandTmhg, "band state re-synced to reality after the crossing", state3);

    // run 4 — real now (after close + past grace, or weekend): engine no-ops
    // and NEVER writes state (yesterday's bands stay frozen)
    captured.length = 0;
    const stale = JSON.stringify(JSON.parse((await db.pushDevice.findUnique({ where: { deviceId: DEV } }))?.movesJson ?? "{}"));
    const r4 = await pushWatchlistMoves(new Date());
    const after4 = JSON.stringify(JSON.parse((await db.pushDevice.findUnique({ where: { deviceId: DEV } }))?.movesJson ?? "{}"));
    ok(r4.notified === 0, "outside session + grace → no notifications", r4);
    ok(after4 === stale, "outside session → state untouched (frozen)", { stale, after4 });

    ok(MOVE_STEP_PCT === 0.5, "step constant is 0.5%");
  } finally {
    await db.pushDevice.delete({ where: { deviceId: DEV } }).catch(() => {});
    server.close();
    await db.$disconnect();
  }
}

async function main() {
  partA();
  await partB();
  console.log(`\n=== T70 moves engine: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("TEST CRASHED:", e);
  process.exit(1);
});
