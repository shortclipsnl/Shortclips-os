import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { publicationChecks, users } from "@/db/schema";

/**
 * Publicatie-checklist: de vaste punten die het publicatieteam (o.a. Milou,
 * Jiska) nalóópt nádat een video gepubliceerd is. Los van de QC-check vóór
 * oplevering. De volgorde hier is de volgorde waarin ze getoond worden.
 */
export const PUBLICATION_CHECKLIST: string[] = [
  "Comments onder de video geplaatst",
  "Likes uitgezet",
  "Video in de story geplaatst",
  "Video staat op alle juiste platformen",
  "Caption gecontroleerd op spelfouten",
];

export type PublicationCheck = {
  id: string;
  label: string;
  done: boolean;
  doneAt: Date | null;
  doneByName: string | null;
};

/**
 * Haalt de checklist van één video op en maakt de vaste punten lui aan als ze
 * er nog niet zijn. Idempotent via de unieke index op (deliverableId, label).
 */
export async function getOrCreatePublicationChecks(deliverableId: string): Promise<PublicationCheck[]> {
  const existing = await db
    .select({ label: publicationChecks.label })
    .from(publicationChecks)
    .where(eq(publicationChecks.deliverableId, deliverableId));
  const have = new Set(existing.map((r) => r.label));
  const missing = PUBLICATION_CHECKLIST.filter((l) => !have.has(l));
  if (missing.length > 0) {
    await db
      .insert(publicationChecks)
      .values(missing.map((label) => ({ deliverableId, label, sortOrder: PUBLICATION_CHECKLIST.indexOf(label) })))
      .onConflictDoNothing();
  }

  const rows = await db
    .select({
      id: publicationChecks.id,
      label: publicationChecks.label,
      done: publicationChecks.done,
      doneAt: publicationChecks.doneAt,
      sortOrder: publicationChecks.sortOrder,
      doneByName: users.fullName,
    })
    .from(publicationChecks)
    .leftJoin(users, eq(users.id, publicationChecks.doneById))
    .where(eq(publicationChecks.deliverableId, deliverableId))
    .orderBy(asc(publicationChecks.sortOrder), asc(publicationChecks.label));

  // Alleen de canonieke punten, in de vaste volgorde (robuust als er ooit een
  // oud label in de data staat dat niet meer in de template zit).
  const byLabel = new Map(rows.map((r) => [r.label, r]));
  return PUBLICATION_CHECKLIST.map((label) => {
    const r = byLabel.get(label);
    return {
      id: r?.id ?? label,
      label,
      done: r?.done ?? false,
      doneAt: r?.doneAt ?? null,
      doneByName: r?.doneByName ?? null,
    };
  });
}

/**
 * Voortgang (afgevinkt/totaal) per video, zónder rijen aan te maken — voor de
 * indicator op de Contentplanning. Een gepubliceerde video zonder aangemaakte
 * rijen telt gewoon als 0/totaal.
 */
export async function getPublicationCheckSummaries(
  deliverableIds: string[],
): Promise<Map<string, { done: number; total: number }>> {
  const total = PUBLICATION_CHECKLIST.length;
  const map = new Map<string, { done: number; total: number }>();
  const ids = [...new Set(deliverableIds.filter(Boolean))];
  for (const id of ids) map.set(id, { done: 0, total });
  if (ids.length === 0) return map;

  const rows = await db
    .select({ deliverableId: publicationChecks.deliverableId, done: publicationChecks.done, label: publicationChecks.label })
    .from(publicationChecks)
    .where(inArray(publicationChecks.deliverableId, ids));

  for (const r of rows) {
    const e = map.get(r.deliverableId);
    if (e && r.done && PUBLICATION_CHECKLIST.includes(r.label)) e.done += 1;
  }
  return map;
}
