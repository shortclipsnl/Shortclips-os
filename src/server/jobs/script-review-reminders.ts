import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, productionDays, scriptReviews, users } from "@/db/schema";
import { notify } from "@/server/notifications";
import { portalEmailHtml, sendEmail } from "@/server/email";
import { getFeedbackDays } from "@/server/portal-settings";
import { env } from "@/lib/env";
import { runJob } from "./runner";

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
 * die al minstens 3 dagen openstaan. Eén herinnering per review per week (dedupe).
 * In-app + e-mail (env-gated). Zodra de klant iets doet, verandert de status en
 * stopt de herinnering vanzelf.
 */
export async function runScriptReviewReminders() {
  return runJob("monday", "script_review.reminders", {}, async (ctx) => {
    const week = mondayIso();
    // Instelbare feedbacktermijn: herinner zodra de deadline nadert of al voorbij
    // is (±1 dag van tevoren), of — als er geen deadline staat — na de ingestelde
    // termijn aan stilte.
    const { scripts: feedbackDays } = await getFeedbackDays();
    const rows = await db
      .select({
        id: scriptReviews.id,
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
        sql`(
          (${scriptReviews.feedbackDeadline} is not null and ${scriptReviews.feedbackDeadline} <= now() + interval '1 day')
          or (${scriptReviews.feedbackDeadline} is null and ${scriptReviews.updatedAt} < now() - (${Math.max(1, feedbackDays)} * interval '1 day'))
        )`,
      ));
    ctx.counters.processed = rows.length;

    for (const r of rows) {
      const portal = await db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(and(eq(users.clientId, r.clientId), eq(users.primaryRole, "client"), eq(users.status, "active"), isNull(users.deletedAt)));
      if (portal.length === 0) continue;

      const href = `/portal/scripts/${r.id}`;
      const heading = "Nog even je scripts bekijken?";
      const body = `Je scripts${r.shootOn ? ` voor de opname van ${fmtDate(r.shootOn)}` : ""} staan nog klaar om te bekijken. Geef je feedback of keur ze goed — het kost maar een paar minuten.`;
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
