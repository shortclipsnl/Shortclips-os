import "server-only";
import { after } from "next/server";
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
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
  calendarMappings,
  productionDays,
  users,
} from "@/db/schema";
import { addWorkingDays } from "@/lib/workdays";
import { nlHolidaySet } from "@/lib/holidays";
import { firstNameKey } from "@/lib/editors";
import { notify } from "@/server/notifications";
import { getNumberSetting, setNumberSetting } from "@/server/app-settings";
import {
  GoogleCalendarService,
  googleCalendar,
  type CalendarEvent,
} from "@/server/integrations/google-calendar";
import {
  classifyAppointment,
  isInternalAppointment,
  isMeetingAppointment,
  matchEvent,
  strongShootSignal,
  type ClientMatcher,
} from "@/server/integrations/calendar-matching";
import { MissingCredentialsError } from "@/server/integrations/types";
import { aliasesForSlug } from "@/server/integrations/client-aliases";
import { listEnabledCouplings } from "@/server/calendar-couplings";
import { runJob } from "./runner";
import { editorIdsByKey, mergeDuplicateDeliverables } from "@/server/editing/integrity";

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
 * Ontdubbelt opnamedagen: dezelfde opname kon eerder (door een titel-/tijd-
 * verschil per agenda) als meerdere production_days belanden. Per klant + datum
 * houden we er één over — de opnamedag met editwerk, anders de oudste — en de
 * lege, onbewerkte duplicaten voegen we samen: hun agenda-koppelingen wijzen we
 * naar de behouden opname, en hun auto-aangemaakte (nog lege) editing-opdracht +
 * de opnamedag zelf zetten we op verwijderd (soft-delete, omkeerbaar). Een
 * duplicaat waar al aan geëdit is, blijft staan — nooit editwerk weggooien.
 */
