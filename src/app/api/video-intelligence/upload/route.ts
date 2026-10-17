import { NextResponse, type NextRequest } from "next/server";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { videoAnalyses, videoAnalysisSteps } from "@/db/schema";
import { getViewer, hasClientAccess } from "@/server/auth/context";
import { ensureAnalysisDir, analysisDir, toStoreRelative } from "@/server/video-intelligence/paths";
import { runPipeline } from "@/server/video-intelligence/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 500 * 1024 * 1024; // 500 MB
const EXT_BY_TYPE: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-matroska": "mkv",
};

/**
 * Upload van een MP4 als terugval wanneer een platform-URL niet op te halen is.
 * Rechtgescoped (video_intelligence:run) + klant-gescoped. Schrijft het bestand
 * naar lokale opslag en start de analyse.
 */
export async function POST(req: NextRequest) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });
  if (!viewer.permissions.has("video_intelligence:run")) return NextResponse.json({ error: "Geen toegang." }, { status: 403 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Onleesbare upload." }, { status: 400 });
  }
  const file = form.get("file");
  const clientId = String(form.get("clientId") ?? "");
  const title = String(form.get("title") ?? "").trim() || null;

  if (!(file instanceof File)) return NextResponse.json({ error: "Geen bestand ontvangen." }, { status: 400 });
  if (!clientId) return NextResponse.json({ error: "Kies een klant." }, { status: 400 });
  if (!hasClientAccess(viewer, clientId)) return NextResponse.json({ error: "Deze klant hoort niet bij jouw toegang." }, { status: 403 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Bestand te groot (max 500 MB)." }, { status: 413 });

  const ext = EXT_BY_TYPE[file.type] ?? (file.name.split(".").pop() ?? "mp4").toLowerCase();
  if (!["mp4", "mov", "webm", "mkv", "m4v"].includes(ext)) {
    return NextResponse.json({ error: "Alleen videobestanden (mp4/mov/webm/mkv)." }, { status: 415 });
  }

  const [created] = await db.insert(videoAnalyses).values({
    clientId,
    title,
    sourceType: "upload",
    status: "queued",
    mimeType: file.type || "video/mp4",
    fileSizeBytes: file.size,
    createdById: viewer.id,
  }).returning({ id: videoAnalyses.id });
  const id = created!.id;

  await ensureAnalysisDir(id);
  const abs = path.join(analysisDir(id), `source.${ext}`);
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(abs, bytes);
  await db.update(videoAnalyses).set({ mediaPath: toStoreRelative(abs), updatedAt: new Date() }).where(eq(videoAnalyses.id, id));

  await db.insert(videoAnalysisSteps).values(
    (["download", "probe", "shots", "editing", "ocr", "transcribe", "vision", "insights"] as const).map((step) => ({ analysisId: id, step })),
  );

  void runPipeline(id).catch(() => {});
  return NextResponse.json({ id });
}
