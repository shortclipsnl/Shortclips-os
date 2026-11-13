import "server-only";
import { and, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, frameAssets, portalVideoApprovals, portalVideoComments } from "@/db/schema";
import { frameio } from "@/server/integrations/frameio";
import { framestampToMs, frameCommentText, isPortalFrameText, matchReplyParent, secondsToFramestamp } from "@/lib/video-review";

/**
 * Synchronisatie tussen de videobeoordeling in het portaal en Frame.io (V4).
 *
 * Portaal → Frame.io
 *  - Verstuurde klantopmerkingen worden opmerkingen op exact dezelfde versie
 *    (bestand) en hetzelfde beeld in Frame.io. Bij een fout blijft de opmerking
 *    op `failed` staan en probeert de job het later opnieuw. Vóór een nieuwe
 *    poging kijken we eerst of de opmerking er toch al staat (geen dubbelingen).
 *  - Feedback / goedkeuring zet het veld Status ("In Progress" / "Approved").
 *
 * Frame.io → portaal (webhook én periodieke controle als vangnet)
 *  - Een opmerking die de editor afvinkt, staat in het portaal als verwerkt.
 *  - Een reactie van het team op (vrijwel) dezelfde tijdcode verschijnt als
 *    antwoord. Opmerkingen die met "intern" beginnen worden nooit getoond.
 */

const MAX_ATTEMPTS = 8;

/* ---------------- Frame-rate (nodig voor de framestempel) ---------------- */

async function frameRateFor(assetId: string, mediaFileId: string): Promise<number | null> {
  const [row] = await db.select({ fps: frameAssets.frameRate, media: frameAssets.mediaFileId }).from(frameAssets).where(eq(frameAssets.id, assetId)).limit(1);
  if (row?.fps && row.media === mediaFileId) return Number(row.fps);
  try {
    const meta = await frameio.getFileMetadata(mediaFileId);
    const fps = Number(meta.find((m) => m.field_definition_name === "Frame Rate")?.value);
    if (Number.isFinite(fps) && fps > 0) {
      if (row?.media === mediaFileId) await db.update(frameAssets).set({ frameRate: fps }).where(eq(frameAssets.id, assetId));
      return fps;
    }
  } catch {
    /* val terug op 25 fps in secondsToFramestamp */
  }
  return row?.fps ? Number(row.fps) : null;
}

/* ---------------- Status-veld in Frame.io ---------------- */

let statusField: { id: string; options: Map<string, string> } | null = null;

async function statusFieldDef() {
  if (statusField) return statusField;
  const defs = await frameio.listFieldDefinitions();
  const def = defs.find((d) => d.name === "Status" && d.field_type === "select" && d.mutable !== false);
  if (!def) return null;
  statusField = { id: def.id, options: new Map((def.field_configuration?.options ?? []).map((o) => [o.display_name, o.id])) };
  return statusField;
}

/** Zet het Status-veld in Frame.io. Geeft een foutmelding terug i.p.v. te gooien. */
export async function setFrameStatus(projectId: string, fileIds: string[], label: "Approved" | "In Progress" | "Needs Review"): Promise<string | null> {
  if (!frameio.isConfigured || fileIds.length === 0) return "Frame.io is niet ingesteld.";
  try {
    const def = await statusFieldDef();
    const option = def?.options.get(label);
    if (!def || !option) return `Status "${label}" bestaat niet in Frame.io.`;
    await frameio.setMetadataValues(projectId, fileIds, [{ field_definition_id: def.id, value: [option] }]);
    return null;
  } catch (e) {
    return String((e as Error)?.message ?? e).slice(0, 300);
  }
}

/* ---------------- Portaal → Frame.io: opmerkingen ---------------- */

