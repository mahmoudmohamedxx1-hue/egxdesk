/** T70 browser test — the SERVICE-WORKER display path for move
 *  notifications: grant the notifications permission, register through the
 *  app's own service worker, show a move notification with the exact
 *  options the push handler uses, then read it back with getNotifications
 *  and verify every option (title/body/dir/lang/tag/data.url) survived the
 *  round-trip. Also verifies the SW serves the new v50 version and the
 *  push handler's JSON parsing path via a synthetic PushEvent dispatch. */
const { chromium } = require("/home/z/.npm-global/lib/node_modules/playwright");

(async () => {
  // headful under Xvfb: headless Chromium force-denies the notifications
  // permission at the browser layer; headful Chrome honors the CDP grant —
  // the honest way to exercise the real display path
  const headless = process.env.T70_HEADLESS === "1";
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext();
  // grant AFTER context creation with an explicit origin (the constructor
  // option is unreliable for notifications in headless Chromium)
  await context.grantPermissions(["notifications"], { origin: "http://localhost:3000" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("http://localhost:3000/", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2500);

  // 1) SW version = v50 (the T70 bump)
  const swVersion = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    const src = await (await fetch("/sw.js", { cache: "no-store" })).text();
    const m = /VERSION = "([^"]+)"/.exec(src);
    return { url: reg.active?.scriptURL ?? "", version: m?.[1] ?? null, scope: reg.scope };
  });
  console.log("SW:", JSON.stringify(swVersion));

  // 2) permission granted?
  const perm = await page.evaluate(() => Notification.permission);
  console.log("permission:", perm);

  // 3) show a move notification through the app's OWN service worker
  const shown = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification("EGX Desk — COMI ▲ +1.20%", {
      body: "تجاوز +0.5% و+1.0% منذ الإغلاق السابق — الآن 96.50 جنيه",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: "mv-COMI-2",
      renotify: true,
      dir: "rtl",
      lang: "ar",
      data: { url: "/?view=company&ticker=COMI&panel=overview" },
    });
    await reg.showNotification("EGX Desk — TMGH ▼ −1.53%", {
      body: "Fell below −1.0% and −1.5% — now 11.61 EGP",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: "mv-TMGH-3n",
      renotify: true,
      dir: "ltr",
      lang: "en",
      data: { url: "/?view=company&ticker=TMGH&panel=overview" },
    });
    const notes = await reg.getNotifications();
    return notes.map((n) => ({
      title: n.title,
      body: n.body,
      dir: n.dir,
      lang: n.lang,
      tag: n.tag,
      dataUrl: n.data && n.data.url,
    }));
  });
  console.log("shown notifications:", JSON.stringify(shown, null, 2));

  let pass = 0;
  let fail = 0;
  const ok = (c, label, extra) => {
    if (c) { pass++; console.log("  ✓ " + label); }
    else { fail++; console.log("  ✗ " + label + (extra !== undefined ? " " + JSON.stringify(extra) : "")); }
  };

  ok(swVersion.version === "egx-desk-v50", "service worker is the T50 bump (v50)", swVersion.version);
  ok(perm === "granted", "notification permission granted", perm);
  ok(shown.length === 2, "both notifications displayed", shown.length);
  const ar = shown.find((n) => n.tag === "mv-COMI-2");
  const en = shown.find((n) => n.tag === "mv-TMGH-3n");
  ok(!!ar && ar.dir === "rtl" && ar.lang === "ar", "AR notification keeps dir=rtl lang=ar", ar);
  ok(!!en && en.dir === "ltr" && en.lang === "en", "EN notification keeps dir=ltr lang=en (T70 fix)", en);
  ok(!!ar && ar.title.includes("▲ +1.20%"), "AR title carries arrow + pct", ar && ar.title);
  ok(!!en && en.body.includes("Fell below"), "EN body wording", en && en.body);
  ok(!!ar && ar.dataUrl === "/?view=company&ticker=COMI&panel=overview", "AR deep link data.url", ar && ar.dataUrl);
  ok(!!en && en.dataUrl === "/?view=company&ticker=TMGH&panel=overview", "EN deep link data.url", en && en.dataUrl);

  // 4) the push EVENT handler itself: ask the worker (via the T70 self-test
  //    hook) to dispatch a synthetic PushEvent with the exact JSON the
  //    engine sends, then verify the handler showed it (a fresh tag proves
  //    the HANDLER created the notification, not our direct calls)
  const pushHandled = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    const sw = reg.active;
    if (!sw) return { ok: false, why: "no active worker" };
    const payload = JSON.stringify({
      title: "EGX Desk — SW test ▲ +0.50%",
      body: "handler-level test",
      url: "/?view=company&ticker=SWTEST&panel=overview",
      tag: "mv-SWTEST-1",
      lang: "en",
    });
    const echoed = new Promise((resolve) => {
      const onMsg = (ev) => {
        if (ev.data && ev.data.__pushEcho) {
          navigator.serviceWorker.removeEventListener("message", onMsg);
          resolve(true);
        }
      };
      navigator.serviceWorker.addEventListener("message", onMsg);
    });
    sw.postMessage({ __pushSelfTest: payload });
    const got = await Promise.race([echoed.then(() => true), new Promise((r) => setTimeout(() => r(false), 4000))]);
    await new Promise((r) => setTimeout(r, 700));
    const notes = await reg.getNotifications();
    const hit = notes.find((n) => n.tag === "mv-SWTEST-1");
    return { echoed: got, notification: hit ? { title: hit.title, dir: hit.dir, lang: hit.lang, dataUrl: hit.data && hit.data.url } : null };
  });
  console.log("push-handler path:", JSON.stringify(pushHandled));

  ok(pushHandled.notification !== null, "push EVENT handler shows the notification", pushHandled);
  ok(pushHandled.notification && pushHandled.notification.dir === "ltr" && pushHandled.notification.lang === "en", "push handler derives dir/lang from payload lang", pushHandled.notification);
  ok(pushHandled.notification && String(pushHandled.notification.dataUrl).includes("SWTEST"), "push handler deep link from payload url", pushHandled.notification && pushHandled.notification.dataUrl);
  ok(errors.length === 0, "zero page errors", errors);

  await browser.close();
  console.log(`\n=== T70 browser SW notification test: ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error("CRASHED:", e);
  process.exit(1);
});
