import { NextResponse, type NextRequest } from "next/server";
import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { adEditProjects, adStyleReferences } from "@/db/schema";
import { getViewer } from "@/server/auth/context";
import { diskPath, signedUrl, type Store } from "@/server/ai-editor/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Afspelen/downloaden van previews, exports en referenties. Supabase: redirect
 * naar een kortlevende ondertekende URL. Disk: gestreamd met Range-support,
 * zodat de speler kan doorspoelen.
 *   ?project=<id>&kind=preview|final[&download=1]   of   ?reference=<id>
 */
export async function GET(req: NextRequest) {
  const viewer = await getViewer();
  if (!viewer) return new NextResponse(null, { status: 401 });
  if (!viewer.permissions.has("ai_editor:read")) return new NextResponse(null, { status: 403 });
  const sp = req.nextUrl.searchParams;
  let store: string | null = null;
  let key: string | null = null;
  let name = "video.mp4";
  if (sp.get("project")) {
    const [p] = await db.select().from(adEditProjects).where(eq(adEditProjects.id, sp.get("project")!)).limit(1);
    if (!p) return new NextResponse(null, { status: 404 });
    const final = sp.get("kind") === "final";
    store = final ? p.finalStore : p.previewStore;
    key = final ? p.finalPath : p.previewPath;
    const slug = p.title.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "advertentie";
    name = final ? `${slug}-${p.finalFormat ?? "9x16"}-v${p.planVersion}.mp4` : `${slug}-preview-v${p.planVersion}.mp4`;
  } else if (sp.get("reference")) {
    const [r] = await db.select().from(adStyleReferences).where(eq(adStyleReferences.id, sp.get("reference")!)).limit(1);
    if (!r) return new NextResponse(null, { status: 404 });
    store = r.mediaStore; key = r.mediaPath;
  }
  if (!store || !key) return new NextResponse(null, { status: 404 });
  const download = sp.get("download") === "1";

  if (store === "supabase") {
    const url = await signedUrl(store as Store, key, 3600, download ? name : undefined);
    return url ? NextResponse.redirect(url) : new NextResponse(null, { status: 404 });
  }
  let abs: string;
  try { abs = diskPath(key); } catch { return new NextResponse(null, { status: 400 }); }
  let size: number;
  try { size = statSync(abs).size; } catch { return new NextResponse(null, { status: 404 }); }
  const headers: Record<string, string> = { "content-type": "video/mp4", "accept-ranges": "bytes", "cache-control": "private, max-age=60" };
  if (download) headers["content-disposition"] = `attachment; filename="${name}"`;
  const range = req.headers.get("range");
  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/);
    const start = m?.[1] ? Number(m[1]) : 0;
    const end = m?.[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start >= size) return new NextResponse(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    const stream = Readable.toWeb(createReadStream(abs, { start, end })) as unknown as ReadableStream;
    return new NextResponse(stream, { status: 206, headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) } });
  }
  const stream = Readable.toWeb(createReadStream(abs)) as unknown as ReadableStream;
  return new NextResponse(stream, { status: 200, headers: { ...headers, "content-length": String(size) } });
}