export async function pushCommentToFrame(commentId: string): Promise<{ ok: boolean; error?: string }> {
  const [c] = await db
    .select({
      id: portalVideoComments.id,
      assetId: portalVideoComments.frameAssetId,
      mediaFileId: portalVideoComments.mediaFileId,
      timecodeMs: portalVideoComments.timecodeMs,
      body: portalVideoComments.body,
      authorName: portalVideoComments.authorName,
      parentId: portalVideoComments.parentId,
      status: portalVideoComments.status,
      syncStatus: portalVideoComments.syncStatus,
      syncAttempts: portalVideoComments.syncAttempts,
      frameCommentId: portalVideoComments.frameCommentId,
      clientName: clients.name,
    })
    .from(portalVideoComments)
    .innerJoin(clients, eq(clients.id, portalVideoComments.clientId))
    .where(and(eq(portalVideoComments.id, commentId), isNull(portalVideoComments.deletedAt)))
    .limit(1);
  if (!c || c.status !== "submitted") return { ok: false, error: "Opmerking niet verstuurd." };
  if (c.frameCommentId || c.syncStatus === "synced") return { ok: true };
  if (!frameio.isConfigured) {
    await markFailed(c.id, c.syncAttempts, "Frame.io is niet ingesteld.");
    return { ok: false, error: "Frame.io is niet ingesteld." };
  }

  let replyTo: string | null = null;
  if (c.parentId) {
    const [p] = await db.select({ body: portalVideoComments.body }).from(portalVideoComments).where(eq(portalVideoComments.id, c.parentId)).limit(1);
    replyTo = p?.body ?? null;
  }
  const text = frameCommentText({ authorName: c.authorName, clientName: c.clientName, body: c.body, replyTo });

  try {
    // Na een eerdere (mislukte of afgebroken) poging: staat hij er toch al?
    if (c.syncAttempts > 0) {
      const existing = await frameio.listCommentsDetailed(c.mediaFileId);
      const hit = existing.find((e) => (e.text ?? "").trim() === text.trim());
      if (hit) {
        await markSynced(c.id, hit.id);
        return { ok: true };
      }
    }
    const fps = c.timecodeMs != null ? await frameRateFor(c.assetId, c.mediaFileId) : null;
    const created = await frameio.createComment(c.mediaFileId, {
      text,
      timestamp: c.timecodeMs != null ? secondsToFramestamp(c.timecodeMs / 1000, fps) : null,
    });
    if (!created?.id) throw new Error("Frame.io gaf geen opmerking-id terug.");
    await markSynced(c.id, created.id);
    return { ok: true };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 400);
    await markFailed(c.id, c.syncAttempts, msg);
    return { ok: false, error: msg };
  }
}

async function markSynced(id: string, frameCommentId: string) {
  await db
    .update(portalVideoComments)
    .set({ syncStatus: "synced", frameCommentId, syncedAt: new Date(), syncError: null, updatedAt: new Date() })
    .where(eq(portalVideoComments.id, id));
}

async function markFailed(id: string, attempts: number, error: string) {
  await db
    .update(portalVideoComments)
    .set({ syncStatus: "failed", syncAttempts: attempts + 1, syncError: error, updatedAt: new Date() })
    .where(eq(portalVideoComments.id, id));
}

/* ---------------- Frame.io → portaal ---------------- */

/**
 * Haalt per video de opmerkingen uit Frame.io en werkt bij:
 *  - afgevinkt (completed) bij klantopmerkingen;
 *  - reacties van het team bij een klantopmerking (zie matchReplyParent).
 * Idempotent: een Frame-opmerking komt maximaal één keer in het portaal.
 */
