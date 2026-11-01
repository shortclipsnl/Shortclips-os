import "server-only";
import { and, eq, gte, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { briefingSets, productionDays, scriptReviews } from "@/db/schema";
import { ensureBriefingForShoot } from "@/server/briefing/run";

const today = () => new Date().toISOString().slice(0, 10);
const STALE_RUNNING_MIN = 10;
const MAX_PER_RUN = 25;

/**
 * Inhaal-/herstelronde voor de automatische editor-briefings. Vangt gemiste
 * triggers op en herstelt mislukte generaties: voor elke aankomende opname met
 * een scriptcontrole-PDF waarvan de verwerkte versie afwijkt (of nog ontbreekt/
 * mislukt is) draait `ensureBriefingForShoot`. Ongewijzigde opnames worden
 * overgeslagen (geen AI-kosten).
 */
export async function runBriefingAutoGenerate(): Promise<{
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
      setStatus: briefingSets.status,
      setSourceVersionId: briefingSets.sourceReviewVersionId,
      setStartedAt: briefingSets.startedAt,
    })
    .from(productionDays)
    .innerJoin(scriptReviews, and(eq(scriptReviews.productionDayId, productionDays.id), isNull(scriptReviews.deletedAt)))
    .leftJoin(briefingSets, and(eq(briefingSets.productionDayId, productionDays.id), isNull(briefingSets.deletedAt)))
    .where(and(isNull(productionDays.deletedAt), ne(productionDays.status, "cancelled"), gte(productionDays.scheduledOn, today())))
    .limit(500);

  const candidates = rows.filter((r) => {
    if (!r.latestVersionId) return false;
    if (r.setStatus === "bezig" && r.setStartedAt && (Date.now() - r.setStartedAt.getTime()) / 60000 < STALE_RUNNING_MIN) {
      return false;
    }
    return !r.setStatus || r.setStatus === "mislukt" || r.setSourceVersionId !== r.latestVersionId;
  });

  let processed = 0;
  let generated = 0;
  let failed = 0;
  for (const c of candidates.slice(0, MAX_PER_RUN)) {
    processed++;
    try {
      const res = await ensureBriefingForShoot(c.productionDayId);
      if (res.ok) generated++;
      else if (res.reason === "error") failed++;
    } catch {
      failed++;
    }
  }

  return { scanned: rows.length, processed, generated, failed };
}
