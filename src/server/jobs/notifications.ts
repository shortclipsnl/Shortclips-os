import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  clients,
  contentCalendar,
  deliverables,
  notifications,
  productionDays,
  scripts,
  users,
} from "@/db/schema";
import { env } from "@/lib/env";
import { PLATFORM } from "@/lib/statuses";
import { cleanVideoTitle } from "@/lib/portal-status";
import { portalEmailHtml, sendEmail } from "@/server/email";

/**
 * Klantnotificaties: meldt de drie momenten waarop een klant iets moet weten of
 * doen. Elke melding wordt in het portaal gezet (notifications-tabel) én, zodra
 * een mailprovider is ingesteld, per e-mail verstuurd.
 *
 *  1. Nieuwe video klaar om te beoordelen  (deliverable → client_review)
 *  2. Nieuw script klaar om te lezen       (script → client_review)
 *  3. Opname morgen                         (production_day → scheduledOn = morgen)
 *
 * Idempotent: de notificatierij met zijn dedupeKey is tegelijk het bewijs "al
 * gemeld". We maken de rij met onConflictDoNothing; alleen als er een nieuwe rij
 * uitkomt, sturen we de e-mail. Draait e-mail (nog) niet, dan verschijnt de
 * melding wél in het portaal en gaat er simpelweg geen mail uit.
 */

type NotifyItem = {
  clientId: string;
  kind: "video_review" | "script_review" | "opname_reminder" | "video_published";
  dedupeKey: string;
  title: string;
  body: string;
  href: string; // relatief pad binnen het portaal
  ctaLabel: string;
};

const appUrl = env.APP_URL.replace(/\/$/, "");

const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

