import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashCode, newToken, SESSION_COOKIE, SESSION_TTL_DAYS } from "@/lib/auth";

/**
 * POST /api/auth/verify
 * Body: { email, code }
 * On success: upsert user, create session, set HttpOnly cookie (30 days).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body.email ?? "").trim().toLowerCase();
    const code = String(body.code ?? "").trim();

    if (!email || !/^\d{6}$/.test(code)) {
      return NextResponse.json({ error: "رمز غير صالح" }, { status: 400 });
    }

    // find the freshest matching code
    const matches = await db.otpCode.findMany({
      where: { email, codeHash: hashCode(code), usedAt: null },
      orderBy: { expiresAt: "desc" },
      take: 5,
    });
    const valid = matches.find((m) => m.expiresAt.getTime() > Date.now());
    if (!valid) {
      return NextResponse.json(
        { error: "الرمز غير صحيح أو منتهي الصلاحية" },
        { status: 401 }
      );
    }

    // burn the code
    await db.otpCode.update({
      where: { id: valid.id },
      data: { usedAt: new Date() },
    });

    // upsert user + session
    const user = await db.user.upsert({
      where: { email },
      create: { email },
      update: {},
    });
    const token = newToken();
    await db.session.create({
      data: {
        token,
        userId: user.id,
        expiresAt: new Date(Date.now() + SESSION_TTL_DAYS * 86400 * 1000),
      },
    });

    const res = NextResponse.json({ email: user.email, expires_in: SESSION_TTL_DAYS * 86400 });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_DAYS * 86400,
    });
    return res;
  } catch {
    return NextResponse.json({ error: "تعذر التحقق من الرمز" }, { status: 500 });
  }
}
