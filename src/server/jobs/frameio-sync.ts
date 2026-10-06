import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  clientIntegrations,
  clients,
  deliverables,
  frameMappings,
  reviewComments,
  reviewThreads,
} from "@/db/schema";
import {
  frameio,
  type FrameComment,
  type FrameFile,
  type FrameProject,
} from "@/server/integrations/frameio";
import { normalizeName } from "@/server/import";
import { runJob } from "./runner";

/**
 * De bron van Frame.io-data. Normaal de echte adapter; in tests injecteren we
 * een nepbron met vaste projecten/bestanden/opmerkingen, zodat de hele keten
 * (project → klant → video → feedback) zonder internet te testen is.
 */
export type FrameSource = {
  isConfigured: boolean;
  listProjects(): Promise<FrameProject[]>;
  getProject(projectId: string): Promise<FrameProject>;
  listFolderChildren(folderId: string): Promise<FrameFile[]>;
  listComments(fileId: string): Promise<FrameComment[]>;
};

/** Welke bestanden zijn video's? Alleen die worden video's in ShortClips OS. */
function isVideoFile(file: FrameFile): boolean {
  if (file.type === "folder") return false;
  if (file.media_type?.toLowerCase().startsWith("video")) return true;
  return /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(file.name ?? "");
}
function isFolder(file: FrameFile): boolean {
  return file.type === "folder";
}

/**
 * Vertaalt een Frame.io-bestandsstatus naar de ShortClips-videostatus.
 *
 * Belangrijk: een bulk-import uit Frame.io bevat vooral al geleverde/afgeronde
 * video's. Die als "wacht op akkoord" tonen zou de klant honderden valse
 * actiepunten geven. Daarom standaard "published" (verschijnt in de video-
 * galerij). Alleen een duidelijk lopende review wordt "client_review"; een
 * duidelijk goedgekeurde status "approved".
 */
function mapFrameStatus(status?: string): "client_review" | "approved" | "published" {
  const s = (status ?? "").toLowerCase();
  if (/review|revision|pending|needs|awaiting/.test(s)) return "client_review";
  if (/approved|accepted/.test(s)) return "approved";
  return "published";
}

