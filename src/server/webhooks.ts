import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { integrationConnections, integrationEvents } from "@/db/schema";
import { logError } from "./audit";
import type { Provider } from "./integrations/types";

/**
 * Webhook-verwerking in twee stappen.
 *
 * 1. Ontvangen: signature controleren, event opslaan, meteen 200 teruggeven.
 *    Externe partijen verwachten binnen enkele seconden antwoord; zware logica
 *    hoort daar niet in.
 * 2. Verwerken: los van het antwoord, en idempotent — dezelfde bezorging mag
 *    nooit twee keer effect hebben.
 */

export type ReceiveResult =
  | { status: "accepted"; eventId: string }
  | { status: "duplicate"; eventId: string }
  | { status: "rejected"; reason: string };

export function payloadHash(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** HMAC-SHA256 vergelijken in constante tijd. */
export function verifyHmac(
  raw: string,
  signature: string | null,
  secret: string | undefined,
): boolean | null {
  // Geen secret ingesteld → we kunnen niet verifiëren. Dat is een expliciete
  // "onbekend", geen stilzwijgende "goed".
  if (!secret) return null;
  if (!signature) return false;

  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const provided = signature.replace(/^sha256=/, "").trim();
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(provided, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Event opslaan. Dubbele bezorging wordt op twee manieren afgevangen: op het
 * externe event-id én op een hash van de payload.
 */
export async function receiveEvent(params: {
  provider: Provider;
  externalEventId: string;
  eventType: string;
  raw: string;
  payload: unknown;
  signatureValid: boolean | null;
}): Promise<ReceiveResult> {
  const hash = payloadHash(params.raw);

  const existing = await db
    .select({ id: integrationEvents.id })
    .from(integrationEvents)
    .where(
      and(
        eq(integrationEvents.provider, params.provider),
        eq(integrationEvents.payloadHash, hash),
      ),
    )
    .limit(1);

  if (existing[0]) {
    return { status: "duplicate", eventId: existing[0].id };
  }

  const inserted = await db
    .insert(integrationEvents)
    .values({
      provider: params.provider,
      externalEventId: params.externalEventId,
      eventType: params.eventType,
      payload: params.payload as Record<string, unknown>,
      payloadHash: hash,
      signatureValid: params.signatureValid,
      status: "received",
    })
    .onConflictDoNothing()
    .returning({ id: integrationEvents.id });

  if (!inserted[0]) {
    // Race met een gelijktijdige bezorging: het event bestaat al.
    const row = await db
      .select({ id: integrationEvents.id })
      .from(integrationEvents)
      .where(
        and(
          eq(integrationEvents.provider, params.provider),
          eq(integrationEvents.externalEventId, params.externalEventId),
        ),
      )
      .limit(1);
    return { status: "duplicate", eventId: row[0]?.id ?? "" };
  }

  await db
    .update(integrationConnections)
    .set({ lastWebhookAt: new Date(), updatedAt: new Date() })
    .where(eq(integrationConnections.provider, params.provider));

  return { status: "accepted", eventId: inserted[0].id };
}

/** Markeer een event als verwerkt of mislukt. */
export async function completeEvent(
  eventId: string,
  outcome: { ok: boolean; error?: string; skipped?: boolean },
): Promise<void> {
  await db
    .update(integrationEvents)
    .set({
      status: outcome.skipped ? "skipped" : outcome.ok ? "processed" : "failed",
      processedAt: new Date(),
      error: outcome.error ?? null,
      updatedAt: new Date(),
    })
    .where(eq(integrationEvents.id, eventId));
}

/**
 * Verwerking starten zonder het antwoord op te houden. Zodra er een echte
 * queue is (bijv. een cron-worker), hangt die hier op dezelfde plek in.
 */
export function processInBackground(
  eventId: string,
  handler: () => Promise<{ skipped?: boolean }>,
): void {
  void (async () => {
    try {
      await db
        .update(integrationEvents)
        .set({ status: "processing" })
        .where(eq(integrationEvents.id, eventId));
      const result = await handler();
      await completeEvent(eventId, { ok: true, skipped: result.skipped });
    } catch (error) {
      await logError({ category: "integration", source: "webhook", error, context: { eventId } });
      await completeEvent(eventId, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();
}
