import "server-only";
import { and, eq, gte, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { captionSets, productionDays, scriptReviews } from "@/db/schema";
import { ensureCaptionsForShoot } from "@/server/captions/run";

const today = () => new Date().toISOString().slice(0, 10);
const STALE_RUNNING_MIN = 10;
/** Max. aantal opnames dat per ronde daadwerkelijk (opnieuw) gegenereerd wordt,
 *  zodat één ronde de AI-kosten en de functieduur begrensd houdt. */
const MAX_PER_RUN = 25;

/**
 * Inhaal-/herstelronde voor de automatische captions. Vangt gemiste triggers op
 * en herstelt mislukte generaties: voor elke aankomende opname met een
 * scriptcontrole-PDF waarvan de verwerkte versie afwijkt (of nog ontbreekt/
 * mislukt is) draait `ensureCaptionsForShoot`. Ongewijzigde opnames worden
 * overgeslagen (geen AI-kosten).
 */
export async function runCaptionsAutoGenerate(): Promise<{
  scanned: number;
  processed: number;
  generated: number;
  failed: number;
}> {
  const rows = await db
    .select({
      productionDayId: productionDays.id,
      latestVersionId: sql<string | null>`(
        select v.id from script_review_versions v
        where v.review_id = ${scriptReviews.id}
        order by v.version_number desc limit 1
      )`,
      setStatus: captionSets.status,
      setSourceVersionId: captionSets.sourceReviewVersionId,
      setStartedAt: captionSets.startedAt,
    })
    .from(productionDays)
    .innerJoin(scriptReviews, and(eq(scriptReviews.productionDayId, productionDays.id), isNull(scriptReviews.deletedAt)))
    .leftJoin(captionSets, and(eq(captionSets.productionDayId, productionDays.id), isNull(captionSets.deletedAt)))
    .where(and(isNull(productionDays.deletedAt), ne(productionDays.status, "cancelled"), gte(productionDays.scheduledOn, today())))
    .limit(500);

  const candidates = rows.filter((r) => {
    if (!r.latestVersionId) return false; // geen PDF-versie
    // Draait al en niet vastgelopen → overslaan.
    if (r.setStatus === "bezig" && r.setStartedAt && (Date.now() - r.setStartedAt.getTime()) / 60000 < STALE_RUNNING_MIN) {
      return false;
    }
    // Nog geen set, of mislukt, of een nieuwere PDF-versie dan verwerkt.
    return !r.setStatus || r.setStatus === "mislukt" || r.setSourceVersionId !== r.latestVersionId;
  });

  let processed = 0;
  let generated = 0;
  let failed = 0;
  for (const c of candidates.slice(0, MAX_PER_RUN)) {
    processed++;
    try {
      const res = await ensureCaptionsForShoot(c.productionDayId);
      if (res.ok) generated++;
      else if (res.reason === "error") failed++;
    } catch {
      failed++;
    }
  }

  return { scanned: rows.length, processed, generated, failed };
}
