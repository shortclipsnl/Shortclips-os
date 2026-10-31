import { NextResponse, type NextRequest } from "next/server";
import { eq, or } from "drizzle-orm";
import { db } from "@/db/client";
import { adEditSources, adStyleAssets, adStyleReferences } from "@/db/schema";
import { getViewer } from "@/server/auth/context";
import { writeDiskStream } from "@/server/ai-editor/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lokale upload-bestemming (alleen ontwikkeling / disk-opslag). Streamt de
 * bytes naar .data/ai-editor zonder ze in het geheugen te laden. Alleen
 * sleutels die bij een eerder aangemaakt record horen worden geaccepteerd.
 */
export async function PUT(req: NextRequest) {
  const viewer = await getViewer();
  if (!viewer) return new NextResponse(null, { status: 401 });
  if (!viewer.permissions.has("ai_editor:run") && !viewer.permissions.has("ai_editor:style")) return new NextResponse(null, { status: 403 });
  const key = req.nextUrl.searchParams.get("key") ?? "";
  const [src] = await db.select({ id: adEditSources.id }).from(adEditSources).where(eq(adEditSources.mediaPath, key)).limit(1);
  const [ref] = src ? [null] : await db.select({ id: adStyleReferences.id }).from(adStyleReferences).where(eq(adStyleReferences.mediaPath, key)).limit(1);
  const [asset] = src || ref ? [null] : await db.select({ id: adStyleAssets.id }).from(adStyleAssets).where(or(eq(adStyleAssets.mediaPath, key))).limit(1);
  if (!src && !ref && !asset) return NextResponse.json({ error: "Onbekende upload." }, { status: 404 });
  if (!req.body) return NextResponse.json({ error: "Leeg bestand." }, { status: 400 });
  const size = await writeDiskStream(key, req.body);
  const expected = Number(req.headers.get("content-length") ?? 0);
  if (expected && size !== expected) {
    return NextResponse.json({ error: `Upload onvolledig ontvangen (${size} van ${expected} bytes). Probeer opnieuw.` }, { status: 400 });
  }
  if (src) await db.update(adEditSources).set({ sizeBytes: size }).where(eq(adEditSources.id, src.id));
  return NextResponse.json({ ok: true, size });
}
