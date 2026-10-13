"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { importCandidates } from "@/db/schema";
import { ForbiddenError, requireOwner } from "@/server/auth/context";
import { auditLog } from "@/server/audit";
import { recordTest, specFor } from "@/server/integrations/registry";
import type { Provider } from "@/server/integrations/types";
import { syncClientDriveFolder } from "@/server/jobs/drive-sync";
import {
  pullFrameComments,
  pullFrameDeliverables,
  pullFrameProjects,
} from "@/server/jobs/frameio-sync";
import { runCalendarSync } from "@/server/jobs/calendar-sync";
import { runMondayClientImport } from "@/server/jobs/monday-import";
import { runDailySignals, runHourlySignals } from "@/server/jobs/maintenance";
import { commitImport, dryRunImport } from "@/server/import";

export type ActionResult<T = unknown> = { ok: boolean; message?: string; data?: T };

export async function testIntegration(provider: string): Promise<ActionResult> {
  try {
    const viewer = await requireOwner();
    const spec = specFor(provider as Provider);
    if (!spec) return { ok: false, message: "Onbekende koppeling." };

    const result = await spec.test();
    await recordTest(provider as Provider, result);
    await auditLog({
      viewer,
      action: "integration.tested",
      entityType: "integration",
      changes: { provider, ok: result.ok },
    });

    revalidatePath("/settings/integrations");
    return { ok: result.ok, message: result.message };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

const JOBS: Record<string, () => Promise<{ ok: boolean; error?: string }>> = {
  "frameio.pull_projects": pullFrameProjects,
  "frameio.pull_deliverables": pullFrameDeliverables,
  "frameio.pull_comments": pullFrameComments,
  "calendar.sync": runCalendarSync,
  "monday.import_clients": runMondayClientImport,
  "signals.daily": runDailySignals,
  "signals.hourly": runHourlySignals,
};

export async function runSyncJob(job: string): Promise<ActionResult> {
  try {
    const viewer = await requireOwner();
    const runner = JOBS[job];
    if (!runner) return { ok: false, message: "Onbekende taak." };

    const result = await runner();
    await auditLog({
      viewer,
      action: "integration.job_run",
      entityType: "sync_job",
      changes: { job, ok: result.ok },
    });

    revalidatePath("/settings/integrations");
    return {
      ok: result.ok,
      message: result.ok ? "Taak afgerond." : (result.error ?? "Taak mislukt."),
    };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function syncDriveForClient(
  clientId: string,
  folderId: string,
): Promise<ActionResult> {
  try {
    const viewer = await requireOwner();
    const result = await syncClientDriveFolder(clientId, folderId, viewer.id);
    revalidatePath("/settings/integrations");
    return { ok: result.ok, message: result.ok ? "Map gesynchroniseerd." : result.error };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function startDryRun(providers: string[]): Promise<ActionResult<{ runId: string }>> {
  try {
    const viewer = await requireOwner();
    const result = await dryRunImport(
      providers as Array<"monday" | "frameio" | "google_drive">,
      viewer.id,
    );
    revalidatePath("/settings/import");
    return { ok: true, data: { runId: result.runId }, message: "Dry run afgerond." };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function decideCandidate(
  candidateId: string,
  decision: "linked" | "created" | "skipped",
  entityId?: string,
): Promise<ActionResult> {
  try {
    await requireOwner();
    await db
      .update(importCandidates)
      .set({ decision, decidedEntityId: entityId ?? null, updatedAt: new Date() })
      .where(eq(importCandidates.id, candidateId));
    revalidatePath("/settings/import");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function confirmImport(runId: string): Promise<ActionResult> {
  try {
    await requireOwner();
    const result = await commitImport(runId);
    revalidatePath("/settings/import");
    revalidatePath("/clients");
    return {
      ok: true,
      message: `${result.linked} gekoppeld, ${result.created} nieuw aangemaakt, ${result.skipped} overgeslagen.`,
    };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}
