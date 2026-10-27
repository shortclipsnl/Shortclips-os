"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { auditLog } from "@/server/audit";
import { dummyVerify, hashPassword, verifyPassword } from "./password";
import { createSession, destroySession, revokeAllSessions } from "./session";
import { requireOwner, requireViewer, ForbiddenError } from "@/server/auth/context";

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Vul een geldig e-mailadres in."),
  password: z.string().min(1, "Vul je wachtwoord in."),
  // FormData levert `null` als het veld ontbreekt.
  next: z.string().nullish(),
});

export type LoginState = { error?: string };

/** Eenvoudige rem op brute force, per proces (IP-gebaseerd). */
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 10 * 60 * 1000;

/**
 * Account-lockout in de database (werkt óók over meerdere instances/serverless
 * en is niet te omzeilen via X-Forwarded-For): na te veel mislukte pogingen
 * wordt het account tijdelijk geblokkeerd.
 */
const LOCK_THRESHOLD = 10;
const LOCK_MINUTES = 15;

function rateLimited(key: string): boolean {
  const entry = attempts.get(key);
  return Boolean(entry && entry.count >= MAX_ATTEMPTS && Date.now() < entry.resetAt);
}

function recordFailure(key: string) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now > entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next"),
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    // Alleen onze eigen, Nederlandse meldingen tonen — geen zod-taal.
    const known = ["Vul een geldig e-mailadres in.", "Vul je wachtwoord in."];
    return {
      error: issue && known.includes(issue.message)
        ? issue.message
        : "Controleer je e-mailadres en wachtwoord.",
    };
  }

  const { email, password } = parsed.data;
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "onbekend";

  if (rateLimited(ip)) {
    return {
      error: "Te veel mislukte pogingen. Probeer het over tien minuten opnieuw.",
    };
  }

  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.email, email), isNull(users.deletedAt)))
    .limit(1);

  // Ook zonder gevonden gebruiker een hash verifiëren: gelijke responstijd,
  // zodat niet te achterhalen is welke e-mailadressen bestaan.
  if (!user) {
    await dummyVerify(password);
    recordFailure(ip);
    return { error: "E-mailadres of wachtwoord klopt niet." };
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return { error: "Dit account is tijdelijk geblokkeerd. Neem contact op met een beheerder." };
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    recordFailure(ip);
    const nextCount = user.failedLoginCount + 1;
    const lock = nextCount >= LOCK_THRESHOLD;
    await db
      .update(users)
      .set({
        failedLoginCount: nextCount,
        ...(lock ? { lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) } : {}),
      })
      .where(eq(users.id, user.id));
    await auditLog({ action: lock ? "auth.account_locked" : "auth.login_failed", entityType: "user", entityId: user.id, outcome: "deny" });
    return { error: "E-mailadres of wachtwoord klopt niet." };
  }

  if (user.status !== "active") {
    return { error: "Dit account is nog niet geactiveerd of is geblokkeerd." };
  }

  attempts.delete(ip);
  await db
    .update(users)
    .set({ lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null })
    .where(eq(users.id, user.id));

  await createSession(user.id, { ip, userAgent: h.get("user-agent") });
  await auditLog({
    viewer: { ...user, permissions: new Set(), clientScope: null, isPortalUser: false } as never,
    action: "auth.login",
    entityType: "user",
    entityId: user.id,
  });

  // Alleen een intern, relatief pad toestaan als doorverwijzing. Een
  // protocol-relatieve URL (`//kwaadaardig.nl`) of backslash-truc begint ook
  // met "/" maar leidt naar een externe site — die weigeren we (open-redirect).
  const nextParam = parsed.data.next ?? "";
  const safeNext = nextParam.startsWith("/") && !nextParam.startsWith("//") && !nextParam.includes("\\");
  const target =
    user.primaryRole === "client"
      ? "/portal"
      : safeNext
        ? nextParam
        : "/dashboard";

  redirect(target);
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

/**
 * Alle sessies van een gebruiker intrekken (geforceerd uitloggen). Alleen de
 * eigenaar mag dit — anders zou iedereen elke gebruiker kunnen uitloggen.
 */
export async function revokeSessionsAction(userId: string): Promise<{ ok: boolean; message?: string }> {
  try {
    await requireOwner();
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
  await revokeAllSessions(userId);
  return { ok: true };
}

/**
 * De ingelogde gebruiker wijzigt zelf zijn wachtwoord (team én klant). Verifieert
 * eerst het huidige wachtwoord, trekt daarna alle sessies in en logt dit apparaat
 * meteen opnieuw in, zodat andere apparaten eruit worden gezet.
 */
export async function changeOwnPassword(input: { current: string; next: string }): Promise<{ ok: boolean; message?: string }> {
  const viewer = await requireViewer();
  const next = input.next ?? "";
  if (next.length < 10) return { ok: false, message: "Kies een wachtwoord van minstens 10 tekens." };

  const [u] = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(and(eq(users.id, viewer.id), isNull(users.deletedAt)))
    .limit(1);
  if (!u) return { ok: false, message: "Account niet gevonden." };

  const valid = await verifyPassword(input.current ?? "", u.passwordHash);
  if (!valid) return { ok: false, message: "Je huidige wachtwoord klopt niet." };

  const passwordHash = await hashPassword(next);
  await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, u.id));
  await revokeAllSessions(u.id);

  const h = await headers();
  await createSession(u.id, { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null, userAgent: h.get("user-agent") });
  await auditLog({ viewer, action: "auth.password_changed", entityType: "user", entityId: u.id });
  return { ok: true };
}
