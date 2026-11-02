import "server-only";
import { and, desc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, productionDays, scripts } from "@/db/schema";
import { assertClientAccess, scopeToClients, type Viewer } from "@/server/auth/context";

/* ------------------------------------------------------------------ *
 * Aanlevering voor de AI Editor vanuit het portaal: klant → opname →
 * script → Drive-map. Zo hoeft de editor niets opnieuw te typen of uploaden.
 * ------------------------------------------------------------------ */

export type IntakeClient = { id: string; name: string; color: string | null; logoUrl: string | null };
export type IntakeOpname = { id: string; scheduledOn: string; title: string; hasDrive: boolean; scriptCount: number };
export type IntakeScript = { id: string; title: string; status: string; format: string | null; hasNotes: boolean; preview: string };
export type OpnameDetail = { opname: { id: string; title: string; scheduledOn: string }; driveFolderId: string | null; scripts: IntakeScript[] };

/** De volledige gesproken scripttekst (hook → body → cta), zoals op camera. */
export function scriptSpokenText(s: { hook?: string | null; body?: string | null; cta?: string | null }): string {
  return [s.hook, s.body, s.cta].map((p) => (p ?? "").trim()).filter(Boolean).join("\n\n");
}

/** Actieve klanten waar deze gebruiker toegang toe heeft (voor de keuzelijst). */
export async function listIntakeClients(viewer: Viewer): Promise<IntakeClient[]> {
  const rows = await db
    .select({ id: clients.id, name: clients.name, color: clients.color, logoUrl: clients.logoUrl })
    .from(clients)
    .where(and(isNull(clients.deletedAt), inArray(clients.status, ["active", "onboarding"]), scopeToClients(viewer, clients.id)))
    .orderBy(clients.name);
  return rows;
}

/** Opnames van één klant: recente én komende (niet geannuleerd), nieuwste eerst. */
export async function listOpnamesForClient(viewer: Viewer, clientId: string): Promise<IntakeOpname[]> {
  assertClientAccess(viewer, clientId);
  // Vanaf ~60 dagen terug, zodat net geschoten opnames er ook bij staan.
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
  const rows = await db
    .select({
      id: productionDays.id,
      scheduledOn: productionDays.scheduledOn,
      title: productionDays.title,
      driveFolderId: productionDays.driveFolderId,
      footageUrl: productionDays.footageUrl,
    })
    .from(productionDays)
    .where(and(eq(productionDays.clientId, clientId), isNull(productionDays.deletedAt), ne(productionDays.status, "cancelled"), gte(productionDays.scheduledOn, since)))
    .orderBy(desc(productionDays.scheduledOn));

  const ids = rows.map((r) => r.id);
  const counts = ids.length
    ? await db
        .select({ productionDayId: scripts.productionDayId, n: sql<number>`count(*)::int` })
        .from(scripts)
        .where(and(inArray(scripts.productionDayId, ids), isNull(scripts.deletedAt)))
        .groupBy(scripts.productionDayId)
    : [];
  const countBy = new Map(counts.map((c) => [c.productionDayId, c.n]));

  return rows.map((r) => ({
    id: r.id,
    scheduledOn: r.scheduledOn,
    title: r.title,
    hasDrive: Boolean(r.driveFolderId || r.footageUrl),
    scriptCount: countBy.get(r.id) ?? 0,
  }));
}

/** Detail van één opname: de gekoppelde scripts + de Drive-map met de beelden. */
export async function getOpnameDetail(viewer: Viewer, productionDayId: string): Promise<OpnameDetail | null> {
  const [day] = await db
    .select({ id: productionDays.id, title: productionDays.title, scheduledOn: productionDays.scheduledOn, clientId: productionDays.clientId, driveFolderId: productionDays.driveFolderId })
    .from(productionDays)
    .where(and(eq(productionDays.id, productionDayId), isNull(productionDays.deletedAt)))
    .limit(1);
  if (!day) return null;
  assertClientAccess(viewer, day.clientId);

  const rows = await db
    .select({ id: scripts.id, title: scripts.title, status: scripts.status, format: scripts.format, hook: scripts.hook, body: scripts.body, cta: scripts.cta, internalNotes: scripts.internalNotes })
    .from(scripts)
    .where(and(eq(scripts.productionDayId, productionDayId), isNull(scripts.deletedAt)))
    .orderBy(desc(scripts.updatedAt));

  const scriptList: IntakeScript[] = rows.map((s) => ({
    id: s.id,
    title: s.title,
    status: s.status,
    format: s.format,
    hasNotes: Boolean((s.internalNotes ?? "").trim()),
    preview: scriptSpokenText(s).slice(0, 320),
  }));

  return {
    opname: { id: day.id, title: day.title, scheduledOn: day.scheduledOn },
    driveFolderId: day.driveFolderId,
    scripts: scriptList,
  };
}

/** Eén script volledig ophalen (gesproken tekst + montageaanwijzingen). Owner-scope
 *  via de opname/klant. Gebruikt bij het aanmaken van een AI Editor-project. */
export async function getScriptForIntake(viewer: Viewer, scriptId: string) {
  const [s] = await db
    .select({ id: scripts.id, title: scripts.title, hook: scripts.hook, body: scripts.body, cta: scripts.cta, internalNotes: scripts.internalNotes, clientId: scripts.clientId, productionDayId: scripts.productionDayId })
    .from(scripts)
    .where(and(eq(scripts.id, scriptId), isNull(scripts.deletedAt)))
    .limit(1);
  if (!s) return null;
  assertClientAccess(viewer, s.clientId);
  return { ...s, spoken: scriptSpokenText(s), montageNotes: (s.internalNotes ?? "").trim() };
}
