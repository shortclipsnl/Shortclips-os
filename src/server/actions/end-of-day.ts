"use server";

import { and, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { contentCalendar, tasks, productionDays, reviewThreads, scriptReviewThreads, scriptReviews, deliverables } from "@/db/schema";
import { requireInternal, scopeToClients } from "@/server/auth/context";
import { getMorningOverview } from "@/server/morning-overview";
import { addWorkingDays } from "@/lib/workdays";

const TZ = "Europe/Amsterdam";

export type EodItem = { key: string; label: string; ok: boolean; detail: string; href: string };
export type EodChecklist = { items: EodItem[]; allGood: boolean };

/**
 * Eindedag-checklist (16:30) per medewerker: is het editing-/scriptingwerk bij,
 * staan de video's van vandaag online, zijn de taken tot morgen bij, en zijn er
 * geen openstaande klantreacties? Alles gescoped op de klanten die de viewer mag
 * zien, zodat iedereen zijn eigen stand ziet. Rood = nog iets te doen.
 */
export async function getEndOfDayChecklist(): Promise<{ ok: true; data: EodChecklist } | { ok: false }> {
  const viewer = await requireInternal().catch(() => null);
  if (!viewer) return { ok: false };

  const today = new Date().toLocaleDateString("en-CA", { timeZone: TZ });
  const in7 = addWorkingDays(today, 7);
  const nextWorkday = addWorkingDays(today, 1);

  const [morning, scRow, vpRow, tkRow, vtRow, stRow] = await Promise.all([
    // 1. Editing: eerste-versie-video's over de interne deadline.
    getMorningOverview(viewer).catch(() => ({ overdueVideos: 0 } as { overdueVideos: number })),
    // 2. Scripting: aankomende opnames (komende ~7 werkdagen) zonder afgerond script.
    db.select({ n: sql<number>`count(*)::int` }).from(productionDays).where(and(
      isNull(productionDays.deletedAt),
      ne(productionDays.status, "cancelled"),
      gte(productionDays.scheduledOn, today),
      lte(productionDays.scheduledOn, in7),
      ne(productionDays.scriptingStatus, "final"),
      scopeToClients(viewer, productionDays.clientId) ?? undefined,
    )).then((r) => r[0]),
    // 3. Video's van vandaag die nog niet online staan.
    db.select({ n: sql<number>`count(*)::int` }).from(contentCalendar).where(and(
      isNull(contentCalendar.deletedAt),
      eq(contentCalendar.scheduledOn, today),
      inArray(contentCalendar.status, ["to_prepare", "ready", "scheduled"]),
      scopeToClients(viewer, contentCalendar.clientId) ?? undefined,
    )).then((r) => r[0]),
    // 4. Eigen open taken t/m de volgende werkdag.
    db.select({ n: sql<number>`count(*)::int` }).from(tasks).where(and(
      isNull(tasks.deletedAt),
      eq(tasks.assigneeId, viewer.id),
      inArray(tasks.status, ["todo", "in_progress", "blocked"]),
      lte(tasks.dueOn, nextWorkday),
      sql`${tasks.dueOn} is not null`,
      sql`not (${tasks.source} = 'automation' and ${tasks.entityType} = 'ai_insight')`,
    )).then((r) => r[0]),
    // 5a. Open klantreacties op video's (klant-zichtbare, onopgeloste threads).
    db.select({ n: sql<number>`count(*)::int` }).from(reviewThreads)
      .innerJoin(deliverables, eq(deliverables.id, reviewThreads.deliverableId))
      .where(and(
        eq(reviewThreads.visibility, "client"),
        eq(reviewThreads.isResolved, false),
        isNull(reviewThreads.deletedAt),
        scopeToClients(viewer, deliverables.clientId) ?? undefined,
      )).then((r) => r[0]),
    // 5b. Open klantreacties op scripts.
    db.select({ n: sql<number>`count(*)::int` }).from(scriptReviewThreads)
      .innerJoin(scriptReviews, eq(scriptReviews.id, scriptReviewThreads.reviewId))
      .where(and(
        eq(scriptReviewThreads.visibility, "client"),
        eq(scriptReviewThreads.isResolved, false),
        isNull(scriptReviewThreads.deletedAt),
        scopeToClients(viewer, scriptReviews.clientId) ?? undefined,
      )).then((r) => r[0]),
  ]);

  const overdue = Number(morning.overdueVideos ?? 0);
  const scN = Number(scRow?.n ?? 0);
  const vpN = Number(vpRow?.n ?? 0);
  const tkN = Number(tkRow?.n ?? 0);
  const clN = Number(vtRow?.n ?? 0) + Number(stRow?.n ?? 0);

  const items: EodItem[] = [
    { key: "editing", label: "Editing bijgewerkt", ok: overdue === 0, href: "/videos",
      detail: overdue === 0 ? "Geen video over de interne deadline" : `${overdue} video${overdue === 1 ? "" : "'s"} over de deadline` },
    { key: "scripting", label: "Scripting ingevuld", ok: scN === 0, href: "/scripting",
      detail: scN === 0 ? "Aankomende opnames hebben hun scripts" : `${scN} aankomende opname${scN === 1 ? "" : "s"} zonder afgerond script` },
    { key: "posted", label: "Video's van vandaag gepost", ok: vpN === 0, href: "/calendar",
      detail: vpN === 0 ? "Alles van vandaag staat online" : `${vpN} publicatie${vpN === 1 ? "" : "s"} van vandaag nog niet online` },
    { key: "tasks", label: "Taken voor morgen klaar", ok: tkN === 0, href: "/tasks",
      detail: tkN === 0 ? "Je taken zijn bij" : `${tkN} open ta${tkN === 1 ? "ak" : "ken"} t/m de volgende werkdag` },
    { key: "clients", label: "Klanten beantwoord", ok: clN === 0, href: "/videos",
      detail: clN === 0 ? "Geen openstaande klantreacties" : `${clN} open klantreactie${clN === 1 ? "" : "s"}` },
  ];

  return { ok: true, data: { items, allGood: items.every((i) => i.ok) } };
}
