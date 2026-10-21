import { NextResponse, after, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { videoAnalyses, videoAnalysisSteps } from "@/db/schema";
import { getViewer, hasClientAccess } from "@/server/auth/context";
import { runPipeline } from "@/server/video-intelligence/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Stap 3 van de upload: het bestand staat in de opslag. Zet de stappenrijen klaar
 * en start de verwerkingspijplijn op de achtergrond (after), zodat de functie na
 * het antwoord blijft draaien tot de analyse klaar is (binnen maxDuration).
 */
export async function POST(req: NextRequest) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });
  if (!viewer.permissions.has("video_intelligence:run")) return NextResponse.json({ error: "Geen toegang." }, { status: 403 });

  let body: { id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Onleesbaar verzoek." }, { status: 400 });
  }
  const id = String(body.id ?? "");

  const [a] = await db
    .select({ clientId: videoAnalyses.clientId, mediaPath: videoAnalyses.mediaPath })
    .from(videoAnalyses)
    .where(eq(videoAnalyses.id, id))
    .limit(1);
  if (!a) return NextResponse.json({ error: "Analyse niet gevonden." }, { status: 404 });
  if (!hasClientAccess(viewer, a.clientId)) return NextResponse.json({ error: "Geen toegang." }, { status: 403 });
  if (!a.mediaPath) return NextResponse.json({ error: "Er is nog geen bestand geüpload." }, { status: 400 });

  await db
    .insert(videoAnalysisSteps)
    .values((["download", "probe", "shots", "editing", "ocr", "transcribe", "vision", "insights"] as const).map((step) => ({ analysisId: id, step })))
    .onConflictDoNothing();

  after(() => runPipeline(id).catch(() => {}));
  return NextResponse.json({ ok: true, id });
}
