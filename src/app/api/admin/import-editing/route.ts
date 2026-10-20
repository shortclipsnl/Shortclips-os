import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { syncJobs } from "@/db/schema";
import { getViewer, isOwner } from "@/server/auth/context";
import { runMondayEditingImport } from "@/server/jobs/monday-editing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Eenmalige overname van de lopende editing-opdrachten uit Monday (EDITING
 * DASHBOARD) naar de portal: fase, editor, deadline, downloadlink en script per
 * video. Idempotent (dedup op Monday-item). Alleen de eigenaar, onder de eigen
 * sessie. Bedoeld om Monday leeg te trekken — daarna kan Monday eruit.
 */
async function handle() {
  const viewer = await getViewer();
  if (!isOwner(viewer)) {
    return NextResponse.json({ error: "Alleen de eigenaar kan de overname starten." }, { status: 403 });
  }

  const result = await runMondayEditingImport();
  const [job] = await db
    .select({
      processed: syncJobs.itemsProcessed,
      created: syncJobs.itemsCreated,
      updated: syncJobs.itemsUpdated,
      failed: syncJobs.itemsFailed,
      jobError: syncJobs.error,
    })
    .from(syncJobs)
    .where(eq(syncJobs.id, result.jobId))
    .limit(1);

  return NextResponse.json({
    ok: result.ok,
    error: result.ok ? undefined : result.error,
    ...(job ?? {}),
  });
}

export const POST = handle;
