import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";

/** GET /api/auth/me — who is signed in? */
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "signed out" }, { status: 401 });
  }
  return NextResponse.json({ email: user.email });
}
