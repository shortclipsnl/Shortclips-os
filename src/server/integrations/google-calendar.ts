import "server-only";
import { env } from "@/lib/env";
import { apiFetch } from "./http";
import { googleAuth } from "./google-auth";
import {
  IntegrationError,
  type ConnectionTest,
} from "./types";

/**
 * Google Agenda — Calendar API v3.
 *
 * Dezelfde refresh-token-flow als Google Drive: de refresh-token staat in de
 * omgeving en wordt omgewisseld voor een kortlevend access-token. De token moet
 * naast de Drive-scope óók `calendar.readonly` hebben.
 *
 * ShortClips OS leest afspraken (opnamedagen, scriptbesprekingen, evaluaties,
 * publicaties) en koppelt ze aan de juiste klant. Onzekere afspraken worden
 * nooit stilletjes toegewezen — die belanden in de review in het beheer.
 */
const API = "https://www.googleapis.com/calendar/v3";

export type CalendarListEntry = {
  id: string;
  summary: string;
  description?: string;
  timeZone?: string;
  primary?: boolean;
  accessRole?: string;
};

export type CalendarEventTime = {
  dateTime?: string; // RFC3339 met tijd
  date?: string; // YYYY-MM-DD bij hele dagen
  timeZone?: string;
};

export type CalendarAttendee = {
  email?: string;
  displayName?: string;
  responseStatus?: string;
  organizer?: boolean;
  self?: boolean;
  resource?: boolean;
};

export type CalendarEvent = {
  id: string;
  status?: string; // confirmed | tentative | cancelled
  summary?: string;
  description?: string;
  location?: string;
  start?: CalendarEventTime;
  end?: CalendarEventTime;
  attendees?: CalendarAttendee[];
  organizer?: { email?: string; displayName?: string };
  htmlLink?: string;
  hangoutLink?: string;
  /** Kleur-id uit Google Agenda (string "1".."11"); "3" = Grape/paars. */
  colorId?: string;
  recurringEventId?: string;
  created?: string;
  updated?: string;
};

export class GoogleCalendarService {

  constructor(
    private clientId = env.GOOGLE_CLIENT_ID,
    private clientSecret = env.GOOGLE_CLIENT_SECRET,
    private refreshToken = env.GOOGLE_REFRESH_TOKEN,
  ) {}

  get isConfigured(): boolean {
    return Boolean(this.clientId && this.clientSecret && this.refreshToken);
  }

  /** Welke agenda's synchroniseren we? Leeg = alle die het account mag zien. */
  get configuredCalendarIds(): string[] {
    return (env.GOOGLE_CALENDAR_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /** Token komt uit het centrale Google-tokenbeheer (gedeeld met Drive en Gmail). */
  private token(): Promise<string> {
    return googleAuth.getAccessToken("google_calendar");
  }

  private async request<T>(
    path: string,
    query: Record<string, string | number | boolean | undefined> = {},
  ): Promise<T> {
    const token = await this.token();
    return apiFetch<T>("google_calendar", `${API}${path}`, {
      retries: 4,
      onUnauthorized: async () => {
        googleAuth.invalidate();
        return { Authorization: `Bearer ${await this.token()}` };
      },
      headers: { Authorization: `Bearer ${token}` },
      query,
    });
  }

  async testConnection(): Promise<ConnectionTest> {
    if (!this.isConfigured) {
      return {
        ok: false,
        message:
          "Nog niet ingesteld: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET en GOOGLE_REFRESH_TOKEN ontbreken.",
      };
    }
    try {
      const list = await this.listCalendars();
      const configured = this.configuredCalendarIds;
      const known = configured.length
        ? configured.filter((id) => list.some((c) => c.id === id))
        : list.map((c) => c.id);
      return {
        ok: true,
        message: configured.length
          ? `Verbonden. ${known.length} van ${configured.length} ingestelde agenda's gevonden (${list.length} beschikbaar).`
          : `Verbonden. ${list.length} agenda's beschikbaar.`,
        detail: { calendars: list.map((c) => ({ id: c.id, summary: c.summary })) },
      };
    } catch (error) {
      const err = error as IntegrationError;
      return {
        ok: false,
        message: err.userMessage ?? "Verbinding mislukt.",
        detail: { error: err.message },
      };
    }
  }

  /** Alle agenda's waartoe het account toegang heeft. */
  async listCalendars(): Promise<CalendarListEntry[]> {
    const items: CalendarListEntry[] = [];
    let pageToken: string | undefined;
    do {
      const page = await this.request<{
        items: CalendarListEntry[];
        nextPageToken?: string;
      }>("/users/me/calendarList", { pageToken, maxResults: 250 });
      items.push(...(page.items ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return items;
  }

  /**
   * Afspraken uit één agenda binnen een venster. `singleEvents` klapt
   * herhalende afspraken uit naar losse exemplaren, zodat elke opnamedag een
   * echte datum heeft. Geannuleerde afspraken worden door Google al
   * uitgefilterd bij `singleEvents=true`.
   */
  async listEvents(
    calendarId: string,
    opts: { timeMin: string; timeMax: string; maxResults?: number } = {
      timeMin: new Date().toISOString(),
      timeMax: new Date(Date.now() + 1000 * 60 * 60 * 24 * 120).toISOString(),
    },
  ): Promise<CalendarEvent[]> {
    const events: CalendarEvent[] = [];
    let pageToken: string | undefined;
    const id = encodeURIComponent(calendarId);

    do {
      const page = await this.request<{
        items: CalendarEvent[];
        nextPageToken?: string;
      }>(`/calendars/${id}/events`, {
        timeMin: opts.timeMin,
        timeMax: opts.timeMax,
        singleEvents: true,
        orderBy: "startTime",
        maxResults: opts.maxResults ?? 250,
        pageToken,
      });
      events.push(...(page.items ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken && events.length < 2000);

    return events.filter((e) => e.status !== "cancelled");
  }

  /** Beginmoment van een afspraak als Date, ook voor hele-dag-afspraken. */
  static startDate(event: CalendarEvent): Date | null {
    const s = event.start;
    if (!s) return null;
    if (s.dateTime) return new Date(s.dateTime);
    if (s.date) return new Date(`${s.date}T00:00:00`);
    return null;
  }

  static isAllDay(event: CalendarEvent): boolean {
    return Boolean(event.start?.date && !event.start?.dateTime);
  }
}

export const googleCalendar = new GoogleCalendarService();
