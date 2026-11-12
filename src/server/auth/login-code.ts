import "server-only";
import { randomInt, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, loginChallenges, trustedDevices, users } from "@/db/schema";
import { isProduction } from "@/lib/env";
import { emailConfigured, portalEmailHtml, sendEmail } from "@/server/email";
import { hashSecret, newSessionToken } from "./session";

/**
 * Inlogcode per e-mail (tweestapsverificatie) voor klantaccounts.
 *
 * Staat per klant aan (clients.portal_login_code_required). Na een juist
 * wachtwoord op een onbekend apparaat krijgt de klant een code van 6 cijfers per
 * e-mail. Daarna onthoudt dit apparaat dat de code is ingevoerd (90 dagen), zodat
 * de klant hem in de praktijk één keer per telefoon invult.
 */

export const DEVICE_COOKIE = "sc_os_device";
export const CHALLENGE_COOKIE = "sc_os_login_challenge";
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const DEVICE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** Moet deze gebruiker op dit apparaat een inlogcode invoeren? */
export async function loginCodeRequired(user: { id: string; primaryRole: string; clientId: string | null }): Promise<boolean> {
  if (user.primaryRole !== "client" || !user.clientId) return false;
  const [client] = await db
    .select({ required: clients.portalLoginCodeRequired })
    .from(clients)
    .where(eq(clients.id, user.clientId))
    .limit(1);
  if (!client?.required) return false;
  return !(await isTrustedDevice(user.id));
}

async function isTrustedDevice(userId: string): Promise<boolean> {
  const store = await cookies();
  const token = store.get(DEVICE_COOKIE)?.value;
  if (!token) return false;
  const [row] = await db
    .select({ id: trustedDevices.id })
    .from(trustedDevices)
    .where(
      and(
        eq(trustedDevices.tokenHash, hashSecret(token)),
        eq(trustedDevices.userId, userId),
        isNull(trustedDevices.revokedAt),
        gt(trustedDevices.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!row) return false;
  await db.update(trustedDevices).set({ lastUsedAt: new Date() }).where(eq(trustedDevices.id, row.id));
  return true;
}

/** Markeert het huidige apparaat als vertrouwd voor deze gebruiker. */
export async function trustThisDevice(userId: string, userAgent: string | null): Promise<void> {
  const token = newSessionToken();
  await db.insert(trustedDevices).values({
    userId,
    tokenHash: hashSecret(token),
    userAgent,
    expiresAt: new Date(Date.now() + DEVICE_TTL_MS),
  });
  const store = await cookies();
  store.set(DEVICE_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    path: "/",
    maxAge: Math.floor(DEVICE_TTL_MS / 1000),
  });
}

/** "j***@bedrijf.nl" — zodat de klant ziet waar de code naartoe ging. */
export function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  if (!name || !domain) return email;
  return `${name.slice(0, 1)}${"*".repeat(Math.max(2, Math.min(6, name.length - 1)))}@${domain}`;
}

export type StartChallengeResult = { ok: true; maskedEmail: string } | { ok: false; message: string };

/** Maakt een nieuwe code aan, mailt hem en zet het (kortlevende) challenge-cookie. */
export async function startLoginChallenge(
  user: { id: string; email: string },
  meta: { ip: string | null; userAgent: string | null },
): Promise<StartChallengeResult> {
  if (!emailConfigured()) {
    return { ok: false, message: "De inlogcode kan nu niet worden verstuurd. Neem contact op met Shortclips." };
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const token = newSessionToken();
  await db.insert(loginChallenges).values({
    userId: user.id,
    tokenHash: hashSecret(token),
    codeHash: hashSecret(`${user.id}:${code}`),
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
    ipAddress: meta.ip,
    userAgent: meta.userAgent,
  });

  const body = `Je inlogcode is ${code}. Deze code is 10 minuten geldig. Heb je niet zelf geprobeerd in te loggen? Negeer dan deze e-mail en laat het ons weten.`;
  const sent = await sendEmail({
    to: user.email,
    subject: `${code} is je inlogcode voor Shortclips`,
    text: body,
    html: portalEmailHtml({ heading: `Je inlogcode: ${code}`, body }),
  });
  if (!sent.sent) {
    return { ok: false, message: "De inlogcode kon niet worden verstuurd. Probeer het zo opnieuw." };
  }

  const store = await cookies();
  store.set(CHALLENGE_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    path: "/",
    maxAge: Math.floor(CODE_TTL_MS / 1000),
  });

  return { ok: true, maskedEmail: maskEmail(user.email) };
}

export type VerifyChallengeResult =
  | { ok: true; userId: string; userAgent: string | null }
  | { ok: false; message: string; expired?: boolean };

/** Controleert de ingevoerde code tegen de lopende challenge. */
export async function verifyLoginChallenge(codeInput: string): Promise<VerifyChallengeResult> {
  const store = await cookies();
  const token = store.get(CHALLENGE_COOKIE)?.value;
  if (!token) return { ok: false, message: "Je inlogpoging is verlopen. Log opnieuw in.", expired: true };

  const [challenge] = await db
    .select()
    .from(loginChallenges)
    .where(eq(loginChallenges.tokenHash, hashSecret(token)))
    .limit(1);

  if (!challenge || challenge.consumedAt || challenge.expiresAt < new Date() || challenge.attempts >= MAX_ATTEMPTS) {
    store.delete(CHALLENGE_COOKIE);
    return { ok: false, message: "Deze code is verlopen. Log opnieuw in voor een nieuwe code.", expired: true };
  }

  const code = codeInput.replace(/\D/g, "");
  const a = Buffer.from(hashSecret(`${challenge.userId}:${code}`));
  const b = Buffer.from(challenge.codeHash);
  const valid = code.length === 6 && a.length === b.length && timingSafeEqual(a, b);

  if (!valid) {
    await db
      .update(loginChallenges)
      .set({ attempts: sql`${loginChallenges.attempts} + 1` })
      .where(eq(loginChallenges.id, challenge.id));
    const left = MAX_ATTEMPTS - challenge.attempts - 1;
    return {
      ok: false,
      message: left > 0 ? `Deze code klopt niet. Je hebt nog ${left} poging${left === 1 ? "" : "en"}.` : "Te veel onjuiste codes. Log opnieuw in.",
      expired: left <= 0,
    };
  }

  await db.update(loginChallenges).set({ consumedAt: new Date() }).where(eq(loginChallenges.id, challenge.id));
  store.delete(CHALLENGE_COOKIE);

  // Account moet nog steeds actief zijn.
  const [user] = await db
    .select({ id: users.id, status: users.status, deletedAt: users.deletedAt })
    .from(users)
    .where(eq(users.id, challenge.userId))
    .limit(1);
  if (!user || user.deletedAt || user.status !== "active") {
    return { ok: false, message: "Dit account is niet actief. Neem contact op met Shortclips.", expired: true };
  }

  return { ok: true, userId: user.id, userAgent: challenge.userAgent };
}

/** Opruimen van oude challenges (onderhoudstaak). */
export async function pruneLoginChallenges(): Promise<void> {
  await db.execute(sql`delete from login_challenges where expires_at < now() - interval '7 days'`);
}
