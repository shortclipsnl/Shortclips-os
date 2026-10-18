import "server-only";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { permissions, rolePermissions, roles, teamMembers, userRoles, users } from "@/db/schema";
import { PERMISSIONS, ROLE_DEFINITIONS, permissionsForRole, type PermissionKey } from "@/server/auth/permissions";
import { hashPassword } from "@/server/auth/password";

/**
 * Eenmalige productie-bootstrap (voor een lege database):
 *  1. Vult de RBAC-tabellen (rechten, rollen, rol↔recht-koppelingen) uit de
 *     code-catalogus, zodat ingelogde gebruikers daadwerkelijk rechten hebben.
 *  2. Zorgt voor één werkend eigenaarsaccount met een wachtwoord.
 *
 * Idempotent (onConflictDoNothing). Geeft het eigenaarswachtwoord terug in het
 * antwoord zodat de eigenaar één keer kan inloggen (en het daarna wijzigt) —
 * op serverless kan het niet naar een bestand worden geschreven.
 */

const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermissionKey[];

async function seedRbac() {
  const permRows = ALL_PERMISSIONS.map((key) => ({
    key,
    resource: key.split(":")[0]!,
    action: key.split(":")[1]!,
    description: PERMISSIONS[key],
  }));
  await db.insert(permissions).values(permRows).onConflictDoNothing();
  const allPerms = await db.select({ id: permissions.id, key: permissions.key }).from(permissions);
  const permByKey = new Map(allPerms.map((p) => [p.key, p.id]));

  const roleRows = ROLE_DEFINITIONS.map((r) => ({
    key: r.key,
    name: r.name,
    description: r.description,
    isSystem: true,
    isPortalRole: r.isPortalRole ?? false,
    sortOrder: r.sortOrder,
  }));
  await db.insert(roles).values(roleRows).onConflictDoNothing();
  const allRoles = await db.select({ id: roles.id, key: roles.key }).from(roles);
  const roleByKey = new Map(allRoles.map((r) => [r.key, r.id]));

  const links: Array<{ roleId: string; permissionId: string }> = [];
  for (const def of ROLE_DEFINITIONS) {
    const roleId = roleByKey.get(def.key);
    if (!roleId) continue;
    for (const perm of permissionsForRole(def.key)) {
      const permissionId = permByKey.get(perm);
      if (permissionId) links.push({ roleId, permissionId });
    }
  }
  if (links.length) await db.insert(rolePermissions).values(links).onConflictDoNothing();

  return { roleByKey, perms: permByKey.size, rolesCount: roleByKey.size, links: links.length };
}

function tempPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const b = randomBytes(14);
  let out = "";
  for (const x of b) out += alphabet[x % alphabet.length];
  return `${out.slice(0, 5)}-${out.slice(5, 10)}-${out.slice(10, 14)}`;
}

const OWNER_EMAIL = "jarno@shortclips.nl";
const OWNER_NAME = "Jarno Klijnsma";

export async function bootstrapProduction(): Promise<{
  ok: boolean;
  rbac: { perms: number; rolesCount: number; links: number };
  owner: { email: string; password: string; created: boolean };
}> {
  const rbac = await seedRbac();

  const password = tempPassword();
  const passwordHash = await hashPassword(password);

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, OWNER_EMAIL)).limit(1);
  let userId: string;
  let created = false;
  if (existing) {
    userId = existing.id;
    await db.update(users).set({ primaryRole: "owner", status: "active", passwordHash, updatedAt: new Date() }).where(eq(users.id, userId));
  } else {
    const [row] = await db
      .insert(users)
      .values({ email: OWNER_EMAIL, fullName: OWNER_NAME, primaryRole: "owner", status: "active", passwordHash })
      .returning({ id: users.id });
    userId = row!.id;
    created = true;
  }

  await db.insert(teamMembers).values({ userId, color: "#00003B" }).onConflictDoNothing();
  const ownerRoleId = rbac.roleByKey.get("owner");
  if (ownerRoleId) await db.insert(userRoles).values({ userId, roleId: ownerRoleId }).onConflictDoNothing();

  return {
    ok: true,
    rbac: { perms: rbac.perms, rolesCount: rbac.rolesCount, links: rbac.links },
    owner: { email: OWNER_EMAIL, password, created },
  };
}
