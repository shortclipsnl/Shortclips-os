"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { auditLog } from "@/server/audit";
import { dummyVerify, verifyPassword } from "./password";
import { createSession, destroySession, revokeAllSessions } from "./session";

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Vul een geldig e-mailadres in."),
  password: z.string().min(1, "Vul je wachtwoord in."),
  // FormData levert `null` als het veld ontbreekt.
  next: z.string().nullish(),
});

export type LoginState = { error?: string };

/** Eenvoudige rem op brute force, per proces. */
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 10 * 60 * 1000;

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
    await db
      .update(users)
      .set({ failedLoginCount: user.failedLoginCount + 1 })
      .where(eq(users.id, user.id));
    await auditLog({ action: "auth.login_failed", entityType: "user", entityId: user.id, outcome: "deny" });
    return { error: "E-mailadres of wachtwoord klopt niet." };
  }

  if (user.status !== "active") {
    return { error: "Dit account is nog niet geactiveerd of is geblokkeerd." };
  }

  attempts.delete(ip);
  await db
    .update(users)
    .set({ lastLoginAt: new Date(), failedLoginCount: 0 })
    .where(eq(users.id, user.id));

  await createSession(user.id, { ip, userAgent: h.get("user-agent") });
  await auditLog({
    viewer: { ...user, permissions: new Set(), clientScope: null, isPortalUser: false } as never,
    action: "auth.login",
    entityType: "user",
    entityId: user.id,
  });

  const target =
    user.primaryRole === "client"
      ? "/portal"
      : parsed.data.next && parsed.data.next.startsWith("/")
        ? parsed.data.next
        : "/dashboard";

  redirect(target);
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

export async function revokeSessionsAction(userId: string) {
  await revokeAllSessions(userId);
}
