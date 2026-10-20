import "server-only";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { and, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { roles, teamMembers, userRoles, users } from "@/db/schema";
import { hashPassword } from "@/server/auth/password";

/**
 * Geeft elk zichtbaar teamlid een eigen, persoonlijk inlogwachtwoord (in plaats
 * van het gedeelde dev-wachtwoord). Rol-gebaseerde rechten zijn al ingebouwd, dus
 * iedereen krijgt toegang tot dezelfde actuele omgeving, met rechten die bij de
 * rol passen. De wachtwoorden worden NIET in de chat getoond, maar weggeschreven
 * naar team-logins.local.md in de projectmap (één keer doorgeven, daarna wissen).
 */
function tempPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const b = randomBytes(14);
  let out = "";
  for (const x of b) out += alphabet[x % alphabet.length];
  return `${out.slice(0, 5)}-${out.slice(5, 10)}-${out.slice(10, 14)}`;
}

export async function setupTeamLogins(): Promise<{ ok: boolean; count: number; file: string | null; credentials: Array<{ fullName: string; role: string; email: string; password: string }> }> {
  // Zichtbare teamleden (team_members niet verwijderd), geen klantaccounts.
  const members = await db
    .select({ id: users.id, fullName: users.fullName, email: users.email, role: users.primaryRole })
    .from(users)
    .innerJoin(teamMembers, eq(teamMembers.userId, users.id))
    .where(and(isNull(teamMembers.deletedAt), isNull(users.deletedAt), ne(users.primaryRole, "client")))
    .orderBy(users.fullName);

  const lines: string[] = [
    "# Shortclips — interne logins",
    "",
    "Persoonlijke inloggegevens per teamlid. Geef ze één keer door en verwijder dit bestand daarna.",
    "Inloggen op het interne dashboard (niet het klantportaal).",
    "",
    "| Naam | Rol | E-mail | Tijdelijk wachtwoord |",
    "|---|---|---|---|",
  ];

  let count = 0;
  const credentials: Array<{ fullName: string; role: string; email: string; password: string }> = [];
  for (const m of members) {
    const pw = tempPassword();
    await db.update(users).set({ passwordHash: await hashPassword(pw), status: "active", updatedAt: new Date() }).where(eq(users.id, m.id));

    // Zorg dat de rol-koppeling (en dus de rechten) bestaat.
    const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, m.role)).limit(1);
    if (role) await db.insert(userRoles).values({ userId: m.id, roleId: role.id }).onConflictDoNothing();

    lines.push(`| ${m.fullName} | ${m.role} | ${m.email} | ${pw} |`);
    credentials.push({ fullName: m.fullName, role: m.role, email: m.email, password: pw });
    count++;
  }

  // Lokaal naar een bestand; op serverless (alleen-lezen schijf) mislukt dat
  // stilletjes — de credentials staan dan in het antwoord.
  let file: string | null = path.resolve(process.cwd(), "team-logins.local.md");
  try {
    writeFileSync(file, lines.join("\n") + "\n", "utf8");
  } catch {
    file = null;
  }
  return { ok: true, count, file, credentials };
}

/**
 * Niet-destructieve variant: geeft alleen teamleden die nog GÉÉN wachtwoord
 * hebben een persoonlijk wachtwoord. Wie al kan inloggen (bijv. de eigenaar)
 * houdt zijn bestaande wachtwoord — zo is herhaald uitvoeren veilig. De
 * rol-koppeling (rechten) wordt voor iedereen gezekerd. Geeft alleen de nieuw
 * aangemaakte inloggegevens terug.
 */
export async function setupMissingTeamLogins(): Promise<{
  ok: boolean;
  created: number;
  alreadyHadLogin: number;
  credentials: Array<{ fullName: string; role: string; email: string; password: string }>;
}> {
  const members = await db
    .select({ id: users.id, fullName: users.fullName, email: users.email, role: users.primaryRole, passwordHash: users.passwordHash })
    .from(users)
    .innerJoin(teamMembers, eq(teamMembers.userId, users.id))
    .where(and(isNull(teamMembers.deletedAt), isNull(users.deletedAt), ne(users.primaryRole, "client")))
    .orderBy(users.fullName);

  let created = 0;
  let alreadyHadLogin = 0;
  const credentials: Array<{ fullName: string; role: string; email: string; password: string }> = [];

  for (const m of members) {
    // Rol-koppeling (rechten) altijd zekeren.
    const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, m.role)).limit(1);
    if (role) await db.insert(userRoles).values({ userId: m.id, roleId: role.id }).onConflictDoNothing();

    if (m.passwordHash) {
      alreadyHadLogin++;
      continue;
    }
    const pw = tempPassword();
    await db.update(users).set({ passwordHash: await hashPassword(pw), status: "active", updatedAt: new Date() }).where(eq(users.id, m.id));
    credentials.push({ fullName: m.fullName, role: m.role, email: m.email, password: pw });
    created++;
  }

  return { ok: true, created, alreadyHadLogin, credentials };
}

/**
 * Stelt voor één teamlid een nieuw wachtwoord in en geeft het terug (één keer te
 * tonen). Nodig wanneer een bestaand wachtwoord nooit is doorgegeven of kwijt is:
 * het oude is versleuteld en niet op te halen, dus we zetten gewoon een nieuw.
 * Alleen aanroepen vanuit een eigenaar-geverifieerde route.
 */
export async function resetTeamLogin(userId: string): Promise<
  | { ok: true; fullName: string; email: string; role: string; password: string }
  | { ok: false; message: string }
> {
  const [member] = await db
    .select({ id: users.id, fullName: users.fullName, email: users.email, role: users.primaryRole })
    .from(users)
    .innerJoin(teamMembers, eq(teamMembers.userId, users.id))
    .where(and(eq(users.id, userId), isNull(teamMembers.deletedAt), isNull(users.deletedAt), ne(users.primaryRole, "client")))
    .limit(1);
  if (!member) return { ok: false, message: "Teamlid niet gevonden." };

  // Rol-koppeling (rechten) zekeren en een vers wachtwoord zetten.
  const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, member.role)).limit(1);
  if (role) await db.insert(userRoles).values({ userId: member.id, roleId: role.id }).onConflictDoNothing();

  const pw = tempPassword();
  await db.update(users).set({ passwordHash: await hashPassword(pw), status: "active", updatedAt: new Date() }).where(eq(users.id, member.id));

  return { ok: true, fullName: member.fullName, email: member.email, role: member.role, password: pw };
}
