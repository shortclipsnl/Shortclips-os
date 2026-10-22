import "server-only";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { deliverables, editorAwards, users } from "@/db/schema";
import { notify } from "@/server/notifications";
import { awardByKey } from "./config";
import { computeEarnedAwards, type Delivery, type EarnedAward } from "./compute";

/** Statussen die "klantgoedgekeurd of afgerond" betekenen (gelijk aan editing.ts). */
export const AWARD_DONE_STATUSES = ["approved", "ready_to_publish", "scheduled", "published", "analysis_available"] as const;

/** De opgeleverde video's van één editor (één rij per video). */
async function getEditorDeliveries(editorUserId: string): Promise<Delivery[]> {
  const rows = await db
    .select({ id: deliverables.id, approvedAt: deliverables.approvedAt, statusChangedAt: deliverables.statusChangedAt })
    .from(deliverables)
    .where(
      and(
        eq(deliverables.editorId, editorUserId),
        isNull(deliverables.deletedAt),
        inArray(deliverables.status, [...AWARD_DONE_STATUSES]),
      ),
    );
  // approvedAt is de goedkeuringsdatum; valt terug op statusChangedAt als die ontbreekt.
  return rows.map((r) => ({ videoId: r.id, approvedAt: r.approvedAt ?? r.statusChangedAt }));
}

/**
 * Kent de nog niet behaalde awards van één editor toe. Meerdere drempels tegelijk
 * kan: dan krijgt alleen de hoogste nieuwe award een viering (celebrated_at null),
 * de rest wordt meteen als gevierd gemarkeerd zodat er geen stapel ontstaat. Dit
 * maakt ook de eenmalige backfill vanzelf goed (één welkomstviering per editor).
 */
export async function recordAwards(editorUserId: string, now = new Date()): Promise<{ newAwards: EarnedAward[] }> {
  const deliveries = await getEditorDeliveries(editorUserId);
  const earned = computeEarnedAwards(deliveries);
  if (earned.length === 0) return { newAwards: [] };

  const existing = await db.select({ awardKey: editorAwards.awardKey }).from(editorAwards).where(eq(editorAwards.editorId, editorUserId));
  const have = new Set(existing.map((e) => e.awardKey));
  const fresh = earned.filter((e) => !have.has(e.awardKey));
  if (fresh.length === 0) return { newAwards: [] };

  const highestKey = fresh.reduce((a, b) => (a.threshold >= b.threshold ? a : b)).awardKey;
  await db
    .insert(editorAwards)
    .values(
      fresh.map((e) => ({
        editorId: editorUserId,
        awardKey: e.awardKey,
        achievedAt: e.achievedAt,
        videoId: e.videoId,
        celebratedAt: e.awardKey === highestKey ? null : now,
      })),
    )
    .onConflictDoNothing();

  const [editor] = await db.select({ name: users.fullName }).from(users).where(eq(users.id, editorUserId)).limit(1);
  for (const e of fresh) {
    const tier = awardByKey(e.awardKey);
    if (!tier) continue;
    await notify({
      roles: ["owner", "project_coordinator"],
      type: "award_earned",
      level: "success",
      title: `${editor?.name ?? "Een editor"} heeft de award ${tier.name} behaald (${tier.threshold} shorts)`,
      href: "/showcase",
      dedupeKey: `award_earned:${editorUserId}:${e.awardKey}`,
    });
  }
  return { newAwards: fresh };
}

/** Veilige variant: nooit een fout naar de aanroeper (bijv. vanuit een goedkeuringsactie). */
export async function recordAwardsSafe(editorUserId: string | null): Promise<void> {
  if (!editorUserId) return;
  try {
    await recordAwards(editorUserId);
  } catch {
    /* awards mogen een goedkeuring nooit blokkeren; het nachtelijke vangnet herstelt */
  }
}

/** Nachtelijk vangnet + backfill: herbereken awards voor elke editor met opgeleverde video's. */
export async function recomputeAllAwards(now = new Date()): Promise<{ editors: number; newAwards: number }> {
  const editors = await db
    .selectDistinct({ id: deliverables.editorId })
    .from(deliverables)
    .where(and(isNull(deliverables.deletedAt), isNotNull(deliverables.editorId), inArray(deliverables.status, [...AWARD_DONE_STATUSES])));

  let newAwards = 0;
  let count = 0;
  for (const e of editors) {
    if (!e.id) continue;
    count++;
    const r = await recordAwards(e.id, now);
    newAwards += r.newAwards.length;
  }
  return { editors: count, newAwards };
}
