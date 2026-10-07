import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { sessions, users } from "@/db/schema";
import { isProduction } from "@/lib/env";

export const SESSION_COOKIE = "sc_os_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Harde bovengrens: een sessie verloopt altijd 30 dagen na aanmaak, ook bij
 *  dagelijks gebruik (glijdende 7-daagse inactiviteit blijft daarnaast gelden). */
const SESSION_ABSOLUTE_MAX_MS = 30 * 24 * 60 * 60 * 1000;
/** Bij elke request verlengen zou te veel schrijven; dit is de drempel. */
const REFRESH_AFTER_MS = 60 * 60 * 1000;

/** Het cookie bevat het token; de database alleen de hash ervan. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export type SessionUser = {
  id: string;
  email: string;
  fullName: string;
  primaryRole: string;
  clientId: string | null;
  avatarUrl: string | null;
  status: string;
};

export async function createSession(
  userId: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<string> {
  const token = newSessionToken();
  await db.insert(sessions).values({
    tokenHash: hashToken(token),
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    ipAddress: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });

  return token;
}

/** Leest de sessie uit het cookie en geeft de bijbehorende gebruiker terug. */
export async function readSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const tokenHash = hashToken(token);

  const rows = await db
    .select({
      sessionId: sessions.id,
      lastSeenAt: sessions.lastSeenAt,
      createdAt: sessions.createdAt,
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      primaryRole: users.primaryRole,
      clientId: users.clientId,
      avatarUrl: users.avatarUrl,
      status: users.status,
      deletedAt: users.deletedAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.deletedAt || row.status !== "active") return null;

  // Harde 30-dagen-grens vanaf aanmaak, ongeacht activiteit.
  if (Date.now() - new Date(row.createdAt).getTime() > SESSION_ABSOLUTE_MAX_MS) {
    await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, row.sessionId));
    return null;
  }

  // Vergelijking in constante tijd, zodat de hash niet via timing lekt.
  const a = Buffer.from(tokenHash);
  const b = Buffer.from(hashToken(token));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  if (Date.now() - new Date(row.lastSeenAt).getTime() > REFRESH_AFTER_MS) {
    const absoluteCap = new Date(row.createdAt).getTime() + SESSION_ABSOLUTE_MAX_MS;
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date(), expiresAt: new Date(Math.min(Date.now() + SESSION_TTL_MS, absoluteCap)) })
      .where(eq(sessions.id, row.sessionId));
  }

  return {
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    primaryRole: row.primaryRole,
    clientId: row.clientId,
    avatarUrl: row.avatarUrl,
    status: row.status,
  };
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.tokenHash, hashToken(token)));
  }
  store.delete(SESSION_COOKIE);
}

/** Alle sessies van een gebruiker intrekken (wachtwoordwijziging, blokkade). */
export async function revokeAllSessions(userId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

/** Opruimen van verlopen sessies; wordt door de onderhoudstaak aangeroepen. */
export async function pruneSessions(): Promise<number> {
  const result = await db.execute(
    sql`delete from sessions where expires_at < now() - interval '30 days'`,
  );
  return (result as unknown as { rowCount?: number }).rowCount ?? 0;
}
