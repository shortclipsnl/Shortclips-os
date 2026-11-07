import "server-only";
import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clientIntegrations, clients, frameAssets, productionDays } from "@/db/schema";
import { frameio, type FrameFile, type FrameProject } from "@/server/integrations/frameio";
import { normalizeName } from "@/server/import";
import { aliasesForSlug } from "@/server/integrations/client-aliases";
import { runJob, type JobContext } from "./runner";
import { signedUrlExpiry } from "@/lib/frame-url";

/**
 * Frame.io-bibliotheek voor het klantportaal.
 *
 * Per gekoppelde klant lopen we het Frame.io-project door en leggen we elke
 * video vast in `frame_assets`, met de opnamesessie (map) waar hij in staat.
 * Opbouw in Frame bij Shortclips: project → (jaarmap) → "SESSIE 3 - 24 APRIL" →
 * video's, soms met submappen (bijv. "AD - VERKORTE VERSIES"). Foto's, PDF's en
 * mappen zonder video's worden genegeerd. Alleen echte Frame-gegevens; niets
 * wordt verzonnen. Klantscheiding: een project wordt alleen automatisch aan een
 * klant gekoppeld bij precies één naamgenoot (naam, slug of bekende alias).
 */

export type FrameLibrarySource = {
  isConfigured: boolean;
  listProjects(): Promise<FrameProject[]>;
  listFolderChildrenAll(folderId: string, opts?: { metadata?: boolean }): Promise<FrameFile[]>;
  getFileThumbnail(fileId: string): Promise<string | null>;
};

/** Thumbnails vooraf verversen (ze verlopen na ongeveer een dag), zodat de
 *  videopagina direct beelden toont. Begrensd per run. */
async function refreshThumbnails(source: FrameLibrarySource, ctx: JobContext, budget = 400) {
  const rows = await db
    .select({ id: frameAssets.id, mediaFileId: frameAssets.mediaFileId, thumbnailUrl: frameAssets.thumbnailUrl })
    .from(frameAssets)
    .where(isNull(frameAssets.deletedAt))
    .orderBy(sql`${frameAssets.sessionCreatedAt} desc nulls last`);
  const soon = Date.now() + 6 * 3_600_000;
  const todo = rows.filter((r) => signedUrlExpiry(r.thumbnailUrl) < soon).slice(0, budget);
  let ok = 0;
  for (let i = 0; i < todo.length; i += 8) {
    await Promise.all(
      todo.slice(i, i + 8).map(async (r) => {
        try {
          const url = await source.getFileThumbnail(r.mediaFileId);
          if (url) { await db.update(frameAssets).set({ thumbnailUrl: url }).where(eq(frameAssets.id, r.id)); ok++; }
        } catch {
          /* volgende run opnieuw */
        }
      }),
    );
  }
  ctx.log(`${ok} van ${todo.length} thumbnails ververst.`);
}

/** Mapnamen die alleen een jaartal (of "Archief 2025") zijn, slaan we over als
 *  sessieniveau: de sessie is de map daaronder. */
function isYearFolder(name: string): boolean {
  return /^\s*(archief\s*)?(19|20)\d{2}\s*$/i.test(name);
}

function isVideo(file: FrameFile): boolean {
  if (file.type === "folder" || file.type === "version_stack") return false;
  if (file.media_type) return file.media_type.toLowerCase().startsWith("video");
  return /\.(mp4|mov|m4v|webm|avi|mkv|mpg|mpeg)$/i.test(file.name ?? "");
}

type Meta = Array<{ field_definition_name?: string; value?: unknown }>;
function metaNumber(file: FrameFile, field: string): number | null {
  const md = (file as unknown as { metadata?: Meta }).metadata;
  const hit = md?.find((m) => m.field_definition_name === field);
  const n = Number(hit?.value);
  return Number.isFinite(n) ? n : null;
}

function toDate(raw?: string): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

type Found = {
  file: FrameFile; // het afspeelbare bestand (head-versie bij een stack)
  identity: FrameFile; // het item zoals het in de map staat (file of stack)
  versionCount: number;
  session: FrameFile | null;
  subfolder: string | null;
};

