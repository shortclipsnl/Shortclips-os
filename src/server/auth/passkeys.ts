"use server";

/**
 * Passkeys: inloggen met Face ID, Touch ID of de schermvergrendeling van het
 * toestel (WebAuthn). Shortclips bewaart alleen de publieke sleutel. Een passkey
 * vervangt wachtwoord én inlogcode: hij bewijst bezit van het toestel en
 * ontgrendeling door de eigenaar (userVerification: "required").
 */

import { headers } from "next/headers";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransport,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { db } from "@/db/client";
import { passkeys, users, webauthnChallenges } from "@/db/schema";
import { env } from "@/lib/env";
import { auditLog } from "@/server/audit";
import { requireViewer } from "./context";
import { createSession } from "./session";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_PASSKEYS_PER_USER = 10;

/**
 * Voor welk domein geldt de passkey? Normaal het vaste portaaldomein (APP_URL).
 * Op een Vercel-preview of lokaal het domein van het verzoek zelf, zodat testen
 * werkt. Andere domeinen worden geweigerd.
 */
async function relyingParty(): Promise<{ rpID: string; origin: string }> {
  const h = await headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0]!.trim().toLowerCase();
  const proto = (h.get("x-forwarded-proto") ?? "https").split(",")[0]!.trim();
  const hostname = host.split(":")[0]!;
  const app = new URL(env.APP_URL);

  const allowed =
    hostname === app.hostname ||
    hostname.endsWith(".vercel.app") ||
    hostname === "localhost";
  if (!host || !allowed) {
    return { rpID: app.hostname, origin: app.origin };
  }
  return { rpID: hostname, origin: `${hostname === "localhost" ? proto : "https"}://${host}` };
}

function friendlyDeviceName(ua: string | null): string {
  const s = ua ?? "";
  if (/iPhone/i.test(s)) return "iPhone";
  if (/iPad/i.test(s)) return "iPad";
  if (/Android/i.test(s)) return "Android-telefoon";
  if (/Macintosh|Mac OS X/i.test(s)) return "Mac";
  if (/Windows/i.test(s)) return "Windows-computer";
  return "Apparaat";
}

async function storeChallenge(challenge: string, purpose: "register" | "login", userId: string | null) {
  const [row] = await db
    .insert(webauthnChallenges)
    .values({ challenge, purpose, userId, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) })
    .returning({ id: webauthnChallenges.id });
  return row!.id;
}

/** Haalt een uitdaging op en markeert hem direct als gebruikt (eenmalig). */
async function consumeChallenge(id: string, purpose: "register" | "login", userId: string | null): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const now = new Date();
  const [row] = await db
    .update(webauthnChallenges)
    .set({ consumedAt: now })
    .where(
      and(
        eq(webauthnChallenges.id, id),
        eq(webauthnChallenges.purpose, purpose),
        isNull(webauthnChallenges.consumedAt),
        gt(webauthnChallenges.expiresAt, now),
        userId ? eq(webauthnChallenges.userId, userId) : isNull(webauthnChallenges.userId),
      ),
    )
    .returning({ challenge: webauthnChallenges.challenge });
  return row?.challenge ?? null;
}

/* ------------------------------ Registreren ------------------------------ */

export async function startPasskeyRegistration(): Promise<
  { ok: true; challengeId: string; options: PublicKeyCredentialCreationOptionsJSON } | { ok: false; message: string }
