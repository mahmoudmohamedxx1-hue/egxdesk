/** Task 19 hardening tests — usage metering, persisted rate limit, health,
 *  push/run guard. Run with the dev server up: `bun scripts/e2e/t19-hardening-test.ts`
 *  (BASE_URL configurable, default http://localhost:3000). */
import { PrismaClient } from "@prisma/client";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const db = new PrismaClient({
  datasources: { db: { url: "file:/home/z/my-project/db/custom.db" } },
});

let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    failures.push(name + (extra ? ` — ${extra}` : ""));
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

const SEED_IP = "203.0.113.77";
const SEED_DEVICE = "t19-seed-device-0001";

async function main() {
  console.log(`\n=== Task 19 hardening tests against ${BASE_URL} ===\n`);

  // ── 1. /api/health ──
  console.log("[health]");
  const health = await fetch(`${BASE_URL}/api/health`).then((r) => r.json() as Promise<Record<string, unknown>>);
  check("health responds ok", health.ok === true);
  check("health reports the current app version", typeof health.version === "string" && /^\d+\.\d+$/.test(health.version) && Number(health.version) >= 2.11, `got ${health.version}`);
  check("health db up", health.db === "up", `got ${health.db}`);

  // ── 2. /api/usage shape ──
  console.log("[usage]");
  const usage0 = (await fetch(`${BASE_URL}/api/usage`).then((r) => r.json() as Promise<Record<string, unknown>>)) as {
    ok?: boolean;
    limits?: { agentQuestionsPerHourPerUser?: number };
    today?: { questions?: number; llmCalls?: number };
    last7d?: unknown[];
  };
  check("usage responds ok", usage0.ok === true);
  check("usage exposes 60/h limit", usage0.limits?.agentQuestionsPerHourPerUser === 60);
  check("usage has today + last7d", typeof usage0.today?.questions === "number" && Array.isArray(usage0.last7d));

  // ── 3. persisted rate limit: seed 60 events for a fake IP, expect 429 ──
  console.log("[persisted rate limit]");
  await db.usageEvent.deleteMany({ where: { ip: SEED_IP } });
  await db.usageEvent.createMany({
    data: Array.from({ length: 60 }, () => ({
      ip: SEED_IP,
      deviceId: SEED_DEVICE,
      route: "agent",
      llmCalls: 2,
      toolCalls: 2,
      webSearches: 0,
      ok: true,
      ms: 4000,
    })),
  });
  const seeded = await db.usageEvent.count({ where: { ip: SEED_IP } });
  check("seeded 60 usage events", seeded === 60, `got ${seeded}`);

  const t429 = Date.now();
  const res429 = await fetch(`${BASE_URL}/api/agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": SEED_IP },
    body: JSON.stringify({
      messages: [{ role: "user", content: "market overview" }],
      lang: "en",
      deviceId: SEED_DEVICE,
    }),
  });
  check("agent returns 429 when over limit", res429.status === 429, `got ${res429.status}`);
  check("429 rejects fast (no LLM burn)", Date.now() - t429 < 3000, `${Date.now() - t429}ms`);

  const cleaned = await db.usageEvent.deleteMany({ where: { ip: SEED_IP } });
  check("cleanup removed all seeds", cleaned.count === 60, `removed ${cleaned.count}`);

  // ── 4. live agent round-trip with deviceId → metered ──
  console.log("[live agent + metering]");
  const before = (await fetch(`${BASE_URL}/api/usage`).then((r) => r.json() as Promise<any>)) as {
    today: { questions: number; llmCalls: number };
  };
  const tLive = Date.now();
  const resLive = await fetch(`${BASE_URL}/api/agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: "What is the latest price of COMI? Keep it to a few lines." }],
      lang: "en",
      deviceId: "t19-live-device-0001",
    }),
  });
  // Task 20: the agent streams SSE now — parse events for the done payload
  const ctLive = resLive.headers.get("content-type") ?? "";
  let jsonLive: { answer?: string; steps?: unknown[]; model?: string } = {};
  if (ctLive.includes("text/event-stream")) {
    const reader = resLive.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let sep: number;
      while ((sep = buf.indexOf("\n\n")) !== -1) {
        const rawEvt = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        for (const line of rawEvt.split("\n")) {
          if (!line.startsWith("data:")) continue;
          try {
            const evt = JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
            if (evt.type === "done") jsonLive = evt as typeof jsonLive;
          } catch {}
        }
      }
    }
  } else {
    jsonLive = (await resLive.json()) as typeof jsonLive;
  }
  check("live agent answers 200", resLive.status === 200, `got ${resLive.status}`);
  check("answer is non-empty markdown", typeof jsonLive.answer === "string" && jsonLive.answer.length > 40);
  check("steps array present", Array.isArray(jsonLive.steps));
  check("model labeled GLM", jsonLive.model === "GLM");
  console.log(`    (${Date.now() - tLive}ms, answer ${jsonLive.answer?.length ?? 0} chars, ${jsonLive.steps?.length ?? 0} tools)`);

  await new Promise((r) => setTimeout(r, 1200)); // metering write is fire-and-forget
  const after = (await fetch(`${BASE_URL}/api/usage`).then((r) => r.json() as Promise<any>)) as {
    today: { questions: number; llmCalls: number };
  };
  check("usage question count incremented", after.today.questions === before.today.questions + 1, `${before.today.questions}→${after.today.questions}`);
  check("usage llmCalls metered", after.today.llmCalls >= before.today.llmCalls + 1, `${before.today.llmCalls}→${after.today.llmCalls}`);

  // ── 5. push/run guard (6/h per IP, then 429) ──
  console.log("[push/run guard]");
  // dedicated test IP so earlier suites (t16's single forced evaluation) can
  // never pre-burn this budget — the assertion stays deterministic
  const PUSH_IP = "198.51.100.77";
  const codes: number[] = [];
  for (let i = 0; i < 7; i++) {
    const r = await fetch(`${BASE_URL}/api/push/run`, {
      method: "POST",
      headers: { "x-forwarded-for": PUSH_IP },
    });
    codes.push(r.status);
  }
  check("first 6 push/run calls allowed", codes.slice(0, 6).every((c) => c !== 429), codes.join(","));
  check("7th push/run call rate limited", codes[6] === 429, codes.join(","));

  console.log(`\n=== RESULT: ${pass}/${pass + fail} ===`);
  if (failures.length) {
    console.log("failures:");
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  await db.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("test crashed:", e);
  await db.$disconnect();
  process.exit(1);
});