/**
 * Frame.io begrenst het aantal aanvragen (HTTP 429). Alle mapaanvragen lopen
 * daarom via één rem: max. 3 tegelijk, ~6 per seconde, en bij 429 opnieuw
 * proberen met oplopende wachttijd.
 */
function throttled(source: FrameLibrarySource): FrameLibrarySource {
  let active = 0;
  let last = 0;
  const acquire = () =>
    new Promise<void>((resolve) => {
      const tryGo = () => {
        const wait = Math.max(0, last + 170 - Date.now());
        if (active < 3 && wait === 0) { active++; last = Date.now(); resolve(); }
        else setTimeout(tryGo, Math.max(wait, 40));
      };
      tryGo();
    });
  const release = () => { active--; };
  async function call<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      await acquire();
      try {
        return await fn();
      } catch (e) {
        const status = (e as { status?: number }).status;
        if (status !== 429 || attempt >= 5) throw e;
        await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
      } finally {
        release();
      }
    }
  }
  return {
    isConfigured: source.isConfigured,
    listProjects: () => call(() => source.listProjects()),
    listFolderChildrenAll: (id, opts) => call(() => source.listFolderChildrenAll(id, opts)),
    getFileThumbnail: (id) => call(() => source.getFileThumbnail(id)),
  };
}

/** Voert taken uit met maximaal `limit` tegelijk. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++]!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/**
 * Loopt een project door (laag voor laag, mappen parallel) en verzamelt alle
 * video's met hun sessie. `complete` is false als een map niet te lezen was;
 * dan archiveren we niets, zodat een tijdelijke fout geen video's laat
 * verdwijnen.
 */
async function collect(
  source: FrameLibrarySource,
  rootFolderId: string,
  ctx: JobContext,
  known: Map<string, number>,
  full: boolean,
): Promise<{ found: Found[]; complete: boolean; skippedSessions: string[] }> {
  const found: Found[] = [];
  const skippedSessions: string[] = [];
  let complete = true;
  let folders = 0;
  type Job = { id: string; session: FrameFile | null; path: string[]; depth: number };
  let level: Job[] = [{ id: rootFolderId, session: null, path: [], depth: 0 }];

  while (level.length && folders < 400) {
    const next: Job[] = [];
    folders += level.length;
    await pool(level, 6, async (job) => {
      let children: FrameFile[] = [];
      try {
        children = await source.listFolderChildrenAll(job.id, { metadata: true });
      } catch (e) {
        complete = false;
        ctx.log(`Map ${job.id} niet leesbaar: ${String(e).slice(0, 160)}`, "warn");
        return;
      }
      const sub = job.path.length ? job.path.join(" / ") : null;
      for (const c of children) {
        if (c.type === "folder") {
          if (job.depth >= 6) continue;
          const name = (c.name ?? "").trim();
          if (!job.session && isYearFolder(name)) next.push({ id: c.id, session: null, path: [], depth: job.depth + 1 });
          else if (!job.session) {
            // Incrementeel: een sessiemap die sinds de vorige ronde niet is
            // gewijzigd, hoeven we niet opnieuw door te lopen.
            const prev = known.get(c.id);
            const upd = toDate(c.updated_at)?.getTime() ?? null;
            if (!full && prev != null && upd != null && upd <= prev) skippedSessions.push(c.id);
            else next.push({ id: c.id, session: c, path: [], depth: job.depth + 1 });
          }
          else next.push({ id: c.id, session: job.session, path: [...job.path, name], depth: job.depth + 1 });
        } else if (c.type === "version_stack") {
          const head = (c as unknown as { head_version?: FrameFile }).head_version;
          if (head && isVideo(head)) found.push({ file: head, identity: c, versionCount: 2, session: job.session, subfolder: sub });
        } else if (isVideo(c)) {
          found.push({ file: c, identity: c, versionCount: 1, session: job.session, subfolder: sub });
        }
      }
    });
    level = next;
  }
  if (level.length) complete = false;
  return { found, complete, skippedSessions };
}

/**
 * Koppelt Frame.io-projecten aan klanten (alleen bij precies één naamgenoot)
 * en geeft per klant het project terug. Handmatige koppelingen blijven staan.
 */
