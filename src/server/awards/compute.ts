import { AWARD_TIERS, type AwardTier } from "./config";

/**
 * Pure telfunctie voor de awards. Geen database, geen tijd-afhankelijkheid: in,
 * uit, makkelijk te testen. De service-laag levert de opgeleverde video's aan.
 */

export type Delivery = { videoId: string | null; approvedAt: Date };

export type EarnedAward = {
  awardKey: string;
  threshold: number;
  /** Goedkeuringsdatum van de video die de drempel haalde. */
  achievedAt: Date;
  videoId: string | null;
};

/** Houdt per video maximaal één oplevering over (revisies/dubbele goedkeuring tellen niet dubbel). */
export function dedupeDeliveries(deliveries: Delivery[]): Delivery[] {
  const seen = new Set<string>();
  const out: Delivery[] = [];
  for (const d of deliveries) {
    const k = d.videoId ?? `__null__:${d.approvedAt.getTime()}:${out.length}`;
    if (d.videoId && seen.has(d.videoId)) continue;
    if (d.videoId) seen.add(d.videoId);
    out.push(d);
  }
  return out;
}

/**
 * Bepaalt welke awards behaald zijn uit de opgeleverde video's. De datum van een
 * award is de goedkeuringsdatum van de N-de oplevering (N = de drempel), op
 * chronologische volgorde. Levert alle behaalde drempels (meerdere tegelijk kan).
 */
export function computeEarnedAwards(deliveries: Delivery[], tiers: AwardTier[] = AWARD_TIERS): EarnedAward[] {
  const unique = dedupeDeliveries(deliveries);
  const sorted = [...unique].sort((a, b) => a.approvedAt.getTime() - b.approvedAt.getTime());
  const earned: EarnedAward[] = [];
  for (const tier of tiers) {
    if (sorted.length >= tier.threshold) {
      const crossing = sorted[tier.threshold - 1]!;
      earned.push({ awardKey: tier.key, threshold: tier.threshold, achievedAt: crossing.approvedAt, videoId: crossing.videoId });
    }
  }
  return earned;
}

/** Aantal opgeleverde shorts (uniek per video). */
export function deliveredCount(deliveries: Delivery[]): number {
  return dedupeDeliveries(deliveries).length;
}

/** De eerstvolgende nog niet behaalde award, of null als alles behaald is. */
export function nextAward(count: number, tiers: AwardTier[] = AWARD_TIERS): AwardTier | null {
  return tiers.find((t) => count < t.threshold) ?? null;
}

/** De hoogste behaalde award (voor de teamweergave/badge), of null. */
export function highestEarned(count: number, tiers: AwardTier[] = AWARD_TIERS): AwardTier | null {
  let best: AwardTier | null = null;
  for (const t of tiers) if (count >= t.threshold) best = t;
  return best;
}