export async function pullFrameUpdates(assetIds: string[]): Promise<{ assets: number; completed: number; replies: number; errors: number }> {
  const out = { assets: 0, completed: 0, replies: 0, errors: 0 };
  const ids = [...new Set(assetIds)];
  if (!ids.length || !frameio.isConfigured) return out;

  const assets = await db
    .select({ id: frameAssets.id, clientId: frameAssets.clientId, mediaFileId: frameAssets.mediaFileId, fps: frameAssets.frameRate })
    .from(frameAssets)
    .where(inArray(frameAssets.id, ids));

  for (const a of assets) {
    // Alle versies waarop de klant feedback gaf (oude versies blijven bijgewerkt).
    const ours = await db
      .select({
        id: portalVideoComments.id,
        mediaFileId: portalVideoComments.mediaFileId,
        timecodeMs: portalVideoComments.timecodeMs,
        frameCommentId: portalVideoComments.frameCommentId,
        completedAt: portalVideoComments.completedAt,
        authorKind: portalVideoComments.authorKind,
        createdAt: portalVideoComments.createdAt,
        parentId: portalVideoComments.parentId,
        versionNumber: portalVideoComments.versionNumber,
      })
      .from(portalVideoComments)
      .where(and(eq(portalVideoComments.frameAssetId, a.id), eq(portalVideoComments.status, "submitted"), isNull(portalVideoComments.deletedAt)));
    const files = [...new Set(ours.filter((o) => o.authorKind === "client").map((o) => o.mediaFileId))];
    if (!files.length) continue;
    out.assets++;

    for (const fileId of files) {
      let remote: Awaited<ReturnType<typeof frameio.listCommentsDetailed>>;
      try {
        remote = await frameio.listCommentsDetailed(fileId);
      } catch {
        out.errors++;
        continue;
      }
      const byFrameId = new Map(ours.filter((o) => o.frameCommentId).map((o) => [o.frameCommentId!, o]));
      const fps = fileId === a.mediaFileId && a.fps ? Number(a.fps) : await frameRateFor(a.id, fileId);
      const clientTop = ours
        .filter((o) => o.authorKind === "client" && !o.parentId && o.mediaFileId === fileId)
        .map((o) => ({ ...o, createdAt: new Date(o.createdAt) }));

      for (const r of remote) {
        const mine = byFrameId.get(r.id);
        const completedAt = r.completed_at ? new Date(r.completed_at) : null;
        if (mine) {
          const was = !!mine.completedAt;
          if (was !== !!completedAt) {
            await db.update(portalVideoComments).set({ completedAt, updatedAt: new Date() }).where(eq(portalVideoComments.id, mine.id));
            if (completedAt) out.completed++;
          }
          continue;
        }
        // Door het portaal zelf geplaatst (bijv. goedkeuringsbericht) of intern.
        const text = (r.text ?? "").trim();
        if (!text || isPortalFrameText(text) || /^#?intern\b/i.test(text) || /Goedgekeurd door .* via het Shortclips portaal/.test(text)) continue;
        if (r.timestamp == null || !r.created_at) continue;
        const candidate = { mediaFileId: fileId, timecodeMs: framestampToMs(Number(r.timestamp), fps), createdAt: new Date(r.created_at) };
        const parent = matchReplyParent(candidate, clientTop);
        if (!parent) continue;
        const inserted = await db
          .insert(portalVideoComments)
          .values({
            clientId: a.clientId,
            frameAssetId: a.id,
            mediaFileId: fileId,
            versionNumber: parent.versionNumber,
            timecodeMs: candidate.timecodeMs,
            body: text,
            parentId: parent.id,
            authorName: "Shortclips",
            authorKind: "shortclips",
            source: "frameio",
            status: "submitted",
            submittedAt: candidate.createdAt,
            syncStatus: "synced",
            syncedAt: new Date(),
            frameCommentId: r.id,
            completedAt,
            createdAt: candidate.createdAt,
          })
          .onConflictDoNothing({ target: portalVideoComments.frameCommentId })
          .returning({ id: portalVideoComments.id });
        if (inserted.length) out.replies++;
      }
    }
  }
  return out;
}

/** Een opmerking in Frame.io (webhook) → bijbehorende video in het portaal. */
export async function assetIdForFrameComment(commentId: string): Promise<string | null> {
  const [known] = await db.select({ asset: portalVideoComments.frameAssetId }).from(portalVideoComments).where(eq(portalVideoComments.frameCommentId, commentId)).limit(1);
  if (known) return known.asset;
  try {
    const c = await frameio.getComment(commentId);
    if (!c?.file_id) return null;
    const [a] = await db
      .select({ id: frameAssets.id })
      .from(frameAssets)
      .where(or(eq(frameAssets.mediaFileId, c.file_id), eq(frameAssets.frameFileId, c.file_id)))
      .limit(1);
    if (a) return a.id;
    // Opmerking op een oudere versie: via een eerdere klantopmerking.
    const [old] = await db.select({ asset: portalVideoComments.frameAssetId }).from(portalVideoComments).where(eq(portalVideoComments.mediaFileId, c.file_id)).limit(1);
    return old?.asset ?? null;
  } catch {
    return null;
  }
}

/* ---------------- Job: opnieuw proberen + vangnet ---------------- */

export async function runVideoReviewSync(): Promise<{ ok: boolean; retried: number; failed: number; pulled: number; completed: number; replies: number; approvals: number }> {
  // 1. Mislukte of blijven hangen opmerkingen opnieuw naar Frame.io.
  const stuck = await db
    .select({ id: portalVideoComments.id })
    .from(portalVideoComments)
    .where(
      and(
        eq(portalVideoComments.status, "submitted"),
        isNull(portalVideoComments.deletedAt),
        isNull(portalVideoComments.frameCommentId),
        inArray(portalVideoComments.syncStatus, ["pending", "failed"]),
        lt(portalVideoComments.syncAttempts, MAX_ATTEMPTS),
        // pending van de laatste 2 minuten loopt mogelijk nog in de klantactie
        or(eq(portalVideoComments.syncStatus, "failed"), lt(portalVideoComments.updatedAt, sql`now() - interval '2 minutes'`)),
      ),
    )
    .limit(40);
  let retried = 0;
  let failed = 0;
  for (const s of stuck) {
    const r = await pushCommentToFrame(s.id);
    if (r.ok) retried++;
    else failed++;
  }

  // 2. Goedkeuringen waarvan de Frame-status nog niet gezet kon worden.
  const pendingApprovals = await db
    .select({ id: portalVideoApprovals.id, mediaFileId: portalVideoApprovals.mediaFileId, projectId: frameAssets.frameProjectId })
    .from(portalVideoApprovals)
    .innerJoin(frameAssets, eq(frameAssets.id, portalVideoApprovals.frameAssetId))
    .where(and(isNull(portalVideoApprovals.frameSyncedAt), gte(portalVideoApprovals.approvedAt, sql`now() - interval '14 days'`)))
    .limit(30);
  let approvalsFixed = 0;
  for (const p of pendingApprovals) {
    const err = await setFrameStatus(p.projectId, [p.mediaFileId], "Approved");
    await db.update(portalVideoApprovals).set(err ? { frameSyncError: err, updatedAt: new Date() } : { frameSyncedAt: new Date(), frameSyncError: null, updatedAt: new Date() }).where(eq(portalVideoApprovals.id, p.id));
    if (!err) approvalsFixed++;
  }

  // 3. Vangnet voor webhooks: video's met openstaande klantfeedback (60 dagen).
  const open = await db
    .selectDistinct({ asset: portalVideoComments.frameAssetId })
    .from(portalVideoComments)
    .where(
      and(
        eq(portalVideoComments.status, "submitted"),
        eq(portalVideoComments.authorKind, "client"),
        isNull(portalVideoComments.deletedAt),
        isNull(portalVideoComments.completedAt),
        isNotNull(portalVideoComments.frameCommentId),
        gte(portalVideoComments.submittedAt, sql`now() - interval '60 days'`),
      ),
    )
    .limit(60);
  const pulled = await pullFrameUpdates(open.map((o) => o.asset));
  return { ok: true, retried, failed, pulled: pulled.assets, completed: pulled.completed, replies: pulled.replies, approvals: approvalsFixed };
}

/* ---------------- Nieuwe versie in Frame.io ---------------- */

/**
 * Een editor zet een nieuwe versie op een video (version stack). De video in
 * het portaal blijft dezelfde (zelfde frame_assets-rij, dus feedback en
 * goedkeuringen blijven eraan hangen), maar wijst voortaan naar de nieuwste
 * versie. Ook de eerste keer, wanneer Frame van een los bestand een stack
 * maakt met een nieuw id, koppelen we via de versies in de stack terug.
 */
export async function applyNewVersion(fileId: string): Promise<{ updated: boolean }> {
  if (!frameio.isConfigured) return { updated: false };
  const file = await frameio.getFile(fileId);
  const stackId = file.parent_id;
  if (!stackId) return { updated: false };
  let children: Awaited<ReturnType<typeof frameio.listVersionStackChildren>>;
  try {
    children = await frameio.listVersionStackChildren(stackId);
  } catch {
    return { updated: false }; // parent is een gewone map, geen stack
  }
  if (!children.length) return { updated: false };
  const head = children[0]!;
  const ids = [stackId, ...children.map((c) => c.id)];
  const [row] = await db
    .select({ id: frameAssets.id, frameFileId: frameAssets.frameFileId })
    .from(frameAssets)
    .where(or(inArray(frameAssets.frameFileId, ids), inArray(frameAssets.mediaFileId, ids)))
    .limit(1);
  if (!row) return { updated: false }; // nieuwe video: de bibliotheek-sync pakt hem op
  // Een eventueel al aangemaakte dubbele rij voor de stack opruimen.
  if (row.frameFileId !== stackId) {
    await db.update(frameAssets).set({ deletedAt: new Date(), frameFileId: sql`${frameAssets.frameFileId} || ':dubbel:' || ${frameAssets.id}` }).where(and(eq(frameAssets.frameFileId, stackId), sql`${frameAssets.id} <> ${row.id}`));
  }
  await db
    .update(frameAssets)
    .set({ frameFileId: stackId, mediaFileId: head.id, versionCount: children.length, thumbnailUrl: null, frameRate: null, deletedAt: null, updatedAt: new Date() })
    .where(eq(frameAssets.id, row.id));
  return { updated: true };
}
