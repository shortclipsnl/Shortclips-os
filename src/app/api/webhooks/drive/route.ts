import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { driveMappings } from "@/db/schema";
import { processInBackground, receiveEvent } from "@/server/webhooks";
import { syncDriveChanges } from "@/server/jobs/drive-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Google Drive-meldingen.
 *
 * Drive stuurt geen inhoud mee, alleen een seintje "er is iets veranderd" met
 * het kanaal-ID in de headers. De echte wijzigingen halen we daarna op met het
 * bewaarde pageToken (changes-API), zodat we niet de hele map opnieuw lezen.
 */
export async function POST(request: Request) {
  const channelId = request.headers.get("x-goog-channel-id");
  const resourceState = request.headers.get("x-goog-resource-state");
  const messageNumber = request.headers.get("x-goog-message-number");

  if (!channelId) {
    return NextResponse.json({ error: "geen kanaal-id" }, { status: 400 });
  }

  // Bij het opzetten van een kanaal stuurt Google eerst een sync-bericht.
  if (resourceState === "sync") {
    return new NextResponse(null, { status: 200 });
  }

  const raw = JSON.stringify({ channelId, resourceState, messageNumber });

  const result = await receiveEvent({
    provider: "google_drive",
    externalEventId: `${channelId}:${messageNumber ?? Date.now()}`,
    eventType: resourceState ?? "change",
    raw,
    payload: { channelId, resourceState, messageNumber },
    // Drive ondertekent niet; de kanaal-ID moet bij een bekende mapping horen.
    signatureValid: null,
  });

  if (result.status !== "accepted") {
    return new NextResponse(null, { status: 200 });
  }

  processInBackground(result.eventId, async () => {
    const [mapping] = await db
      .select()
      .from(driveMappings)
      .where(eq(driveMappings.watchChannelId, channelId))
      .limit(1);
    if (!mapping) return { skipped: true };
    await syncDriveChanges(mapping.id);
    return {};
  });

  return new NextResponse(null, { status: 200 });
}
