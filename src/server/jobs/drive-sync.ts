import "server-only";
import { randomBytes } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, driveMappings, files, integrationConnections } from "@/db/schema";
import { drive, DriveService, type DriveFile } from "@/server/integrations/drive";
import { ensureConnectionRow } from "@/server/integrations/google-connection";
import { matchScore, normalizeName } from "@/server/import";
import { aliasesForSlug } from "@/server/integrations/client-aliases";
import { runJob, type JobContext } from "./runner";

/**
 * Google Drive-synchronisatie.
 *
 * Hoe het werkt (en waarom het vroeger misging):
 *
 * 1. De Drive changes-feed is ACCOUNT-BREED: hij bevat alle wijzigingen van
 *    het hele Google-account. Vroeger had elke klantmap een eigen cursor en
 *    las elke map dus álle wijzigingen opnieuw (24× hetzelfde werk). De
 *    nachtrun liep daardoor tegen de servertijdslimiet aan; sinds 20 oktober
 *    werden de meeste klantmappen niet meer bijgewerkt.
 *    → Nu is er één cursor (`drive_mappings` met entity_type 'account').
 *
 * 2. Nieuwe bestanden werden aan de klant van "de eerste map die toevallig
 *    draaide" gehangen, zonder pad of categorie (dus onvindbaar voor
 *    Scripting). Verplaatsen en hernoemen van mappen werd niet verwerkt.
 *    → Nu bepaalt de mapstructuur (parent → klantmap) bij welke klant een
 *    bestand hoort, met pad en categorie. Verplaatsen tussen klanten, uit de
 *    klantmap of het hernoemen van een map wordt correct doorgevoerd.
 *
 * 3. Drive werd maar één keer per nacht gesynchroniseerd.
 *    → Nu elke 2 minuten (licht: zonder wijzigingen kost het één API-aanroep),
 *    met een tijdbudget per run en een cursor die na elke pagina wordt
 *    bewaard, zodat een onderbroken run nooit wijzigingen kwijtraakt.
 *
 * 4. Vangnet: elke klantmap wordt periodiek volledig nagelopen
 *    (`reconcileDriveFolders`). Wat de feed onverhoopt mist, wordt daar
 *    alsnog rechtgezet.
 *
 * Een lease (vergrendeling met verlooptijd) voorkomt dat twee runs tegelijk
 * dezelfde cursor verwerken. Bestanden worden nooit hard verwijderd, alleen
 * gemarkeerd (deleted_at), zodat bestaande koppelingen behouden blijven.
 */

export const ACCOUNT_ENTITY = "account";
export const ACCOUNT_FOLDER = "__changes__";
const FOLDER_MIME = "application/vnd.google-apps.folder";

