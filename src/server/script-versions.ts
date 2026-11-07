import "server-only";
import { and, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, files, productionDays, shootScriptSources } from "@/db/schema";
import { checkForNewerVersion, type VersionFile } from "@/lib/script-versions";
import { isScriptPdf } from "@/lib/drive-sessions";
import { ensureCaptionsForShoot } from "@/server/captions/run";
import { notify } from "@/server/notifications";
import { runJob } from "@/server/jobs/runner";
import { syncScriptingTasks } from "@/server/scripting-tasks";

/**
 * Altijd de nieuwste scriptversie.
 *
 * 1. Versiecontrole: staat er in de map van de gekoppelde script-PDF een
 *    nieuwere versie van hetzelfde script (bijv. "… V2.pdf"), dan koppelen we
 *    die automatisch en krijgt de verantwoordelijke een melding. Andere
 *    nieuwere PDF's in die map (een variant voor de videograaf, advertenties)
 *    worden niet automatisch gekozen; die verschijnen als hint in Scripting.
 * 2. Captions: voor elke aankomende opname met een script-PDF controleren we of
 *    de inhoud gewijzigd is (ook een in Drive overschreven PDF). Zo ja, dan
 *    worden de captions opnieuw gemaakt. Ongewijzigd = geen AI-kosten.
 */

const MAX_CAPTION_RUNS = 25;

function today(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
}
function iso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const x = d instanceof Date ? d : new Date(d);
  return isNaN(x.getTime()) ? null : x.toISOString();
}

export type VersionInfo = {
  productionDayId: string;
  linked: VersionFile & { parentExternalId: string | null };
  upgradeTo: VersionFile | null;
  otherNewer: VersionFile[];
};

/** Versiestatus van de gekoppelde Drive-PDF's van de opgegeven opnames. */
export async function scriptVersionInfo(productionDayIds: string[]): Promise<Map<string, VersionInfo>> {
  const out = new Map<string, VersionInfo>();
  if (productionDayIds.length === 0) return out;
  const sources = await db
    .select({
      productionDayId: shootScriptSources.productionDayId,
      clientId: shootScriptSources.clientId,
      fileExternalId: shootScriptSources.fileExternalId,
      fileName: shootScriptSources.fileName,
      confirmedAt: shootScriptSources.confirmedAt,
      matchedAt: shootScriptSources.matchedAt,
    })
    .from(shootScriptSources)
    .where(and(inArray(shootScriptSources.productionDayId, productionDayIds), eq(shootScriptSources.status, "gekoppeld")));
  if (sources.length === 0) return out;

  // De gekoppelde bestanden zelf (ook als ze inmiddels uit Drive verwijderd zijn).
  const linkedRows = await db
    .select({ externalId: files.externalId, clientId: files.clientId, name: files.name, parent: files.parentExternalId, modifiedAt: files.modifiedAt, deletedAt: files.deletedAt })
    .from(files)
    .where(inArray(files.externalId, sources.map((s) => s.fileExternalId)));
  const linkedById = new Map(linkedRows.map((r) => [`${r.clientId}:${r.externalId}`, r]));

  const parents = [...new Set(linkedRows.map((r) => r.parent).filter((p): p is string => Boolean(p)))];
  const siblingRows = parents.length
    ? await db
        .select({ externalId: files.externalId, clientId: files.clientId, name: files.name, parent: files.parentExternalId, modifiedAt: files.modifiedAt, mimeType: files.mimeType, isFolder: files.isFolder })
        .from(files)
        .where(and(inArray(files.parentExternalId, parents), isNull(files.deletedAt), eq(files.isFolder, false)))
    : [];

  for (const s of sources) {
    const lf = linkedById.get(`${s.clientId}:${s.fileExternalId}`);
    if (!lf) continue;
    const siblings: VersionFile[] = siblingRows
      .filter((r) => r.parent === lf.parent && r.clientId === s.clientId && r.externalId && isScriptPdf({ name: r.name, mimeType: r.mimeType, isFolder: r.isFolder }))
      .map((r) => ({ externalId: r.externalId!, name: r.name, modifiedAt: iso(r.modifiedAt) }));
    const linked = { externalId: s.fileExternalId, name: lf.name ?? s.fileName, modifiedAt: iso(lf.modifiedAt), deleted: lf.deletedAt != null, parentExternalId: lf.parent };
    const check = checkForNewerVersion({ linked, linkedAt: iso(s.confirmedAt) ?? iso(s.matchedAt), siblings });
    out.set(s.productionDayId, { productionDayId: s.productionDayId, linked, ...check });
  }
  return out;
}

