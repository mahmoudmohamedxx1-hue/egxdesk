import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/** /api/agent/chats — server-side chat history for the AI agent tab, keyed by
 *  the device uuid (egx-device-id, same identity as PushDevice). The client
 *  saves the whole conversation here after every exchange (full-list sync,
 *  same pattern as the watchlist), so history survives browser storage clears
 *  and device changes of the installed PWA.
 *
 *  - GET  ?deviceId=            → list of chats (metadata only, 50 newest)
 *  - GET  ?deviceId=&id=        → full messages of one chat
 *  - PUT  {deviceId,id,title,messages} → upsert one chat
 *  - DEL  ?deviceId=&id=        → delete one chat
 *
 *  Validation is deliberately lenient (unknown fields dropped, bad rows
 *  filtered) so a client version skew can never 500. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MsgIn = {
  role?: unknown;
  content?: unknown;
  steps?: unknown;
  error?: unknown;
  ts?: unknown;
};

type StepIn = {
  tool?: unknown;
  args?: unknown;
  ok?: unknown;
};

const MAX_MSGS = 80;
const MAX_CONTENT = 20000;
const MAX_STEPS = 20;

type StoredMsg = {
  role: "user" | "assistant";
  content: string;
  steps?: { tool: string; args: Record<string, unknown>; ok: boolean }[];
  error?: boolean;
  ts?: number;
};

function validDeviceId(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length >= 8 && s.length <= 128 ? s : null;
}

function validChatId(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length >= 8 && s.length <= 64 ? s : null;
}

/** Normalize one incoming message; null = drop the row. */
function normalizeMsg(m: unknown): StoredMsg | null {
  if (m === null || typeof m !== "object") return null;
  const msg = m as MsgIn;
  if (msg.role !== "user" && msg.role !== "assistant") return null;
  if (typeof msg.content !== "string" || msg.content.length === 0 || msg.content.length > MAX_CONTENT) return null;
  const out: StoredMsg = {
    role: msg.role,
    content: msg.content,
  };
  if (Array.isArray(msg.steps)) {
    const steps = msg.steps
      .filter((s): s is StepIn => s !== null && typeof s === "object" && typeof (s as StepIn).tool === "string")
      .slice(0, MAX_STEPS)
      .map((s) => ({
        tool: String(s.tool).slice(0, 60),
        args:
          s.args && typeof s.args === "object" && !Array.isArray(s.args)
            ? (JSON.parse(JSON.stringify(s.args)) as Record<string, unknown>)
            : {},
        ok: s.ok !== false,
      }));
    if (steps.length > 0) out.steps = steps;
  }
  if (msg.error === true) out.error = true;
  if (typeof msg.ts === "number" && Number.isFinite(msg.ts)) out.ts = msg.ts;
  return out;
}

function countMessages(json: string): number {
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.length : 0;
  } catch {
    return 0;
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const deviceId = validDeviceId(url.searchParams.get("deviceId"));
  if (!deviceId) {
    return NextResponse.json({ error: "deviceId required" }, { status: 400 });
  }

  // single chat → full messages
  const chatId = url.searchParams.get("id");
  if (chatId) {
    const id = validChatId(chatId);
    if (!id) return NextResponse.json({ error: "invalid id" }, { status: 400 });
    const row = await db.agentChat.findFirst({ where: { id, deviceId } });
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    let messages: unknown[] = [];
    try {
      const parsed = JSON.parse(row.messagesJson);
      if (Array.isArray(parsed)) messages = parsed;
    } catch {}
    return NextResponse.json(
      { id: row.id, title: row.title, updatedAt: row.updatedAt, messages },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  // list → metadata only
  const rows = await db.agentChat.findMany({
    where: { deviceId },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: { id: true, title: true, updatedAt: true, messagesJson: true },
  });
  return NextResponse.json(
    {
      chats: rows.map((r) => ({
        id: r.id,
        title: r.title,
        updatedAt: r.updatedAt,
        count: countMessages(r.messagesJson),
      })),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function PUT(req: Request) {
  let body: { deviceId?: unknown; id?: unknown; title?: unknown; messages?: unknown };
  try {
    body = (await req.json()) as { deviceId?: unknown; id?: unknown; title?: unknown; messages?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const deviceId = validDeviceId(body.deviceId);
  const id = validChatId(body.id);
  if (!deviceId || !id) {
    return NextResponse.json({ error: "deviceId + id required" }, { status: 400 });
  }

  const messages = Array.isArray(body.messages)
    ? body.messages
        .map((m) => normalizeMsg(m))
        .filter((m): m is StoredMsg => m !== null)
        .slice(0, MAX_MSGS)
    : [];
  if (messages.length === 0) {
    return NextResponse.json({ error: "messages required" }, { status: 400 });
  }

  // title: client sends the first user message; fall back to first message content
  let title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    const first = messages.find((m) => m.role === "user") ?? messages[0];
    title = first.content.slice(0, 80);
  }
  title = title.slice(0, 120);

  const messagesJson = JSON.stringify(messages);

  // ownership-checked upsert (never overwrite another device's row)
  const existing = await db.agentChat.findFirst({ where: { id, deviceId }, select: { id: true } });
  if (existing) {
    await db.agentChat.update({ where: { id: existing.id }, data: { title, messagesJson, updatedAt: new Date() } });
  } else {
    try {
      await db.agentChat.create({ data: { id, deviceId, title, messagesJson } });
    } catch {
      // id collides with another device's chat — refuse rather than leak
      return NextResponse.json({ error: "chat id already exists" }, { status: 409 });
    }
  }
  return NextResponse.json({ ok: true, count: messages.length });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const deviceId = validDeviceId(url.searchParams.get("deviceId"));
  const id = validChatId(url.searchParams.get("id"));
  if (!deviceId || !id) {
    return NextResponse.json({ error: "deviceId + id required" }, { status: 400 });
  }
  const res = await db.agentChat.deleteMany({ where: { id, deviceId } });
  return NextResponse.json({ ok: true, deleted: res.count });
}
