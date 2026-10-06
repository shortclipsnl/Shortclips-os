import "server-only";
import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import {
  clientContacts,
  clientIntegrations,
  clients,
  roles,
  userRoles,
  users,
} from "@/db/schema";
import { hashPassword } from "@/server/auth/password";

/**
 * Zet pilot-portaalaccounts klaar voor een handvol ÉCHTE klanten, zodat we het
 * klantportaal met echte inlogs kunnen testen — inclusief de harde eis dat
 * klant A nooit data van klant B ziet.
 *
 * Veilig en herhaalbaar:
 *  - alleen klanten die echt uit Monday komen (hebben een monday-koppeling);
 *  - elke klant krijgt één portaalgebruiker, gekoppeld aan precies die klant
 *    (users.client_id dwingt de scheiding af in de datalaag);
 *  - verse, willekeurige tijdelijke wachtwoorden — nooit een bestaand wachtwoord
 *    van de klant hergebruiken;
 *  - opnieuw draaien zet het wachtwoord opnieuw en maakt geen duplicaten.
 *
 * Geeft de aangemaakte accounts terug (mét tijdelijk wachtwoord) zodat de
 * beheerder ze één keer kan doorgeven. Wachtwoorden staan nooit leesbaar in de
 * database — alleen de scrypt-hash.
 */

/** Leesbaar, sterk tijdelijk wachtwoord (geen verwarrende tekens). */
function tempPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(14);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${out.slice(0, 5)}-${out.slice(5, 10)}-${out.slice(10, 14)}`;
}

export type PilotAccount = {
  clientId: string;
  clientName: string;
  contactName: string | null;
  email: string;
  tempPassword: string;
  action: "created" | "updated";
};

export async function runPilotPortalSetup(options: {
  clientIds?: string[];
  limit?: number;
} = {}): Promise<{ ok: boolean; accounts: PilotAccount[]; note?: string }> {
  // Zonder expliciete limiet: een portaallogin voor élke echte klant.
  const limit = options.limit ?? 500;

  // De 'client'-rol (portaal) moet bestaan — die seedt de RBAC-stap.
  const [clientRole] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.key, "client"))
    .limit(1);
  if (!clientRole) {
    return { ok: false, accounts: [], note: "Rol 'client' ontbreekt — draai eerst de seed." };
  }

  // Kandidaat-klanten: echt (monday-koppeling) én met een contactpersoon-e-mail.
  const realClientRows = await db
    .selectDistinct({ id: clientIntegrations.clientId })
    .from(clientIntegrations)
    .where(eq(clientIntegrations.provider, "monday"));
  const realIds = new Set(realClientRows.map((r) => r.id));

  const chosenIds = options.clientIds?.filter((id) => realIds.has(id)) ?? [];

  if (chosenIds.length === 0) {
    // Automatisch kiezen: echte klanten, hoogste omzet eerst.
    const candidates = await db
      .select({ id: clients.id })
      .from(clients)
      .where(and(isNull(clients.deletedAt), inArray(clients.id, [...realIds])))
      .orderBy(desc(clients.monthlyRevenue));

    for (const c of candidates) {
      chosenIds.push(c.id);
      if (chosenIds.length >= limit) break;
    }
  }

  const accounts: PilotAccount[] = [];

  for (const clientId of chosenIds) {
    const [client] = await db
      .select({ id: clients.id, name: clients.name })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);
    if (!client) continue;

    // Contactpersoon van de klant (primair eerst). In Monday staan de namen
    // wel, maar de e-mailadressen vaak nog niet — daarom een duidelijk
    // pilot-loginadres als terugval (er wordt lokaal niets gemaild).
    const contacts = await db
      .select({
        fullName: clientContacts.fullName,
        email: clientContacts.email,
        isPrimary: clientContacts.isPrimary,
      })
      .from(clientContacts)
      .where(eq(clientContacts.clientId, clientId))
      .orderBy(desc(clientContacts.isPrimary));
    const contact = contacts.find((c) => c.email) ?? contacts[0] ?? null;

    const slug = client.name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "klant";
    const email = (contact?.email ?? `${slug}@pilot.shortclips.nl`).toLowerCase();
    const password = tempPassword();
    const passwordHash = await hashPassword(password);

    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    let userId: string;
    let action: "created" | "updated";
    if (existing) {
      await db
        .update(users)
        .set({
          passwordHash,
          fullName: contact?.fullName ?? client.name,
          primaryRole: "client",
          clientId,
          status: "active",
          updatedAt: new Date(),
        })
        .where(eq(users.id, existing.id));
      userId = existing.id;
      action = "updated";
    } else {
      const [created] = await db
        .insert(users)
        .values({
          email,
          fullName: contact?.fullName ?? client.name,
          passwordHash,
          primaryRole: "client",
          clientId,
          status: "active",
        })
        .returning({ id: users.id });
      userId = created!.id;
      action = "created";
    }

    // Zorg dat de portaalrol gekoppeld is (idempotent).
    await db
      .insert(userRoles)
      .values({ userId, roleId: clientRole.id })
      .onConflictDoNothing();

    accounts.push({
      clientId,
      clientName: client.name,
      contactName: contact?.fullName ?? null,
      email,
      tempPassword: password,
      action,
    });
  }

  return {
    ok: accounts.length > 0,
    accounts,
    note:
      accounts.length === 0
        ? "Geen echte klanten gevonden om pilot-accounts voor te maken."
        : undefined,
  };
}
