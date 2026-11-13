import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { deliverables, reviewComments, reviewThreads, videoVersions } from "@/db/schema";
import { env } from "@/lib/env";
import { completeEvent, receiveEvent, verifyHmac } from "@/server/webhooks";
import { dispatch } from "@/server/automation";
import { recordActivity } from "@/server/audit";
import { getStringSetting } from "@/server/app-settings";
import { applyNewVersion, assetIdForFrameComment, pullFrameUpdates } from "@/server/video-review-sync";
import { FRAMEIO_WEBHOOK_SECRET_KEY, verifyFrameV4 } from "@/server/integrations/frameio-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FramePayload = {
  type?: string;
  event?: string;
  id?: string;
  resource?: { id?: string; type?: string };
  data?: Record<string, unknown>;
  account?: { id?: string };
  project?: { id?: string };
  user?: { id?: string; name?: string };
};

export async function POST(request: Request) {
  const raw = await request.text();
  const signature = request.headers.get("x-frameio-signature");
  const timestamp = request.headers.get("x-frameio-request-timestamp");

  // Fail-closed: alleen met een geldige handtekening verwerken.
  const stored = await getStringSetting(FRAMEIO_WEBHOOK_SECRET_KEY, "").catch(() => "");
  const secrets = [stored, env.FRAMEIO_WEBHOOK_SECRET].filter((s): s is string => !!s);
  let signatureValid: boolean | null = secrets.length ? false : null;
  for (const s of secrets) {
    if (verifyFrameV4(raw, signature, timestamp, s) || verifyHmac(raw, signature, s) === true) {
      signatureValid = true;
      break;
    }
  }
  if (signatureValid !== true) {
    const reason = signatureValid === null ? "webhook-secret niet ingesteld" : "ongeldige handtekening";
    return NextResponse.json({ error: reason }, { status: 401 });
  }

  let payload: FramePayload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "ongeldige json" }, { status: 400 });
  }

  const eventType = payload.type ?? payload.event ?? "unknown";
  // V4 stuurt geen event-id mee: type + resource + tijdstempel is uniek genoeg,
  // en de payload-hash in receiveEvent vangt herhaalde bezorging af.
  const externalEventId = payload.id ?? `${eventType}:${payload.resource?.id ?? ""}:${timestamp ?? ""}`;

  const result = await receiveEvent({ provider: "frameio", externalEventId, eventType, raw, payload, signatureValid });
  if (result.status !== "accepted") {
    return NextResponse.json({ ok: true, duplicate: result.status === "duplicate" });
  }

  // Direct verwerken (licht werk); serverless functies stoppen na het antwoord.
  try {
    const out = await handleFrameEvent(eventType, payload);
    await completeEvent(result.eventId, { ok: true, skipped: out.skipped });
  } catch (error) {
    await completeEvent(result.eventId, { ok: false, error: String(error).slice(0, 500) }).catch(() => undefined);
  }
  return NextResponse.json({ ok: true });
}

async function handleFrameEvent(eventType: string, payload: FramePayload): Promise<{ skipped?: boolean }> {
  const resourceId = payload.resource?.id ?? (payload.data?.id as string | undefined);
  if (!resourceId) return { skipped: true };

  // Videobeoordeling in het portaal: opmerkingen afgevinkt of beantwoord.
  if (eventType.startsWith("comment.")) {
    const assetId = await assetIdForFrameComment(resourceId);
    if (assetId) {
      await pullFrameUpdates([assetId]);
      return {};
    }
  }

  // Nieuwe versie: portaal toont direct de nieuwste versie van dezelfde video.
  if (eventType === "file.versioned" || eventType === "file.upload.completed") {
    const r = await applyNewVersion(resourceId).catch(() => ({ updated: false }));
    if (r.updated) return {};
  }

  // Oudere koppeling: Frame-bestand direct gekoppeld aan een editingproject.
  const [video] = await db
    .select({ id: deliverables.id, clientId: deliverables.clientId, title: deliverables.title, status: deliverables.status })
    .from(deliverables)
    .where(and(eq(deliverables.frameAssetId, resourceId), isNull(deliverables.deletedAt)))
    .limit(1);

  if (!video) return { skipped: true };

  if (eventType.includes("comment")) {
    const commentId = (payload.data?.id as string) ?? resourceId;
    const existing = await db.select({ id: reviewComments.id }).from(reviewComments).where(eq(reviewComments.frameCommentId, commentId)).limit(1);
    if (existing[0]) return { skipped: true };

    const [thread] = await db
      .insert(reviewThreads)
      .values({
        deliverableId: video.id,
        visibility: "client",
        timecodeMs: payload.data?.timestamp ? Number(payload.data.timestamp) * 1000 : null,
        frameCommentId: commentId,
      })
      .returning({ id: reviewThreads.id });

    await db.insert(reviewComments).values({
      threadId: thread!.id,
      body: String(payload.data?.text ?? "(geen tekst)"),
      authorName: payload.user?.name ?? "Frame.io-gebruiker",
      source: "frameio",
      frameCommentId: commentId,
      timecodeMs: payload.data?.timestamp ? Number(payload.data.timestamp) * 1000 : null,
    });

    await recordActivity({
      clientId: video.clientId,
      type: "video.comment_received",
      title: `Nieuwe feedback via Frame.io op ${video.title}`,
      entityType: "deliverable",
      entityId: video.id,
      isClientVisible: true,
    });

    await dispatch({
      trigger: "frameio.comment_created",
      clientId: video.clientId,
      entityType: "deliverable",
      entityId: video.id,
      data: { title: video.title, href: `/videos/${video.id}` },
    });
    return {};
  }

  if (eventType.includes("approve") || payload.data?.status === "approved") {
    await dispatch({
      trigger: "frameio.asset_approved",
      clientId: video.clientId,
      entityType: "deliverable",
      entityId: video.id,
      data: { title: video.title, href: `/videos/${video.id}` },
    });
    return {};
  }

  if (eventType.includes("version") || eventType.includes("asset.created")) {
    const versionNumber = Number(payload.data?.version ?? 0) || 1;
    await db
      .insert(videoVersions)
      .values({ deliverableId: video.id, versionNumber, frameAssetId: resourceId, label: String(payload.data?.name ?? `Versie ${versionNumber}`) })
      .onConflictDoNothing();
    return {};
  }

  return { skipped: true };
}
