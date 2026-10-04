import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { deliverables, reviewComments, reviewThreads, videoVersions } from "@/db/schema";
import { env } from "@/lib/env";
import { processInBackground, receiveEvent, verifyHmac } from "@/server/webhooks";
import { dispatch } from "@/server/automation";
import { recordActivity } from "@/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FramePayload = {
  type?: string;
  event?: string;
  id?: string;
  resource?: { id?: string; type?: string };
  data?: Record<string, unknown>;
  account_id?: string;
  project_id?: string;
  user?: { id?: string; name?: string };
};

/**
 * Frame.io-webhooks. Het antwoord gaat er meteen uit; de verwerking loopt
 * daarna en is idempotent — hetzelfde event levert nooit dubbele records op.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  const signature =
    request.headers.get("x-frameio-signature") ??
    request.headers.get("x-signature") ??
    null;

  const signatureValid = verifyHmac(raw, signature, env.FRAMEIO_WEBHOOK_SECRET);
  if (signatureValid === false) {
    return NextResponse.json({ error: "ongeldige handtekening" }, { status: 401 });
  }

  let payload: FramePayload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "ongeldige json" }, { status: 400 });
  }

  const eventType = payload.type ?? payload.event ?? "unknown";
  const externalEventId =
    payload.id ?? `${eventType}:${payload.resource?.id ?? ""}:${Date.now()}`;

  const result = await receiveEvent({
    provider: "frameio",
    externalEventId,
    eventType,
    raw,
    payload,
    signatureValid,
  });

  if (result.status !== "accepted") {
    return NextResponse.json({ ok: true, duplicate: result.status === "duplicate" });
  }

  processInBackground(result.eventId, () => handleFrameEvent(eventType, payload));
  return NextResponse.json({ ok: true });
}

async function handleFrameEvent(
  eventType: string,
  payload: FramePayload,
): Promise<{ skipped?: boolean }> {
  const resourceId = payload.resource?.id ?? (payload.data?.id as string | undefined);
  if (!resourceId) return { skipped: true };

  // Welke video hoort bij dit Frame.io-object?
  const [video] = await db
    .select({ id: deliverables.id, clientId: deliverables.clientId, title: deliverables.title, status: deliverables.status })
    .from(deliverables)
    .where(and(eq(deliverables.frameAssetId, resourceId), isNull(deliverables.deletedAt)))
    .limit(1);

  if (!video) return { skipped: true };

  if (eventType.includes("comment")) {
    const commentId = (payload.data?.id as string) ?? resourceId;
    // Bestaat deze opmerking al? Dan niets doen (idempotent).
    const existing = await db
      .select({ id: reviewComments.id })
      .from(reviewComments)
      .where(eq(reviewComments.frameCommentId, commentId))
      .limit(1);
    if (existing[0]) return { skipped: true };

    const [thread] = await db
      .insert(reviewThreads)
      .values({
        deliverableId: video.id,
        // Frame.io-opmerkingen komen van klanten en reviewers; standaard
        // behandelen we ze als klantfeedback. Intern kan het team ze omzetten.
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
      .values({
        deliverableId: video.id,
        versionNumber,
        frameAssetId: resourceId,
        label: String(payload.data?.name ?? `Versie ${versionNumber}`),
      })
      .onConflictDoNothing();
    return {};
  }

  return { skipped: true };
}
