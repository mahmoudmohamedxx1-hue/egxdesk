/** t18 test — server-side agent chat history CRUD (/api/agent/chats):
 *  create/upsert, list, single fetch, ownership isolation, validation,
 *  delete, lenient row filtering. Run: BASE_URL=... node scripts/e2e/t18-chats-test.js */
const BASE = process.env.BASE_URL || "http://localhost:3000";
const DEV = "test-device-12345678";
const CID = "test-chat-abcdef12";

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  PASS  ${name}${extra ? "  -- " + extra : ""}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? "  -- " + extra : ""}`); }
}

async function req(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = {};
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

(async () => {
  console.log("── /api/agent/chats ──");
  const msgs = [
    { role: "user", content: "What is the state of the market?", ts: 1700000000 },
    { role: "assistant", content: "EGX30 is down 0.39% at 56,280...", steps: [{ tool: "market_overview", args: {}, ok: true }], ts: 1700000001 },
    { role: "user", content: "And COMI?", ts: 1700000002 },
    { role: "assistant", content: "COMI trades at 74.5 EGP...", steps: [{ tool: "quote", args: { ticker: "COMI" }, ok: true }], ts: 1700000003 },
  ];

  let r = await req("PUT", "/api/agent/chats", { deviceId: DEV, id: CID, messages: msgs });
  check("PUT create", r.status === 200 && r.json.count === 4, JSON.stringify(r.json));

  r = await req("PUT", "/api/agent/chats", { deviceId: DEV, id: CID, messages: [...msgs, { role: "user", content: "And dividends?", ts: 4 }] });
  check("PUT upsert update", r.status === 200 && r.json.count === 5);

  r = await req("GET", `/api/agent/chats?deviceId=${DEV}`);
  check("GET list", r.status === 200 && r.json.chats?.length === 1 && r.json.chats[0].count === 5, `title=${r.json.chats?.[0]?.title?.slice(0, 30)}`);

  r = await req("GET", `/api/agent/chats?deviceId=${DEV}&id=${CID}`);
  check("GET single with steps preserved", r.status === 200 && r.json.messages?.length === 5 && !!r.json.messages[1].steps);

  r = await req("GET", `/api/agent/chats?deviceId=other-device-9999&id=${CID}`);
  check("cross-device GET isolated (404)", r.status === 404);
  r = await req("DELETE", `/api/agent/chats?deviceId=other-device-9999&id=${CID}`);
  check("cross-device DELETE no-op", r.json.deleted === 0);

  r = await req("PUT", "/api/agent/chats", { deviceId: "short", id: CID, messages: msgs });
  check("invalid deviceId -> 400", r.status === 400);
  r = await req("PUT", "/api/agent/chats", { deviceId: DEV, id: CID, messages: "nope" });
  check("invalid messages -> 400", r.status === 400);
  r = await req("GET", "/api/agent/chats");
  check("missing deviceId -> 400", r.status === 400);

  r = await req("DELETE", `/api/agent/chats?deviceId=${DEV}&id=${CID}`);
  check("DELETE own chat", r.status === 200 && r.json.deleted === 1);
  r = await req("GET", `/api/agent/chats?deviceId=${DEV}`);
  check("list empty after delete", r.json.chats?.length === 0);

  r = await req("PUT", "/api/agent/chats", { deviceId: DEV, id: CID, messages: [{ role: "bogus", content: "x" }, msgs[0], { role: "user", content: "" }] });
  check("lenient row filter (bad rows dropped)", r.status === 200 && r.json.count === 1);
  await req("DELETE", `/api/agent/chats?deviceId=${DEV}&id=${CID}`);

  console.log(`\n${passed}/${passed + failed} passed`);
  process.exit(failed ? 1 : 0);
})();
