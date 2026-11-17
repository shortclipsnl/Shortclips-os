import "server-only";
import { randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, portalAccessLinks, users } from "@/db/schema";
import { env } from "@/lib/env";
import {
  ACCESS_LINK_MAX_USES,
  ACCESS_LINK_TTL_DAYS,
  buildAccessUrl,
  isAccessToken,
  safePortalPath,
} from "@/lib/access-link";
import { hashSecret } from "./session";

/**
 * Persoonlijke inloglinks voor het klantportaal.
 *
 * Het doel: een klant tikt op de link in WhatsApp en staat binnen een paar
 * seconden op het juiste script of de juiste video's, zonder e-mailadres en
 * wachtwoord. Waarom dat nodig is: op een iPhone opent WhatsApp links in
 * Safari, en Safari deelt de inlog niet met de app op het beginscherm.
 *
 * Beveiliging:
 *  - Token van 32 willekeurige bytes; alleen de SHA-256 staat in de database.
 *  - Hoort bij precies één klantgebruiker en één portaalpagina.
 *  - 7 dagen geldig en maximaal 10 keer te gebruiken.
 *  - Ingetrokken bij deactiveren, een gepauzeerde of beëindigde samenwerking
 *    en een wachtwoordreset (revokeClientAppAccess).
 *  - Het openen van de link (GET) logt nog niet in: dat gebeurt pas na een tik
 *    op "Doorgaan". Zo verbruiken linkvoorbeelden van WhatsApp de link niet.
 *  - Staat de inlogcode per e-mail aan voor deze klant en is het apparaat nog
 *    onbekend, dan blijft die code verplicht (de link vervangt hem niet).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export type PortalLinkUser = { id: string; fullName: string | null; email: string; lastLoginAt: Date | null };

/** Actieve klantgebruikers van een klant, meest recent ingelogd eerst. */
export async function activePortalUsers(clientId: string): Promise<PortalLinkUser[]> {
  return db
    .select({ id: users.id, fullName: users.fullName, email: users.email, lastLoginAt: users.lastLoginAt })
    .from(users)
    .where(and(eq(users.clientId, clientId), eq(users.primaryRole, "client"), eq(users.status, "active"), isNull(users.deletedAt)))
    .orderBy(sql`${users.lastLoginAt} desc nulls last`, users.createdAt);
}

export async function createAccessLink(input: {
  userId: string;
  targetPath: string;
  createdById: string | null;
}): Promise<{ ok: true; url: string; expiresAt: Date; userName: string } | { ok: false; message: string }> {
  const [user] = await db
    .select({ id: users.id, clientId: users.clientId, primaryRole: users.primaryRole, status: users.status, deletedAt: users.deletedAt, fullName: users.fullName, email: users.email })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  if (!user || user.primaryRole !== "client" || !user.clientId) return { ok: false, message: "Dit is geen klantaccount." };
  if (user.deletedAt || user.status !== "active") return { ok: false, message: "Dit klantaccount is niet actief." };

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ACCESS_LINK_TTL_DAYS * DAY_MS);
  const targetPath = safePortalPath(input.targetPath);
  await db.insert(portalAccessLinks).values({
    userId: user.id,
    clientId: user.clientId,
    tokenHash: hashSecret(token),
    targetPath,
    createdById: input.createdById,
    expiresAt,
    maxUses: ACCESS_LINK_MAX_USES,
  });
  return { ok: true, url: buildAccessUrl(env.APP_URL, targetPath, token), expiresAt, userName: user.fullName?.trim() || user.email };
}

export type AccessLinkInfo =
  | {
      ok: true;
      linkId: string;
      userId: string;
      clientId: string | null;
      targetPath: string;
      userName: string;
      clientName: string | null;
      clientLogo: string | null;
      clientColor: string | null;
    }
  | { ok: false; reason: "invalid" | "expired" | "inactive" };

