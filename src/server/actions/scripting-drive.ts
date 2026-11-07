"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, files, productionDays, shootScriptSources } from "@/db/schema";
import { assertClientAccess, ForbiddenError, requireInternal, requirePermission } from "@/server/auth/context";
import { buildDriveSessions, isScriptPdf, sessionMatchesShoot, type DriveEntry, type DriveSession } from "@/lib/drive-sessions";
import { syncScriptingTasks } from "@/server/scripting-tasks";

/**
 * Scripts uit Google Drive koppelen op de scriptingpagina, in drie stappen:
 * 1. sessiemappen van de klant (nieuwste eerst), 2. alleen de PDF's in de
 * gekozen sessie, 3. de gekozen PDF koppelen aan de scriptsessie (opname).
 *
 * Leest de al gesynchroniseerde Drive-structuur (tabel `files`, bijgehouden door
 * de bestaande Drive-koppeling) en koppelt via `shoot_script_sources`: dezelfde
 * koppeling die de Caption Maker gebruikt. Eén bron, dus de captions lezen
 * automatisch de PDF die hier gekozen is.
 */

export type SessionView = DriveSession & {
  /** Past de sessiedatum bij de opnamedatum? */
  match: "match" | "mismatch" | "onbekend";
  /** Bevat de PDF die nu aan deze opname gekoppeld is. */
  containsLinked: boolean;
};

export type DriveSessionsResult =
  | {
      ok: true;
      clientName: string;
      scheduledOn: string;
      sessions: SessionView[];
      linked: { externalId: string; name: string; sessionName: string | null; url: string | null } | null;
      canWrite: boolean;
    }
  | { ok: false; message: string };

export type LinkResult = { ok: boolean; message?: string };

async function loadDay(productionDayId: string) {
  const [d] = await db
    .select({ id: productionDays.id, clientId: productionDays.clientId, scheduledOn: productionDays.scheduledOn, clientName: clients.name })
    .from(productionDays)
    .innerJoin(clients, eq(clients.id, productionDays.clientId))
    .where(and(eq(productionDays.id, productionDayId), isNull(productionDays.deletedAt)))
    .limit(1);
  return d ?? null;
}

/** Alle mappen en bestanden in de scriptmap(pen) van een klant. */
async function loadScriptEntries(clientId: string): Promise<DriveEntry[]> {
  const rows = await db
    .select({
      externalId: files.externalId,
      parentExternalId: files.parentExternalId,
      name: files.name,
      path: files.path,
      isFolder: files.isFolder,
      mimeType: files.mimeType,
      url: files.externalUrl,
      modifiedAt: files.modifiedAt,
    })
    .from(files)
    .where(and(
      eq(files.clientId, clientId),
      isNull(files.deletedAt),
      or(eq(files.category, "Scripts"), sql`lower(${files.path}) like '%script%'`),
    ));
  return rows
    .filter((r): r is typeof r & { externalId: string } => Boolean(r.externalId))
    .map((r) => ({
      externalId: r.externalId,
      parentExternalId: r.parentExternalId,
      name: r.name,
      path: r.path,
      isFolder: r.isFolder,
      mimeType: r.mimeType,
      url: r.url,
      modifiedAt: r.modifiedAt ? (r.modifiedAt instanceof Date ? r.modifiedAt : new Date(r.modifiedAt as unknown as string)).toISOString() : null,
    }));
}

