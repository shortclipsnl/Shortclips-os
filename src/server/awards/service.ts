import "server-only";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { deliverables, editorAwards, editorPreferences, users } from "@/db/schema";
import { notify } from "@/server/notifications";
import { awardByKey, AWARD_COUNT } from "./config";
import { computeEarnedAwards, nextAward, type Delivery, type EarnedAward } from "./compute";

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

export type ShowcaseEarned = { awardKey: string; achievedAt: string };
export type ShowcaseData = {
  editorId: string;
  editorName: string;
  count: number;
  thisMonth: number;
  clientCount: number;
  earnedCount: number;
  totalAwards: number;
  earned: ShowcaseEarned[];
  awardSound: boolean;
  /** "december 2026" of null als er te weinig data is of alles behaald is. */
  projectionMonth: string | null;
};

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}`;
}

/** Verwachte maand voor de volgende award op basis van de laatste 3 maanden. Null bij <2 maanden data of geen tempo. */
function projectNextAward(count: number, dates: Date[], now: Date): string | null {
  const next = nextAward(count);
  if (!next) return null;
  const distinctMonths = new Set(dates.map(monthKey)).size;
  if (distinctMonths < 2) return null;
  const since = new Date(now);
  since.setDate(since.getDate() - 90);
  const recent = dates.filter((d) => d >= since).length;
  const perMonth = recent / 3;
  if (perMonth <= 0) return null;
  const remaining = next.threshold - count;
  const monthsNeeded = Math.ceil(remaining / perMonth);
  const target = new Date(now);
  target.setMonth(target.getMonth() + monthsNeeded);
  return target.toLocaleDateString("nl-NL", { month: "long", year: "numeric" });
}

/** Alle data voor de Showcase van één editor. */
export async function getShowcase(editorUserId: string, now = new Date()): Promise<ShowcaseData> {
  const rows = await db
    .select({ clientId: deliverables.clientId, approvedAt: deliverables.approvedAt, statusChangedAt: deliverables.statusChangedAt })
    .from(deliverables)
    .where(and(eq(deliverables.editorId, editorUserId), isNull(deliverables.deletedAt), inArray(deliverables.status, [...AWARD_DONE_STATUSES])));
  const dated = rows.map((r) => ({ clientId: r.clientId, date: r.approvedAt ?? r.statusChangedAt }));
  const count = dated.length;
  const thisMonth = dated.filter((d) => monthKey(d.date) === monthKey(now)).length;
  const clientCount = new Set(dated.map((d) => d.clientId)).size;

  const earnedRows = await db.select({ awardKey: editorAwards.awardKey, achievedAt: editorAwards.achievedAt }).from(editorAwards).where(eq(editorAwards.editorId, editorUserId));
  const earned = earnedRows.map((e) => ({ awardKey: e.awardKey, achievedAt: e.achievedAt.toISOString() }));

  const [editor] = await db.select({ name: users.fullName }).from(users).where(eq(users.id, editorUserId)).limit(1);
  const [pref] = await db.select({ s: editorPreferences.awardSound }).from(editorPreferences).where(eq(editorPreferences.userId, editorUserId)).limit(1);

  return {
    editorId: editorUserId,
    editorName: editor?.name ?? "",
    count,
    thisMonth,
    clientCount,
    earnedCount: earned.length,
    totalAwards: AWARD_COUNT,
    earned,
    awardSound: pref?.s ?? true,
    projectionMonth: projectNextAward(count, dated.map((d) => d.date), now),
  };
}

/** Editors voor de keuzelijst in de teamweergave. */
export async function listShowcaseEditors(): Promise<{ id: string; name: string }[]> {
  const rows = await db
    .select({ id: users.id, name: users.fullName })
    .from(users)
    .where(and(isNull(users.deletedAt), eq(users.status, "active"), eq(users.primaryRole, "editor")))
    .orderBy(users.fullName);
  return rows;
}

/** De nog niet gevierde award met de hoogste drempel (voor de vieringskaart). Null als er niets te vieren is. */
export async function getPendingCelebration(editorUserId: string): Promise<{ awardKey: string } | null> {
  const rows = await db.select({ awardKey: editorAwards.awardKey }).from(editorAwards).where(and(eq(editorAwards.editorId, editorUserId), isNull(editorAwards.celebratedAt)));
  if (rows.length === 0) return null;
  // hoogste drempel kiezen
  let best: { awardKey: string; threshold: number } | null = null;
  for (const r of rows) {
    const tier = awardByKey(r.awardKey);
    if (tier && (!best || tier.threshold > best.threshold)) best = { awardKey: r.awardKey, threshold: tier.threshold };
  }
  return best ? { awardKey: best.awardKey } : null;
}

export type CelebrationContext = { awardKey: string; firstName: string; awardSound: boolean; nextRemaining: number | null };

/** Context voor de vieringskaart bij binnenkomst: null als er niets te vieren is. */
export async function getCelebrationContext(viewerId: string, now = new Date()): Promise<CelebrationContext | null> {
  const pending = await getPendingCelebration(viewerId);
  if (!pending) return null;
  const data = await getShowcase(viewerId, now);
  const next = nextAward(data.count);
  return {
    awardKey: pending.awardKey,
    firstName: data.editorName.split(" ")[0] || "editor",
    awardSound: data.awardSound,
    nextRemaining: next ? next.threshold - data.count : null,
  };
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
