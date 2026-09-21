import { createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";

export const SESSION_COOKIE = "egx_session";
export const SESSION_TTL_DAYS = 30;

export function hashCode(code: string) {
  return createHash("sha256").update(code).digest("hex");
}

export function newToken() {
  return randomBytes(32).toString("base64url");
}

export function isEmailValid(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Read the session cookie and resolve the signed-in user (null if signed out). */
export async function getSessionUser() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { token },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  return session.user;
}

/** Which dataset this visitor may read: signed-in => live, otherwise demo. */
export async function resolveDataset() {
  const user = await getSessionUser();
  return { user, dataset: user ? "live" : "demo" as "live" | "demo" };
}