export async function listScriptingDriveSessions(productionDayId: string): Promise<DriveSessionsResult> {
  try {
    const viewer = await requireInternal();
    const day = await loadDay(productionDayId);
    if (!day) return { ok: false, message: "Opname niet gevonden." };
    assertClientAccess(viewer, day.clientId);

    const [entries, [src]] = await Promise.all([
      loadScriptEntries(day.clientId),
      db
        .select({ fileExternalId: shootScriptSources.fileExternalId, fileName: shootScriptSources.fileName, status: shootScriptSources.status })
        .from(shootScriptSources)
        .where(eq(shootScriptSources.productionDayId, productionDayId))
        .limit(1),
    ]);
    const linkedId = src && src.status === "gekoppeld" ? src.fileExternalId : null;
    const sessions = buildDriveSessions(entries).map((s) => ({
      ...s,
      match: sessionMatchesShoot(s, day.scheduledOn),
      containsLinked: linkedId ? s.pdfs.some((p) => p.externalId === linkedId) : false,
    }));
    const linkedSession = linkedId ? sessions.find((s) => s.containsLinked) ?? null : null;
    const linkedPdf = linkedSession?.pdfs.find((p) => p.externalId === linkedId) ?? null;

    return {
      ok: true,
      clientName: day.clientName,
      scheduledOn: day.scheduledOn,
      sessions,
      linked: linkedId && src
        ? { externalId: linkedId, name: linkedPdf?.name ?? src.fileName, sessionName: linkedSession?.name ?? null, url: linkedPdf?.url ?? null }
        : null,
      canWrite: viewer.permissions.has("scripts:write"),
    };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Koppelt één PDF uit de Drive-map van deze klant aan de scriptsessie (opname). */
export async function linkScriptingDrivePdf(productionDayId: string, fileExternalId: string): Promise<LinkResult> {
  try {
    const viewer = await requirePermission("scripts:write");
    const day = await loadDay(productionDayId);
    if (!day) return { ok: false, message: "Opname niet gevonden." };
    assertClientAccess(viewer, day.clientId);

    // Alleen een PDF uit de scriptmap van déze klant mag gekoppeld worden.
    const entries = await loadScriptEntries(day.clientId);
    const file = entries.find((e) => e.externalId === fileExternalId);
    if (!file || !isScriptPdf(file)) return { ok: false, message: "Dit bestand is geen script-PDF van deze klant." };

    const now = new Date();
    const values = {
      status: "gekoppeld",
      confidence: "hoog",
      fileExternalId: file.externalId,
      fileName: file.name.trim().slice(0, 400),
      filePath: file.path,
      matchReason: `Gekoppeld via Scripting door ${viewer.fullName.split(" ")[0]}`,
      // Inhoud-hash wissen: de Caption Maker verwerkt de gekozen PDF opnieuw.
      contentHash: null,
      confirmedAt: now,
      confirmedById: viewer.id,
    };
    await db
      .insert(shootScriptSources)
      .values({ productionDayId, clientId: day.clientId, matchedAt: now, ...values })
      .onConflictDoUpdate({ target: shootScriptSources.productionDayId, set: { ...values, updatedAt: now } });

    // Sessienaam in de taakomschrijving bijwerken.
    await syncScriptingTasks([productionDayId]).catch(() => undefined);

    revalidatePath("/scripting");
    revalidatePath("/ai/caption");
    revalidatePath(`/ai/caption/opname/${productionDayId}`);
    revalidatePath("/tasks");
    return { ok: true, message: "PDF gekoppeld aan deze opname." };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/**
 * Koppeling ongedaan maken. We zetten de bron op "afgewezen" (in plaats van
 * verwijderen), zodat de automatische Drive-matcher van de Caption Maker hem
 * niet stilletjes opnieuw koppelt.
 */
export async function unlinkScriptingDrivePdf(productionDayId: string): Promise<LinkResult> {
  try {
    const viewer = await requirePermission("scripts:write");
    const day = await loadDay(productionDayId);
    if (!day) return { ok: false, message: "Opname niet gevonden." };
    assertClientAccess(viewer, day.clientId);
    await db
      .update(shootScriptSources)
      .set({ status: "afgewezen", confirmedAt: new Date(), confirmedById: viewer.id, updatedAt: new Date() })
      .where(eq(shootScriptSources.productionDayId, productionDayId));
    await syncScriptingTasks([productionDayId]).catch(() => undefined);
    revalidatePath("/scripting");
    revalidatePath("/ai/caption");
    revalidatePath("/tasks");
    return { ok: true, message: "Koppeling verwijderd." };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}
