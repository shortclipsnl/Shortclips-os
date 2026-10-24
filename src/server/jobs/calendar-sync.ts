import "server-only";
import { after } from "next/server";
import { and, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { env } from "@/lib/env";
import {
  calendarEvents,
  clientContacts,
  clientIntegrations,
  clients,
  contentCalendar,
  deliverables,
  integrationConnections,
  mondayMappings,
  productionDays,
  users,
} from "@/db/schema";
import { addWorkingDays } from "@/lib/workdays";
import { nlHolidaySet } from "@/lib/holidays";
import { firstNameKey } from "@/lib/editors";
import { notify } from "@/server/notifications";
import {
  GoogleCalendarService,
  googleCalendar,
  type CalendarEvent,
} from "@/server/integrations/google-calendar";
import {
  classifyAppointment,
  isInternalAppointment,
  matchEvent,
  type ClientMatcher,
} from "@/server/integrations/calendar-matching";
import { MissingCredentialsError } from "@/server/integrations/types";
import { aliasesForSlug } from "@/server/integrations/client-aliases";
import { listEnabledCouplings } from "@/server/calendar-couplings";
import { runJob } from "./runner";

/**
 * Publieke e-mailproviders mogen nooit als "klantdomein" gelden — anders zou
 * elke gmail-deelnemer bij een willekeurige klant kunnen belanden.
 */
const GENERIC_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "hotmail.nl", "outlook.com",
  "outlook.nl", "live.nl", "live.com", "icloud.com", "me.com", "yahoo.com",
  "ziggo.nl", "kpnmail.nl", "planet.nl", "home.nl", "upcmail.nl",
]);

/**
 * Bouwt per klant de match-regels op uit de database: naam, slug, de e-mails
 * van de contactpersonen en de domeinen daarvan, plus eventuele handmatige
 * aliassen/domeinen uit de koppelingsconfiguratie (client_integrations,
 * provider google_calendar).
 */
export async function buildClientMatchers(): Promise<ClientMatcher[]> {
  const rows = await db
    .select({ id: clients.id, name: clients.name, slug: clients.slug })
    .from(clients)
    .where(isNull(clients.deletedAt));

  const contacts = await db
    .select({ clientId: clientContacts.clientId, email: clientContacts.email })
    .from(clientContacts)
    .where(isNull(clientContacts.deletedAt));

  const integ = await db
    .select({ clientId: clientIntegrations.clientId, config: clientIntegrations.config })
    .from(clientIntegrations)
    .where(eq(clientIntegrations.provider, "google_calendar"));

  const byClient = new Map<string, Required<ClientMatcher>>();
  for (const r of rows) {
    byClient.set(r.id, {
      id: r.id, name: r.name, slug: r.slug,
      aliases: [...aliasesForSlug(r.slug)], contactEmails: [], domains: [],
    });
  }

  for (const c of contacts) {
    const m = byClient.get(c.clientId);
    if (!m || !c.email) continue;
    const email = c.email.toLowerCase().trim();
    if (!m.contactEmails.includes(email)) m.contactEmails.push(email);
    const d = email.split("@")[1];
    if (d && !GENERIC_DOMAINS.has(d) && !m.domains.includes(d)) m.domains.push(d);
  }

  for (const i of integ) {
    const m = byClient.get(i.clientId);
    if (!m) continue;
    const cfg = (i.config ?? {}) as { aliases?: string[]; domains?: string[]; emails?: string[] };
    for (const a of cfg.aliases ?? []) if (a && !m.aliases.includes(a)) m.aliases.push(a);
    for (const d of cfg.domains ?? []) {
      const dd = d.toLowerCase();
      if (dd && !GENERIC_DOMAINS.has(dd) && !m.domains.includes(dd)) m.domains.push(dd);
    }
    for (const e of cfg.emails ?? []) {
      const ee = e.toLowerCase();
      if (ee && !m.contactEmails.includes(ee)) m.contactEmails.push(ee);
    }
  }

  return [...byClient.values()];
}

/**
 * Bron van afspraken. Normaal de echte Google-adapter; in tests injecteren we
 * een nepbron met vaste afspraken, zodat de sync zonder internet te testen is.
 */
