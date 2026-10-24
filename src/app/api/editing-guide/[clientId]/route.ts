import { NextResponse, type NextRequest } from "next/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clientEditingGuides } from "@/db/schema";
import { getViewer } from "@/server/auth/context";
import { assertLibraryAccess } from "@/server/client-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serveert de meest recente Editing Guide-PDF van een klant, inline (bekijken in
 * het portaal) of als download (?download=1). Toegang alleen voor een gebruiker
 * die aan de klant gekoppeld is — server-side afgedwongen, niet via de UI.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const viewer = await getViewer();
  if (!viewer || viewer.isPortalUser) return new NextResponse(null, { status: 401 });
  if (!(await assertLibraryAccess(viewer, clientId))) return new NextResponse(null, { status: 403 });

  const [guide] = await db
    .select({ fileName: clientEditingGuides.fileName, contentType: clientEditingGuides.contentType, dataBase64: clientEditingGuides.dataBase64 })
    .from(clientEditingGuides)
    .where(and(eq(clientEditingGuides.clientId, clientId), isNull(clientEditingGuides.deletedAt)))
    .orderBy(desc(clientEditingGuides.createdAt))
    .limit(1);
  if (!guide) return new NextResponse(null, { status: 404 });

  const bytes = Buffer.from(guide.dataBase64, "base64");
  const download = new URL(req.url).searchParams.get("download") === "1";
  const safeName = guide.fileName.replace(/[^\p{L}\p{N}. _-]+/gu, "").trim() || "editing-guide.pdf";
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type": guide.contentType || "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${safeName}"`,
      "Cache-Control": "no-store",
    },
  });
}
