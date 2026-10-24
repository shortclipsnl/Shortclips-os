import "server-only";
import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
} from "drizzle-orm";
import { db } from "@/db/client";
import {
  clients,
  driveMappings,
  files,
} from "@/db/schema";
import { drive, DriveService } from "@/server/integrations/drive";
import { matchScore, normalizeName } from "@/server/import";
import { aliasesForSlug } from "@/server/integrations/client-aliases";
import { runJob } from "./runner";

/** Uit welke logische map komt dit bestand? Bepaalt de categorie in de UI. */
function categoryFromPath(path: string): string | null {
  const known = [
    "Strategie", "Scripts", "Opnames", "Video", "Rapportages",
    "Branding", "Contracten", "Overig",
  ];
  const segments = path.split("/").filter(Boolean);
  const exact = known.find((k) => segments.some((s) => s.toLowerCase() === k.toLowerCase()));
  if (exact) return exact;
  // Mappen als "Short Video Scripts" tellen ook als Scripts, zodat de
  // scriptgenerator en de scriptingpagina die PDF's vinden.
  if (segments.some((s) => s.toLowerCase().includes("script"))) return "Scripts";
  return null;
}

/**
 * Volledige eerste synchronisatie van de klantmap: alle mappen en bestanden
 * inlezen als metadata. De bestanden zelf blijven in Drive staan.
 */
export async function syncClientDriveFolder(
  clientId: string,
  folderId: string,
  triggeredById?: string,
) {
  return runJob(
    "google_drive",
    "drive.sync_client_folder",
    { clientId, folderId },
    async (ctx) => {
      ctx.log(`Map ${folderId} doorlopen`);
      const entries = await drive.walkFolder(folderId, 3);
      ctx.log(`${entries.length} objecten gevonden`);

      // Bestaande bestanden één keer ophalen, zodat we nieuwe bestanden in bulk
      // kunnen invoegen i.p.v. per stuk een select + insert (snelheid/limiet).
      const entryIds = entries.map((e) => e.id);
      const existingSet = new Set<string>();
      for (let i = 0; i < entryIds.length; i += 200) {
        const rows = await db
          .select({ externalId: files.externalId })
          .from(files)
          .where(and(eq(files.source, "google_drive"), inArray(files.externalId, entryIds.slice(i, i + 200))));
        for (const r of rows) if (r.externalId) existingSet.add(r.externalId);
      }

      const toInsert: (typeof files.$inferInsert)[] = [];
      for (const entry of entries) {
        ctx.counters.processed++;
        const values = {
          clientId,
          name: entry.name,
          mimeType: entry.mimeType,
          sizeBytes: entry.size ?? null,
          source: "google_drive" as const,
          externalId: entry.id,
          externalUrl: entry.webViewLink ?? null,
          category: categoryFromPath(entry.path),
          path: entry.path,
          parentExternalId: entry.parents?.[0] ?? null,
          isFolder: DriveService.isFolder(entry),
          modifiedAt: entry.modifiedTime ? new Date(entry.modifiedTime) : null,
          lastSyncedAt: new Date(),
        };

        if (existingSet.has(entry.id)) {
          await db.update(files).set(values).where(and(eq(files.source, "google_drive"), eq(files.externalId, entry.id)));
          ctx.counters.updated++;
        } else {
          toInsert.push(values);
        }
      }
      for (let i = 0; i < toInsert.length; i += 200) {
        await db.insert(files).values(toInsert.slice(i, i + 200));
        ctx.counters.created += Math.min(200, toInsert.length - i);
      }

      // Startpunt bewaren voor incrementele synchronisatie hierna.
      const pageToken = await drive.startPageToken();
      const existingMapping = await db
        .select({ id: driveMappings.id })
        .from(driveMappings)
        .where(
          and(eq(driveMappings.entityType, "client"), eq(driveMappings.folderId, folderId)),
        )
        .limit(1);

      if (existingMapping[0]) {
        await db
          .update(driveMappings)
          .set({ pageToken, lastSyncedAt: new Date(), entityId: clientId })
          .where(eq(driveMappings.id, existingMapping[0].id));
      } else {
        await db.insert(driveMappings).values({
          entityType: "client",
          entityId: clientId,
          folderId,
          pageToken,
          lastSyncedAt: new Date(),
        });
      }

      ctx.log("Startpunt voor incrementele synchronisatie opgeslagen");
    },
    { triggeredById, scopeType: "client", scopeId: clientId },
  );
}