async function linkProjects(source: FrameLibrarySource, ctx: JobContext): Promise<FrameProject[]> {
  const projects = await source.listProjects();
  ctx.log(`${projects.length} Frame.io-projecten gevonden`);
  const clientRows = await db
    .select({ id: clients.id, name: clients.name, slug: clients.slug })
    .from(clients)
    .where(isNull(clients.deletedAt));
  const existing = await db
    .select({ clientId: clientIntegrations.clientId, externalId: clientIntegrations.externalId })
    .from(clientIntegrations)
    .where(eq(clientIntegrations.provider, "frameio"));
  const linkedProjectIds = new Set(existing.map((e) => e.externalId));

  for (const project of projects) {
    if (linkedProjectIds.has(project.id)) continue;
    const n = normalizeName(project.name ?? "");
    if (!n) continue;
    const hits = clientRows.filter(
      (c) => normalizeName(c.name) === n || normalizeName(c.slug) === n || aliasesForSlug(c.slug).some((a) => normalizeName(a) === n),
    );
    if (hits.length !== 1) {
      ctx.log(`Project "${project.name.trim()}": ${hits.length === 0 ? "geen klant gevonden" : "meerdere mogelijke klanten"}, niet gekoppeld.`, "warn");
      continue;
    }
    await db
      .insert(clientIntegrations)
      .values({
        clientId: hits[0]!.id,
        provider: "frameio",
        externalId: project.id,
        externalName: project.name.trim(),
        config: { rootFolderId: project.root_folder_id ?? null },
        lastSyncedAt: new Date(),
      })
      .onConflictDoNothing();
    linkedProjectIds.add(project.id);
    ctx.log(`Project "${project.name.trim()}" gekoppeld aan ${hits[0]!.name}.`);
  }
  return projects;
}

const MONTHS: Record<string, number> = {
  jan: 1, januari: 1, feb: 2, februari: 2, mrt: 3, maart: 3, apr: 4, april: 4, mei: 5, jun: 6, juni: 6,
  jul: 7, juli: 7, aug: 8, augustus: 8, sep: 9, sept: 9, september: 9, okt: 10, oktober: 10, nov: 11, november: 11, dec: 12, december: 12,
};