export type CalendarSource = {
  isConfigured: boolean;
  configuredCalendarIds: string[];
  listCalendars(): Promise<Array<{ id: string; summary: string }>>;
  listEvents(
    calendarId: string,
    opts: { timeMin: string; timeMax: string },
  ): Promise<CalendarEvent[]>;
};

function resolveTimes(ev: CalendarEvent): {
  startsAt: Date | null;
  endsAt: Date | null;
  allDay: boolean;
} {
  const startsAt = GoogleCalendarService.startDate(ev);
  const allDay = GoogleCalendarService.isAllDay(ev);
  let endsAt: Date | null = null;
  if (ev.end?.dateTime) endsAt = new Date(ev.end.dateTime);
  else if (ev.end?.date) endsAt = new Date(`${ev.end.date}T00:00:00`);
  return { startsAt, endsAt, allDay };
}

export type CalendarSyncOptions = {
  source?: CalendarSource;
  triggeredById?: string;
  windowDaysBack?: number;
  windowDaysForward?: number;
};

/**
 * Haalt afspraken op uit de ingestelde agenda's, koppelt ze aan de juiste
 * klant (of markeert ze voor review) en slaat ze op. Idempotent: opnieuw
 * draaien werkt elke afspraak bij in plaats van te dupliceren.
 */
