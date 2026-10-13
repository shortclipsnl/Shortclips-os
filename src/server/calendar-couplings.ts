import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { calendarCouplings } from "@/db/schema";
import { googleCalendar } from "@/server/integrations/google-calendar";

export type CalendarCoupling = typeof calendarCouplings.$inferSelect;

/** Standaardkleuren om een nieuwe agenda een eigen, afwijkende kleur te geven. */
export const AGENDA_COLORS = [
  "#2E90FA", // blauw (ShortClips)
  "#FF6A00", // oranje (ShortClips)
  "#7c5cff", // violet
  "#2e9a6e", // groen
  "#d9483b", // rood
  "#d98200", // amber
  "#0a66c2", // linkedin-blauw
  "#e1306c", // magenta
] as const;

/** Alle gekoppelde agenda's (owner-beheer), gesorteerd op label/id. */
export async function listCouplings(): Promise<CalendarCoupling[]> {
  return db.select().from(calendarCouplings).orderBy(asc(calendarCouplings.label), asc(calendarCouplings.calendarId));
}

/** Alleen de ingeschakelde agenda's — deze worden daadwerkelijk gesynchroniseerd. */
export async function listEnabledCouplings(): Promise<CalendarCoupling[]> {
  return db.select().from(calendarCouplings).where(eq(calendarCouplings.enabled, true));
}

/** Map calendarId → kleur, voor gekleurde weergave van afspraken per agenda. */
export async function calendarColorMap(): Promise<Map<string, string>> {
  const rows = await listCouplings();
  return new Map(rows.map((r) => [r.calendarId, r.color]));
}

export type AvailableCalendar = { id: string; summary: string; alreadyCoupled: boolean };

/**
 * De agenda's waartoe het Google-account toegang heeft, zodat je er één kunt
 * kiezen i.p.v. een id in te typen. Geeft een nette fout terug als Google
 * (nog) niet gekoppeld is — dan kun je alsnog handmatig een id toevoegen.
 */
export async function listAvailableGoogleCalendars(): Promise<
  { ok: true; calendars: AvailableCalendar[] } | { ok: false; message: string }
> {
  if (!googleCalendar.isConfigured) {
    return { ok: false, message: "Google is nog niet gekoppeld (GOOGLE_* ontbreekt). Je kunt een agenda-id wel handmatig toevoegen." };
  }
  try {
    const [list, coupled] = await Promise.all([googleCalendar.listCalendars(), listCouplings()]);
    const have = new Set(coupled.map((c) => c.calendarId));
    return {
      ok: true,
      calendars: list.map((c) => ({ id: c.id, summary: c.summary, alreadyCoupled: have.has(c.id) })),
    };
  } catch {
    return { ok: false, message: "Agenda's ophalen bij Google is niet gelukt. Je kunt een agenda-id wel handmatig toevoegen." };
  }
}
