import { NextResponse, type NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { adEditProjects, aiEditorJobs } from "@/db/schema";
import { getViewer } from "@/server/auth/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lichte status voor live voortgang (polling vanuit de pagina). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (!viewer?.permissions.has("ai_editor:read")) return new NextResponse(null, { status: 403 });
  const { id } = await ctx.params;
  const [p] = await db.select({ status: adEditProjects.status, phase: adEditProjects.phase, progress: adEditProjects.progress, planVersion: adEditProjects.planVersion, error: adEditProjects.error, updatedAt: adEditProjects.updatedAt })
    .from(adEditProjects).where(eq(adEditProjects.id, id)).limit(1);
  if (!p) return new NextResponse(null, { status: 404 });
  const [job] = await db.select({ status: aiEditorJobs.status, createdAt: aiEditorJobs.createdAt }).from(aiEditorJobs)
    .where(and(eq(aiEditorJobs.projectId, id), isNull(aiEditorJobs.finishedAt))).limit(1);
  // Staat een job al > 2 minuten in de wachtrij, dan draait er waarschijnlijk geen worker.
  const waitingForWorker = job?.status === "queued" && Date.now() - new Date(job.createdAt).getTime() > 120_000;
  return NextResponse.json({ ...p, busy: Boolean(job), waitingForWorker });
}