export async function runCalendarSync(options: CalendarSyncOptions = {}) {
  const source = options.source ?? (googleCalendar as CalendarSource);
  const back = options.windowDaysBack ?? 30;
  // Standaard vooruit tot minstens eind dit jaar (en altijd minimaal ~4 maanden),
  // zodat afspraken t/m 31 december altijd mee worden genomen — ook als de sync
  // vroeg in het jaar draait.
  const daysToEndOfYear = Math.ceil((new Date(new Date().getFullYear(), 11, 31, 23, 59).getTime() - Date.now()) / 86_400_000);
  const forward = options.windowDaysForward ?? Math.max(120, daysToEndOfYear + 7);

  return runJob(
    "google_calendar",
    "calendar.sync",
    { windowDaysBack: back, windowDaysForward: forward },
    async (ctx) => {
      if (!source.isConfigured) {
        throw new MissingCredentialsError("google_calendar", [
          "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN",
        ]);
      }

      const matchers = await buildClientMatchers();
      ctx.log(`${matchers.length} klanten geladen als matcher`);

      // Gekoppelde agenda's uit de database (Beheer → Agenda's) hebben voorrang.
      // Staat er niets, dan vallen we terug op de env-lijst of alle agenda's.
      const coupled = await listEnabledCouplings();
      let calendars: { id: string; summary: string }[];
      if (coupled.length) {
        calendars = coupled.map((c) => ({ id: c.calendarId, summary: c.label ?? c.calendarId }));
        ctx.log(`${coupled.length} gekoppelde agenda's uit beheer`);
      } else if (source.configuredCalendarIds.length) {
        // Echte agenda-namen ophalen (niet het kale ID), zodat de classificatie
        // o.a. "Klant Content uploaden" als publicatie-agenda herkent.
        const all = await source.listCalendars().catch(() => [] as { id: string; summary: string }[]);
        const byId = new Map(all.map((c) => [c.id, c.summary]));
        calendars = source.configuredCalendarIds.map((id) => ({ id, summary: byId.get(id) ?? id }));
      } else {
        calendars = await source.listCalendars();
      }

      const timeMin = new Date(Date.now() - back * 86_400_000).toISOString();
      const timeMax = new Date(Date.now() + forward * 86_400_000).toISOString();

      let matched = 0;
      let needsReview = 0;
      // Per agenda bijhouden welke afspraken we nu zagen, zodat we daarna
      // afspraken die in Google verdwenen/geannuleerd zijn kunnen opruimen.
      const seenByCalendar = new Map<string, Set<string>>();

      // Welke afspraken staan al in de database? Eén keer ophalen voor de
      // betrokken agenda's, zodat we in bulk kunnen wegschrijven i.p.v. per
      // afspraak een select + insert/update (dat haalt bij honderden afspraken
      // de tijdslimiet niet).
      const calendarIds = calendars.map((c) => c.id);
      const existingKeys = new Set<string>();
      if (calendarIds.length) {
        const known = await db
          .select({ calendarId: calendarEvents.calendarId, externalId: calendarEvents.externalId })
          .from(calendarEvents)
          .where(and(eq(calendarEvents.source, "google_calendar"), inArray(calendarEvents.calendarId, calendarIds)));
        for (const r of known) existingKeys.add(`${r.calendarId}|${r.externalId}`);
      }

      const toUpsert: (typeof calendarEvents.$inferInsert)[] = [];

      for (const cal of calendars) {
        // Eén onbereikbare agenda (verwijderd, hernoemd of toegang ingetrokken)
        // mag nooit de hele sync platleggen. We slaan zo'n agenda over met een
        // waarschuwing en gaan door met de rest. Belangrijk: we voegen hem dan
        // NIET toe aan seenByCalendar, zodat de opruimstap zijn eerder gesyncte
        // afspraken niet ten onrechte als geannuleerd markeert.
        let events: CalendarEvent[];
        try {
          events = await source.listEvents(cal.id, { timeMin, timeMax });
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          ctx.log(`Agenda "${cal.summary}" overgeslagen (niet bereikbaar): ${msg}`);
          continue;
        }
        ctx.log(`Agenda "${cal.summary}": ${events.length} afspraken`);
        if (!seenByCalendar.has(cal.id)) seenByCalendar.set(cal.id, new Set());

        for (const ev of events) {
          ctx.counters.processed++;
          const { startsAt, endsAt, allDay } = resolveTimes(ev);
          if (!startsAt || !ev.id) {
            ctx.counters.failed++;
            continue;
          }
          seenByCalendar.get(cal.id)!.add(ev.id);

          const match = matchEvent(ev, matchers, cal.summary);
          const clientId =
            match.confidence === "high" || match.confidence === "medium"
              ? match.clientId
              : null;
          // Niet-gekoppelde, duidelijk interne afspraken apart markeren zodat ze
          // niet in de controlelijst terechtkomen.
          const kind =
            !clientId && isInternalAppointment(ev, cal.summary)
              ? "intern"
              : classifyAppointment(ev.summary, cal.summary);
          if (clientId) matched++;
          else if (kind !== "intern") needsReview++;

          toUpsert.push({
            source: "google_calendar",
            calendarId: cal.id,
            calendarName: cal.summary ?? null,
            externalId: ev.id,
            clientId,
            kind,
            title: ev.summary ?? null,
            description: ev.description ?? null,
            location: ev.location ?? null,
            startsAt,
            endsAt,
            allDay,
            attendees: (ev.attendees ?? []).map((a) => ({
              email: a.email ?? null,
              displayName: a.displayName ?? null,
            })),
            htmlLink: ev.htmlLink ?? null,
            status: ev.status ?? null,
            matchConfidence: match.confidence,
            matchReason: match.reason,
            matchedBy: match.matchedBy,
            candidates: match.candidates,
            syncedAt: new Date(),
            updatedAt: new Date(),
          });
        }
      }

      // In bulk wegschrijven: upsert op (source, agenda, externalId), in blokken
      // zodat ook honderden afspraken ruim binnen de tijdslimiet passen.
      const CHUNK = 200;
      for (let i = 0; i < toUpsert.length; i += CHUNK) {
        await db
          .insert(calendarEvents)
          .values(toUpsert.slice(i, i + CHUNK))
          .onConflictDoUpdate({
            target: [calendarEvents.source, calendarEvents.calendarId, calendarEvents.externalId],
            set: {
              calendarName: sql`excluded.calendar_name`,
              clientId: sql`excluded.client_id`,
              kind: sql`excluded.kind`,
              title: sql`excluded.title`,
              description: sql`excluded.description`,
              location: sql`excluded.location`,
              startsAt: sql`excluded.starts_at`,
              endsAt: sql`excluded.ends_at`,
              allDay: sql`excluded.all_day`,
              attendees: sql`excluded.attendees`,
              htmlLink: sql`excluded.html_link`,
              status: sql`excluded.status`,
              matchConfidence: sql`excluded.match_confidence`,
              matchReason: sql`excluded.match_reason`,
              matchedBy: sql`excluded.matched_by`,
              candidates: sql`excluded.candidates`,
              syncedAt: sql`excluded.synced_at`,
              updatedAt: sql`excluded.updated_at`,
            },
          });
      }
      for (const v of toUpsert) {
        if (existingKeys.has(`${v.calendarId}|${v.externalId}`)) ctx.counters.updated++;
        else ctx.counters.created++;
      }

      // Annuleringen opruimen: afspraken die eerder in het venster gesynct zijn
      // maar nu niet meer uit Google terugkomen (geannuleerd of verwijderd),
      // markeren we als geannuleerd en we annuleren de afgeleide opnamedag.
      let cancelled = 0;
      const timeMinDate = new Date(timeMin);
      const timeMaxDate = new Date(timeMax);
      for (const [calId, seen] of seenByCalendar) {
        const known = await db
          .select({ id: calendarEvents.id, externalId: calendarEvents.externalId })
          .from(calendarEvents)
          .where(
            and(
              eq(calendarEvents.source, "google_calendar"),
              eq(calendarEvents.calendarId, calId),
              sql`${calendarEvents.status} is distinct from 'cancelled'`,
              gte(calendarEvents.startsAt, timeMinDate),
              lte(calendarEvents.startsAt, timeMaxDate),
            ),
          );
        for (const row of known) {
          if (seen.has(row.externalId)) continue;
          await db.update(calendarEvents).set({ status: "cancelled", syncedAt: new Date(), updatedAt: new Date() }).where(eq(calendarEvents.id, row.id));
          // Afgeleide opnamedag annuleren (de calendar_shoot-mapping gebruikt
          // het calendar_events-id als itemId).
          const [map] = await db
            .select({ entityId: mondayMappings.entityId })
            .from(mondayMappings)
            .where(and(eq(mondayMappings.entityType, "calendar_shoot"), eq(mondayMappings.itemId, row.id)))
            .limit(1);
          if (map?.entityId) {
            await db.update(productionDays).set({ status: "cancelled", updatedAt: new Date() }).where(eq(productionDays.id, map.entityId));
            // De automatisch aangemaakte, nog niet gestarte editing-opdracht van
            // deze opname ook intrekken (editwerk dat al loopt blijft staan).
            await db
              .update(deliverables)
              .set({ deletedAt: new Date(), updatedAt: new Date() })
              .where(and(eq(deliverables.productionDayId, map.entityId), eq(deliverables.status, "recorded"), isNull(deliverables.deletedAt)));
          }
          // Verwijderde publicatie-afspraak ("Klant Content uploaden") → ook de
          // afgeleide contentplanning-post opruimen, tenzij die al gepubliceerd is.
          const [contentMap] = await db
            .select({ entityId: mondayMappings.entityId })
            .from(mondayMappings)
            .where(and(eq(mondayMappings.entityType, "calendar_content"), eq(mondayMappings.itemId, row.id)))
            .limit(1);
          if (contentMap?.entityId) {
            await db
              .update(contentCalendar)
              .set({ deletedAt: new Date(), updatedAt: new Date() })
              .where(and(eq(contentCalendar.id, contentMap.entityId), ne(contentCalendar.status, "published"), isNull(contentCalendar.deletedAt)));
          }
          cancelled++;
        }
      }
      if (cancelled > 0) ctx.log(`${cancelled} geannuleerde/verwijderde afspraken opgeruimd`);

      // Toekomstige opname-afspraken → opnamedagen (productionDays), zodat
      // "aankomende opnames" en het klantportaal "volgende opname" de echte
      // geplande opnames tonen. Google Agenda is hiervoor de centrale bron (§5).
      const shootEvents = await db
        .select({
          id: calendarEvents.id,
          clientId: calendarEvents.clientId,
          title: calendarEvents.title,
          location: calendarEvents.location,
          startsAt: calendarEvents.startsAt,
          allDay: calendarEvents.allDay,
        })
        .from(calendarEvents)
        .where(
          and(
            eq(calendarEvents.kind, "opname"),
            isNotNull(calendarEvents.clientId),
            gte(calendarEvents.startsAt, new Date()),
            sql`${calendarEvents.status} is distinct from 'cancelled'`,
          ),
        );

      // Ontdubbelen: dezelfde opname kan in meerdere gekoppelde agenda's staan
      // (bijv. een gedeelde afspraak). We leiden er dan één opnamedag van af,
      // op basis van klant + datum + titel + starttijd.
      // Voor de automatische deliverable per opname: klantnaam + werkdag-deadline.
      const holidays = nlHolidaySet();
      const clientNameById = new Map(matchers.map((m) => [m.id, m.name]));

      // Vaste editor per klant → user-id, zodat nieuwe opnames automatisch bij de
      // juiste editor op het board komen (op basis van clients.editorName).
      const editorUsers = await db.select({ id: users.id, fullName: users.fullName }).from(users).where(and(eq(users.primaryRole, "editor"), eq(users.status, "active")));
      const editorByKey = new Map<string, string>();
      for (const e of editorUsers) { const k = firstNameKey(e.fullName); if (k && !editorByKey.has(k)) editorByKey.set(k, e.id); }
      const clientEditorRows = await db.select({ id: clients.id, editorName: clients.editorName }).from(clients).where(isNull(clients.deletedAt));
      const editorByClient = new Map<string, string>();
      for (const c of clientEditorRows) { if (c.editorName) { const uid = editorByKey.get(firstNameKey(c.editorName)); if (uid) editorByClient.set(c.id, uid); } }

      // Backfill: bestaande opnames én opleveringen zonder editor krijgen de vaste
      // editor van de klant (zie assignMissingEditors, hieronder gedeeld met de
      // editing-pagina).
      await assignMissingEditors();

      // Videograaf automatisch koppelen: meestal Rutger, Luxewagen → Jarno.
      const vgRows = await db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(inArray(users.email, ["rutger@shortclips.nl", "jarno@shortclips.nl"]));
      const rutgerId = vgRows.find((r) => r.email.toLowerCase() === "rutger@shortclips.nl")?.id ?? null;
      const jarnoId = vgRows.find((r) => r.email.toLowerCase() === "jarno@shortclips.nl")?.id ?? null;

      let shoots = 0;
      const seenShoot = new Map<string, string>(); // dedup-sleutel → productionDayId
      for (const ev of shootEvents) {
        if (!ev.clientId || !ev.startsAt) continue;
        const scheduledOn = ev.startsAt.toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
        const startTime = ev.allDay
          ? null
          : `${ev.startsAt.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" })}:00`;
        const dedupKey = `${ev.clientId}|${scheduledOn}|${(ev.title ?? "opnamedag").trim().toLowerCase()}|${startTime ?? "allday"}`;
        const base = {
          clientId: ev.clientId,
          title: ev.title ?? "Opnamedag",
          scheduledOn,
          ...(startTime ? { startTime } : {}),
          ...(ev.location ? { locationName: ev.location.slice(0, 200) } : {}),
          status: "planned" as const,
          updatedAt: new Date(),
        };

        const [map] = await db
          .select({ id: mondayMappings.id, entityId: mondayMappings.entityId })
          .from(mondayMappings)
          .where(and(eq(mondayMappings.entityType, "calendar_shoot"), eq(mondayMappings.itemId, ev.id)))
          .limit(1);

        // Doel-opnamedag bepalen: eerst een al in deze run gezien exemplaar
        // (andere agenda, zelfde opname), dan de bestaande koppeling, anders nieuw.
        let targetPdId = seenShoot.get(dedupKey) ?? map?.entityId ?? null;
        const alreadyCounted = seenShoot.has(dedupKey);

        if (targetPdId) {
          // Oude waarden vóór de update, om een verplaatsing te herkennen.
          const [before] = await db
            .select({ scheduledOn: productionDays.scheduledOn, startTime: productionDays.startTime, videographerId: productionDays.videographerId, coordinatorId: clients.coordinatorId })
            .from(productionDays)
            .innerJoin(clients, eq(clients.id, productionDays.clientId))
            .where(eq(productionDays.id, targetPdId))
            .limit(1);
          await db.update(productionDays).set(base).where(eq(productionDays.id, targetPdId));

          // Verplaatsing herkend (datum of starttijd gewijzigd) → betrokken
          // medewerkers melden én de auto-deadlines van gekoppelde video's
          // herberekenen (opname + 14 werkdagen). Eén melding per verzetting.
          if (before && (before.scheduledOn !== scheduledOn || (before.startTime ?? null) !== (startTime ?? null))) {
            const dateChanged = before.scheduledOn !== scheduledOn;
            if (dateChanged) {
              const newDue = addWorkingDays(scheduledOn, 14, holidays);
              await db.update(deliverables)
                .set({ dueOn: newDue, updatedAt: new Date() })
                .where(and(eq(deliverables.productionDayId, targetPdId), isNull(deliverables.deletedAt), eq(deliverables.dueOnSource, "auto")));
            }
            const edRows = await db.select({ editorId: deliverables.editorId }).from(deliverables)
              .where(and(eq(deliverables.productionDayId, targetPdId), isNull(deliverables.deletedAt)));
            const recipients = new Set<string>();
            if (before.coordinatorId) recipients.add(before.coordinatorId);
            if (before.videographerId) recipients.add(before.videographerId);
            for (const e of edRows) if (e.editorId) recipients.add(e.editorId);
            if (recipients.size > 0) {
              const cname = clientNameById.get(ev.clientId) ?? "de klant";
              const when = dateChanged
                ? `verzet van ${before.scheduledOn} naar ${scheduledOn}`
                : `qua tijd gewijzigd op ${scheduledOn}`;
              await notify({
                userIds: [...recipients],
                clientId: ev.clientId,
                type: "shoot_moved",
                level: "warning",
                title: `Opname verplaatst: ${cname}`,
                body: `De opname "${base.title}" is ${when}.${dateChanged ? " De interne deadlines zijn automatisch bijgewerkt." : ""}`,
                href: `/productions/${targetPdId}`,
                entityType: "production_day",
                entityId: targetPdId,
                dedupeKey: `shoot_moved:${targetPdId}:${scheduledOn}:${startTime ?? "allday"}`,
              });
            }
          }
        } else {
          const [created] = await db.insert(productionDays).values(base).returning({ id: productionDays.id });
          targetPdId = created!.id;
        }
        seenShoot.set(dedupKey, targetPdId);

        // Koppeling voor déze agenda-afspraak naar de (gedeelde) opnamedag wijzen.
        if (map) {
          if (map.entityId !== targetPdId) {
            await db.update(mondayMappings).set({ entityId: targetPdId, lastSyncedAt: new Date() }).where(eq(mondayMappings.id, map.id));
          }
        } else {
          await db.insert(mondayMappings).values({
            entityType: "calendar_shoot",
            entityId: targetPdId,
            boardId: "google_calendar",
            itemId: ev.id,
            lastSyncedAt: new Date(),
          });
        }

        // Elke opname wordt automatisch een editing-opdracht (deliverable), zodat
        // een nieuwe of gewijzigde opname uit Google Agenda vanzelf op het
        // editing-board komt ("binnenkort beschikbaar") — zonder handwerk. Eén
        // deliverable per opname (dedup op production_day_id).
        if (!alreadyCounted) {
          // Videograaf standaard koppelen als er nog geen staat (handmatige keuze
          // blijft behouden): Luxewagen → Jarno, de rest → Rutger.
          const [pd] = await db
            .select({ vid: productionDays.videographerId })
            .from(productionDays)
            .where(eq(productionDays.id, targetPdId))
            .limit(1);
          if (pd && !pd.vid) {
            const cname = clientNameById.get(ev.clientId) ?? "";
            const vgId = /luxewagen/i.test(cname) ? jarnoId : rutgerId;
            if (vgId) await db.update(productionDays).set({ videographerId: vgId, updatedAt: new Date() }).where(eq(productionDays.id, targetPdId));
          }

          const [existing] = await db
            .select({ id: deliverables.id })
            .from(deliverables)
            .where(and(eq(deliverables.productionDayId, targetPdId), isNull(deliverables.deletedAt)))
            .limit(1);
          if (!existing) {
            await db.insert(deliverables).values({
              clientId: ev.clientId,
              productionDayId: targetPdId,
              title: ev.title?.slice(0, 240) || `${clientNameById.get(ev.clientId) ?? "Opname"} — ${scheduledOn}`,
              status: "recorded",
              // Automatisch de vaste editor van de klant toewijzen, zodat de opname
              // meteen op het juiste editor-board komt.
              editorId: editorByClient.get(ev.clientId) ?? null,
              dueOn: addWorkingDays(scheduledOn, 14, holidays),
              dueOnSource: "auto",
              statusChangedAt: ev.startsAt ?? new Date(),
            });
          }
        }

        if (!alreadyCounted) shoots++;
      }

      // Publicatie-afspraken (agenda "Klant Content uploaden") → contentplanning.
      // De titel is de post, de omschrijving bevat de caption. Alleen met een
      // herkende klant (nooit gokken). Ontdubbeld via een calendar_content-koppeling.
      const pubEvents = await db
        .select({
          id: calendarEvents.id,
          clientId: calendarEvents.clientId,
          title: calendarEvents.title,
          description: calendarEvents.description,
          startsAt: calendarEvents.startsAt,
          allDay: calendarEvents.allDay,
        })
        .from(calendarEvents)
        .where(
          and(
            eq(calendarEvents.kind, "publicatie"),
            isNotNull(calendarEvents.clientId),
            sql`${calendarEvents.status} is distinct from 'cancelled'`,
          ),
        );

      let publications = 0;
      const seenPub = new Map<string, string>();
      for (const ev of pubEvents) {
        if (!ev.clientId || !ev.startsAt) continue;
        const scheduledOn = ev.startsAt.toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
        const scheduledAt = ev.allDay
          ? null
          : `${ev.startsAt.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" })}:00`;
        const dedupKey = `${ev.clientId}|${scheduledOn}|${(ev.title ?? "publicatie").trim().toLowerCase()}`;
        const base = {
          clientId: ev.clientId,
          title: (ev.title ?? "Publicatie").slice(0, 240),
          scheduledOn,
          ...(scheduledAt ? { scheduledAt } : {}),
          caption: ev.description ?? null,
          updatedAt: new Date(),
        };

        const [map] = await db
          .select({ id: mondayMappings.id, entityId: mondayMappings.entityId })
          .from(mondayMappings)
          .where(and(eq(mondayMappings.entityType, "calendar_content"), eq(mondayMappings.itemId, ev.id)))
          .limit(1);

        let targetId = seenPub.get(dedupKey) ?? map?.entityId ?? null;
        const alreadyCounted = seenPub.has(dedupKey);
        if (targetId) {
          await db.update(contentCalendar).set(base).where(eq(contentCalendar.id, targetId));
        } else {
          const [created] = await db.insert(contentCalendar).values(base).returning({ id: contentCalendar.id });
          targetId = created!.id;
        }
        seenPub.set(dedupKey, targetId);

        if (map) {
          if (map.entityId !== targetId) {
            await db.update(mondayMappings).set({ entityId: targetId, lastSyncedAt: new Date() }).where(eq(mondayMappings.id, map.id));
          }
        } else {
          await db.insert(mondayMappings).values({
            entityType: "calendar_content",
            entityId: targetId,
            boardId: "google_calendar",
            itemId: ev.id,
            lastSyncedAt: new Date(),
          });
        }
        if (!alreadyCounted) publications++;
      }

      // Back-fill: opnames die nog géén videograaf hebben alsnog standaard
      // koppelen (Luxewagen → Jarno, de rest → Rutger). Zo staat elke opname
      // meteen op een videograaf; handmatige keuzes blijven altijd staan.
      let coupledVg = 0;
      if (rutgerId || jarnoId) {
        const uncoupled = await db
          .select({ id: productionDays.id, cname: clients.name })
          .from(productionDays)
          .innerJoin(clients, eq(clients.id, productionDays.clientId))
          .where(
            and(
              isNull(productionDays.deletedAt),
              isNull(productionDays.videographerId),
              ne(productionDays.status, "cancelled"),
            ),
          );
        for (const pd of uncoupled) {
          const vgId = /luxewagen/i.test(pd.cname) ? jarnoId : rutgerId;
          if (!vgId) continue;
          await db.update(productionDays).set({ videographerId: vgId, updatedAt: new Date() }).where(eq(productionDays.id, pd.id));
          coupledVg++;
        }
      }

      ctx.log(
        `Klaar: ${ctx.counters.processed} afspraken, ${matched} gekoppeld, ${needsReview} voor review, ${shoots} opnamedagen, ${publications} publicaties afgeleid${coupledVg > 0 ? `, ${coupledVg} videograaf-koppelingen` : ""}.`,
      );
    },
    { triggeredById: options.triggeredById },
  );
}

