import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { contentCalendar, users } from "@/db/schema";
import { env } from "@/lib/env";
import { PLATFORM } from "@/lib/statuses";
import { emailConfigured, portalEmailHtml, sendEmail } from "@/server/email";
import { runJob } from "./runner";

/**
 * De dag ná publicatie krijgt de klant per e-mail bericht dat zijn video online
 * staat ("heb je 'm al gezien?"), met de platforms erbij. Bewust niet op de dag
 * van publicatie zelf, maar de dag erna. Eén melding per post (dedupe via
 * `online_notified_at`). Draait dagelijks.
 */
export async function runContentOnlineNotifications() {
  return runJob("monday", "content.online_notify", {}, async (ctx) => {
    if (!emailConfigured()) {
      ctx.log("E-mail niet ingesteld (RESEND_API_KEY/MAIL_FROM) — online-meldingen overgeslagen.");
      return;
    }
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

    // Posts die gisteren online gingen, gedeeld met de klant, nog niet gemeld.
    const rows = await db
      .select({
        id: contentCalendar.id,
        clientId: contentCalendar.clientId,
        title: contentCalendar.title,
        platforms: contentCalendar.platforms,
      })
      .from(contentCalendar)
      .where(and(
        eq(contentCalendar.status, "published"),
        eq(contentCalendar.clientApproved, true),
        eq(contentCalendar.scheduledOn, yesterday),
        isNull(contentCalendar.onlineNotifiedAt),
        isNull(contentCalendar.deletedAt),
      ));

    const portalUrl = `${(env.APP_URL || "").replace(/\/$/, "")}/portal/content`;

    for (const r of rows) {
      ctx.counters.processed++;
      const recipients = await db
        .select({ email: users.email })
        .from(users)
        .where(and(eq(users.clientId, r.clientId), eq(users.status, "active"), isNull(users.deletedAt)));
      const emails = recipients.map((u) => u.email).filter((e): e is string => Boolean(e));

      // Altijd markeren als gemeld (ook zonder ontvangers), zodat we het niet
      // elke dag opnieuw proberen.
      await db.update(contentCalendar).set({ onlineNotifiedAt: new Date() }).where(eq(contentCalendar.id, r.id));
      if (emails.length === 0) continue;

      const platforms = (Array.isArray(r.platforms) ? (r.platforms as string[]) : []).map((p) => PLATFORM[p]?.label ?? p);
      const platformLine = platforms.length ? `op ${platforms.join(", ")}` : "op je kanalen";
      const html = portalEmailHtml({
        heading: "Je nieuwe video staat online! 🎉",
        body: `"${r.title}" staat sinds gisteren online ${platformLine}. Heb je 'm al bekeken? Bekijk je volledige contentplanning in je portaal.`,
        ctaLabel: "Bekijk in je portaal",
        ctaUrl: portalUrl,
      });
      const res = await sendEmail({
        to: emails,
        subject: "Je nieuwe video staat online 🎉",
        text: `"${r.title}" staat sinds gisteren online ${platformLine}. Heb je 'm al bekeken? Bekijk je contentplanning in je portaal: ${portalUrl}`,
        html,
      });
      if (res.sent) ctx.counters.updated++;
    }

    ctx.log(`${ctx.counters.processed} online-posts, ${ctx.counters.updated} klantmeldingen verstuurd.`);
  });
}
