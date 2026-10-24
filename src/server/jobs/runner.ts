import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { integrationConnections, syncJobs } from "@/db/schema";
import { logError } from "@/server/audit";
import { notify } from "@/server/notifications";
import type { Provider } from "@/server/integrations/types";
import { IntegrationError, MissingCredentialsError } from "@/server/integrations/types";

export type JobLogEntry = { at: string; level: "info" | "warn" | "error"; message: string };

/** Echte externe koppelingen (de rest gebruikt 'monday' als placeholder voor
 *  interne jobs — die willen we niet als koppelingsfout melden). */
const EXTERNAL_PROVIDERS = new Set<Provider>(["frameio", "google_drive", "google_calendar", "metricool"]);
const PROVIDER_LABEL: Record<string, string> = {
  frameio: "Frame.io",
  google_drive: "Google Drive",
  google_calendar: "Google Agenda",
  metricool: "Metricool",
};

/** Eén melding per koppeling per dag bij een echte sync-fout (geen configuratie-
 *  tekort). De verantwoordelijke (eigenaar) ziet het direct en kan het oplossen. */
async function notifySyncFailure(provider: Provider, message: string): Promise<void> {
  const label = PROVIDER_LABEL[provider] ?? provider;
  const dayKey = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
  await notify({
    roles: ["owner"],
    level: "critical",
    type: "sync_failed",
    title: `Koppeling ${label} synchroniseert niet`,
    body: `De laatste synchronisatie is mislukt: ${message}`.slice(0, 300),
    href: "/settings/integrations",
    dedupeKey: `sync_failed:${provider}:${dayKey}`,
  });
}

export type JobContext = {
  jobId: string;
  log: (message: string, level?: JobLogEntry["level"]) => void;
  counters: { processed: number; created: number; updated: number; failed: number };
};

/**
 * Eén plek waar achtergrondtaken draaien. Elke run wordt van begin tot eind
 * vastgelegd: status, aantallen, regel-voor-regel logboek en eventuele fout.
 * Daardoor is op de integratiepagina te zien wat er precies gebeurd is.
 */
export async function runJob(
  provider: Provider,
  jobType: string,
  params: Record<string, unknown>,
  work: (ctx: JobContext) => Promise<void>,
  options: { triggeredById?: string; scopeType?: string; scopeId?: string } = {},
): Promise<{ jobId: string; ok: boolean; error?: string }> {
  const [job] = await db
    .insert(syncJobs)
    .values({
      provider,
      jobType,
      status: "running",
      params,
      startedAt: new Date(),
      triggeredById: options.triggeredById ?? null,
      scopeType: options.scopeType ?? null,
      scopeId: options.scopeId ?? null,
    })
    .returning({ id: syncJobs.id });

  const entries: JobLogEntry[] = [];
  const ctx: JobContext = {
    jobId: job!.id,
    log: (message, level = "info") => {
      entries.push({ at: new Date().toISOString(), level, message });
    },
    counters: { processed: 0, created: 0, updated: 0, failed: 0 },
  };

  try {
    await work(ctx);

    await db
      .update(syncJobs)
      .set({
        status: ctx.counters.failed > 0 ? "partial" : "success",
        finishedAt: new Date(),
        itemsProcessed: ctx.counters.processed,
        itemsCreated: ctx.counters.created,
        itemsUpdated: ctx.counters.updated,
        itemsFailed: ctx.counters.failed,
        log: entries,
      })
      .where(eq(syncJobs.id, job!.id));

    await db
      .update(integrationConnections)
      .set({
        status: "connected",
        lastSyncAt: new Date(),
        itemsSynced: ctx.counters.processed,
        updatedAt: new Date(),
      })
      .where(eq(integrationConnections.provider, provider));

    return { jobId: job!.id, ok: true };
  } catch (error) {
    const message =
      error instanceof IntegrationError ? error.userMessage : String(error);
    const technical = error instanceof Error ? error.message : String(error);

    entries.push({ at: new Date().toISOString(), level: "error", message: technical });

    await db
      .update(syncJobs)
      .set({
        status: "error",
        finishedAt: new Date(),
        itemsProcessed: ctx.counters.processed,
        itemsCreated: ctx.counters.created,
        itemsUpdated: ctx.counters.updated,
        itemsFailed: ctx.counters.failed,
        log: entries,
        error: message,
      })
      .where(eq(syncJobs.id, job!.id));

    await db
      .update(integrationConnections)
      .set({
        status: error instanceof MissingCredentialsError ? "not_configured" : "error",
        lastErrorAt: new Date(),
        lastErrorMessage: message,
        updatedAt: new Date(),
      })
      .where(eq(integrationConnections.provider, provider));

    await logError({ category: "sync", source: `${provider}:${jobType}`, error });

    // Directe melding aan de verantwoordelijke bij een echte koppelingsfout
    // (niet bij ontbrekende configuratie — dat is een bewuste keuze, geen storing).
    if (EXTERNAL_PROVIDERS.has(provider) && !(error instanceof MissingCredentialsError)) {
      await notifySyncFailure(provider, message).catch(() => {});
    }
    return { jobId: job!.id, ok: false, error: message };
  }
}