export async function mergeDuplicateShoots(): Promise<number> {
  const groups = await db
    .select({ clientId: productionDays.clientId, scheduledOn: productionDays.scheduledOn })
    .from(productionDays)
    .where(and(isNull(productionDays.deletedAt), ne(productionDays.status, "cancelled")))
    .groupBy(productionDays.clientId, productionDays.scheduledOn)
    .having(sql`count(*) > 1`);
  if (groups.length === 0) return 0;

  let merged = 0;
  for (const g of groups) {
    const pds = await db
      .select({ id: productionDays.id })
      .from(productionDays)
      .where(and(eq(productionDays.clientId, g.clientId), eq(productionDays.scheduledOn, g.scheduledOn), isNull(productionDays.deletedAt), ne(productionDays.status, "cancelled")))
      .orderBy(asc(productionDays.createdAt));
    if (pds.length < 2) continue;
    const ids = pds.map((p) => p.id);

    // Per opnamedag: is er al editwerk (een niet-lege, niet-verwijderde opdracht)?
    const dels = await db
      .select({ pdId: deliverables.productionDayId, status: deliverables.status, currentVersion: deliverables.currentVersion, footageUrl: deliverables.footageUrl, frameUrl: deliverables.frameUrl, id: deliverables.id })
      .from(deliverables)
      .where(and(inArray(deliverables.productionDayId, ids), isNull(deliverables.deletedAt)));
    const hasWork = new Set<string>();
    const emptyDelByPd = new Map<string, string[]>();
    for (const d of dels) {
      if (!d.pdId) continue;
      const empty = d.status === "recorded" && (d.currentVersion ?? 0) === 0 && !d.footageUrl && !d.frameUrl;
      if (empty) { const list = emptyDelByPd.get(d.pdId) ?? []; list.push(d.id); emptyDelByPd.set(d.pdId, list); }
      else hasWork.add(d.pdId);
    }

    const canonical = pds.find((p) => hasWork.has(p.id)) ?? pds[0]!;
    for (const p of pds) {
      if (p.id === canonical.id || hasWork.has(p.id)) continue; // behouden of met werk → laat staan
      await db.update(calendarMappings)
        .set({ entityId: canonical.id, lastSyncedAt: new Date() })
        .where(and(eq(calendarMappings.entityType, "calendar_shoot"), eq(calendarMappings.entityId, p.id)));
      const emptyIds = emptyDelByPd.get(p.id) ?? [];
      if (emptyIds.length) await db.update(deliverables).set({ deletedAt: new Date(), updatedAt: new Date() }).where(inArray(deliverables.id, emptyIds));
      await db.update(productionDays).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(productionDays.id, p.id));
      merged++;
    }
  }
  return merged;
}

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
      let unreachable = 0;
      let lastError = "";

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
          unreachable++;
          lastError = msg;
          ctx.log(`Agenda "${cal.summary}" overgeslagen (niet bereikbaar): ${msg}`);
          // Punt 7: duidelijke melding als één agenda niet synchroniseert, zodat
          // het team het meteen kan oplossen (de andere agenda's gaan door). Eén
          // melding per agenda per dag.
          const dayKey = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
          await notify({
            roles: ["owner", "operational_manager"],
            level: "critical",
            type: "calendar_agenda_unreachable",
            title: `Agenda synchroniseert niet: ${cal.summary}`,
            body: `De agenda "${cal.summary}" kon niet worden opgehaald en is overgeslagen. Opnames uit deze agenda ontbreken mogelijk in de planning. ${msg}`.slice(0, 300),
            href: "/settings/agendas",
            dedupeKey: `calendar_unreachable:${cal.id}:${dayKey}`,
          }).catch(() => {});
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
          let kind =
            !clientId && isInternalAppointment(ev, cal.summary)
              ? "intern"
              : classifyAppointment(ev.summary, cal.summary);
          // Context-override: een afspraak met een herkende klant, een aantal shorts
          // in de titel en een stevig dagblok (geen hard overleg-woord) is in de
          // praktijk een opname — ook als de titel-classifier 'm als "overig" zag
          // (bijv. "AI2 - 8 shorts - afstemmen datums"). Alleen hier, met context.
          if (kind === "overig" && clientId) {
            const durationMinutes = startsAt && endsAt ? Math.round((endsAt.getTime() - startsAt.getTime()) / 60000) : null;
            if (strongShootSignal(ev.summary, { durationMinutes, allDay, hasClient: true })) kind = "opname";
          }
          // Meeting-herkenning: een nog niet-geclassificeerde afspraak (overig) die
          // paars is, een Google Meet-link heeft of een meeting-trefwoord bevat,
          // wordt een "meeting" — zodat online meetings, informatiemeetings,
          // klantafspraken en afspraken op locatie in de Weekplanning verschijnen.
          if (kind === "overig" && isMeetingAppointment(ev, cal.summary)) kind = "meeting";
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
            colorId: ev.colorId ?? null,
            meetLink: ev.hangoutLink ?? null,
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

      // Géén enkele agenda bereikbaar (bijv. verlopen Google-token): dan is dit
      // geen geslaagde sync. Eén duidelijke melding en de job op "mislukt", in
      // plaats van stil "succes" met verouderde opnames in het portaal.
      if (calendars.length > 0 && unreachable === calendars.length) {
        const tokenIssue = /token/i.test(lastError);
        const dayKey = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
        await notify({
          roles: ["owner"],
          level: "critical",
          type: "calendar_sync_down",
          title: "Google Agenda-koppeling ligt plat",
          body: tokenIssue
            ? "De Google-toegang is verlopen (token vernieuwen mislukt). Opnames, afspraken en publicaties worden niet meer bijgewerkt. Maak een nieuw Google-token aan (scripts/google-refresh-token.mjs) en zet het als GOOGLE_REFRESH_TOKEN in Vercel."
            : `Geen enkele agenda kon worden opgehaald: ${lastError}`.slice(0, 300),
          href: "/settings/integrations",
          dedupeKey: `calendar_sync_down:${dayKey}`,
        }).catch(() => {});
        throw new Error(`Geen enkele agenda bereikbaar: ${lastError}`);
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
              // Een handmatige koppeling (review → "koppel aan klant") blijft staan:
              // de automatische matcher mag klant/soort van zo'n afspraak niet meer
              // overschrijven, anders zou de uursync 'm terug op "geen klant" zetten.
              clientId: sql`case when ${calendarEvents.matchConfidence} = 'manual' then ${calendarEvents.clientId} else excluded.client_id end`,
              kind: sql`case when ${calendarEvents.matchConfidence} = 'manual' then ${calendarEvents.kind} else excluded.kind end`,
              matchConfidence: sql`case when ${calendarEvents.matchConfidence} = 'manual' then 'manual' else excluded.match_confidence end`,
              matchReason: sql`case when ${calendarEvents.matchConfidence} = 'manual' then ${calendarEvents.matchReason} else excluded.match_reason end`,
              matchedBy: sql`case when ${calendarEvents.matchConfidence} = 'manual' then ${calendarEvents.matchedBy} else excluded.matched_by end`,
              title: sql`excluded.title`,
              description: sql`excluded.description`,
              location: sql`excluded.location`,
              startsAt: sql`excluded.starts_at`,
              endsAt: sql`excluded.ends_at`,
              allDay: sql`excluded.all_day`,
              attendees: sql`excluded.attendees`,
              htmlLink: sql`excluded.html_link`,
              colorId: sql`excluded.color_id`,
              meetLink: sql`excluded.meet_link`,
              status: sql`excluded.status`,
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
            .select({ entityId: calendarMappings.entityId })
            .from(calendarMappings)
            .where(and(eq(calendarMappings.entityType, "calendar_shoot"), eq(calendarMappings.itemId, row.id)))
            .limit(1);
          // Dezelfde opname kan via meerdere afspraken binnenkomen (gedeelde of
          // dubbele afspraak). Alleen annuleren als er géén andere, nog actieve
          // afspraak meer naar deze opnamedag wijst — anders zou het verwijderen
          // van één kopie de echte opname (en het editwerk) wegtrekken.
          const stillActive = map?.entityId
            ? await db
                .select({ id: calendarEvents.id })
                .from(calendarMappings)
                .innerJoin(calendarEvents, sql`${calendarEvents.id}::text = ${calendarMappings.itemId}`)
                .where(and(
                  eq(calendarMappings.entityType, "calendar_shoot"),
                  eq(calendarMappings.entityId, map.entityId),
                  ne(calendarEvents.id, row.id),
                  sql`${calendarEvents.status} is distinct from 'cancelled'`,
                  eq(calendarEvents.kind, "opname"),
                ))
                .limit(1)
            : [];
          if (map?.entityId && stillActive.length === 0) {
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
            .select({ entityId: calendarMappings.entityId })
            .from(calendarMappings)
            .where(and(eq(calendarMappings.entityType, "calendar_content"), eq(calendarMappings.itemId, row.id)))
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
      const editorByKey = await editorIdsByKey();
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

      // Eerst bestaande duplicaten (van vóór de klant+datum-dedup) opruimen, zodat
      // we per klant+datum op één opnamedag verder werken. Faalt zacht — de
      // ontdubbeling mag de sync nooit breken.
      try { await mergeDuplicateShoots(); } catch { /* ontdubbeling overslaan */ }

      let shoots = 0;
      const seenShoot = new Map<string, string>(); // dedup-sleutel → productionDayId
      for (const ev of shootEvents) {
        if (!ev.clientId || !ev.startsAt) continue;
        const scheduledOn = ev.startsAt.toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
        const startTime = ev.allDay
          ? null
          : `${ev.startsAt.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" })}:00`;
        // Eén opname per klant per dag. Dezelfde opname staat vaak in meerdere
        // gekoppelde agenda's (ieder teamlid heeft 'm), soms met een iets andere
        // titel of tijd — dat is NOOIT een tweede opname. Daarom dedupen we puur op
        // klant + datum, zodat er niet per agenda een duplicaat ontstaat.
        const dedupKey = `${ev.clientId}|${scheduledOn}`;
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
          .select({ id: calendarMappings.id, entityId: calendarMappings.entityId })
          .from(calendarMappings)
          .where(and(eq(calendarMappings.entityType, "calendar_shoot"), eq(calendarMappings.itemId, ev.id)))
          .limit(1);

        // Doel-opnamedag bepalen: eerst een al in deze run gezien exemplaar
        // (andere agenda, zelfde opname), dan de bestaande koppeling, anders nieuw.
        let targetPdId = seenShoot.get(dedupKey) ?? map?.entityId ?? null;
        const alreadyCounted = seenShoot.has(dedupKey);
        // Nog geen doel? Dan eerst een bestaande opnamedag van deze klant op deze
        // datum zoeken vóór we een nieuwe aanmaken. Zonder deze stap maakte een
        // nieuwe (of opnieuw aangemaakte) afspraak een tweede opnamedag naast de
        // bestaande — de bron van de dubbele opnames en projecten.
        if (!targetPdId) {
          const [existingDay] = await db
            .select({ id: productionDays.id })
            .from(productionDays)
            .where(and(eq(productionDays.clientId, ev.clientId), eq(productionDays.scheduledOn, scheduledOn), isNull(productionDays.deletedAt)))
            .orderBy(sql`case when ${productionDays.status} = 'cancelled' then 1 else 0 end`, asc(productionDays.createdAt))
            .limit(1);
          if (existingDay) targetPdId = existingDay.id;
        }

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
          const [created] = await db
            .insert(productionDays)
            .values({ ...base, editorId: editorByClient.get(ev.clientId) ?? null })
            .returning({ id: productionDays.id });
          targetPdId = created!.id;
        }
        seenShoot.set(dedupKey, targetPdId);

        // Koppeling voor déze agenda-afspraak naar de (gedeelde) opnamedag wijzen.
        if (map) {
          if (map.entityId !== targetPdId) {
            await db.update(calendarMappings).set({ entityId: targetPdId, lastSyncedAt: new Date() }).where(eq(calendarMappings.id, map.id));
          }
        } else {
          await db.insert(calendarMappings).values({
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

      // Na de opnames: dubbele opnamedagen (bijv. door een verzette afspraak die op
      // een bestaande datum landt) en dubbele editing-projecten per opname opruimen.
      try {
        const mergedDays = await mergeDuplicateShoots();
        const r = await mergeDuplicateDeliverables();
        if (mergedDays || r.merged || r.aligned) ctx.log(`Opgeschoond: ${mergedDays} dubbele opnamedagen, ${r.merged} dubbele editing-projecten, ${r.aligned} editor-correcties.`);
      } catch { /* opschonen mag de sync nooit breken */ }

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
          .select({ id: calendarMappings.id, entityId: calendarMappings.entityId })
          .from(calendarMappings)
          .where(and(eq(calendarMappings.entityType, "calendar_content"), eq(calendarMappings.itemId, ev.id)))
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
            await db.update(calendarMappings).set({ entityId: targetId, lastSyncedAt: new Date() }).where(eq(calendarMappings.id, map.id));
          }
        } else {
          await db.insert(calendarMappings).values({
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
export async function syncCalendarIfStale(maxAgeMinutes = 5): Promise<void> {
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
  const editorByKey = await editorIdsByKey();
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

/**
 * Draait `assignMissingEditors` alleen als het langer dan `maxAgeMinutes` geleden
 * is, en dan ná de response (Next's `after`), zodat het de editing-pagina niet
 * vertraagt. Idempotent; faalt nooit richting de pagina.
 */
export async function assignMissingEditorsIfStale(maxAgeMinutes = 30): Promise<void> {
  try {
    const last = await getNumberSetting("jobs.assign_editors_last_ms", 0);
    if (Date.now() - last < maxAgeMinutes * 60_000) return;
    await setNumberSetting("jobs.assign_editors_last_ms", Date.now(), { category: "jobs" });
    after(async () => {
      try {
        await assignMissingEditors();
      } catch {
        /* fout wordt al gelogd; nooit de pagina breken */
      }
    });
  } catch {
    /* nooit de pagina breken door deze check */
  }
}

/**
 * Ruimt dubbele opnamedagen op (klant + datum) als dat langer dan `maxAgeMinutes`
 * geleden is, ná de response. Draait los van de Google-sync, zodat het
 * editing-board (en de opnameplanning) zichzelf opruimt bij bezoek — ook als
 * Google even niet bereikbaar is. Idempotent en cheap als er niets dubbel staat.
 */
export async function mergeDuplicateShootsIfStale(maxAgeMinutes = 5): Promise<void> {
  try {
    const last = await getNumberSetting("jobs.merge_shoots_last_ms", 0);
    if (Date.now() - last < maxAgeMinutes * 60_000) return;
    await setNumberSetting("jobs.merge_shoots_last_ms", Date.now(), { category: "jobs" });
    after(async () => {
      try {
        await mergeDuplicateShoots();
        await mergeDuplicateDeliverables();
      } catch {
        /* nooit de pagina breken */
      }
    });
  } catch {
    /* nooit de pagina breken door deze check */
  }
}
