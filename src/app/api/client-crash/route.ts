import { NextResponse } from "next/server";

/** POST /api/client-crash — T69: the client error boundaries (error.tsx /
 *  global-error.tsx) report view crashes here so they are diagnosable from
 *  the dev log / Vercel logs instead of dying invisibly as blank screens.
 *  Fire-and-forget from the client; heavily clamped (kind + 300-char msg +
 *  UA); best-effort JSONL append on writable hosts (the sandbox dev box) —
 *  never throws, never acknowledges anything sensitive. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { kind?: unknown; msg?: unknown; at?: unknown };
    const kind = typeof body.kind === "string" ? body.kind.slice(0, 40) : "unknown";
    const msg = typeof body.msg === "string" ? body.msg.slice(0, 300) : "";
    const at = typeof body.at === "string" ? body.at.slice(0, 40) : new Date().toISOString();
    const ua = (req.headers.get("user-agent") ?? "").slice(0, 140);
    const line = `[client-crash] ${at} kind=${kind} ua=${ua} msg=${msg}`;
    console.warn(line);
    // best-effort persistent tail (read-only hosts just skip it)
    try {
      const { appendFile, mkdir } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      const file = "data/client-crashes.jsonl";
      await mkdir(dirname(file), { recursive: true });
      await appendFile(file, JSON.stringify({ at, kind, msg, ua }) + "\n", "utf8");
    } catch {}
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
