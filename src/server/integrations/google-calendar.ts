import "server-only";
import { env } from "@/lib/env";
import { apiFetch } from "./http";
import {
  IntegrationError,
  MissingCredentialsError,
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
const TOKEN_URL = "https://oauth2.googleapis.com/token";
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
  recurringEventId?: string;
  created?: string;
  updated?: string;
};

export class GoogleCalendarService {
  private accessToken: string | null = null;
  private expiresAt = 0;

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

  private async token(): Promise<string> {
    if (!this.isConfigured) {
      throw new MissingCredentialsError("google_calendar", [
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "GOOGLE_REFRESH_TOKEN",
      ]);
    }
    // Een minuut marge, zodat een token nooit halverwege een verzoek verloopt.
    if (this.accessToken && Date.now() < this.expiresAt - 60_000) {
      return this.accessToken;
    }

    const body = new URLSearchParams({
      client_id: this.clientId!,
      client_secret: this.clientSecret!,
      refresh_token: this.refreshToken!,
      grant_type: "refresh_token",
    });

    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
    });

    if (!response.ok) {
      throw new IntegrationError(
        "google_calendar",
        `Token vernieuwen mislukt (HTTP ${response.status})`,
        response.status,
        response.status >= 500,
      );
    }

    const data = (await response.json()) as { access_token: string; expires_in: number };
    this.accessToken = data.access_token;
    this.expiresAt = Date.now() + data.expires_in * 1000;
    return this.accessToken;
  }

  private async request<T>(
    path: string,
    query: Record<string, string | number | boolean | undefined> = {},
  ): Promise<T> {
    const token = await this.token();
    return apiFetch<T>("google_calendar", `${API}${path}`, {
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