export async function runClientNotifications(): Promise<{
  ok: boolean;
  created: number;
  emailed: number;
  emailSkipped: number;
  byKind: Record<string, number>;
}> {
  const items: NotifyItem[] = [];

  // 1. Video's die klaarstaan voor klantbeoordeling.
  const videos = await db
    .select({
      id: deliverables.id,
      clientId: deliverables.clientId,
      title: deliverables.title,
      statusChangedAt: deliverables.statusChangedAt,
    })
    .from(deliverables)
    .where(and(isNull(deliverables.deletedAt), eq(deliverables.status, "client_review")));

  for (const v of videos) {
    items.push({
      clientId: v.clientId,
      kind: "video_review",
      dedupeKey: `portal:video_review:${v.id}:${v.statusChangedAt.toISOString().slice(0, 10)}`,
      title: "Een nieuwe video staat klaar voor je",
      body: `“${v.title}” is klaar om te bekijken en goed te keuren in het portaal.`,
      href: `/portal/videos/${v.id}`,
      ctaLabel: "Bekijk de video",
    });
  }

  // 2. Scripts die klaarstaan om te lezen.
  const scriptRows = await db
    .select({ id: scripts.id, clientId: scripts.clientId, title: scripts.title })
    .from(scripts)
    .where(and(isNull(scripts.deletedAt), eq(scripts.status, "client_review")));

  for (const s of scriptRows) {
    items.push({
      clientId: s.clientId,
      kind: "script_review",
      dedupeKey: `portal:script_review:${s.id}`,
      title: "Een nieuw script om te lezen",
      body: `Het script “${s.title}” staat klaar in het portaal. Lees het rustig door en laat je reactie achter.`,
      href: `/portal/scripts`,
      ctaLabel: "Lees het script",
    });
  }

  // 3. Opname morgen.
  const shoots = await db
    .select({
      id: productionDays.id,
      clientId: productionDays.clientId,
      title: productionDays.title,
      scheduledOn: productionDays.scheduledOn,
      startTime: productionDays.startTime,
      locationName: productionDays.locationName,
    })
    .from(productionDays)
    .where(
      and(
        isNull(productionDays.deletedAt),
        eq(productionDays.scheduledOn, day(1)),
        inArray(productionDays.status, ["planned", "confirmed"]),
      ),
    );

  for (const shoot of shoots) {
    const time = shoot.startTime ? ` om ${shoot.startTime.slice(0, 5)}` : "";
    const place = shoot.locationName ? ` bij ${shoot.locationName}` : "";
    items.push({
      clientId: shoot.clientId,
      kind: "opname_reminder",
      dedupeKey: `portal:opname_reminder:${shoot.id}:${shoot.scheduledOn}`,
      title: "Morgen is het opnamedag",
      body: `Morgen${time} staat de opname gepland${place}. In het portaal vind je wie er komt en hoe de dag eruitziet.`,
      href: `/portal/planning`,
      ctaLabel: "Bekijk de planning",
    });
  }

  // 4. Video's die gisteren online zijn gezet — "we hebben gisteren geplaatst".
  // Bron is de publicatiekalender (o.a. gevoed vanuit Google Agenda/Monday):
  // status 'published' met publicatiedatum = gisteren.
  const publishedYesterday = await db
    .select({
      id: contentCalendar.id,
      clientId: contentCalendar.clientId,
      title: contentCalendar.title,
      platforms: contentCalendar.platforms,
      deliverableId: contentCalendar.deliverableId,
      scheduledOn: contentCalendar.scheduledOn,
    })
    .from(contentCalendar)
    .where(
      and(
        isNull(contentCalendar.deletedAt),
        eq(contentCalendar.status, "published"),
        eq(contentCalendar.scheduledOn, day(-1)),
      ),
    );

  for (const p of publishedYesterday) {
    const labels = ((p.platforms as string[]) ?? []).map((x) => PLATFORM[x]?.label ?? x);
    const onPlatforms = labels.length ? ` op ${labels.join(", ")}` : "";
    items.push({
      clientId: p.clientId,
      kind: "video_published",
      dedupeKey: `portal:video_published:${p.id}:${p.scheduledOn}`,
      title: "We hebben gisteren een nieuwe video geplaatst 🎬",
      body: `“${cleanVideoTitle(p.title)}” staat sinds gisteren online${onPlatforms}. Al gezien? Leuk om 'm even te bekijken!`,
      href: p.deliverableId ? `/portal/videos/${p.deliverableId}` : "/portal/videos",
      ctaLabel: "Bekijk de video",
    });
  }

  if (items.length === 0) {
    return { ok: true, created: 0, emailed: 0, emailSkipped: 0, byKind: {} };
  }

  // Ontvangers per klant: actieve portaalgebruikers, plus de coördinator als
  // reply-to.
  const clientIds = [...new Set(items.map((i) => i.clientId))];
  const recipientRows = await db
    .select({ clientId: users.clientId, userId: users.id, email: users.email })
    .from(users)
    .where(
      and(
        eq(users.primaryRole, "client"),
        eq(users.status, "active"),
        isNull(users.deletedAt),
        inArray(users.clientId, clientIds),
      ),
    );

  const recipientsByClient = new Map<string, { userId: string; email: string }[]>();
  for (const r of recipientRows) {
    if (!r.clientId) continue;
    const list = recipientsByClient.get(r.clientId) ?? [];
    list.push({ userId: r.userId, email: r.email });
    recipientsByClient.set(r.clientId, list);
  }

  // Reply-to per klant = e-mail van de coördinator.
  const coordRows = await db
    .select({ clientId: clients.id, email: users.email })
    .from(clients)
    .leftJoin(users, eq(users.id, clients.coordinatorId))
    .where(inArray(clients.id, clientIds));
  const replyToByClient = new Map<string, string | null>();
  for (const c of coordRows) replyToByClient.set(c.clientId, c.email ?? null);

  let created = 0;
  let emailed = 0;
  let emailSkipped = 0;
  const byKind: Record<string, number> = {};

  for (const item of items) {
    const recipients = recipientsByClient.get(item.clientId) ?? [];
    const replyTo = replyToByClient.get(item.clientId) ?? undefined;
    const href = `${appUrl}${item.href}`;

    for (const recipient of recipients) {
      // Nieuwe rij? Dan is dit de eerste keer dat we deze klant hierover melden.
      const inserted = await db
        .insert(notifications)
        .values({
          userId: recipient.userId,
          clientId: item.clientId,
          type: item.kind,
          level: item.kind === "video_review" || item.kind === "video_published" ? "success" : "info",
          title: item.title,
          body: item.body,
          href: item.href,
          dedupeKey: item.dedupeKey,
        })
        .onConflictDoNothing({ target: [notifications.userId, notifications.dedupeKey] })
        .returning({ id: notifications.id });

      if (inserted.length === 0) continue; // al eerder gemeld

      created++;
      byKind[item.kind] = (byKind[item.kind] ?? 0) + 1;

      const result = await sendEmail({
        to: recipient.email,
        subject: item.title,
        text: `${item.body}\n\n${item.ctaLabel}: ${href}`,
        html: portalEmailHtml({
          heading: item.title,
          body: item.body,
          ctaLabel: item.ctaLabel,
          ctaUrl: href,
        }),
        replyTo: replyTo ?? undefined,
      });

      if (result.sent) emailed++;
      else emailSkipped++;
    }
  }

  return { ok: true, created, emailed, emailSkipped, byKind };
}
