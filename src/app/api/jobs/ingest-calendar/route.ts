import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { runCalendarSync, type CalendarSource } from "@/server/jobs/calendar-sync";
import type { CalendarEvent } from "@/server/integrations/google-calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Brug-route: laadt echte Google Agenda-afspraken in ShortClips OS via een
 * meegestuurde payload, zonder dat de app zelf al een OAuth-refresh-token heeft.
 * Zo zien we de volledige keten (matchen → koppelen → portaal) werken met echte
 * data, terwijl de duurzame koppeling (eigen refresh-token) nog wordt ingericht.
 *
 * Dezelfde matcher en opslag als de normale sync — alleen de BRON verschilt:
 * hier een in-memory bron uit de payload in plaats van de live Google-adapter.
 * Beveiligd met CRON_SECRET, net als /api/jobs/run.
 */

function authorized(request: Request): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return false;
  const provided = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Google levert hele-dag-datums soms als volledige timestamp; normaliseer naar YYYY-MM-DD. */
function normalizeDate(d?: string): string | undefined {
  if (!d) return d;
  return d.length > 10 ? d.slice(0, 10) : d;
}

function normalizeEvent(ev: CalendarEvent): CalendarEvent {
  return {
    ...ev,
    start: ev.start
      ? { ...ev.start, date: normalizeDate(ev.start.date) }
      : ev.start,
    end: ev.end ? { ...ev.end, date: normalizeDate(ev.end.date) } : ev.end,
  };
}

type IngestBody = {
  calendars: Array<{ id: string; summary: string; events: CalendarEvent[] }>;
  windowDaysBack?: number;
  windowDaysForward?: number;
};

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Niet toegestaan." }, { status: 401 });
  }

  let body: IngestBody;
  try {
    body = (await request.json()) as IngestBody;
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON." }, { status: 400 });
  }
  if (!Array.isArray(body.calendars) || body.calendars.length === 0) {
    return NextResponse.json({ error: "Geen agenda's in payload." }, { status: 400 });
  }

  const byId = new Map<string, CalendarEvent[]>();
  const list = body.calendars.map((c) => {
    byId.set(c.id, (c.events ?? []).map(normalizeEvent));
    return { id: c.id, summary: c.summary };
  });

  const source: CalendarSource = {
    isConfigured: true,
    // Leeg laten: dan vraagt de sync listCalendars() op en houdt hij de échte
    // agendanamen (die de matcher gebruikt om afspraken te classificeren).
    configuredCalendarIds: [],
    async listCalendars() {
      return list;
    },
    async listEvents(calendarId) {
      return byId.get(calendarId) ?? [];
    },
  };

  const result = await runCalendarSync({
    source,
    windowDaysBack: body.windowDaysBack ?? 7,
    windowDaysForward: body.windowDaysForward ?? 180,
  });

  return NextResponse.json({ ok: result.ok, job: "calendar.ingest", result });
}