/** Alleen de wijzigingen sinds de vorige run ophalen. */
export async function syncDriveChanges(mappingId: string) {
  const [mapping] = await db
    .select()
    .from(driveMappings)
    .where(eq(driveMappings.id, mappingId))
    .limit(1);

  if (!mapping?.pageToken) {
    return { jobId: "", ok: false, error: "Geen startpunt bekend; draai eerst een volledige synchronisatie." };
  }

  return runJob(
    "google_drive",
    "drive.sync_changes",
    { mappingId },
    async (ctx) => {
      let token: string | undefined = mapping.pageToken!;
      let newToken: string | undefined;

      while (token) {
        const page = await drive.changes(token);
        for (const change of page.changes) {
          ctx.counters.processed++;

          if (change.removed || change.file?.trashed) {
            await db
              .update(files)
              .set({ deletedAt: new Date() })
              .where(
                and(eq(files.source, "google_drive"), eq(files.externalId, change.fileId)),
              );
            ctx.counters.updated++;
            continue;
          }

          const file = change.file;
          if (!file) continue;

          const existing = await db
            .select({ id: files.id })
            .from(files)
            .where(and(eq(files.source, "google_drive"), eq(files.externalId, file.id)))
            .limit(1);

          if (existing[0]) {
            await db
              .update(files)
              .set({
                name: file.name,
                mimeType: file.mimeType,
                sizeBytes: file.size ?? null,
                externalUrl: file.webViewLink ?? null,
                modifiedAt: file.modifiedTime ? new Date(file.modifiedTime) : null,
                lastSyncedAt: new Date(),
                deletedAt: null,
              })
              .where(eq(files.id, existing[0].id));
            ctx.counters.updated++;
          } else if (mapping.entityId) {
            await db.insert(files).values({
              clientId: mapping.entityId,
              name: file.name,
              mimeType: file.mimeType,
              sizeBytes: file.size ?? null,
              source: "google_drive",
              externalId: file.id,
              externalUrl: file.webViewLink ?? null,
              isFolder: DriveService.isFolder(file),
              parentExternalId: file.parents?.[0] ?? null,
              modifiedAt: file.modifiedTime ? new Date(file.modifiedTime) : null,
              lastSyncedAt: new Date(),
            });
            ctx.counters.created++;
          }
        }

        newToken = page.newStartPageToken ?? newToken;
        token = page.nextPageToken;
      }

      if (newToken) {
        await db
          .update(driveMappings)
          .set({ pageToken: newToken, lastSyncedAt: new Date() })
          .where(eq(driveMappings.id, mappingId));
        ctx.log("Nieuw startpunt opgeslagen");
      }
    },
  );
}

/**
 * Nachtelijke Drive-synchronisatie: werk alle gekoppelde klantmappen
 * incrementeel bij (via de opgeslagen pageToken). Zo blijft Drive automatisch
 * actueel i.p.v. alleen bij een handmatige actie. Draait alleen echt zodra de
 * Google-secrets zijn ingevuld.
 */
export async function runDriveSync() {
  const mappings = await db
    .select({ id: driveMappings.id })
    .from(driveMappings)
    .where(and(eq(driveMappings.entityType, "client"), isNotNull(driveMappings.pageToken)));
  let ok = 0;
  let failed = 0;
  for (const m of mappings) {
    try {
      const res = await syncDriveChanges(m.id);
      if (res.ok) ok++;
      else failed++;
    } catch {
      failed++;
    }
  }
  return { ok: true, mappings: mappings.length, synced: ok, failed };
}

/**
 * Koppelt de klantmappen onder GOOGLE_DRIVE_ROOT_FOLDER_ID aan klanten (op naam,
 * met aliassen en een fuzzy score) en leest hun bestanden in. Per aanroep worden
 * maximaal `limit` nog-niet-gekoppelde mappen verwerkt, zodat ook grote mappen
 * binnen de tijdslimiet passen; herhaal tot `remaining` 0 is. Nooit gokken:
 * mappen zonder één duidelijke klant worden overgeslagen en gerapporteerd.
 */
export async function linkDriveFolders(limit = 5): Promise<{
  ok: boolean;
  linked: number;
  linkedList: string[];
  skipped: number;
  skippedList: string[];
  remaining: number;
}> {
  const root = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  if (!root) throw new Error("GOOGLE_DRIVE_ROOT_FOLDER_ID ontbreekt");

  const folders = (await drive.listFolder(root)).filter((f) => DriveService.isFolder(f));
  const clientRows = await db
    .select({ id: clients.id, name: clients.name, slug: clients.slug })
    .from(clients)
    .where(isNull(clients.deletedAt));
  const mapped = new Set(
    (await db.select({ folderId: driveMappings.folderId }).from(driveMappings).where(eq(driveMappings.entityType, "client"))).map((m) => m.folderId),
  );

  function matchClient(name: string): { id: string; name: string } | null {
    const n = normalizeName(name);
    if (!n) return null;
    const hits = clientRows.filter(
      (c) =>
        normalizeName(c.name) === n ||
        normalizeName(c.slug) === n ||
        aliasesForSlug(c.slug).some((a) => normalizeName(a) === n) ||
        matchScore(name, c.name) >= 85,
    );
    return hits.length === 1 ? { id: hits[0]!.id, name: hits[0]!.name } : null;
  }

  const skipped: string[] = [];
  const candidates: { folderId: string; folderName: string; client: { id: string; name: string } }[] = [];
  for (const folder of folders) {
    if (mapped.has(folder.id)) continue;
    const client = matchClient(folder.name);
    if (client) candidates.push({ folderId: folder.id, folderName: folder.name, client });
    else skipped.push(folder.name);
  }

  const batch = candidates.slice(0, limit);
  const linkedList: string[] = [];
  for (const c of batch) {
    await syncClientDriveFolder(c.client.id, c.folderId);
    linkedList.push(`${c.folderName} → ${c.client.name}`);
  }

  return {
    ok: true,
    linked: linkedList.length,
    linkedList,
    skipped: skipped.length,
    skippedList: skipped,
    remaining: candidates.length - batch.length,
  };
}
