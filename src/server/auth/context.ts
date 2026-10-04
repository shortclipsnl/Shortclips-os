import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  clients,
  deliverables,
  permissions as permissionsTable,
  rolePermissions,
  roles,
  tasks,
  userRoles,
} from "@/db/schema";
import { readSession, type SessionUser } from "./session";
import type { PermissionKey } from "./permissions";

/**
 * De "viewer": wie kijkt er, wat mag die, en welke klanten mag die zien.
 *
 * Dit is het enige punt waar toegang wordt bepaald. Elke query in de
 * applicatie gaat via `scopeToClients` of `assertClientAccess`, zodat een
 * gebruiker nooit data van een andere klant kan opvragen — ook niet door een
 * id in de URL te veranderen.
 */
export type Viewer = SessionUser & {
  permissions: Set<string>;
  /** `null` = alle klanten (bijv. eigenaar). Anders exact deze ids. */
  clientScope: string[] | null;
  isPortalUser: boolean;
  /**
   * Editors zonder bredere rechten zien uitsluitend hun eigen toegewezen werk.
   * Klanttoegang alleen is hier niet genoeg: binnen een klant mag een editor
   * niet het werk van een collega inzien.
   */
  isEditorOnly: boolean;
};

async function loadPermissions(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ key: permissionsTable.key })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .innerJoin(
      permissionsTable,
      eq(permissionsTable.id, rolePermissions.permissionId),
    )
    .where(eq(userRoles.userId, userId));

  return new Set(rows.map((r) => r.key));
}

/**
 * Welke klanten mag deze gebruiker zien?
 *
 *  - klantgebruiker → uitsluitend de eigen klant;
 *  - `clients:read_all` → alle klanten;
 *  - anders → klanten waar de gebruiker aan verbonden is (coördinator,
 *    videograaf, toegewezen video of taak).
 */
async function loadClientScope(
  user: SessionUser,
  perms: Set<string>,
): Promise<string[] | null> {
  if (user.primaryRole === "client") return user.clientId ? [user.clientId] : [];
  if (perms.has("clients:read_all")) return null;

  const owned = await db
    .select({ id: clients.id })
    .from(clients)
    .where(
      and(
        isNull(clients.deletedAt),
        or(
          eq(clients.coordinatorId, user.id),
          eq(clients.videographerId, user.id),
        ),
      ),
    );

  const viaVideos = await db
    .selectDistinct({ id: deliverables.clientId })
    .from(deliverables)
    .where(and(eq(deliverables.editorId, user.id), isNull(deliverables.deletedAt)));

  const viaTasks = await db
    .selectDistinct({ id: tasks.clientId })
    .from(tasks)
    .where(and(eq(tasks.assigneeId, user.id), isNull(tasks.deletedAt)));

  const ids = new Set<string>();
  for (const r of owned) ids.add(r.id);
  for (const r of viaVideos) if (r.id) ids.add(r.id);
  for (const r of viaTasks) if (r.id) ids.add(r.id);
  return [...ids];
}

/** Per request één keer berekend. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const user = await readSession();
  if (!user) return null;

  const perms = await loadPermissions(user.id);
  const clientScope = await loadClientScope(user, perms);

  return {
    ...user,
    permissions: perms,
    clientScope,
    isPortalUser: user.primaryRole === "client",
    isEditorOnly: user.primaryRole === "editor" && !perms.has("clients:read_all"),
  };
});

export async function requireViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  return viewer;
}

/** Interne gebruiker: klantaccounts horen in het portaal, niet in de OS-app. */
export async function requireInternal(): Promise<Viewer> {
  const viewer = await requireViewer();
  if (viewer.isPortalUser) redirect("/portal");
  return viewer;
}

export async function requirePortal(): Promise<Viewer> {
  const viewer = await requireViewer();
  if (!viewer.isPortalUser) redirect("/dashboard");
  if (!viewer.clientId) redirect("/login?reden=geen-klant");
  return viewer;
}

export function can(viewer: Viewer | null, permission: PermissionKey): boolean {
  return Boolean(viewer?.permissions.has(permission));
}

export function canAny(viewer: Viewer | null, list: PermissionKey[]): boolean {
  return list.some((p) => can(viewer, p));
}

export class ForbiddenError extends Error {
  constructor(message = "Je hebt geen toegang tot dit onderdeel.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export async function requirePermission(
  permission: PermissionKey,
): Promise<Viewer> {
  const viewer = await requireViewer();
  if (!viewer.permissions.has(permission)) {
    throw new ForbiddenError(
      `Hiervoor is het recht "${permission}" nodig. Vraag een beheerder om toegang.`,
    );
  }
  return viewer;
}

/**
 * Bouwt een WHERE-conditie die queries beperkt tot de klanten die deze viewer
 * mag zien. Gebruik dit in élke query op klantgebonden tabellen.
 */
export function scopeToClients(
  viewer: Viewer,
  column: Parameters<typeof inArray>[0],
) {
  if (viewer.clientScope === null) return undefined;
  if (viewer.clientScope.length === 0) return sql`false`;
  return inArray(column, viewer.clientScope);
}

/** Harde controle voor detailpagina's en mutaties. */
export function assertClientAccess(viewer: Viewer, clientId: string): void {
  if (viewer.clientScope === null) return;
  if (!viewer.clientScope.includes(clientId)) {
    throw new ForbiddenError("Deze klant hoort niet bij jouw toegang.");
  }
}

export function hasClientAccess(viewer: Viewer, clientId: string): boolean {
  return viewer.clientScope === null || viewer.clientScope.includes(clientId);
}
