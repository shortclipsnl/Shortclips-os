import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  clients,
  deliverables,
  permissions as permissionsTable,
  productionDays,
  rolePermissions,
  roles,
  tasks,
  userRoles,
  users,
} from "@/db/schema";
import { readSession, type SessionUser } from "./session";
import type { PermissionKey } from "./permissions";
import { isCoreStaff } from "@/server/core-staff";

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
  // Het vaste kantoorteam (Milou, Jiska, Rutger) beheert alle klanten, net als de
  // eigenaar — zij zien overal hetzelfde beeld als Jarno. De DB-rol kan dit recht
  // missen doordat later toegevoegde rollenrechten niet met terugwerkende kracht
  // worden toegekend; deze vaste uitzondering (zelfde patroon als het editing-board)
  // zorgt dat zij niet op "Deze klant hoort niet bij jouw toegang" lopen.
  if (isCoreStaff(user.email)) return null;

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
    // Kernteam (Jarno/Milou/Jiska/Rutger) is nooit "editor-only", ook niet als hun
    // hoofdrol toevallig op "editor" staat: zij sturen de productie aan en moeten
    // het volledige editing-board zien en bewerken (downloadlink + script), niet
    // alleen hun eigen toegewezen video's.
    isEditorOnly: user.primaryRole === "editor" && !perms.has("clients:read_all") && !isCoreStaff(user.email),
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

/** Is deze gebruiker de eigenaar (Janno)? Enige bron van waarheid hiervoor. */
export function isOwner(viewer: Viewer | null): boolean {
  return viewer?.primaryRole === "owner";
}

/**
 * Klantbeheer is rolgebaseerd, niet per e-mailadres (#4.1/#6): de eigenaar en
 * elke projectcoördinator mogen klanten beheren. Zo hoeft er geen uitzondering
 * per persoon bijgehouden te worden als het team wisselt.
 */
export function canManageClients(viewer: Viewer | null): boolean {
  if (!viewer) return false;
  // De eigenaar, projectcoördinatoren en de operationeel beheerder mogen klanten
  // en klantportalen beheren. Het vaste kernteam (Jarno, Milou, Jiska, Rutger)
  // krijgt dit óók op e-mail, onafhankelijk van de exacte rol — zij zien toch al
  // alle klanten. Zo kan bv. Milou ook portaallogins aanmaken.
  return (
    isOwner(viewer) ||
    viewer.primaryRole === "project_coordinator" ||
    viewer.primaryRole === "operational_manager" ||
    isCoreStaff(viewer.email)
  );
}

/**
 * Operationeel beheer: de eigenaar en de operationeel beheerder (Milou). Dit is
 * de gate voor de voorheen eigenaar-only operationele surfaces (koppelingen,
 * klantportaal-instellingen) die níet voor elke projectcoördinator bedoeld zijn.
 */
