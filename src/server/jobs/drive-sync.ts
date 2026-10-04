import "server-only";
import {
  and,
  eq,
} from "drizzle-orm";
import { db } from "@/db/client";
import {
  driveMappings,
  files,
} from "@/db/schema";
import { drive, DriveService } from "@/server/integrations/drive";
import { runJob } from "./runner";

/** Uit welke logische map komt dit bestand? Bepaalt de categorie in de UI. */
function categoryFromPath(path: string): string | null {
  const known = [
    "Strategie", "Scripts", "Opnames", "Video", "Rapportages",
    "Branding", "Contracten", "Overig",
  ];
  const segments = path.split("/").filter(Boolean);
  return known.find((k) => segments.some((s) => s.toLowerCase() === k.toLowerCase())) ?? null;
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

      for (const entry of entries) {
        ctx.counters.processed++;
        const isFolder = DriveService.isFolder(entry);

        const existing = await db
          .select({ id: files.id })
          .from(files)
          .where(and(eq(files.source, "google_drive"), eq(files.externalId, entry.id)))
          .limit(1);

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
          isFolder,
          modifiedAt: entry.modifiedTime ? new Date(entry.modifiedTime) : null,
          lastSyncedAt: new Date(),
        };

        if (existing[0]) {
          await db.update(files).set(values).where(eq(files.id, existing[0].id));
          ctx.counters.updated++;
        } else {
          await db.insert(files).values(values);
          ctx.counters.created++;
        }
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
