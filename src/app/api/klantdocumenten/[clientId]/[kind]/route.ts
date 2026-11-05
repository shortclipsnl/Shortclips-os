import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { clientDocuments, kbAssetParts, kbAssets, KB_PART_SIZE } from "@/db/schema";
import { getViewer } from "@/server/auth/context";
import {
  canManageClientDocs,
  canViewClientDoc,
  clientExists,
  DOC_LABEL,
  getCurrentDoc,
  isDocKind,
} from "@/server/client-documents";
import { finalizeAsset, streamAssetRange } from "@/server/kennisbank-assets";
import { auditLog } from "@/server/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Eén vaste link per klant per document (Klanten Guide / Editing Guide).
 *
 *   GET    → de geldende (nieuwste) versie, inline of ?download=1
 *   POST   → nieuwe upload starten (alleen klantbeheer)
 *   PUT    → één deel van die upload (?asset=…&part=n, max 3 MB)
 *   PATCH  → upload afronden; wordt daarmee direct de geldende versie overal
 *
 * Alle plekken in het portaal linken hierheen, zodat een vervanging meteen op
 * Productie → Klanten én in de Klantenbibliotheek zichtbaar is.
 */

type Ctx = { params: Promise<{ clientId: string; kind: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 50 * 1024 * 1024;

function notAvailable(title: string, body: string, status: number) {
  const html = `<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>${title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:Poppins,system-ui,sans-serif;background:#f6f7fb;color:#00003b;display:grid;place-items:center;min-height:100vh;margin:0}
.c{background:#fff;border:1px solid #e3e5ee;border-radius:14px;padding:28px 32px;max-width:460px}h1{font-size:18px;margin:0 0 8px}p{margin:0;color:#555b70;font-size:14px;line-height:1.5}</style>
</head><body><div class="c"><h1>${title}</h1><p>${body}</p></div></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function GET(req: Request, ctx: Ctx) {
  const { clientId, kind } = await ctx.params;
  const viewer = await getViewer();
  if (!viewer || viewer.isPortalUser) return new Response("Niet toegestaan", { status: 401 });
  if (!isDocKind(kind) || !UUID.test(clientId)) return notAvailable("Niet gevonden", "Deze link klopt niet.", 404);
  if (!(await canViewClientDoc(viewer, clientId, kind))) return notAvailable("Geen toegang", "Je hebt geen toegang tot dit document.", 403);

  const url = new URL(req.url);
  const variant = (url.searchParams.get("v") ?? "").slice(0, 80);
  const doc = await getCurrentDoc(clientId, kind, variant);
  if (!doc) {
    const client = await clientExists(clientId);
    return notAvailable(`${DOC_LABEL[kind]} volgt`, `Voor ${client?.name ?? "deze klant"} is nog geen ${DOC_LABEL[kind]} geüpload. Zodra die er is, opent deze link automatisch de nieuwste versie.`, 404);
  }
  const [asset] = await db.select().from(kbAssets).where(eq(kbAssets.id, doc.assetId)).limit(1);
  if (!asset || !asset.isComplete) return notAvailable("Bestand ontbreekt", "Het bestand is niet volledig opgeslagen. Upload het opnieuw.", 404);

  const size = asset.byteSize;
  const download = url.searchParams.get("download") === "1";
  const safeName = doc.fileName.replace(/[^\w.\- ()]+/g, "_");
  const headers: Record<string, string> = {
    "Content-Type": asset.contentType || "application/pdf",
    "Accept-Ranges": "bytes",
    // Altijd opnieuw valideren: na een vervanging moet direct de nieuwe versie komen.
    "Cache-Control": "private, no-cache",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`,
    ...(asset.sha256 ? { ETag: `"${asset.sha256}"` } : {}),
  };
  if (asset.sha256 && req.headers.get("if-none-match") === `"${asset.sha256}"`) return new Response(null, { status: 304, headers });

  const m = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (m && size > 0) {
    let start = m[1] ? Number(m[1]) : NaN;
    let end = m[2] ? Number(m[2]) : NaN;
    if (Number.isNaN(start)) {
      start = Math.max(0, size - (Number.isNaN(end) ? 0 : end));
      end = size - 1;
    }
    if (Number.isNaN(end) || end >= size) end = Math.min(size - 1, start + 4 * KB_PART_SIZE - 1);
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
    return new Response(streamAssetRange(doc.assetId, start, end), {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  return new Response(streamAssetRange(doc.assetId, 0, Math.max(0, size - 1)), { headers: { ...headers, "Content-Length": String(size) } });
}

async function guard(ctx: Ctx) {
  const { clientId, kind } = await ctx.params;
  const viewer = await getViewer();
  if (!viewer || viewer.isPortalUser || !canManageClientDocs(viewer)) return { error: Response.json({ ok: false, message: "Alleen het kernteam kan guides uploaden of vervangen." }, { status: 403 }) } as const;
  if (!isDocKind(kind)) return { error: Response.json({ ok: false, message: "Onbekend documenttype." }, { status: 400 }) } as const;
  const client = await clientExists(clientId);
  if (!client) return { error: Response.json({ ok: false, message: "Klant niet gevonden." }, { status: 404 }) } as const;
  return { viewer, client, kind } as const;
}

const startSchema = z.object({
  fileName: z.string().trim().min(1).max(300),
  byteSize: z.number().int().min(1).max(MAX_BYTES),
  contentType: z.string().trim().max(160).optional(),
});

/** Upload starten. */
export async function POST(req: Request, ctx: Ctx) {
  const g = await guard(ctx);
  if ("error" in g) return g.error;
  const parsed = startSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ ok: false, message: "Kies een PDF van maximaal 50 MB." }, { status: 400 });
  const { fileName, byteSize } = parsed.data;
  const contentType = parsed.data.contentType || "application/pdf";
  if (!/pdf/i.test(contentType) && !/\.pdf$/i.test(fileName)) return Response.json({ ok: false, message: "Alleen PDF-bestanden." }, { status: 400 });
  const [row] = await db
    .insert(kbAssets)
    .values({ kind: "file", fileName, contentType: "application/pdf", byteSize, isComplete: false, createdById: g.viewer.id, sourceRef: `klantdocument:${g.client.id}:${g.kind}` })
    .returning({ id: kbAssets.id });
  return Response.json({ ok: true, assetId: row!.id, partSize: KB_PART_SIZE });
}

/** Eén deel uploaden. */
export async function PUT(req: Request, ctx: Ctx) {
  const g = await guard(ctx);
  if ("error" in g) return g.error;
  const url = new URL(req.url);
  const assetId = url.searchParams.get("asset") ?? "";
  const part = Number(url.searchParams.get("part"));
  if (!UUID.test(assetId) || !Number.isInteger(part) || part < 0 || part > 100) return Response.json({ ok: false, message: "Ongeldig deel." }, { status: 400 });
  const [asset] = await db
    .select({ id: kbAssets.id, isComplete: kbAssets.isComplete })
    .from(kbAssets)
    .where(and(eq(kbAssets.id, assetId), eq(kbAssets.sourceRef, `klantdocument:${g.client.id}:${g.kind}`)))
    .limit(1);
  if (!asset || asset.isComplete) return Response.json({ ok: false, message: "Upload niet (meer) open." }, { status: 409 });
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length === 0 || buf.length > KB_PART_SIZE) return Response.json({ ok: false, message: "Deel te groot." }, { status: 413 });
  await db
    .insert(kbAssetParts)
    .values({ assetId, partNo: part, byteSize: buf.length, data: buf })
    .onConflictDoUpdate({ target: [kbAssetParts.assetId, kbAssetParts.partNo], set: { data: buf, byteSize: buf.length } });
  return Response.json({ ok: true });
}

const finishSchema = z.object({
  assetId: z.string().regex(UUID),
  fileName: z.string().trim().min(1).max(300),
  variant: z.string().trim().max(80).optional(),
});

/** Upload afronden: wordt direct de geldende versie op alle plekken. */
export async function PATCH(req: Request, ctx: Ctx) {
  const g = await guard(ctx);
  if ("error" in g) return g.error;
  const parsed = finishSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ ok: false, message: "Ongeldige afronding." }, { status: 400 });
  const [asset] = await db
    .select({ id: kbAssets.id, byteSize: kbAssets.byteSize })
    .from(kbAssets)
    .where(and(eq(kbAssets.id, parsed.data.assetId), eq(kbAssets.sourceRef, `klantdocument:${g.client.id}:${g.kind}`)))
    .limit(1);
  if (!asset) return Response.json({ ok: false, message: "Upload niet gevonden." }, { status: 404 });
  const res = await finalizeAsset(asset.id);
  if (!res.ok) return Response.json(res, { status: 400 });
  await db.insert(clientDocuments).values({
    clientId: g.client.id,
    kind: g.kind,
    variant: parsed.data.variant ?? "",
    assetId: asset.id,
    fileName: parsed.data.fileName,
    sizeBytes: asset.byteSize,
    uploadedById: g.viewer.id,
  });
  await auditLog({ viewer: g.viewer, action: "klantdocument.upload", entityType: "client_document", clientId: g.client.id, changes: { kind: g.kind, variant: parsed.data.variant ?? "", fileName: parsed.data.fileName }, outcome: "allow" }).catch(() => {});
  revalidatePath("/clients");
  revalidatePath(`/clients/${g.client.slug}`);
  revalidatePath("/mijn-klanten");
  revalidatePath(`/mijn-klanten/${g.client.slug}`);
  revalidatePath("/kennisbank", "layout");
  return Response.json({ ok: true });
}
