import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashCode, isEmailValid } from "@/lib/auth";

/**
 * POST /api/auth/request
 * Body: { email }
 * Creates a 6-digit one-time code valid for 10 minutes.
 * Delivery: in this sandbox there is no SMTP relay, so the code is returned
 * in the response (and logged) — mirroring an email-OTP flow.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!isEmailValid(email)) {
      return NextResponse.json({ error: "بريد غير صالح" }, { status: 400 });
    }

    // throttle: max 3 pending codes per email
    const pending = await db.otpCode.count({
      where: { email, usedAt: null, expiresAt: { gt: new Date() } },
    });
    if (pending >= 3) {
      return NextResponse.json(
        { error: "طلبت رمزاً منذ قليل — راجع بريدك أو انتظر قليلاً." },
        { status: 429 }
      );
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    await db.otpCode.create({
      data: {
        email,
        codeHash: hashCode(code),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });
    console.log(`[auth] OTP for ${email}: ${code}`);

    return NextResponse.json({
      sent: true,
      // Sandbox delivery: the code is surfaced here instead of an email.
      devCode: code,
      message: "أُرسل رمز من ستة أرقام. صالح عشر دقائق ويُستخدم مرة واحدة.",
    });
  } catch {
    return NextResponse.json({ error: "تعذر إرسال الرمز" }, { status: 500 });
  }
}
