import { z } from "zod";
import { db } from "@/db/client";
import { kbAssets } from "@/db/schema";
import { getViewer, canAuthorKennisbank } from "@/server/auth/context";
import { auditLog } from "@/server/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

const schema = z.object({
  fileName: z.string().trim().min(1).max(400),
  contentType: z.string().trim().min(1).max(160),
  byteSize: z.number().int().min(0).max(MAX_BYTES),
});

/** Start een upload (alleen de eigenaar). Daarna delen via PUT en afronden via /complete. */
export async function POST(req: Request) {
  const viewer = await getViewer();
  if (!viewer || !canAuthorKennisbank(viewer)) {
    await auditLog({ viewer, action: "kennisbank.asset.upload", outcome: "deny" }).catch(() => {});
    return Response.json({ ok: false, message: "Alleen de eigenaar en projectcoördinatoren mogen bestanden uploaden." }, { status: 403 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ ok: false, message: "Ongeldig bestand." }, { status: 400 });
  const ct = parsed.data.contentType;
  const kind = ct.startsWith("image/") ? "image" : ct.startsWith("video/") ? "video" : "file";
  const [row] = await db
    .insert(kbAssets)
    .values({ kind, fileName: parsed.data.fileName, contentType: ct, byteSize: parsed.data.byteSize, isComplete: false, createdById: viewer.id, sourceRef: "upload" })
    .returning({ id: kbAssets.id });
  return Response.json({ ok: true, id: row!.id, kind });
}
