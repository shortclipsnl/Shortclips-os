import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import {
  deliverables,
  frameMappings,
  reviewComments,
  reviewThreads,
} from "@/db/schema";
import { frameio } from "@/server/integrations/frameio";
import { runJob } from "./runner";

/**
 * Opmerkingen en versies uit Frame.io ophalen voor alle video's die aan een
 * Frame.io-asset gekoppeld zijn. Idempotent: bestaande opmerkingen worden
 * overgeslagen op basis van hun Frame.io-id.
 */
export async function pullFrameComments(triggeredById?: string) {
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
          const comments = await frameio.listComments(video.frameAssetId!);
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

/** Projecten uit Frame.io ophalen, zodat ze aan klanten gekoppeld kunnen worden. */
export async function pullFrameProjects(triggeredById?: string) {
  return runJob(
    "frameio",
    "frameio.pull_projects",
    {},
    async (ctx) => {
      const projects = await frameio.listProjects();
      ctx.log(`${projects.length} projecten gevonden`);
      ctx.counters.processed = projects.length;

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
      }
    },
    { triggeredById },
  );
}
