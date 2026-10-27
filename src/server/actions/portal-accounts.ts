"use server";

import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clientContacts, clients, roles, userRoles, users } from "@/db/schema";
import {
  assertClientAccess,
  ForbiddenError,
  requireManageClients,
} from "@/server/auth/context";
import { hashPassword } from "@/server/auth/password";
import { createSession, revokeAllSessions } from "@/server/auth/session";
import {
  consumePortalToken,
  createPortalToken,
  portalTokenLink,
  type InvitePurpose,
} from "@/server/auth/portal-invites";
import { emailConfigured, portalEmailHtml, sendEmail } from "@/server/email";
import { auditLog } from "@/server/audit";

export type PortalAccountResult = {
  ok: boolean;
  message?: string;
  /** Eénmalig terug te geven gegevens voor handmatig doorgeven. */
  email?: string;
  /** Activerings-/herstel-link (als e-mail niet aanstaat of modus "manual"). */
  link?: string;
  /** Eénmalig tijdelijk wachtwoord (alleen bij modus "manual"). */
  password?: string;
  /** Of de uitnodiging/reset per e-mail is verstuurd. */
  emailSent?: boolean;
};

/** Leesbaar tijdelijk wachtwoord zonder verwarrende tekens (0/O, 1/l/I). */
function tempPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(14);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${out.slice(0, 5)}-${out.slice(5, 10)}-${out.slice(10, 14)}`;
}

const PW_MIN = 10;

/**
 * Zoekt of maakt een portaalgebruiker voor (klant + e-mail). Dwingt de harde
 * regels af: een e-mailadres van een teamlid of van een ÁNDERE klant wordt
 * geweigerd, zodat er nooit een bestaand account gekaapt of gekruist wordt.
 * Nieuwe accounts krijgen status "invited" (kan pas in zodra er een wachtwoord
 * staat); een bestaand portaalaccount van deze klant wordt hergebruikt.
 */
async function ensurePortalUser(
  clientId: string,
  email: string,
  fullName: string,
): Promise<{ ok: true; userId: string; isNew: boolean } | { ok: false; message: string }> {
  const [clientRole] = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, "client")).limit(1);
  if (!clientRole) return { ok: false, message: "De portaalrol ontbreekt in het systeem — neem contact op met de beheerder." };

  const [existing] = await db
    .select({ id: users.id, primaryRole: users.primaryRole, clientId: users.clientId })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing) {
    if (existing.primaryRole !== "client" && existing.clientId == null) {
      return { ok: false, message: "Dit e-mailadres hoort al bij een teamaccount. Gebruik een ander e-mailadres voor de klantlogin." };
    }
    if (existing.clientId && existing.clientId !== clientId) {
      return { ok: false, message: "Dit e-mailadres is al gekoppeld aan een andere klant." };
    }
    await db
      .update(users)
      .set({ fullName, primaryRole: "client", clientId, updatedAt: new Date() })
      .where(eq(users.id, existing.id));
    await db.insert(userRoles).values({ userId: existing.id, roleId: clientRole.id }).onConflictDoNothing();
    return { ok: true, userId: existing.id, isNew: false };
  }

  const [created] = await db
    .insert(users)
    .values({ email, fullName, passwordHash: null, primaryRole: "client", clientId, status: "invited" })
    .returning({ id: users.id });
  await db.insert(userRoles).values({ userId: created!.id, roleId: clientRole.id }).onConflictDoNothing();
  return { ok: true, userId: created!.id, isNew: true };
}

async function loadManageableClient(clientId: string) {
  const viewer = await requireManageClients();
  assertClientAccess(viewer, clientId);
  const [client] = await db
    .select({ id: clients.id, name: clients.name, slug: clients.slug, coordinatorId: clients.coordinatorId })
    .from(clients)
    .where(and(eq(clients.id, clientId), isNull(clients.deletedAt)))
    .limit(1);
  return { viewer, client };
}

/**
 * Nodig een klantgebruiker uit voor het portaal. Standaard per e-mail (de klant
 * stelt zelf een wachtwoord in via een beveiligde link); valt terug op een
 * kopieerbare link wanneer e-mail (nog) niet is ingericht. Modus "manual" maakt
 * meteen een tijdelijk wachtwoord dat je één keer ziet en zelf doorgeeft.
 * Meerdere gebruikers per klant kunnen: elk met een eigen e-mailadres.
 */
export async function invitePortalUser(input: {
  clientId: string;
  email: string;
  fullName?: string;
  mode?: "email" | "manual";
}): Promise<PortalAccountResult> {
  try {
    const { viewer, client } = await loadManageableClient(input.clientId);
    if (!client) return { ok: false, message: "Klant niet gevonden." };

    const email = (input.email ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { ok: false, message: "Vul een geldig e-mailadres in." };
    }
    const fullName = (input.fullName ?? "").trim() || client.name;
    const mode = input.mode ?? "email";

    const ensured = await ensurePortalUser(client.id, email, fullName);
    if (!ensured.ok) return { ok: false, message: ensured.message };

    // Modus "manual": meteen een tijdelijk wachtwoord zetten (account actief).
    if (mode === "manual") {
      const password = tempPassword();
      const passwordHash = await hashPassword(password);
      await db
        .update(users)
        .set({ passwordHash, status: "active", lockedUntil: null, failedLoginCount: 0, updatedAt: new Date() })
        .where(eq(users.id, ensured.userId));
      await revokeAllSessions(ensured.userId);
      await auditLog({ viewer, action: "portal.account_manual", entityType: "client", entityId: client.id, clientId: client.id });
      revalidatePath("/klantportalen");
      revalidatePath(`/clients/${client.slug}`);
      return { ok: true, email, password };
    }

    // Modus "email": uitnodigings-token + beveiligde link; mailen indien mogelijk.
    const { token } = await createPortalToken(ensured.userId, "invite", viewer.id);
    const link = portalTokenLink(token, "invite");
    await db.update(users).set({ invitedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, ensured.userId));

    let emailSent = false;
    if (emailConfigured()) {
      const res = await sendEmail({
        to: email,
        subject: "Je ShortClips-portaal staat klaar",
        text: `Hoi,\n\nJe krijgt toegang tot je persoonlijke ShortClips-portaal. Stel hier een wachtwoord in en log in:\n${link}\n\nDeze link is 7 dagen geldig.\n\nGroet, ShortClips`,
        html: portalEmailHtml({
          heading: "Je portaal staat klaar",
          body: "Stel een wachtwoord in en bekijk je opnames, scripts, planning en resultaten op één plek. Deze link is 7 dagen geldig.",
          ctaLabel: "Wachtwoord instellen",
          ctaUrl: link,
        }),
      });
      emailSent = res.sent;
    }

    await auditLog({ viewer, action: "portal.account_invited", entityType: "client", entityId: client.id, clientId: client.id });
    revalidatePath("/klantportalen");
    revalidatePath(`/clients/${client.slug}`);
    // Bij geen e-mail(provider): de link teruggeven zodat de beheerder 'm deelt.
    return { ok: true, email, emailSent, link: emailSent ? undefined : link };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Een nieuwe uitnodigingslink maken en (opnieuw) versturen/teruggeven. */
export async function resendPortalInvite(userId: string): Promise<PortalAccountResult> {
  try {
    const viewer = await requireManageClients();
    const [u] = await db
      .select({ id: users.id, email: users.email, clientId: users.clientId, primaryRole: users.primaryRole })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!u || u.primaryRole !== "client" || !u.clientId) return { ok: false, message: "Portaalaccount niet gevonden." };
    assertClientAccess(viewer, u.clientId);

    const { token } = await createPortalToken(u.id, "invite", viewer.id);
    const link = portalTokenLink(token, "invite");
    let emailSent = false;
    if (emailConfigured()) {
      const res = await sendEmail({
        to: u.email,
        subject: "Je ShortClips-portaal staat klaar",
        text: `Hoi,\n\nStel hier een wachtwoord in voor je ShortClips-portaal:\n${link}\n\nDeze link is 7 dagen geldig.\n\nGroet, ShortClips`,
        html: portalEmailHtml({ heading: "Je portaal staat klaar", body: "Stel een wachtwoord in voor je ShortClips-portaal. Deze link is 7 dagen geldig.", ctaLabel: "Wachtwoord instellen", ctaUrl: link }),
      });
      emailSent = res.sent;
    }
    await auditLog({ viewer, action: "portal.invite_resent", entityType: "client", entityId: u.clientId, clientId: u.clientId });
    revalidatePath("/klantportalen");
    return { ok: true, email: u.email, emailSent, link: emailSent ? undefined : link };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/**
 * Wachtwoordherstel in gang zetten voor een klantgebruiker. Modus "email" stuurt
 * een herstel-link (2 uur geldig); modus "manual" zet meteen een tijdelijk
 * wachtwoord dat je één keer ziet. In beide gevallen worden lopende sessies pas
 * ingetrokken zodra het nieuwe wachtwoord echt is gezet.
 */
export async function sendPortalPasswordReset(input: {
  userId: string;
  mode?: "email" | "manual";
}): Promise<PortalAccountResult> {
  try {
    const viewer = await requireManageClients();
    const [u] = await db
      .select({ id: users.id, email: users.email, clientId: users.clientId, primaryRole: users.primaryRole })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1);
    if (!u || u.primaryRole !== "client" || !u.clientId) return { ok: false, message: "Portaalaccount niet gevonden." };
    assertClientAccess(viewer, u.clientId);

    if ((input.mode ?? "email") === "manual") {
      const password = tempPassword();
      const passwordHash = await hashPassword(password);
      await db
        .update(users)
        .set({ passwordHash, status: "active", lockedUntil: null, failedLoginCount: 0, updatedAt: new Date() })
        .where(eq(users.id, u.id));
      await revokeAllSessions(u.id);
      await auditLog({ viewer, action: "portal.password_reset_manual", entityType: "client", entityId: u.clientId, clientId: u.clientId });
      revalidatePath("/klantportalen");
      return { ok: true, email: u.email, password };
    }

    const { token } = await createPortalToken(u.id, "reset", viewer.id);
    const link = portalTokenLink(token, "reset");
    let emailSent = false;
    if (emailConfigured()) {
      const res = await sendEmail({
        to: u.email,
        subject: "Nieuw wachtwoord voor je ShortClips-portaal",
        text: `Hoi,\n\nStel hier een nieuw wachtwoord in:\n${link}\n\nDeze link is 2 uur geldig. Niet aangevraagd? Dan kun je deze mail negeren.\n\nGroet, ShortClips`,
        html: portalEmailHtml({ heading: "Nieuw wachtwoord instellen", body: "Je kunt een nieuw wachtwoord instellen voor je ShortClips-portaal. Deze link is 2 uur geldig. Niet aangevraagd? Negeer deze mail.", ctaLabel: "Nieuw wachtwoord instellen", ctaUrl: link }),
      });
      emailSent = res.sent;
    }
    await auditLog({ viewer, action: "portal.password_reset_sent", entityType: "client", entityId: u.clientId, clientId: u.clientId });
    revalidatePath("/klantportalen");
    return { ok: true, email: u.email, emailSent, link: emailSent ? undefined : link };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Een portaalaccount (de)activeren. Deactiveren trekt lopende sessies in. */
export async function setPortalUserActive(userId: string, active: boolean): Promise<PortalAccountResult> {
  try {
    const viewer = await requireManageClients();
    const [u] = await db
      .select({ id: users.id, clientId: users.clientId, primaryRole: users.primaryRole, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!u || u.primaryRole !== "client" || !u.clientId) return { ok: false, message: "Portaalaccount niet gevonden." };
    assertClientAccess(viewer, u.clientId);

    // Een account zonder wachtwoord kan niet "actief" zijn (nog niet geactiveerd).
    const nextStatus = active ? (u.passwordHash ? "active" : "invited") : "suspended";
    await db.update(users).set({ status: nextStatus, updatedAt: new Date() }).where(eq(users.id, u.id));
    if (!active) await revokeAllSessions(u.id);
    await auditLog({ viewer, action: active ? "portal.account_activated" : "portal.account_deactivated", entityType: "client", entityId: u.clientId, clientId: u.clientId });
    revalidatePath("/klantportalen");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/**
 * PUBLIEK (geen login): de klant stelt via een beveiligd token een wachtwoord in
 * — zowel voor een nieuwe uitnodiging als voor een wachtwoordherstel. Zet het
 * account op "active", trekt oude sessies in, logt direct in en stuurt door naar
 * het portaal.
 */
export async function completePortalSetup(input: {
  token: string;
  password: string;
}): Promise<{ ok: false; message: string } | never> {
  const password = input.password ?? "";
  if (password.length < PW_MIN) {
    return { ok: false, message: `Kies een wachtwoord van minstens ${PW_MIN} tekens.` };
  }

  const consumed = await consumePortalToken(input.token);
  if (!consumed) {
    return { ok: false, message: "Deze link is verlopen of al gebruikt. Vraag een nieuwe aan." };
  }

  const [u] = await db
    .select({ id: users.id, primaryRole: users.primaryRole, clientId: users.clientId })
    .from(users)
    .where(eq(users.id, consumed.userId))
    .limit(1);
  if (!u || u.primaryRole !== "client" || !u.clientId) {
    return { ok: false, message: "Dit account kan niet geactiveerd worden. Neem contact op met ShortClips." };
  }

  const passwordHash = await hashPassword(password);
  await db
    .update(users)
    .set({ passwordHash, status: "active", lockedUntil: null, failedLoginCount: 0, updatedAt: new Date() })
    .where(eq(users.id, u.id));
  // Eventuele bestaande sessies intrekken; daarna vers inloggen.
  await revokeAllSessions(u.id);

  const h = await headers();
  await createSession(u.id, {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent"),
  });
  redirect("/portal");
}

/** Helper voor UI-gating: mag deze viewer portaalaccounts beheren? */
export async function canManagePortalAccounts(): Promise<boolean> {
  try {
    await requireManageClients();
    return true;
  } catch {
    return false;
  }
}
