import { NextResponse } from "next/server";
import {
  eq,
} from "drizzle-orm";
import { db } from "@/db/client";
import { mondayMappings, tasks } from "@/db/schema";
import { env } from "@/lib/env";
import { payloadHash, processInBackground, receiveEvent, verifyHmac } from "@/server/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MondayPayload = {
  /** Monday stuurt bij het aanmaken van een webhook eerst een challenge. */
  challenge?: string;
  event?: {
    type?: string;
    boardId?: number | string;
    pulseId?: number | string;
    pulseName?: string;
    groupId?: string;
    columnId?: string;
    value?: unknown;
    previousValue?: unknown;
    userId?: number | string;
    triggerTime?: string;
  };
};

/**
 * Monday-webhooks. Twee bijzonderheden:
 *  1. Bij het registreren stuurt Monday een `challenge` die je moet echoën.
 *  2. Wijzigingen die ShortClips OS zélf heeft doorgestuurd moeten niet opnieuw
 *     verwerkt worden — anders ontstaat een sync-lus. Daarvoor vergelijken we
 *     de payload-hash met de laatst weggeschreven hash in de mapping.
 */
export async function POST(request: Request) {
  const raw = await request.text();

  let payload: MondayPayload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "ongeldige json" }, { status: 400 });
  }

  if (payload.challenge) {
    return NextResponse.json({ challenge: payload.challenge });
  }

  const signatureValid = verifyHmac(
    raw,
    request.headers.get("authorization"),
    env.MONDAY_WEBHOOK_SECRET,
  );
  if (signatureValid === false) {
    return NextResponse.json({ error: "ongeldige handtekening" }, { status: 401 });
  }

  const event = payload.event ?? {};
  const eventType = event.type ?? "unknown";
  const externalEventId = `${eventType}:${event.boardId ?? ""}:${event.pulseId ?? ""}:${event.triggerTime ?? Date.now()}`;

  const result = await receiveEvent({
    provider: "monday",
    externalEventId,
    eventType,
    raw,
    payload,
    signatureValid,
  });

  if (result.status !== "accepted") {
    return NextResponse.json({ ok: true, duplicate: result.status === "duplicate" });
  }

  processInBackground(result.eventId, () => handleMondayEvent(payload, raw));
  return NextResponse.json({ ok: true });
}

async function handleMondayEvent(
  payload: MondayPayload,
  raw: string,
): Promise<{ skipped?: boolean }> {
  const event = payload.event;
  if (!event?.pulseId) return { skipped: true };

  const itemId = String(event.pulseId);
  const hash = payloadHash(raw);

  const [mapping] = await db
    .select()
    .from(mondayMappings)
    .where(eq(mondayMappings.itemId, itemId))
    .limit(1);

  // Sync-lus voorkomen: als deze payload identiek is aan wat wij zelf net
  // hebben weggeschreven, is er niets nieuws gebeurd.
  if (mapping?.lastPayloadHash === hash) return { skipped: true };

  if (!mapping) {
    // Nog geen koppeling: het item is in Monday aangemaakt en moet eerst via de
    // importwizard aan een ShortClips-entiteit worden gekoppeld.
    return { skipped: true };
  }

  if (mapping.entityType === "task" && mapping.entityId) {
    const columnMap = mapping.columnMap as Record<string, string>;
    const patch: Record<string, unknown> = { updatedAt: new Date() };

    if (event.pulseName) patch.title = event.pulseName;
    if (event.columnId && event.columnId === columnMap.status) {
      const text = (event.value as { label?: { text?: string } })?.label?.text?.toLowerCase();
      if (text?.includes("klaar") || text?.includes("done")) patch.status = "done";
      else if (text?.includes("bezig")) patch.status = "in_progress";
    }
    if (event.columnId && event.columnId === columnMap.deadline) {
      const date = (event.value as { date?: string })?.date;
      if (date) patch.dueOn = date;
    }

    await db.update(tasks).set(patch).where(eq(tasks.id, mapping.entityId));
  }

  await db
    .update(mondayMappings)
    .set({ lastPayloadHash: hash, lastSyncedAt: new Date() })
    .where(eq(mondayMappings.id, mapping.id));

  return {};
}
