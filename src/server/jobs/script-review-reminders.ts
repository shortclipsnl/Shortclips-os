import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, productionDays, scriptReviewVersions, scriptReviews, users } from "@/db/schema";
import { notify } from "@/server/notifications";
import { portalEmailHtml, sendEmail } from "@/server/email";
import { getFeedbackDays } from "@/server/portal-settings";
import { amsterdamDay, isClientFeedbackOverdue } from "@/lib/client-feedback";
import { addWorkingDays } from "@/lib/workdays";
import { nlHolidaySet } from "@/lib/holidays";
import { env } from "@/lib/env";
import { getReviewApproval } from "@/server/script-review";
import { runJob } from "./runner";
import { notInactiveClient } from "@/server/client-activity";

const appUrl = env.APP_URL.replace(/\/$/, "");

/** Maandag van de huidige week (YYYY-MM-DD) — voor wekelijkse dedupe. */
function mondayIso(): string {
  const d = new Date();
  const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  utc.setUTCDate(utc.getUTCDate() - ((utc.getUTCDay() + 6) % 7));
  return utc.toISOString().slice(0, 10);
}
function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d).toLocaleDateString("nl-NL", { day: "numeric", month: "long" });
}

/**
 * Herinnert klanten die nog geen feedback/akkoord hebben gegeven op scripts die
 * ter controle staan (status "klaar voor controle" of "opnieuw ter controle") en
 * waarvan de feedbacktermijn (in werkdagen) bijna of al verstreken is. Eén herinnering per review per week (dedupe).
 * In-app + e-mail (env-gated). Zodra de klant iets doet, verandert de status en
 * stopt de herinnering vanzelf.
 */
export async function runScriptReviewReminders() {
  return runJob("system", "script_review.reminders", {}, async (ctx) => {
    const week = mondayIso();
    // Instelbare feedbacktermijn: herinner zodra de deadline nadert of al voorbij
    // is (±1 dag van tevoren), of — als er geen deadline staat — na de ingestelde
    // termijn aan stilte.
    const { scripts: feedbackDays } = await getFeedbackDays();
    const candidates = await db
      .select({
        id: scriptReviews.id,
        currentVersion: scriptReviews.currentVersion,
        coordinatorId: clients.coordinatorId,
        feedbackDeadline: scriptReviews.feedbackDeadline,
        updatedAt: scriptReviews.updatedAt,
        clientId: scriptReviews.clientId,
        clientName: clients.name,
        shootOn: productionDays.scheduledOn,
        coordEmail: users.email,
      })
      .from(scriptReviews)
      .innerJoin(clients, eq(clients.id, scriptReviews.clientId))
      .innerJoin(productionDays, eq(productionDays.id, scriptReviews.productionDayId))
      .leftJoin(users, eq(users.id, clients.coordinatorId))
      .where(and(
        isNull(scriptReviews.deletedAt),
        inArray(scriptReviews.status, ["klaar_controle", "opnieuw_controle"]),
        notInactiveClient(scriptReviews.clientId),
      ));
    // Herinneren zodra de deadline (al in werkdagen gezet) morgen of eerder is,
    // of, zonder deadline, als de feedbacktermijn in WERKDAGEN verstreken is.
    const holidays = nlHolidaySet();
    const today = amsterdamDay(new Date());
    const tomorrow = addWorkingDays(today, 1, holidays);
    const rows = candidates.filter((r) =>
      r.feedbackDeadline
        ? amsterdamDay(r.feedbackDeadline as Date | string) <= tomorrow
        : isClientFeedbackOverdue(r.updatedAt as Date | string, feedbackDays, today, holidays),
    );
    ctx.counters.processed = rows.length;

    // Signaal voor de verantwoordelijke: termijn verstreken én de opname komt
    // dichtbij (binnen 5 werkdagen). Eén keer per review-versie, geen herhaling.
    const soon = addWorkingDays(today, 5, holidays);
    for (const r of candidates) {
      const overdue = r.feedbackDeadline ? amsterdamDay(r.feedbackDeadline as Date | string) < today : false;
      if (!overdue || !r.shootOn || r.shootOn > soon || r.shootOn < today) continue;
      await notify({
        roles: r.coordinatorId ? undefined : ["owner"],
        userIds: r.coordinatorId ? [r.coordinatorId] : undefined,
        clientId: r.clientId,
        level: "warning",
        type: "script_review_overdue",
        title: `${r.clientName}: scripts nog niet goedgekeurd`,
        body: `De feedbacktermijn is verstreken en de opname is op ${fmtDate(r.shootOn)}. Neem even contact op met de klant.`,
        href: `/scriptcontrole/${r.id}`,
        entityType: "script_review",
        entityId: r.id,
        dedupeKey: `script_review_overdue:${r.id}:v${r.currentVersion}`,
      });
    }

    for (const r of rows) {
      const portal = await db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(and(eq(users.clientId, r.clientId), eq(users.primaryRole, "client"), eq(users.status, "active"), isNull(users.deletedAt)));
      if (portal.length === 0) continue;

      const href = `/portal/scripts/${r.id}`;
      const heading = "Nog even je scripts bekijken?";
      const [v] = await db.select({ id: scriptReviewVersions.id }).from(scriptReviewVersions)
        .where(and(eq(scriptReviewVersions.reviewId, r.id), eq(scriptReviewVersions.versionNumber, r.currentVersion))).limit(1);
      const { summary } = await getReviewApproval(r.id, r.currentVersion, v?.id ?? null);
      const progress = summary.total > 0 && summary.approved > 0 ? ` Je hebt er al ${summary.approved} van de ${summary.total} goedgekeurd.` : "";
      const body = `Je scripts${r.shootOn ? ` voor de opname van ${fmtDate(r.shootOn)}` : ""} staan nog klaar om te bekijken.${progress} Goedkeuren kan per script met één klik.`;
      const sent = await notify({
        userIds: portal.map((p) => p.id),
        clientId: r.clientId,
        level: "info",
        type: "script_review_reminder",
        title: heading,
        body,
        href,
        entityType: "script_review",
        entityId: r.id,
        dedupeKey: `script_review_reminder:${r.id}:${week}`,
      });
      // Alleen e-mailen als de in-app melding nieuw was (voorkomt dubbele mails).
      if (sent > 0) {
        ctx.counters.updated++;
        const emails = portal.map((p) => p.email).filter(Boolean);
        if (emails.length > 0) {
          await sendEmail({
            to: emails,
            subject: heading,
            text: `${body}\n\nBekijk de scripts: ${appUrl}${href}`,
            html: portalEmailHtml({ heading, body, ctaLabel: "Bekijk de scripts", ctaUrl: `${appUrl}${href}` }),
            replyTo: r.coordEmail ?? undefined,
          }).catch(() => undefined);
        }
      }
    }
    ctx.log(`${rows.length} openstaande reviews, ${ctx.counters.updated} herinnering(en) verstuurd.`);
  });
}
