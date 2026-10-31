import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { aiEditorJobs } from "@/db/schema";

/**
 * Wachtrij voor de AI Editor. De online hub zet jobs klaar; de verwerk-server
 * claimt ze atomisch (FOR UPDATE SKIP LOCKED), zodat meerdere workers veilig
 * naast elkaar kunnen draaien. Een job die te lang op "processing" staat
 * (worker gecrasht) wordt opnieuw opgepakt.
 */

export type JobKind = "generate" | "revise" | "export" | "analyze_reference";

export async function enqueue(kind: JobKind, opts: { projectId?: string; referenceId?: string; payload?: Record<string, unknown> }): Promise<string> {
  const [row] = await db.insert(aiEditorJobs).values({
    kind,
    projectId: opts.projectId ?? null,
    referenceId: opts.referenceId ?? null,
    payload: opts.payload ?? {},
  }).returning({ id: aiEditorJobs.id });
  return row!.id;
}

export async function claimNextJob(staleMinutes = 90): Promise<string | null> {
  const res = await db.execute(sql`
    update ai_editor_jobs set status = 'processing', started_at = now(), updated_at = now(), attempts = attempts + 1
    where id = (
      select id from ai_editor_jobs
      where (status = 'queued' and (project_id is null or project_id not in (select project_id from ai_editor_jobs where status = 'processing' and project_id is not null)))
         or (status = 'processing' and updated_at < now() - (${staleMinutes} || ' minutes')::interval and attempts < 3)
      order by created_at
      limit 1
      for update skip locked
    )
    returning id
  `);
  const rows = (res as unknown as { rows?: Array<{ id: string }> }).rows ?? (res as unknown as Array<{ id: string }>);
  return rows[0]?.id ?? null;
}