/**
 * Sync-bij-gebruik: ververst de Google Agenda op de achtergrond (ná de respons,
 * via after()) wanneer iemand een plannings-/contentpagina opent én de laatste
 * sync langer dan `maxAgeMinutes` geleden was. Zo zijn wijzigingen in Google
 * binnen ~een uur zichtbaar, zonder dat het de pagina vertraagt. Een atomische
 * "claim" op lastSyncAt voorkomt dat gelijktijdige bezoeken dubbel syncen.
 * Draait alleen als Google is geconfigureerd; faalt nooit richting de pagina.
 */
export async function syncCalendarIfStale(maxAgeMinutes = 20): Promise<void> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REFRESH_TOKEN) return;
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60_000);
  try {
    const claimed = await db
      .update(integrationConnections)
      .set({ lastSyncAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(integrationConnections.provider, "google_calendar"),
          or(isNull(integrationConnections.lastSyncAt), lt(integrationConnections.lastSyncAt, cutoff)),
        ),
      )
      .returning({ id: integrationConnections.id });
    if (claimed.length > 0) {
      after(async () => {
        try {
          await runCalendarSync();
        } catch {
          /* fout wordt al in de job-log vastgelegd */
        }
      });
    }
  } catch {
    /* nooit de pagina breken door een sync-check */
  }
}