> {
  const viewer = await requireViewer();
  const existing = await db
    .select({ credentialId: passkeys.credentialId, transports: passkeys.transports })
    .from(passkeys)
    .where(and(eq(passkeys.userId, viewer.id), isNull(passkeys.revokedAt)));
  if (existing.length >= MAX_PASSKEYS_PER_USER) {
    return { ok: false, message: "Je hebt al het maximale aantal apparaten gekoppeld. Verwijder er eerst een." };
  }

  const { rpID } = await relyingParty();
  const options = await generateRegistrationOptions({
    rpName: "Shortclips",
    rpID,
    userName: viewer.email,
    userDisplayName: viewer.fullName || viewer.email,
    userID: new TextEncoder().encode(viewer.id),
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({
      id: c.credentialId,
      transports: (c.transports?.split(",").filter(Boolean) ?? []) as AuthenticatorTransport[],
    })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  const challengeId = await storeChallenge(options.challenge, "register", viewer.id);
  return { ok: true, challengeId, options };
}

export async function finishPasskeyRegistration(input: {
  challengeId: string;
  response: RegistrationResponseJSON;
}): Promise<{ ok: boolean; message?: string }> {
  const viewer = await requireViewer();
  const expectedChallenge = await consumeChallenge(input.challengeId, "register", viewer.id);
  if (!expectedChallenge) return { ok: false, message: "Dit verzoek is verlopen. Probeer het opnieuw." };

  const { rpID, origin } = await relyingParty();
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch {
    return { ok: false, message: "Koppelen is niet gelukt. Probeer het opnieuw." };
  }
  if (!verification.verified || !verification.registrationInfo) {
    return { ok: false, message: "Koppelen is niet gelukt. Probeer het opnieuw." };
  }

  const { credential } = verification.registrationInfo;
  const h = await headers();
  await db
    .insert(passkeys)
    .values({
      userId: viewer.id,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString("base64url"),
      counter: credential.counter,
      transports: credential.transports?.join(",") ?? null,
      deviceName: friendlyDeviceName(h.get("user-agent")),
    })
    .onConflictDoNothing();
  await auditLog({ viewer, action: "auth.passkey_added", entityType: "user", entityId: viewer.id });
  return { ok: true };
}

/* -------------------------------- Inloggen -------------------------------- */

export async function startPasskeyLogin(): Promise<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }> {
  const { rpID } = await relyingParty();
  // Geen allowCredentials: het toestel laat zelf zien welke passkeys er zijn.
  const options = await generateAuthenticationOptions({ rpID, userVerification: "required" });
  const challengeId = await storeChallenge(options.challenge, "login", null);
  return { challengeId, options };
}

export async function finishPasskeyLogin(input: {
  challengeId: string;
  response: AuthenticationResponseJSON;
}): Promise<{ ok: true; target: string } | { ok: false; message: string }> {
  const fail = { ok: false as const, message: "Inloggen met Face ID of Touch ID is niet gelukt. Log in met je wachtwoord." };
  const expectedChallenge = await consumeChallenge(input.challengeId, "login", null);
  if (!expectedChallenge) return { ok: false, message: "Dit verzoek is verlopen. Probeer het opnieuw." };

  const [row] = await db
    .select({
      id: passkeys.id,
      userId: passkeys.userId,
      credentialId: passkeys.credentialId,
      publicKey: passkeys.publicKey,
      counter: passkeys.counter,
      transports: passkeys.transports,
      status: users.status,
      lockedUntil: users.lockedUntil,
      deletedAt: users.deletedAt,
      primaryRole: users.primaryRole,
      clientId: users.clientId,
    })
    .from(passkeys)
    .innerJoin(users, eq(users.id, passkeys.userId))
    .where(and(eq(passkeys.credentialId, input.response.id), isNull(passkeys.revokedAt)))
    .limit(1);
  if (!row) return fail;
  if (row.deletedAt || row.status !== "active") {
    return { ok: false, message: "Dit account is nog niet geactiveerd of is geblokkeerd." };
  }
  if (row.lockedUntil && row.lockedUntil > new Date()) {
    return { ok: false, message: "Dit account is tijdelijk geblokkeerd. Neem contact op met een beheerder." };
  }

  const { rpID, origin } = await relyingParty();
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: row.credentialId,
        publicKey: new Uint8Array(Buffer.from(row.publicKey, "base64url")),
        counter: row.counter,
        transports: (row.transports?.split(",").filter(Boolean) ?? []) as AuthenticatorTransport[],
      },
    });
  } catch {
    await auditLog({ action: "auth.passkey_failed", entityType: "user", entityId: row.userId, outcome: "deny" });
    return fail;
  }
  if (!verification.verified) return fail;

  const now = new Date();
  await db
    .update(passkeys)
    .set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: now, updatedAt: now })
    .where(eq(passkeys.id, row.id));
  await db.update(users).set({ lastLoginAt: now, failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, row.userId));

  const h = await headers();
  await createSession(row.userId, {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent"),
  });
  await auditLog({ action: "auth.login_passkey", entityType: "user", entityId: row.userId, clientId: row.clientId });
  return { ok: true, target: row.primaryRole === "client" ? "/portal" : "/dashboard" };
}

/* --------------------------------- Beheer --------------------------------- */

export type PasskeyRow = { id: string; deviceName: string | null; createdAt: Date; lastUsedAt: Date | null };

export async function listMyPasskeys(): Promise<PasskeyRow[]> {
  const viewer = await requireViewer();
  return db
    .select({ id: passkeys.id, deviceName: passkeys.deviceName, createdAt: passkeys.createdAt, lastUsedAt: passkeys.lastUsedAt })
    .from(passkeys)
    .where(and(eq(passkeys.userId, viewer.id), isNull(passkeys.revokedAt)))
    .orderBy(desc(passkeys.createdAt));
}

export async function removeMyPasskey(id: string): Promise<{ ok: boolean }> {
  const viewer = await requireViewer();
  const now = new Date();
  await db
    .update(passkeys)
    .set({ revokedAt: now, updatedAt: now })
    .where(and(eq(passkeys.id, id), eq(passkeys.userId, viewer.id), isNull(passkeys.revokedAt)));
  await auditLog({ viewer, action: "auth.passkey_removed", entityType: "user", entityId: viewer.id });
  return { ok: true };
}
