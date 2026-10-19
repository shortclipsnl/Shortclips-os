import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { kbAssetParts, kbAssets, KB_PART_SIZE } from "@/db/schema";
import { getViewer, canAuthorKennisbank } from "@/server/auth/context";
import { canViewAsset } from "@/server/kennisbank";
import { streamAssetRange } from "@/server/kennisbank-assets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Een kennisbankbestand (afbeelding, PDF, video) tonen of downloaden.
 * Alleen voor ingelogde interne gebruikers, en alleen als het bestand bij een
 * cursus hoort die zij mogen zien. Gestreamd en met Range-ondersteuning.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (!viewer || viewer.isPortalUser) return new Response("Niet toegestaan", { status: 401 });
  const { id } = await ctx.params;
  if (!UUID.test(id)) return new Response("Niet gevonden", { status: 404 });

  const [asset] = await db.select().from(kbAssets).where(eq(kbAssets.id, id)).limit(1);
  if (!asset || (!asset.isComplete && !canAuthorKennisbank(viewer))) return new Response("Niet gevonden", { status: 404 });
  if (!(await canViewAsset(viewer, id))) return new Response("Niet toegestaan", { status: 403 });

  const size = asset.byteSize;
  const download = new URL(req.url).searchParams.has("download");
  const safeName = asset.fileName.replace(/[^\w.\- ()]+/g, "_");
  const headers: Record<string, string> = {
    "Content-Type": asset.contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=86400",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(asset.fileName)}`,
    ...(asset.sha256 ? { ETag: `"${asset.sha256}"` } : {}),
  };
  if (asset.sha256 && req.headers.get("if-none-match") === `"${asset.sha256}"`) {
    return new Response(null, { status: 304, headers });
  }

  const range = req.headers.get("range");
  const m = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (m && size > 0) {
    let start = m[1] ? Number(m[1]) : NaN;
    let end = m[2] ? Number(m[2]) : NaN;
    if (Number.isNaN(start)) {
      start = Math.max(0, size - (Number.isNaN(end) ? 0 : end));
      end = size - 1;
    }
    if (Number.isNaN(end) || end >= size) end = Math.min(size - 1, start + 4 * KB_PART_SIZE - 1);
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
    }
    return new Response(streamAssetRange(id, start, end), {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  if (size === 0) return new Response(new Uint8Array(), { headers: { ...headers, "Content-Length": "0" } });
  return new Response(streamAssetRange(id, 0, size - 1), { headers: { ...headers, "Content-Length": String(size) } });
}

/** Eén deel van een upload (alleen de eigenaar). Body = ruwe bytes, max. 3 MB. */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (!viewer || !canAuthorKennisbank(viewer)) return Response.json({ ok: false, message: "Alleen de eigenaar en projectcoördinatoren mogen bestanden uploaden." }, { status: 403 });
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ ok: false }, { status: 404 });
  const part = Number(new URL(req.url).searchParams.get("part"));
  if (!Number.isInteger(part) || part < 0 || part > 5000) return Response.json({ ok: false, message: "Ongeldig deel." }, { status: 400 });
  const [asset] = await db.select({ id: kbAssets.id, isComplete: kbAssets.isComplete }).from(kbAssets).where(eq(kbAssets.id, id)).limit(1);
  if (!asset || asset.isComplete) return Response.json({ ok: false, message: "Upload niet (meer) open." }, { status: 409 });
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length > KB_PART_SIZE) return Response.json({ ok: false, message: "Deel te groot." }, { status: 413 });
  await db
    .insert(kbAssetParts)
    .values({ assetId: id, partNo: part, byteSize: buf.length, data: buf })
    .onConflictDoUpdate({ target: [kbAssetParts.assetId, kbAssetParts.partNo], set: { data: buf, byteSize: buf.length } });
  return Response.json({ ok: true });
}