/** Controleert een token zonder het te gebruiken (voor de pagina /toegang). */
export async function peekAccessLink(token: string): Promise<AccessLinkInfo> {
  if (!isAccessToken(token)) return { ok: false, reason: "invalid" };
  const [row] = await db
    .select({
      id: portalAccessLinks.id,
      userId: portalAccessLinks.userId,
      clientId: portalAccessLinks.clientId,
      targetPath: portalAccessLinks.targetPath,
      expiresAt: portalAccessLinks.expiresAt,
      useCount: portalAccessLinks.useCount,
      maxUses: portalAccessLinks.maxUses,
      revokedAt: portalAccessLinks.revokedAt,
      userStatus: users.status,
      userDeleted: users.deletedAt,
      userRole: users.primaryRole,
      fullName: users.fullName,
      email: users.email,
      clientName: clients.name,
      clientLogo: clients.logoUrl,
      clientColor: clients.color,
    })
    .from(portalAccessLinks)
    .innerJoin(users, eq(users.id, portalAccessLinks.userId))
    .leftJoin(clients, eq(clients.id, portalAccessLinks.clientId))
    .where(eq(portalAccessLinks.tokenHash, hashSecret(token)))
    .limit(1);
  if (!row || row.revokedAt) return { ok: false, reason: "invalid" };
  if (row.userDeleted || row.userStatus !== "active" || row.userRole !== "client") return { ok: false, reason: "inactive" };
  if (row.expiresAt.getTime() <= Date.now() || row.useCount >= row.maxUses) return { ok: false, reason: "expired" };
  return {
    ok: true,
    linkId: row.id,
    userId: row.userId,
    clientId: row.clientId,
    targetPath: safePortalPath(row.targetPath),
    userName: row.fullName?.trim() || row.email,
    clientName: row.clientName,
    clientLogo: row.clientLogo,
    clientColor: row.clientColor,
  };
}

/**
 * Gebruik registreren. Atomair: telt alleen op zolang de link nog geldig is,
 * zodat gelijktijdige tikken de grens niet kunnen omzeilen.
 */
export async function consumeAccessLink(linkId: string): Promise<boolean> {
  const now = new Date();
  const updated = await db
    .update(portalAccessLinks)
    .set({ useCount: sql`${portalAccessLinks.useCount} + 1`, lastUsedAt: now, updatedAt: now })
    .where(
      and(
        eq(portalAccessLinks.id, linkId),
        isNull(portalAccessLinks.revokedAt),
        gt(portalAccessLinks.expiresAt, now),
        lt(portalAccessLinks.useCount, portalAccessLinks.maxUses),
      ),
    )
    .returning({ id: portalAccessLinks.id });
  return updated.length > 0;
}

/** Alle openstaande links van een gebruiker intrekken. */
export async function revokeAccessLinks(userId: string): Promise<void> {
  const now = new Date();
  await db
    .update(portalAccessLinks)
    .set({ revokedAt: now, updatedAt: now })
    .where(and(eq(portalAccessLinks.userId, userId), isNull(portalAccessLinks.revokedAt)));
}

/** Overzicht voor het team: laatste links van een klant. */
export async function recentAccessLinks(clientId: string, limit = 5) {
  return db
    .select({
      id: portalAccessLinks.id,
      targetPath: portalAccessLinks.targetPath,
      createdAt: portalAccessLinks.createdAt,
      expiresAt: portalAccessLinks.expiresAt,
      useCount: portalAccessLinks.useCount,
      lastUsedAt: portalAccessLinks.lastUsedAt,
      revokedAt: portalAccessLinks.revokedAt,
      userName: users.fullName,
      email: users.email,
    })
    .from(portalAccessLinks)
    .innerJoin(users, eq(users.id, portalAccessLinks.userId))
    .where(eq(portalAccessLinks.clientId, clientId))
    .orderBy(desc(portalAccessLinks.createdAt))
    .limit(limit);
}

/** Opruimen: verlopen of ingetrokken links ouder dan 30 dagen. */
export async function pruneAccessLinks(): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * DAY_MS);
  await db
    .delete(portalAccessLinks)
    .where(or(lt(portalAccessLinks.expiresAt, cutoff), and(lt(portalAccessLinks.revokedAt, cutoff))));
}