/** Beste schatting voor de publicatiedatum van een geïmporteerde video. */
function frameDate(file: FrameFile): Date {
  const raw = file.updated_at ?? file.created_at;
  const d = raw ? new Date(raw) : new Date();
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

/**
 * Projecten uit Frame.io ophalen. Elk project wordt vastgelegd in frame_mappings
 * en — als de projectnaam onmiskenbaar bij precies één klant hoort — automatisch
 * aan die klant gekoppeld (client_integrations, provider frameio). Bij twijfel
 * (geen of meerdere klanten) gebeurt dat NIET; dan koppelt een beheerder het
 * handmatig. Zo belandt een video nooit bij de verkeerde klant.
 */
export async function pullFrameProjects(
  triggeredById?: string,
  source: FrameSource = frameio,
) {
  return runJob(
    "frameio",
    "frameio.pull_projects",
    {},
    async (ctx) => {
      const projects = await source.listProjects();
      ctx.log(`${projects.length} projecten gevonden`);
      ctx.counters.processed = projects.length;

      const clientRows = await db
        .select({ id: clients.id, name: clients.name, slug: clients.slug })
        .from(clients)
        .where(isNull(clients.deletedAt));

      for (const project of projects) {
        const existing = await db
          .select({ id: frameMappings.id })
          .from(frameMappings)
          .where(
            and(eq(frameMappings.entityType, "frame_project"), eq(frameMappings.projectId, project.id)),
          )
          .limit(1);

        if (existing[0]) {
          await db
            .update(frameMappings)
            .set({ lastSyncedAt: new Date() })
            .where(eq(frameMappings.id, existing[0].id));
          ctx.counters.updated++;
        } else {
          await db.insert(frameMappings).values({
            entityType: "frame_project",
            projectId: project.id,
            workspaceId: project.workspace_id ?? null,
            folderId: project.root_folder_id ?? null,
            lastSyncedAt: new Date(),
          });
          ctx.counters.created++;
        }

        // Voorzichtige automatische koppeling: alleen bij precies één naamgenoot.
        const nName = normalizeName(project.name);
        const hits = clientRows.filter(
          (c) => normalizeName(c.name) === nName || normalizeName(c.slug) === nName,
        );
        if (hits.length === 1) {
          await db
            .insert(clientIntegrations)
            .values({
              clientId: hits[0]!.id,
              provider: "frameio",
              externalId: project.id,
              externalName: project.name,
              config: { rootFolderId: project.root_folder_id ?? null },
              lastSyncedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: [
                clientIntegrations.clientId,
                clientIntegrations.provider,
                clientIntegrations.externalId,
              ],
              set: { externalName: project.name, lastSyncedAt: new Date(), updatedAt: new Date() },
            });
          ctx.log(`Project "${project.name}" gekoppeld aan klant.`);
        } else {
          ctx.log(
            `Project "${project.name}": ${hits.length === 0 ? "geen" : `${hits.length} mogelijke`} klant — handmatig koppelen.`,
            "warn",
          );
        }
      }
    },
    { triggeredById },
  );
}

/** Verzamelt alle video-bestanden van een project (recursief, begrensd). */
async function collectProjectVideos(
  source: FrameSource,
  rootFolderId: string,
): Promise<FrameFile[]> {
  const videos: FrameFile[] = [];
  const queue: string[] = [rootFolderId];
  const seen = new Set<string>();
  let folders = 0;

  while (queue.length && folders < 200 && videos.length < 500) {
    const folderId = queue.shift()!;
    if (seen.has(folderId)) continue;
    seen.add(folderId);
    folders++;

    const children = await source.listFolderChildren(folderId);
    for (const child of children) {
      if (isFolder(child)) queue.push(child.id);
      else if (isVideoFile(child)) videos.push(child);
    }
  }
  return videos;
}

/**
 * Maakt/verwerkt video's (deliverables) uit de gekoppelde Frame.io-projecten,
 * zodat ze in het klantportaal verschijnen. Idempotent op het Frame.io-asset-id.
 * Daarna haalt `pullFrameComments` de feedback per video op.
 */
export async function pullFrameDeliverables(
  triggeredById?: string,
  source: FrameSource = frameio,
) {
  return runJob(
    "frameio",
    "frameio.pull_deliverables",
    {},
    async (ctx) => {
      const links = await db
        .select({
          clientId: clientIntegrations.clientId,
          projectId: clientIntegrations.externalId,
          config: clientIntegrations.config,
        })
        .from(clientIntegrations)
        .where(eq(clientIntegrations.provider, "frameio"));

      ctx.log(`${links.length} gekoppelde Frame.io-projecten`);

      for (const link of links) {
        if (!link.projectId) continue;
        try {
          const cfg = (link.config ?? {}) as { rootFolderId?: string | null };
          let rootFolderId = cfg.rootFolderId ?? null;
          if (!rootFolderId) {
            const project = await source.getProject(link.projectId);
            rootFolderId = project.root_folder_id ?? null;
          }
          if (!rootFolderId) {
            ctx.log(`Project ${link.projectId}: geen hoofdmap gevonden.`, "warn");
            continue;
          }

          const videos = await collectProjectVideos(source, rootFolderId);
          ctx.counters.processed += videos.length;

          for (const file of videos) {
            const status = mapFrameStatus(file.status);
            const base = {
              clientId: link.clientId,
              title: file.name ?? "Video",
              frameAssetId: file.id,
              frameProjectId: link.projectId,
              frameUrl: file.view_url ?? null,
              updatedAt: new Date(),
            };

            const [existing] = await db
              .select({ id: deliverables.id })
              .from(deliverables)
              .where(eq(deliverables.frameAssetId, file.id))
              .limit(1);

            if (existing) {
              // Status niet terugzetten als het team die al verder heeft gezet;
              // alleen de Frame.io-metadata bijwerken.
              await db.update(deliverables).set(base).where(eq(deliverables.id, existing.id));
              ctx.counters.updated++;
            } else {
              await db.insert(deliverables).values({
                ...base,
                status,
                publishedAt: status === "published" ? frameDate(file) : null,
              });
              ctx.counters.created++;
            }
          }
        } catch (error) {
          ctx.counters.failed++;
          ctx.log(`Project ${link.projectId}: ${String(error)}`, "warn");
        }
      }

      ctx.log(`Klaar: ${ctx.counters.created} nieuwe video's, ${ctx.counters.updated} bijgewerkt.`);
    },
    { triggeredById },
  );
}

/**
 * Eenmalige correctie: zet uit Frame.io geïmporteerde video's die nog op
 * "client_review" staan (de oude standaard) om naar "published", zodat ze in de
 * klant-galerij verschijnen in plaats van als vals actiepunt "wacht op akkoord".
 * Door het team al verder gezette statussen blijven ongemoeid.
 */
export async function normalizeImportedFrameDeliverables() {
  await db.execute(sql`
    update deliverables
       set status = 'published',
           published_at = coalesce(published_at, created_at, now()),
           updated_at = now()
     where frame_asset_id is not null
       and status = 'client_review'
  `);
  return { ok: true };
}

/**
 * Opmerkingen (klantfeedback) uit Frame.io ophalen voor alle video's die aan een
 * Frame.io-asset gekoppeld zijn. Idempotent: bestaande opmerkingen worden
 * overgeslagen op basis van hun Frame.io-id.
 */
export async function pullFrameComments(
  triggeredById?: string,
  source: FrameSource = frameio,
) {
  return runJob(
    "frameio",
    "frameio.pull_comments",
    {},
    async (ctx) => {
      const videos = await db
        .select({
          id: deliverables.id,
          clientId: deliverables.clientId,
          title: deliverables.title,
          frameAssetId: deliverables.frameAssetId,
        })
        .from(deliverables)
        .where(and(isNull(deliverables.deletedAt), isNull(deliverables.publishedAt)));

      const linked = videos.filter((v) => v.frameAssetId);
      ctx.log(`${linked.length} video's gekoppeld aan Frame.io`);

      for (const video of linked) {
        try {
          const comments = await source.listComments(video.frameAssetId!);
          ctx.counters.processed += comments.length;

          for (const comment of comments) {
            const existing = await db
              .select({ id: reviewComments.id })
              .from(reviewComments)
              .where(eq(reviewComments.frameCommentId, comment.id))
              .limit(1);
            if (existing[0]) continue;

            const [thread] = await db
              .insert(reviewThreads)
              .values({
                deliverableId: video.id,
                visibility: "client",
                timecodeMs: comment.timestamp ? Math.round(comment.timestamp * 1000) : null,
                isResolved: Boolean(comment.completed),
                frameCommentId: comment.id,
              })
              .returning({ id: reviewThreads.id });

            await db.insert(reviewComments).values({
              threadId: thread!.id,
              body: comment.text ?? "(geen tekst)",
              authorName: "Frame.io",
              source: "frameio",
              frameCommentId: comment.id,
              timecodeMs: comment.timestamp ? Math.round(comment.timestamp * 1000) : null,
            });
            ctx.counters.created++;
          }
        } catch (error) {
          ctx.counters.failed++;
          ctx.log(`Video ${video.title}: ${String(error)}`, "warn");
        }
      }
    },
    { triggeredById },
  );
}