/** "SESSIE 1 - 6 MAART" → YYYY-MM-DD (jaar uit de aanmaakdatum van de map). */
export function dateFromSessionName(name: string, createdAt: Date | null): string | null {
  const m = name.toLowerCase().match(/\b(\d{1,2})\s*[-\s]?\s*(jan(?:uari)?|feb(?:ruari)?|mrt|maart|apr(?:il)?|mei|jun(?:i)?|jul(?:i)?|aug(?:ustus)?|sept?(?:ember)?|okt(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = MONTHS[m[2]!];
  if (!month || day < 1 || day > 31) return null;
  const ref = createdAt ?? new Date();
  let year = ref.getUTCFullYear();
  // Map in januari aangemaakt voor een opname in december → vorig jaar.
  if (month > ref.getUTCMonth() + 2) year -= 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Koppelt elke sessiemap aan de opnamedag van die klant: eerst via een datum in
 * de mapnaam, anders de laatste opname in de 45 dagen vóór het aanmaken van de
 * map (alleen als die nog niet aan een andere sessie hangt). Geen match = geen
 * koppeling; dan toont het portaal ook geen status (nooit gokken).
 */
async function linkSessionsToShoots(clientId: string, sessions: Array<{ id: string; name: string; createdAt: Date | null }>, alreadyUsed: string[] = []) {
  const days = await db
    .select({ id: productionDays.id, on: productionDays.scheduledOn })
    .from(productionDays)
    .where(and(eq(productionDays.clientId, clientId), isNull(productionDays.deletedAt)));
  const result = new Map<string, string>();
  const used = new Set<string>(alreadyUsed);
  const sorted = [...sessions].sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
  // 1) expliciete datum in de mapnaam
  for (const s of sorted) {
    const iso = dateFromSessionName(s.name, s.createdAt);
    if (!iso) continue;
    const hit = days.find((d) => d.on === iso);
    if (hit && !used.has(hit.id)) { result.set(s.id, hit.id); used.add(hit.id); }
  }
  // 2) dichtstbijzijnde eerdere opname
  for (const s of sorted) {
    if (result.has(s.id) || !s.createdAt) continue;
    const created = s.createdAt.toISOString().slice(0, 10);
    const floor = new Date(s.createdAt.getTime() - 45 * 86_400_000).toISOString().slice(0, 10);
    const cands = days.filter((d) => d.on <= created && d.on >= floor && !used.has(d.id)).sort((a, b) => b.on.localeCompare(a.on));
    if (cands[0]) { result.set(s.id, cands[0].id); used.add(cands[0].id); }
  }
  return result;
}

export async function syncFrameLibrary(triggeredById?: string, rawSource: FrameLibrarySource = frameio, opts: { full?: boolean } = {}) {
  const source = throttled(rawSource);
  const full = opts.full ?? false;
  return runJob(
    "frameio",
    "frameio.sync_library",
    { full },
    async (ctx) => {
      const projects = await linkProjects(source, ctx);
      const byId = new Map(projects.map((p) => [p.id, p]));
      const links = await db
        .select({ clientId: clientIntegrations.clientId, projectId: clientIntegrations.externalId, config: clientIntegrations.config })
        .from(clientIntegrations)
        .where(and(eq(clientIntegrations.provider, "frameio"), eq(clientIntegrations.isActive, true)));

      await pool(links, 4, async (link) => {
        const project = byId.get(link.projectId);
        const root = project?.root_folder_id ?? ((link.config ?? {}) as { rootFolderId?: string | null }).rootFolderId ?? null;
        if (!root) {
          ctx.log(`Project ${link.projectId}: niet gevonden in Frame.io of geen hoofdmap.`, "warn");
          return;
        }
        const runStart = new Date();
        try {
          const knownRows = await db
            .select({ id: frameAssets.sessionFolderId, upd: sql<string | null>`max(${frameAssets.sessionUpdatedAt})::text` })
            .from(frameAssets)
            .where(and(eq(frameAssets.frameProjectId, link.projectId), isNull(frameAssets.deletedAt)))
            .groupBy(frameAssets.sessionFolderId);
          const known = new Map<string, number>();
          for (const k of knownRows) if (k.id && k.upd) known.set(k.id, new Date(k.upd).getTime());
          const { found: items, complete, skippedSessions } = await collect(source, root, ctx, known, full);
          // Ongewijzigde sessies: bestaande video's als "gezien" markeren.
          if (skippedSessions.length) {
            await db.update(frameAssets).set({ lastSeenAt: runStart })
              .where(and(eq(frameAssets.frameProjectId, link.projectId), inArray(frameAssets.sessionFolderId, skippedSessions), isNull(frameAssets.deletedAt)));
          }
          ctx.counters.processed += items.length;

          const sessions = new Map<string, { id: string; name: string; createdAt: Date | null }>();
          for (const it of items) if (it.session) sessions.set(it.session.id, { id: it.session.id, name: (it.session.name ?? "").trim(), createdAt: toDate(it.session.created_at) });
          const keptDays = skippedSessions.length
            ? (await db.selectDistinct({ d: frameAssets.sessionProductionDayId }).from(frameAssets)
                .where(and(eq(frameAssets.frameProjectId, link.projectId), inArray(frameAssets.sessionFolderId, skippedSessions)))).map((r) => r.d).filter((d): d is string => !!d)
            : [];
          const shootBySession = await linkSessionsToShoots(link.clientId, [...sessions.values()], keptDays);

          const allValues = items.map((it) => ({
            clientId: link.clientId,
            frameProjectId: link.projectId,
            frameFileId: it.identity.id,
            mediaFileId: it.file.id,
            name: (it.identity.name ?? it.file.name ?? "Video").trim().slice(0, 400),
            sessionFolderId: it.session?.id ?? null,
            sessionName: it.session ? (it.session.name ?? "").trim().slice(0, 240) : null,
            sessionViewUrl: it.session?.view_url ?? null,
            sessionCreatedAt: toDate(it.session?.created_at),
            sessionUpdatedAt: toDate(it.session?.updated_at),
            sessionProductionDayId: it.session ? (shootBySession.get(it.session.id) ?? null) : null,
            subfolderName: it.subfolder?.slice(0, 240) ?? null,
            viewUrl: it.identity.view_url ?? it.file.view_url ?? null,
            durationSeconds: (() => { const d = metaNumber(it.file, "Duration"); return d != null ? Math.round(d) : null; })(),
            commentCount: metaNumber(it.file, "Comment Count"),
            versionCount: it.versionCount,
            frameCreatedAt: toDate(it.identity.created_at),
            frameUpdatedAt: toDate(it.file.updated_at ?? it.identity.updated_at),
            lastSeenAt: runStart,
            deletedAt: null,
            updatedAt: new Date(),
          }));
          // Ontdubbelen op frameFileId (zelfde bestand kan via twee paden opduiken).
          const uniq = [...new Map(allValues.map((v) => [v.frameFileId, v])).values()];
          const ex = (col: string) => sql.raw(`excluded."${col}"`);
          for (let i = 0; i < uniq.length; i += 200) {
            const res = await db
              .insert(frameAssets)
              .values(uniq.slice(i, i + 200))
              .onConflictDoUpdate({
                target: frameAssets.frameFileId,
                set: {
                  clientId: ex("client_id"), frameProjectId: ex("frame_project_id"), mediaFileId: ex("media_file_id"), name: ex("name"),
                  sessionFolderId: ex("session_folder_id"), sessionName: ex("session_name"), sessionViewUrl: ex("session_view_url"),
                  sessionCreatedAt: ex("session_created_at"), sessionUpdatedAt: ex("session_updated_at"), sessionProductionDayId: ex("session_production_day_id"),
                  subfolderName: ex("subfolder_name"), viewUrl: ex("view_url"), durationSeconds: ex("duration_seconds"),
                  commentCount: ex("comment_count"), versionCount: ex("version_count"), frameCreatedAt: ex("frame_created_at"),
                  frameUpdatedAt: ex("frame_updated_at"), lastSeenAt: ex("last_seen_at"), deletedAt: sql`null`, updatedAt: sql`now()`,
                  // Wisselt de head-versie, dan is de oude thumbnail niet meer geldig.
                  thumbnailUrl: sql`case when ${frameAssets.mediaFileId} = excluded."media_file_id" then ${frameAssets.thumbnailUrl} else null end`,
                },
              })
              .returning({ created: sql<boolean>`(xmax = 0)` });
            for (const r of res) { if (r.created) ctx.counters.created++; else ctx.counters.updated++; }
          }

          // Niet meer in Frame gezien → archiveren (historie blijft bewaard).
          // Alleen na een volledige, foutloze ronde door het project.
          if (complete) await db
            .update(frameAssets)
            .set({ deletedAt: new Date() })
            .where(and(eq(frameAssets.frameProjectId, link.projectId), isNull(frameAssets.deletedAt), or(isNull(frameAssets.lastSeenAt), lt(frameAssets.lastSeenAt, runStart))));
          await db.update(clientIntegrations).set({ lastSyncedAt: new Date() }).where(and(eq(clientIntegrations.provider, "frameio"), eq(clientIntegrations.externalId, link.projectId)));
          ctx.log(`${project?.name?.trim() ?? link.projectId}: ${items.length} video's bijgewerkt in ${sessions.size} sessies${skippedSessions.length ? `, ${skippedSessions.length} ongewijzigd` : ""}.`);
        } catch (error) {
          ctx.counters.failed++;
          ctx.log(`Project ${link.projectId}: ${String(error).slice(0, 300)}`, "warn");
        }
      });
      await refreshThumbnails(source, ctx);
    },
    { triggeredById },
  );
}

/** Voor de diagnose/rapportage: welke klanten hebben (nog) geen Frame-project. */
export async function frameLibraryCoverage() {
  const rows = await db.execute(sql`
    select c.name, c.status::text status,
           (select count(*) from client_integrations ci where ci.client_id = c.id and ci.provider = 'frameio')::int projects,
           (select count(*) from frame_assets fa where fa.client_id = c.id and fa.deleted_at is null)::int videos
    from clients c where c.deleted_at is null order by c.status, c.name`);
  return { ok: true, clients: (rows as unknown as { rows?: unknown[] }).rows ?? rows };
}