/** Uit welke logische map komt dit bestand? Bepaalt de categorie in de UI. */
export function categoryFromPath(path: string): string | null {
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

function likePrefix(path: string): string {
  return `${path.replace(/[\\%_]/g, (m) => `\\${m}`)}/%`;
}

/* ------------------------------------------------------------------ *
 * Lease: voorkomt dubbele, gelijktijdige verwerking.
 * ------------------------------------------------------------------ */

export async function acquireLease(mappingId: string, owner: string, ms: number): Promise<boolean> {
  const rows = await db
    .update(driveMappings)
    .set({ leaseUntil: new Date(Date.now() + ms), leaseOwner: owner })
    .where(
      and(
        eq(driveMappings.id, mappingId),
        or(isNull(driveMappings.leaseUntil), lt(driveMappings.leaseUntil, new Date())),
      ),
    )
    .returning({ id: driveMappings.id });
  return rows.length > 0;
}

async function extendLease(mappingId: string, owner: string, ms: number) {
  await db
    .update(driveMappings)
    .set({ leaseUntil: new Date(Date.now() + ms) })
    .where(and(eq(driveMappings.id, mappingId), eq(driveMappings.leaseOwner, owner)));
}

async function releaseLease(mappingId: string, owner: string) {
  await db
    .update(driveMappings)
    .set({ leaseUntil: null, leaseOwner: null })
    .where(and(eq(driveMappings.id, mappingId), eq(driveMappings.leaseOwner, owner)));
}

/* ------------------------------------------------------------------ *
 * Account-cursor
 * ------------------------------------------------------------------ */

export async function getAccountCursor() {
  const [row] = await db
    .select()
    .from(driveMappings)
    .where(and(eq(driveMappings.entityType, ACCOUNT_ENTITY), eq(driveMappings.folderId, ACCOUNT_FOLDER)))
    .limit(1);
  return row ?? null;
}

/**
 * Maakt de account-cursor aan als die nog niet bestaat. Startpunt = de OUDSTE
 * cursor van de klantmappen, zodat de achterstand sinds de laatste geslaagde
 * run alsnog wordt ingehaald. Pas als er niets is, starten we "vanaf nu".
 */
export async function ensureAccountCursor() {
  const existing = await getAccountCursor();
  if (existing?.pageToken) return existing;

  const tokens = (
    await db
      .select({ pageToken: driveMappings.pageToken })
      .from(driveMappings)
      .where(and(eq(driveMappings.entityType, "client"), isNotNull(driveMappings.pageToken)))
  )
    .map((r) => r.pageToken!)
    .filter((t) => /^\d+$/.test(t))
    .sort((a, b) => Number(a) - Number(b));
  const start = tokens[0] ?? (await drive.startPageToken());

  if (existing) {
    await db.update(driveMappings).set({ pageToken: start }).where(eq(driveMappings.id, existing.id));
  } else {
    await db
      .insert(driveMappings)
      .values({ entityType: ACCOUNT_ENTITY, folderId: ACCOUNT_FOLDER, folderName: "Drive changes-feed", pageToken: start })
      .onConflictDoNothing();
  }
  return (await getAccountCursor())!;
}

/* ------------------------------------------------------------------ *
 * Mapstructuur: welke Drive-map hoort bij welke klant, met welk pad.
 * ------------------------------------------------------------------ */

type FolderInfo = { clientId: string; path: string };
export type FolderIndex = Map<string, FolderInfo>;

export async function loadFolderIndex(): Promise<{ index: FolderIndex; roots: Set<string> }> {
  const index: FolderIndex = new Map();
  const roots = new Set<string>();
  const folderRows = await db
    .select({ externalId: files.externalId, clientId: files.clientId, path: files.path })
    .from(files)
    .where(
      and(
        eq(files.source, "google_drive"),
        eq(files.isFolder, true),
        isNull(files.deletedAt),
        isNotNull(files.clientId),
        isNotNull(files.path),
      ),
    );
  for (const f of folderRows) {
    if (f.externalId && f.clientId && f.path) index.set(f.externalId, { clientId: f.clientId, path: f.path });
  }
  // Klant-hoofdmappen als laatste: die winnen altijd.
  const mappings = await db
    .select({ folderId: driveMappings.folderId, entityId: driveMappings.entityId })
    .from(driveMappings)
    .where(and(eq(driveMappings.entityType, "client"), isNotNull(driveMappings.entityId)));
  for (const m of mappings) {
    index.set(m.folderId, { clientId: m.entityId!, path: "" });
    roots.add(m.folderId);
  }
  return { index, roots };
}

type FileRow = typeof files.$inferSelect;

async function findByExternalId(externalId: string): Promise<FileRow | null> {
  const rows = await db
    .select()
    .from(files)
    .where(and(eq(files.source, "google_drive"), eq(files.externalId, externalId)))
    .orderBy(sql`${files.deletedAt} is not null`, asc(files.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

/** Markeert een bestand (en bij een map: alles eronder) als verwijderd. */
async function softDeleteTree(row: FileRow, index: FolderIndex) {
  const now = new Date();
  await db.update(files).set({ deletedAt: now, lastSyncedAt: now }).where(eq(files.id, row.id));
  if (row.isFolder && row.clientId && row.path) {
    const descendants = await db
      .update(files)
      .set({ deletedAt: now, lastSyncedAt: now })
      .where(
        and(
          eq(files.source, "google_drive"),
          eq(files.clientId, row.clientId),
          isNull(files.deletedAt),
          sql`${files.path} like ${likePrefix(row.path)}`,
        ),
      )
      .returning({ externalId: files.externalId });
    for (const d of descendants) if (d.externalId) index.delete(d.externalId);
  }
  if (row.externalId) index.delete(row.externalId);
}

/** Map verplaatst of hernoemd: paden (en evt. klant) van alles eronder bijwerken. */
async function moveDescendants(
  oldClientId: string,
  oldPath: string,
  newClientId: string,
  newPath: string,
  index: FolderIndex,
) {
  const rows = await db
    .select({ id: files.id, path: files.path, externalId: files.externalId, isFolder: files.isFolder })
    .from(files)
    .where(
      and(
        eq(files.source, "google_drive"),
        eq(files.clientId, oldClientId),
        isNull(files.deletedAt),
        sql`${files.path} like ${likePrefix(oldPath)}`,
      ),
    );
  for (const r of rows) {
    const path = newPath + r.path!.slice(oldPath.length);
    await db
      .update(files)
      .set({ clientId: newClientId, path, category: categoryFromPath(path), lastSyncedAt: new Date() })
      .where(eq(files.id, r.id));
    if (r.isFolder && r.externalId) index.set(r.externalId, { clientId: newClientId, path });
  }
}

export type ChangeOutcome = "created" | "updated" | "deleted" | "ignored" | "unresolved";

/**
 * Onbekende bovenliggende map: navragen bij Drive en omhoog lopen tot een
 * bekende klantmap. Gevonden → de tussenliggende mappen worden vastgelegd
 * (met pad), zodat ook diepe submappen kloppen. Niet gevonden → de map ligt
 * echt buiten de klantmappen. Resultaten worden per run onthouden.
 */
export type ParentResolver = (parentId: string, index: FolderIndex) => Promise<FolderInfo | null>;

export function createParentResolver(service: DriveService = drive): ParentResolver {
  const outside = new Set<string>();
  return async (parentId, index) => {
    const chain: DriveFile[] = [];
    let current: string | undefined = parentId;
    for (let depth = 0; current && depth < 15; depth++) {
      const known = index.get(current);
      if (known) {
        // Van boven naar beneden vastleggen.
        let info = known;
        for (const folderFile of chain.reverse()) {
          const path = `${info.path}/${folderFile.name}`;
          info = { clientId: info.clientId, path };
          await upsertFolderRow(folderFile, info);
          index.set(folderFile.id, info);
        }
        return index.get(parentId) ?? null;
      }
      if (outside.has(current)) break;
      let meta: DriveFile;
      try {
        meta = await service.getFile(current);
      } catch (error) {
        // Geen toegang of niet (meer) bestaand = buiten de klantmappen.
        const status = (error as { status?: number }).status;
        if (status === 404 || status === 403) break;
        throw error;
      }
      if (meta.trashed) break;
      chain.push(meta);
      current = meta.parents?.[0];
    }
    for (const c of chain) outside.add(c.id);
    outside.add(parentId);
    return null;
  };
}

async function upsertFolderRow(folderFile: DriveFile, info: FolderInfo) {
  const values = {
    clientId: info.clientId,
    name: folderFile.name,
    mimeType: FOLDER_MIME,
    externalUrl: folderFile.webViewLink ?? null,
    category: categoryFromPath(info.path),
    path: info.path,
    parentExternalId: folderFile.parents?.[0] ?? null,
    isFolder: true,
    modifiedAt: folderFile.modifiedTime ? new Date(folderFile.modifiedTime) : null,
    lastSyncedAt: new Date(),
    deletedAt: null,
  };
  const existing = await findByExternalId(folderFile.id);
  if (existing) await db.update(files).set(values).where(eq(files.id, existing.id));
  else await db.insert(files).values({ ...values, source: "google_drive", externalId: folderFile.id });
}

/**
 * Verwerkt één wijziging uit de changes-feed. Idempotent: dezelfde wijziging
 * twee keer verwerken geeft hetzelfde resultaat (geen dubbele bestanden).
 */
export async function applyDriveChange(
  change: { fileId: string; removed: boolean; file?: DriveFile },
  index: FolderIndex,
  roots: Set<string>,
  resolveParent?: ParentResolver,
): Promise<ChangeOutcome> {
  const file = change.file;

  if (change.removed || file?.trashed) {
    const existing = await findByExternalId(change.fileId);
    if (!existing || existing.deletedAt) return "ignored";
    await softDeleteTree(existing, index);
    return "deleted";
  }
  if (!file) return "ignored";
  // De klant-hoofdmap zelf staat niet in `files`.
  if (roots.has(file.id)) return "ignored";

  const parentId = file.parents?.[0];
  let parent = parentId ? index.get(parentId) : undefined;
  if (!parent && parentId) {
    // Eerst de rest van de pagina verwerken (de map kan erin zitten); pas
    // daarna bij Drive navragen.
    if (!resolveParent) return "unresolved";
    parent = (await resolveParent(parentId, index)) ?? undefined;
  }
  const existing = await findByExternalId(file.id);

  if (!parent) {
    // Zeker weten buiten de klantmappen (Drive bevestigd): eruit verplaatst.
    if (existing && !existing.deletedAt) {
      await softDeleteTree(existing, index);
      return "deleted";
    }
    return "ignored";
  }

  const path = `${parent.path}/${file.name}`;
  const isFolder = file.mimeType === FOLDER_MIME;
  const values = {
    clientId: parent.clientId,
    name: file.name,
    mimeType: file.mimeType,
    sizeBytes: file.size ?? null,
    externalUrl: file.webViewLink ?? null,
    category: categoryFromPath(path),
    path,
    parentExternalId: parentId ?? null,
    isFolder,
    modifiedAt: file.modifiedTime ? new Date(file.modifiedTime) : null,
    lastSyncedAt: new Date(),
    deletedAt: null,
  };

  if (existing) {
    const moved = existing.path !== path || existing.clientId !== parent.clientId;
    await db.update(files).set(values).where(eq(files.id, existing.id));
    if (isFolder && moved && existing.path && existing.clientId) {
      await moveDescendants(existing.clientId, existing.path, parent.clientId, path, index);
    }
    if (isFolder) index.set(file.id, { clientId: parent.clientId, path });
    return "updated";
  }

  await db.insert(files).values({ ...values, source: "google_drive", externalId: file.id });
  if (isFolder) index.set(file.id, { clientId: parent.clientId, path });
  return "created";
}

/** Verwerkt een pagina wijzigingen; onopgeloste (ouder nog onbekend) opnieuw na de rest. */
async function applyPage(
  changes: Array<{ fileId: string; removed: boolean; file?: DriveFile }>,
  index: FolderIndex,
  roots: Set<string>,
  ctx: JobContext,
  resolveParent: ParentResolver,
) {
  let pending = changes;
  for (let pass = 0; pass < 4 && pending.length > 0; pass++) {
    const retry: typeof pending = [];
    // Laatste ronde: onbekende mappen bij Drive navragen.
    const lookup = pass === 3 ? resolveParent : undefined;
    for (const change of pending) {
      const outcome = await applyDriveChange(change, index, roots, lookup);
      if (outcome === "unresolved") {
        retry.push(change);
        continue;
      }
      ctx.counters.processed++;
      if (outcome === "created") ctx.counters.created++;
      if (outcome === "updated" || outcome === "deleted") ctx.counters.updated++;
    }
    if (retry.length === pending.length && pass < 3) {
      // Geen voortgang meer binnen de pagina: direct naar de navraagronde.
      pass = 2;
    }
    pending = retry;
  }
}

/* ------------------------------------------------------------------ *
 * Gezondheidsregistratie (voor de statuspagina en meldingen)
 * ------------------------------------------------------------------ */

async function recordHeartbeat(ok: boolean, message?: string) {
  await ensureConnectionRow("google_drive");
  const now = new Date();
  await db
    .update(integrationConnections)
    .set(
      ok
        ? { lastCheckedAt: now, lastSyncAt: now, status: "connected", errorCount: 0, updatedAt: now }
        : {
            lastCheckedAt: now,
            lastErrorAt: now,
            lastErrorMessage: message ?? null,
            // errorCount = aantal OPEENVOLGENDE mislukte runs.
            errorCount: sql`${integrationConnections.errorCount} + 1`,
            updatedAt: now,
          },
    )
    .where(eq(integrationConnections.provider, "google_drive"));
}

/* ------------------------------------------------------------------ *
 * Incrementele synchronisatie (elke 2 minuten)
 * ------------------------------------------------------------------ */

export type DriveSyncResult = {
  ok: boolean;
  skipped?: "not_configured" | "already_running";
  changes: number;
  created: number;
  updated: number;
  caughtUp: boolean;
  error?: string;
  jobId?: string;
};

export async function processDriveChanges(
  options: { budgetMs?: number; trigger?: string; triggeredById?: string } = {},
): Promise<DriveSyncResult> {
  const budgetMs = options.budgetMs ?? 100_000;
  const empty = { changes: 0, created: 0, updated: 0, caughtUp: false };
  if (!drive.isConfigured) return { ok: false, skipped: "not_configured", ...empty };

  let cursor;
  try {
    cursor = await ensureAccountCursor();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordHeartbeat(false, message);
    return { ok: false, error: message, ...empty };
  }

  const owner = randomBytes(8).toString("hex");
  if (!(await acquireLease(cursor.id, owner, budgetMs + 60_000))) {
    return { ok: true, skipped: "already_running", ...empty };
  }

  const started = Date.now();
  try {
    // Eerst kijken óf er iets is: dan hoeft er geen joblog te komen.
    let first;
    try {
      first = await drive.changes(cursor.pageToken!);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await recordHeartbeat(false, message);
      return { ok: false, error: message, ...empty };
    }

    if (first.changes.length === 0 && !first.nextPageToken) {
      const now = new Date();
      await db
        .update(driveMappings)
        .set({ pageToken: first.newStartPageToken ?? cursor.pageToken, lastSyncedAt: now, lastError: null })
        .where(eq(driveMappings.id, cursor.id));
      await recordHeartbeat(true);
      return { ok: true, ...empty, caughtUp: true };
    }

    let caughtUp = false;
    const result = await runJob(
      "google_drive",
      "drive.sync_changes",
      { trigger: options.trigger ?? "cron" },
      async (ctx) => {
        const { index, roots } = await loadFolderIndex();
        const resolveParent = createParentResolver();
        let page = first;
        let pages = 0;
        for (;;) {
          await applyPage(page.changes, index, roots, ctx, resolveParent);
          pages++;
          const next = page.nextPageToken ?? page.newStartPageToken;
          // Cursor pas ná volledige verwerking van de pagina opschuiven.
          if (next) {
            await db.update(driveMappings).set({ pageToken: next }).where(eq(driveMappings.id, cursor.id));
          }
          if (!page.nextPageToken) {
            caughtUp = true;
            break;
          }
          if (Date.now() - started >= budgetMs) {
            ctx.log("Tijdbudget bereikt; de volgende run gaat verder waar deze stopte.", "warn");
            break;
          }
          await extendLease(cursor.id, owner, budgetMs + 60_000);
          page = await drive.changes(page.nextPageToken);
        }
        ctx.log(`${pages} pagina('s) verwerkt${caughtUp ? ", volledig bij" : ", achterstand loopt nog"}.`);
        const now = new Date();
        await db.update(driveMappings).set({ lastSyncedAt: now, lastError: null }).where(eq(driveMappings.id, cursor.id));
        if (caughtUp) {
          await db
            .update(driveMappings)
            .set({ lastSyncedAt: now })
            .where(eq(driveMappings.entityType, "client"));
        }
      },
      { triggeredById: options.triggeredById, notify: false },
    );

    await recordHeartbeat(result.ok, result.error);
    if (!result.ok) {
      await db
        .update(driveMappings)
        .set({ lastError: result.error ?? "onbekende fout", lastErrorAt: new Date() })
        .where(eq(driveMappings.id, cursor.id));
    }
    const [job] = await db.execute(sql`select items_processed, items_created, items_updated from sync_jobs where id = ${result.jobId}`).then(
      (r) => ((r as unknown as { rows?: unknown[] }).rows ?? (r as unknown as unknown[])) as Array<{ items_processed: number; items_created: number; items_updated: number }>,
    );
    return {
      ok: result.ok,
      error: result.error,
      jobId: result.jobId,
      changes: job?.items_processed ?? 0,
      created: job?.items_created ?? 0,
      updated: job?.items_updated ?? 0,
      caughtUp,
    };
  } finally {
    await releaseLease(cursor.id, owner);
  }
}

/* ------------------------------------------------------------------ *
 * Vangnet: volledige controle van klantmappen
 * ------------------------------------------------------------------ */

const RECONCILE_MAX_DEPTH = 8;
const LIST_CAP = 2000;

/** Loopt een klantmap volledig door. `complete` = false als er iets is afgekapt. */
async function walkComplete(rootId: string, service: DriveService = drive) {
  const out: Array<DriveFile & { path: string }> = [];
  let complete = true;
  const queue: Array<{ id: string; depth: number; path: string }> = [{ id: rootId, depth: 0, path: "" }];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = await service.listFolder(current.id);
    if (children.length >= LIST_CAP) complete = false;
    for (const child of children) {
      const path = `${current.path}/${child.name}`;
      out.push({ ...child, path });
      if (child.mimeType === FOLDER_MIME) {
        if (current.depth + 1 <= RECONCILE_MAX_DEPTH) queue.push({ id: child.id, depth: current.depth + 1, path });
        else complete = false;
      }
    }
  }
  return { entries: out, complete };
}

async function upsertEntries(clientId: string, entries: Array<DriveFile & { path: string }>, ctx: JobContext) {
  const ids = entries.map((e) => e.id);
  const existing = new Map<string, FileRow>();
  for (let i = 0; i < ids.length; i += 300) {
    const rows = await db
      .select()
      .from(files)
      .where(and(eq(files.source, "google_drive"), inArray(files.externalId, ids.slice(i, i + 300))));
    for (const r of rows) {
      const prev = r.externalId ? existing.get(r.externalId) : undefined;
      // Bij (historische) dubbelen de levende, oudste rij aanhouden.
      if (r.externalId && (!prev || (prev.deletedAt && !r.deletedAt))) existing.set(r.externalId, r);
    }
  }
  const toInsert: (typeof files.$inferInsert)[] = [];
  for (const e of entries) {
    ctx.counters.processed++;
    const values = {
      clientId,
      name: e.name,
      mimeType: e.mimeType,
      sizeBytes: e.size ?? null,
      externalUrl: e.webViewLink ?? null,
      category: categoryFromPath(e.path),
      path: e.path,
      parentExternalId: e.parents?.[0] ?? null,
      isFolder: e.mimeType === FOLDER_MIME,
      modifiedAt: e.modifiedTime ? new Date(e.modifiedTime) : null,
      lastSyncedAt: new Date(),
      deletedAt: null,
    };
    const row = existing.get(e.id);
    if (!row) {
      toInsert.push({ ...values, source: "google_drive", externalId: e.id });
      continue;
    }
    const changed =
      row.clientId !== values.clientId ||
      row.name !== values.name ||
      row.path !== values.path ||
      row.category !== values.category ||
      row.parentExternalId !== values.parentExternalId ||
      row.deletedAt !== null ||
      (row.modifiedAt?.getTime() ?? null) !== (values.modifiedAt?.getTime() ?? null) ||
      row.externalUrl !== values.externalUrl;
    if (changed) {
      await db.update(files).set(values).where(eq(files.id, row.id));
      ctx.counters.updated++;
    }
  }
  for (let i = 0; i < toInsert.length; i += 200) {
    await db.insert(files).values(toInsert.slice(i, i + 200));
    ctx.counters.created += Math.min(200, toInsert.length - i);
  }
}

/**
 * Loopt de klantmappen die het langst niet volledig gecontroleerd zijn door
 * en zet de database gelijk aan Drive (nieuw, gewijzigd, verplaatst,
 * verwijderd). Werkt per klant, met tijdbudget en lease per map.
 */
export async function reconcileDriveFolders(
  options: { budgetMs?: number; maxClients?: number; clientId?: string } = {},
) {
  const budgetMs = options.budgetMs ?? 200_000;
  if (!drive.isConfigured) return { ok: false, skipped: "not_configured" as const };

  const mappings = await db
    .select()
    .from(driveMappings)
    .where(
      and(
        eq(driveMappings.entityType, "client"),
        isNotNull(driveMappings.entityId),
        options.clientId ? eq(driveMappings.entityId, options.clientId) : undefined,
      ),
    )
    .orderBy(sql`${driveMappings.lastFullSyncAt} asc nulls first`);

  // Per klant groeperen: een klant kan (zelden) meerdere gekoppelde mappen hebben.
  const byClient = new Map<string, typeof mappings>();
  for (const m of mappings) {
    const list = byClient.get(m.entityId!) ?? [];
    list.push(m);
    byClient.set(m.entityId!, list);
  }

  const started = Date.now();
  const owner = randomBytes(8).toString("hex");
  let done = 0;
  const failures: string[] = [];

  for (const [clientId, group] of byClient) {
    if (options.maxClients && done >= options.maxClients) break;
    if (Date.now() - started > budgetMs) break;

    const leased: string[] = [];
    for (const m of group) if (await acquireLease(m.id, owner, 10 * 60_000)) leased.push(m.id);
    if (leased.length !== group.length) {
      for (const id of leased) await releaseLease(id, owner);
      continue;
    }

    const res = await runJob(
      "google_drive",
      "drive.reconcile_client",
      { clientId, folders: group.map((m) => m.folderId) },
      async (ctx) => {
        const seen = new Set<string>();
        let complete = true;
        for (const m of group) {
          const walk = await walkComplete(m.folderId);
          complete &&= walk.complete;
          await upsertEntries(clientId, walk.entries, ctx);
          for (const e of walk.entries) seen.add(e.id);
        }
        if (!complete) {
          ctx.log("Map te groot of te diep om volledig te controleren; verwijderingen overgeslagen.", "warn");
          return;
        }
        // Wat in de database bij deze klant staat maar niet meer in Drive: markeren.
        const live = await db
          .select({ id: files.id, externalId: files.externalId })
          .from(files)
          .where(and(eq(files.source, "google_drive"), eq(files.clientId, clientId), isNull(files.deletedAt)));
        const gone = live.filter((r) => r.externalId && !seen.has(r.externalId)).map((r) => r.id);
        for (let i = 0; i < gone.length; i += 300) {
          await db.update(files).set({ deletedAt: new Date() }).where(inArray(files.id, gone.slice(i, i + 300)));
        }
        ctx.counters.updated += gone.length;
        if (gone.length) ctx.log(`${gone.length} bestand(en) niet meer in Drive gevonden en als verwijderd gemarkeerd.`);
      },
      { notify: false, scopeType: "client", scopeId: clientId },
    );

    const now = new Date();
    for (const m of group) {
      await db
        .update(driveMappings)
        .set(
          res.ok
            ? { lastFullSyncAt: now, lastError: null, leaseUntil: null, leaseOwner: null }
            : { lastError: res.error ?? "onbekende fout", lastErrorAt: now, leaseUntil: null, leaseOwner: null },
        )
        .where(eq(driveMappings.id, m.id));
    }
    if (!res.ok) failures.push(clientId);
    done++;
  }

  return { ok: failures.length === 0, reconciled: done, failed: failures.length, remaining: byClient.size - done };
}

/* ------------------------------------------------------------------ *
 * Eerste koppeling van een klantmap
 * ------------------------------------------------------------------ */

/**
 * Koppelt een klantmap en leest alle bestanden in. Daarna houdt de
 * account-brede changes-feed de map automatisch bij.
 */
export async function syncClientDriveFolder(clientId: string, folderId: string, triggeredById?: string) {
  const [existingMapping] = await db
    .select({ id: driveMappings.id })
    .from(driveMappings)
    .where(and(eq(driveMappings.entityType, "client"), eq(driveMappings.folderId, folderId)))
    .limit(1);
  if (existingMapping) {
    await db.update(driveMappings).set({ entityId: clientId }).where(eq(driveMappings.id, existingMapping.id));
  } else {
    await db.insert(driveMappings).values({ entityType: "client", entityId: clientId, folderId, lastSyncedAt: new Date() });
  }
  // Zorg dat de changes-feed bestaat vóór de import, zodat niets tussen wal en schip valt.
  await ensureAccountCursor();
  const res = await reconcileDriveFolders({ clientId, budgetMs: 240_000 });
  return { jobId: "", ok: res.ok !== false, error: res.ok === false ? "Synchroniseren van de map is mislukt." : undefined, triggeredById };
}

/* ------------------------------------------------------------------ *
 * Compatibiliteit met bestaande aanroepen
 * ------------------------------------------------------------------ */

/** @deprecated Er is nog maar één cursor; verwerkt de account-brede wijzigingen. */
export async function syncDriveChanges(_mappingId?: string) {
  void _mappingId;
  const r = await processDriveChanges({ trigger: "webhook", budgetMs: 60_000 });
  return { jobId: r.jobId ?? "", ok: r.ok, error: r.error };
}

/** Nachtrun: korte inhaalslag van de feed (het echte werk gebeurt elke 2 minuten). */
export async function runDriveSync() {
  const changes = await processDriveChanges({ trigger: "nightly", budgetMs: 45_000 });
  return { ok: changes.ok, changes };
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
