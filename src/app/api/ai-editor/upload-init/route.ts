import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { adEditProjects, adEditSources, adStyleAssets, adStyleReferences } from "@/db/schema";
import { getViewer } from "@/server/auth/context";
import { createUploadTarget, safeName } from "@/server/ai-editor/storage";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VIDEO = ["mp4", "mov", "m4v", "mxf", "mkv", "webm", "avi", "mts"];
const AUDIO = ["mp3", "wav", "m4a", "aac", "aiff", "aif", "flac"];

/**
 * Stap 1 van een upload naar de AI Editor: maakt het record aan en geeft een
 * upload-plek terug. De browser stuurt het bestand rechtstreeks naar de opslag
 * (ondertekende Supabase-URL in productie, lokale route in ontwikkeling), dus
 * de 4,5 MB-limiet van Vercel speelt geen rol.
 *
 * kind: "source" (ruw camerabestand) | "reference" (stijlreferentie) | "asset" (muziek/LUT).
 */
export async function POST(req: NextRequest) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });
  let body: { kind?: string; projectId?: string; filename?: string; mimeType?: string; size?: number; title?: string; assetKind?: string; matchProfile?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Onleesbaar verzoek." }, { status: 400 }); }
  const kind = String(body.kind ?? "source");
  const filename = String(body.filename ?? "bestand").slice(0, 300);
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  const size = Number(body.size ?? 0);
  const mime = String(body.mimeType ?? "application/octet-stream");
  const maxMb = env.AI_EDITOR_MAX_UPLOAD_MB;
  const tooBig = Number.isFinite(size) && size > maxMb * 1024 * 1024 && process.env.NODE_ENV === "production";

  if (kind === "source") {
    if (!viewer.permissions.has("ai_editor:run")) return NextResponse.json({ error: "Geen toegang." }, { status: 403 });
    const projectId = String(body.projectId ?? "");
    const [p] = await db.select({ id: adEditProjects.id }).from(adEditProjects).where(eq(adEditProjects.id, projectId)).limit(1);
    if (!p) return NextResponse.json({ error: "Project niet gevonden." }, { status: 404 });
    if (!VIDEO.includes(ext)) return NextResponse.json({ error: "Alleen videobestanden (mp4, mov, mxf, …)." }, { status: 415 });
    if (tooBig) return NextResponse.json({ error: `Bestand groter dan ${maxMb} MB. Zet grote camerabestanden in Google Drive en voeg ze toe via de Drive-link.` }, { status: 413 });
    const [row] = await db.insert(adEditSources).values({ projectId, filename, origin: "upload", sizeBytes: Number.isFinite(size) ? size : null, status: "uploading" }).returning({ id: adEditSources.id });
    const key = `${projectId}/sources/${row!.id}-${safeName(filename)}`;
    try {
      const t = await createUploadTarget(key, mime);
      await db.update(adEditSources).set({ mediaStore: t.store, mediaPath: t.key }).where(eq(adEditSources.id, row!.id));
      return NextResponse.json({ id: row!.id, ...t });
    } catch (e) {
      await db.delete(adEditSources).where(eq(adEditSources.id, row!.id));
      return NextResponse.json({ error: String(e) }, { status: 500 });
    }
  }

  if (!viewer.permissions.has("ai_editor:style")) return NextResponse.json({ error: "Geen toegang tot Stijlbeheer." }, { status: 403 });
  if (tooBig) return NextResponse.json({ error: `Bestand groter dan ${maxMb} MB.` }, { status: 413 });

  if (kind === "reference") {
    if (!VIDEO.includes(ext)) return NextResponse.json({ error: "Alleen videobestanden." }, { status: 415 });
    const [row] = await db.insert(adStyleReferences).values({ title: String(body.title || filename).slice(0, 240), status: "uploading", createdById: viewer.id }).returning({ id: adStyleReferences.id });
    const key = `references/${row!.id}-${safeName(filename)}`;
    const t = await createUploadTarget(key, mime);
    await db.update(adStyleReferences).set({ mediaStore: t.store, mediaPath: t.key }).where(eq(adStyleReferences.id, row!.id));
    return NextResponse.json({ id: row!.id, ...t });
  }

  if (kind === "asset") {
    const assetKind = body.assetKind === "lut" ? "lut" : "music";
    if (assetKind === "lut" && ext !== "cube") return NextResponse.json({ error: "Een LUT moet een .cube-bestand zijn." }, { status: 415 });
    if (assetKind === "music" && !AUDIO.includes(ext)) return NextResponse.json({ error: "Alleen audiobestanden (mp3, wav, m4a, …)." }, { status: 415 });
    const [row] = await db.insert(adStyleAssets).values({ kind: assetKind, name: filename, matchProfile: body.matchProfile ? String(body.matchProfile).toLowerCase().slice(0, 60) : null, isActive: false, createdById: viewer.id }).returning({ id: adStyleAssets.id });
    const key = `assets/${row!.id}-${safeName(filename)}`;
    const t = await createUploadTarget(key, mime);
    await db.update(adStyleAssets).set({ mediaStore: t.store, mediaPath: t.key }).where(eq(adStyleAssets.id, row!.id));
    return NextResponse.json({ id: row!.id, ...t });
  }
  return NextResponse.json({ error: "Onbekend type upload." }, { status: 400 });
}