/** Koppelt een nieuwere versie en meldt dat aan de verantwoordelijke. */
async function upgradeLink(dayId: string, to: VersionFile, from: VersionFile): Promise<void> {
  const [f] = await db
    .select({ path: files.path })
    .from(files)
    .where(eq(files.externalId, to.externalId))
    .limit(1);
  const now = new Date();
  await db
    .update(shootScriptSources)
    .set({
      fileExternalId: to.externalId,
      fileName: to.name.trim().slice(0, 400),
      filePath: f?.path ?? null,
      matchReason: `Automatisch bijgewerkt naar nieuwere versie (was: ${from.name.trim()})`.slice(0, 500),
      contentHash: null,
      confirmedAt: now,
      confirmedById: null,
      updatedAt: now,
    })
    .where(eq(shootScriptSources.productionDayId, dayId));

  const [day] = await db
    .select({ clientId: productionDays.clientId, clientName: clients.name, writer: productionDays.scriptWriterId, coordinator: clients.coordinatorId })
    .from(productionDays)
    .innerJoin(clients, eq(clients.id, productionDays.clientId))
    .where(eq(productionDays.id, dayId))
    .limit(1);
  const who = [day?.writer ?? day?.coordinator].filter((x): x is string => Boolean(x));
  await notify({
    userIds: who,
    roles: who.length ? undefined : ["owner"],
    clientId: day?.clientId,
    level: "info",
    type: "script_version_updated",
    title: "Nieuwe scriptversie gekoppeld",
    body: `${day?.clientName ?? "Klant"}: "${to.name.trim()}" vervangt "${from.name.trim()}". De captions worden op basis van deze versie bijgewerkt.`.slice(0, 300),
    href: `/scripting?sessie=${dayId}`,
    entityType: "production_day",
    entityId: dayId,
    dedupeKey: `script_version:${dayId}:${to.externalId}`,
  }).catch(() => undefined);
}

export type VersionSyncResult = { checked: number; upgraded: number; captionsUpdated: number; captionsFailed: number };

/**
 * Versiecontrole + captions bijwerken voor aankomende opnames (of de opgegeven
 * opnames). Idempotent: zonder nieuwe versie of gewijzigde PDF gebeurt er niets.
 */
export async function syncScriptVersions(dayIds?: string[]): Promise<VersionSyncResult> {
  const result: VersionSyncResult = { checked: 0, upgraded: 0, captionsUpdated: 0, captionsFailed: 0 };
  const ids = dayIds ?? (
    await db
      .select({ id: productionDays.id })
      .from(productionDays)
      .where(and(
        isNull(productionDays.deletedAt),
        ne(productionDays.status, "cancelled"),
        gte(productionDays.scheduledOn, today()),
        sql`exists (select 1 from shoot_script_sources s where s.production_day_id = ${productionDays.id} and s.status = 'gekoppeld')
            or exists (select 1 from script_reviews r where r.production_day_id = ${productionDays.id} and r.deleted_at is null)`,
      ))
  ).map((r) => r.id);
  if (ids.length === 0) return result;

  const info = await scriptVersionInfo(ids);
  for (const v of info.values()) {
    if (!v.upgradeTo) continue;
    await upgradeLink(v.productionDayId, v.upgradeTo, v.linked);
    result.upgraded++;
  }
  if (result.upgraded) await syncScriptingTasks([...info.values()].filter((v) => v.upgradeTo).map((v) => v.productionDayId)).catch(() => undefined);

  // Captions: per opname de bron-PDF controleren (hash) en zo nodig opnieuw maken.
  let runs = 0;
  for (const id of ids) {
    result.checked++;
    if (runs >= MAX_CAPTION_RUNS) break;
    try {
      const res = await ensureCaptionsForShoot(id);
      if (res.ok) { result.captionsUpdated++; runs++; }
      else if (res.reason === "error") { result.captionsFailed++; runs++; }
    } catch {
      result.captionsFailed++;
    }
  }
  return result;
}

/** Geplande run (elk uur overdag). */
export async function runScriptVersionSync() {
  return runJob("system", "scripts.version_sync", {}, async (ctx) => {
    const r = await syncScriptVersions();
    ctx.counters.processed = r.checked;
    ctx.counters.updated = r.upgraded + r.captionsUpdated;
    ctx.counters.failed = r.captionsFailed;
    ctx.log(`${r.checked} opnames gecontroleerd: ${r.upgraded} nieuwere scriptversies gekoppeld, captions ${r.captionsUpdated}x bijgewerkt`);
  });
}