export function canManageOperations(viewer: Viewer | null): boolean {
  if (!viewer) return false;
  return isOwner(viewer) || viewer.primaryRole === "operational_manager";
}
export async function requireOperationalManager(): Promise<Viewer> {
  const viewer = await requireInternal();
  if (!canManageOperations(viewer)) {
    throw new ForbiddenError("Dit onderdeel is alleen voor de eigenaar en de operationeel beheerder.");
  }
  return viewer;
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

/** Alleen de eigenaar (Janno) — financiën, leads, koppelingen, migratie. */
export async function requireOwner(): Promise<Viewer> {
  const viewer = await requireInternal();
  if (!isOwner(viewer)) {
    throw new ForbiddenError("Dit onderdeel is alleen toegankelijk voor de eigenaar.");
  }
  return viewer;
}

/** Eigenaar of een projectcoördinator mag klanten beheren (rolgebaseerd). */
export async function requireManageClients(): Promise<Viewer> {
  const viewer = await requireInternal();
  if (!canManageClients(viewer)) {
    throw new ForbiddenError("Klantenbeheer is alleen voor de eigenaar en projectcoördinatoren.");
  }
  return viewer;
}

/**
 * Offertemodule: naast de eigenaar mogen deze aangewezen teamleden offertes
 * maken, versturen en de tracking zien — zodat het doorgaat als de eigenaar er
 * niet is. Bewust een expliciete lijst (niet alle coördinatoren), zodat alleen
 * de gekozen personen erbij kunnen. Uitbreiden = een e-mail toevoegen.
 */
export const QUOTES_EXTRA_EMAILS = ["milou@shortclips.nl"] as const;
export function canManageQuotes(viewer: Viewer | null): boolean {
  if (!viewer) return false;
  return isOwner(viewer) || (QUOTES_EXTRA_EMAILS as readonly string[]).includes(viewer.email.toLowerCase());
}
export async function requireQuotesAccess(): Promise<Viewer> {
  const viewer = await requireInternal();
  if (!canManageQuotes(viewer)) {
    throw new ForbiddenError("De offertemodule is alleen voor de eigenaar en aangewezen teamleden.");
  }
  return viewer;
}

/**
 * SOP's en cursussen in de kennisbank schrijven: de eigenaar én
 * projectcoördinatoren (Jarno, Milou, Jiska, Tim …). Zo hoeft niet alles via
 * de eigenaar te lopen. Rolgebaseerd, net als klantbeheer.
 */
export function canAuthorKennisbank(viewer: Viewer | null): boolean {
  if (!viewer) return false;
  return (
    isOwner(viewer) ||
    viewer.primaryRole === "project_coordinator" ||
    viewer.primaryRole === "operational_manager"
  );
}

export async function requireAuthorKennisbank(): Promise<Viewer> {
  const viewer = await requireInternal();
  if (!canAuthorKennisbank(viewer)) {
    throw new ForbiddenError("De kennisbank beheren kan de eigenaar en projectcoördinatoren.");
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

/**
 * Is deze gebruiker een (freelance) editor? Dan mag hij alleen zijn eigen,
 * toegewezen werk zien en uitvoeren. Kernteam is nooit editor, ook niet als de
 * hoofdrol per ongeluk op "editor" staat. Gebruikt naast `isEditorOnly`, zodat
 * een editor met een losse extra rol (bv. clients:read_all) nog steeds geen
 * bronmateriaal van Team Shortclips kan wijzigen.
 */
export function isEditorRole(viewer: Viewer | null): boolean {
  if (!viewer) return false;
  return viewer.isEditorOnly || (viewer.primaryRole === "editor" && !isCoreStaff(viewer.email));
}

/**
 * Mag deze gebruiker het bronmateriaal van editingprojecten beheren: downloadlinks,
 * scripts, editorbriefings, deadlines, aantallen shorts en nieuwe projecten?
 * Uitsluitend Team Shortclips. Editors nooit, ook niet voor hun eigen projecten:
 * zij bekijken en downloaden alleen.
 */
export function canManageEditingProjects(viewer: Viewer | null): boolean {
  if (!viewer || viewer.isPortalUser || isEditorRole(viewer)) return false;
  return viewer.permissions.has("videos:write") || isCoreStaff(viewer.email);
}

/**
 * Interne teamfuncties (aandachtspunten, meetings, checklists, doelen, inzichten,
 * publicatiecheck): alleen Team Shortclips, nooit freelance editors. Editors
 * kunnen die pagina's al niet openen; dit sluit ook de server-acties zelf af.
 */
export async function requireTeamMember(): Promise<Viewer> {
  const viewer = await requireInternal();
  if (isEditorRole(viewer)) {
    throw new ForbiddenError("Dit onderdeel is alleen voor Team Shortclips.");
  }
  return viewer;
}

/** Server-side poort voor alle beheeracties op editingprojecten (zie hierboven). */
export async function requireEditingManager(): Promise<Viewer> {
  const viewer = await requireInternal();
  if (!canManageEditingProjects(viewer)) {
    throw new ForbiddenError(
      "Scripts, briefings, links en deadlines worden beheerd door Team Shortclips. Klopt er iets niet? Laat het je contactpersoon weten.",
    );
  }
  return viewer;
}

/**
 * Editors werken alleen aan hun eigen toegewezen projecten. Klanttoegang alleen
 * is niet genoeg: binnen dezelfde klant kan ook een collega-editor werk hebben.
 */
export function assertOwnEditingWork(viewer: Viewer, editorId: string | null): void {
  if (!isEditorRole(viewer)) return;
  if (!editorId || editorId !== viewer.id) {
    throw new ForbiddenError("Dit project is niet aan jou toegewezen.");
  }
}

/**
 * Editors: mag deze editor bij het materiaal van deze opname (script-pdf,
 * briefing)? Alleen als de opname of een project van die opname aan hem is
 * toegewezen. Voor niet-editors altijd true (klanttoegang wordt elders gecheckt).
 */
export async function editorMayOpenShoot(viewer: Viewer, productionDayId: string): Promise<boolean> {
  if (!isEditorRole(viewer)) return true;
  const [day] = await db
    .select({ editorId: productionDays.editorId })
    .from(productionDays)
    .where(eq(productionDays.id, productionDayId))
    .limit(1);
  if (day?.editorId === viewer.id) return true;
  const [own] = await db
    .select({ id: deliverables.id })
    .from(deliverables)
    .where(and(eq(deliverables.productionDayId, productionDayId), eq(deliverables.editorId, viewer.id), isNull(deliverables.deletedAt)))
    .limit(1);
  return !!own;
}

export function hasClientAccess(viewer: Viewer, clientId: string): boolean {
  return viewer.clientScope === null || viewer.clientScope.includes(clientId);
}

/**
 * Een Viewer opbouwen voor een gebruiker buiten een request om (geplande taken),
 * met dezelfde rechten en klantscope als wanneer die persoon zelf inlogt.
 */
export async function viewerForUser(userId: string): Promise<Viewer | null> {
  const [u] = await db
    .select({
      id: users.id, email: users.email, fullName: users.fullName, primaryRole: users.primaryRole,
      clientId: users.clientId, avatarUrl: users.avatarUrl, status: users.status,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u) return null;
  const user: SessionUser = { ...u, primaryRole: String(u.primaryRole), status: String(u.status) };
  const perms = await loadPermissions(user.id);
  const clientScope = await loadClientScope(user, perms);
  return {
    ...user,
    permissions: perms,
    clientScope,
    isPortalUser: user.primaryRole === "client",
    // Kernteam (Jarno/Milou/Jiska/Rutger) is nooit "editor-only", ook niet als hun
    // hoofdrol toevallig op "editor" staat: zij sturen de productie aan en moeten
    // het volledige editing-board zien en bewerken (downloadlink + script), niet
    // alleen hun eigen toegewezen video's.
    isEditorOnly: user.primaryRole === "editor" && !perms.has("clients:read_all") && !isCoreStaff(user.email),
  };
}
