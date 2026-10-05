import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import {
  calendarEvents,
  clientContacts,
  clientIntegrations,
  clients,
} from "@/db/schema";
import {
  GoogleCalendarService,
  googleCalendar,
  type CalendarEvent,
} from "@/server/integrations/google-calendar";
import {
  classifyAppointment,
  matchEvent,
  type ClientMatcher,
} from "@/server/integrations/calendar-matching";
import { MissingCredentialsError } from "@/server/integrations/types";
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
      aliases: [], contactEmails: [], domains: [],
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
  const forward = options.windowDaysForward ?? 120;

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

      const calendars = source.configuredCalendarIds.length
        ? source.configuredCalendarIds.map((id) => ({ id, summary: id }))
        : await source.listCalendars();

      const timeMin = new Date(Date.now() - back * 86_400_000).toISOString();
      const timeMax = new Date(Date.now() + forward * 86_400_000).toISOString();

      let matched = 0;
      let needsReview = 0;

      for (const cal of calendars) {
        const events = await source.listEvents(cal.id, { timeMin, timeMax });
        ctx.log(`Agenda "${cal.summary}": ${events.length} afspraken`);

        for (const ev of events) {
          ctx.counters.processed++;
          const { startsAt, endsAt, allDay } = resolveTimes(ev);
          if (!startsAt || !ev.id) {
            ctx.counters.failed++;
            continue;
          }

          const kind = classifyAppointment(ev.summary, cal.summary);
          const match = matchEvent(ev, matchers, cal.summary);
          const clientId =
            match.confidence === "high" || match.confidence === "medium"
              ? match.clientId
              : null;
          if (clientId) matched++;
          else needsReview++;

          const values = {
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
          };

          const existing = await db
            .select({ id: calendarEvents.id })
            .from(calendarEvents)
            .where(
              and(
                eq(calendarEvents.source, "google_calendar"),
                eq(calendarEvents.calendarId, cal.id),
                eq(calendarEvents.externalId, ev.id),
              ),
            )
            .limit(1);

          if (existing[0]) {
            await db.update(calendarEvents).set(values).where(eq(calendarEvents.id, existing[0].id));
            ctx.counters.updated++;
          } else {
            await db.insert(calendarEvents).values(values);
            ctx.counters.created++;
          }
        }
      }

      ctx.log(
        `Klaar: ${ctx.counters.processed} afspraken, ${matched} gekoppeld, ${needsReview} voor review.`,
      );
    },
    { triggeredById: options.triggeredById },
  );
}
