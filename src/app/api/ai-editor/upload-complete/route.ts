import { NextResponse, after, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { adEditSources, adStyleAssets, adStyleReferences } from "@/db/schema";
import { getViewer } from "@/server/auth/context";
import { enqueue } from "@/server/ai-editor/queue";
import { kickInline } from "@/server/ai-editor/inline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stap 3: het bestand staat in de opslag. Markeert het als klaar (en start bij een referentie de analyse). */
export async function POST(req: NextRequest) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });
  let body: { kind?: string; id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Onleesbaar verzoek." }, { status: 400 }); }
  const id = String(body.id ?? "");
  if (body.kind === "source") {
    if (!viewer.permissions.has("ai_editor:run")) return NextResponse.json({ error: "Geen toegang." }, { status: 403 });
    await db.update(adEditSources).set({ status: "ready", updatedAt: new Date() }).where(eq(adEditSources.id, id));
    return NextResponse.json({ ok: true });
  }
  if (!viewer.permissions.has("ai_editor:style")) return NextResponse.json({ error: "Geen toegang." }, { status: 403 });
  if (body.kind === "reference") {
    await db.update(adStyleReferences).set({ status: "queued", updatedAt: new Date() }).where(eq(adStyleReferences.id, id));
    await enqueue("analyze_reference", { referenceId: id });
    after(async () => { await kickInline(); });
    return NextResponse.json({ ok: true });
  }
  if (body.kind === "asset") {
    await db.update(adStyleAssets).set({ isActive: true, updatedAt: new Date() }).where(eq(adStyleAssets.id, id));
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Onbekend type." }, { status: 400 });
}
