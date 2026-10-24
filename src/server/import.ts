import "server-only";
import {
  eq,
  isNull,
} from "drizzle-orm";
import { db } from "@/db/client";
import {
  clientIntegrations,
  clients,
  importCandidates,
  importRuns,
} from "@/db/schema";
import { frameio } from "@/server/integrations/frameio";
import { drive } from "@/server/integrations/drive";
import { auditLog } from "@/server/audit";

/**
 * Import in twee stappen: eerst een dry run die alleen kijkt en voorstelt,
 * daarna een bevestigde import. Nooit blind overnemen — bij twijfel beslist de
 * beheerder in het reconciliation-scherm.
 */

/** Naamvergelijking die "Friesland Lease", "FrieslandLease" en "Friesland Lease 2026" bij elkaar brengt. */
export function normalizeName(input: string): string {
  return input
    .toLowerCase()
    .replace(/\b(b\.?v\.?|n\.?v\.?|v\.?o\.?f\.?)\b/g, "")
    .replace(/\b(19|20)\d{2}\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** 0–100. Gebaseerd op de genormaliseerde naam plus het langste gemeenschappelijke begin. */
export function matchScore(a: string, b: string): number {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return 0;
  if (x === y) return 100;
  if (x.includes(y) || y.includes(x)) {
    const ratio = Math.min(x.length, y.length) / Math.max(x.length, y.length);
    return Math.round(70 + ratio * 25);
  }

  let common = 0;
  while (common < x.length && common < y.length && x[common] === y[common]) common++;
  const score = Math.round((common / Math.max(x.length, y.length)) * 70);
  return score >= 30 ? score : 0;
}

export type DryRunSummary = {
  provider: string;
  found: Record<string, number>;
  suggestions: number;
  conflicts: number;
  missingMappings: number;
  notes: string[];
};

/**
 * Dry run: haalt op wat er in de externe systemen staat, zoekt bestaande
 * ShortClips-klanten erbij en schrijft voorstellen weg. Er verandert nog niets
 * aan de echte data.
 */
export async function dryRunImport(
  providers: Array<"frameio" | "google_drive">,
  startedById: string,
): Promise<{ runId: string; summary: DryRunSummary[] }> {
  const [run] = await db
    .insert(importRuns)
    .values({
      provider: providers.join(","),
      status: "dry_run",
      params: { providers },
      startedById,
    })
    .returning({ id: importRuns.id });

  const existingClients = await db
    .select({ id: clients.id, name: clients.name, slug: clients.slug })
    .from(clients)
    .where(isNull(clients.deletedAt));

  const summaries: DryRunSummary[] = [];

  for (const provider of providers) {
    const summary: DryRunSummary = {
      provider,
      found: {},
      suggestions: 0,
      conflicts: 0,
      missingMappings: 0,
      notes: [],
    };

    try {
      if (provider === "frameio") {
        if (!frameio.isConfigured) {
          summary.notes.push("Frame.io is niet ingesteld; FRAMEIO_TOKEN ontbreekt.");
        } else {
          const projects = await frameio.listProjects();
          summary.found.projects = projects.length;

          for (const project of projects) {
            const best = bestMatch(project.name, existingClients);
            summary.suggestions += best ? 1 : 0;
            if (!best) summary.missingMappings++;
            if (best && best.score < 80) summary.conflicts++;

            await db.insert(importCandidates).values({
              runId: run!.id,
              entityType: "client",
              provider: "frameio",
              externalId: project.id,
              externalName: project.name,
              payload: { rootFolderId: project.root_folder_id, workspaceId: project.workspace_id },
              suggestedEntityId: best?.id ?? null,
              suggestedName: best?.name ?? null,
              matchScore: best?.score ?? 0,
              conflictReason:
                best && best.score < 80 ? "Projectnaam wijkt af van de klantnaam." : null,
            }).onConflictDoNothing();
          }
        }
      }

      if (provider === "google_drive") {
        if (!drive.isConfigured) {
          summary.notes.push(
            "Google Drive is niet ingesteld; GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET en GOOGLE_REFRESH_TOKEN ontbreken.",
          );
        } else {
          const root = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
          if (!root) {
            summary.notes.push(
              "GOOGLE_DRIVE_ROOT_FOLDER_ID ontbreekt. Zonder hoofdmap weten we niet welke mappen klanten zijn.",
            );
          } else {
            const folders = (await drive.listFolder(root)).filter((f) =>
              f.mimeType === "application/vnd.google-apps.folder",
            );
            summary.found.folders = folders.length;

            for (const folder of folders) {
              const best = bestMatch(folder.name, existingClients);
              summary.suggestions += best ? 1 : 0;
              if (!best) summary.missingMappings++;
              if (best && best.score < 80) summary.conflicts++;

              await db.insert(importCandidates).values({
                runId: run!.id,
                entityType: "client",
                provider: "google_drive",
                externalId: folder.id,
                externalName: folder.name,
                payload: { webViewLink: folder.webViewLink },
                suggestedEntityId: best?.id ?? null,
                suggestedName: best?.name ?? null,
                matchScore: best?.score ?? 0,
                conflictReason:
                  best && best.score < 80 ? "Mapnaam bevat mogelijk een jaartal of afwijkende schrijfwijze." : null,
              }).onConflictDoNothing();
            }
          }
        }
      }
    } catch (error) {
      summary.notes.push(
        error instanceof Error ? error.message : "Onbekende fout bij het ophalen.",
      );
    }

    summaries.push(summary);
  }

  await db
    .update(importRuns)
    .set({ summary: { summaries } })
    .where(eq(importRuns.id, run!.id));

  return { runId: run!.id, summary: summaries };
}

function bestMatch(
  externalName: string,
  candidates: Array<{ id: string; name: string }>,
): { id: string; name: string; score: number } | null {
  let best: { id: string; name: string; score: number } | null = null;
  for (const candidate of candidates) {
    const score = matchScore(externalName, candidate.name);
    if (score >= 40 && (!best || score > best.score)) {
      best = { id: candidate.id, name: candidate.name, score };
    }
  }
  return best;
}

/**
 * Definitieve import. Alleen kandidaten met een beslissing worden verwerkt:
 * `linked` koppelt aan een bestaande klant, `created` maakt een nieuwe klant
 * aan, `skipped` slaat over.
 */
export async function commitImport(
  runId: string,
): Promise<{ linked: number; created: number; skipped: number }> {
  const candidates = await db
    .select()
    .from(importCandidates)
    .where(eq(importCandidates.runId, runId));

  let linked = 0;
  let created = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    if (candidate.decision === "pending" || candidate.decision === "skipped") {
      skipped++;
      continue;
    }

    let clientId = candidate.decidedEntityId ?? candidate.suggestedEntityId;

    if (candidate.decision === "created" && !clientId) {
      const slug = candidate.externalName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 70);
      const [row] = await db
        .insert(clients)
        .values({
          slug,
          name: candidate.externalName,
          status: "active",
        })
        .onConflictDoNothing()
        .returning({ id: clients.id });
      if (row) {
        clientId = row.id;
        created++;
      }
    } else if (candidate.decision === "linked") {
      linked++;
    }

    if (!clientId) {
      skipped++;
      continue;
    }

    await db
      .insert(clientIntegrations)
      .values({
        clientId,
        provider: candidate.provider as "frameio" | "google_drive",
        externalId: candidate.externalId,
        externalName: candidate.externalName,
        config: candidate.payload as Record<string, unknown>,
        isActive: true,
      })
      .onConflictDoNothing();

    await db
      .update(importCandidates)
      .set({ decidedEntityId: clientId })
      .where(eq(importCandidates.id, candidate.id));
  }

  await db
    .update(importRuns)
    .set({ status: "committed", committedAt: new Date() })
    .where(eq(importRuns.id, runId));

  await auditLog({
    action: "import.committed",
    entityType: "import_run",
    entityId: runId,
    changes: { linked, created, skipped },
  });

  return { linked, created, skipped };
}