/**
 * Koppelt opnames én opleveringen zonder editor automatisch aan de vaste editor
 * van de klant (clients.editorName). Idempotent — raakt alleen rijen waar de
 * editor ontbreekt, dus al toegewezen of in bewerking zijnde opleveringen van een
 * ander blijven intact. Gebruikt door de agenda-sync en door de editing-pagina,
 * zodat elke editor zijn eigen projecten in de planning heeft.
 */
export async function assignMissingEditors(): Promise<number> {
  const editorUsers = await db.select({ id: users.id, fullName: users.fullName }).from(users).where(and(eq(users.primaryRole, "editor"), eq(users.status, "active")));
  const editorByKey = new Map<string, string>();
  for (const e of editorUsers) { const k = firstNameKey(e.fullName); if (k && !editorByKey.has(k)) editorByKey.set(k, e.id); }
  const clientRows = await db.select({ id: clients.id, editorName: clients.editorName }).from(clients).where(isNull(clients.deletedAt));

  let changed = 0;
  for (const c of clientRows) {
    if (!c.editorName) continue;
    const editorId = editorByKey.get(firstNameKey(c.editorName));
    if (!editorId) continue;
    const pd = await db.update(productionDays)
      .set({ editorId, updatedAt: new Date() })
      .where(and(eq(productionDays.clientId, c.id), isNull(productionDays.editorId), isNull(productionDays.deletedAt), ne(productionDays.status, "cancelled")))
      .returning({ id: productionDays.id });
    const dv = await db.update(deliverables)
      .set({ editorId, updatedAt: new Date() })
      .where(and(eq(deliverables.clientId, c.id), isNull(deliverables.editorId), isNull(deliverables.deletedAt)))
      .returning({ id: deliverables.id });
    changed += pd.length + dv.length;
  }
  return changed;
}
