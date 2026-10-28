import "server-only";
import { and, asc, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { contentCalendar } from "@/db/schema";
import type { Viewer } from "@/server/auth/context";

export type PortalContentPost = {
  id: string;
  title: string;
  scheduledOn: string;
  scheduledAt: string | null;
  platforms: string[];
  status: string;
  /** Staat de post online (gepubliceerd)? Dan tonen we 'm groen. */
  isOnline: boolean;
};

export type PortalContentWeek = {
  /** Maandag van de week (YYYY-MM-DD). */
  weekStart: string;
  /** Leesbare periode, bijv. "27 okt – 2 nov". */
  label: string;
  posts: PortalContentPost[];
};

export type PortalContentPlanning = {
  /** Heeft het team de contentplanning met het portaal gedeeld? */
  shared: boolean;
  weeks: PortalContentWeek[];
  total: number;
};

/** Maandag (UTC) van de week waarin `iso` valt. */
function mondayOf(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = maandag
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

function weekLabel(mondayIso: string): string {
  const start = new Date(`${mondayIso}T12:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString("nl-NL", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${fmt(start)} – ${fmt(end)}`;
}

/**
 * De contentplanning van de klant voor het portaal: welke post wanneer online
 * komt, op welke platforms, en wat er al live staat (groen). Toont alleen de
 * items die het team expliciet met de klant heeft gedeeld (contentCalendar.
 * clientApproved — via de knop "Goedkeuren en delen met klant" op de interne
 * contentplanning).
 *
 * Venster: vanaf 14 dagen terug (zodat recent gepubliceerde posts nog even
 * zichtbaar blijven) en alles vooruit. Gegroepeerd per week (maandag).
 */
export async function getPortalContentPlanning(viewer: Viewer): Promise<PortalContentPlanning> {
  const clientId = viewer.clientId;
  if (!clientId) return { shared: false, weeks: [], total: 0 };

  // Is er überhaupt al iets met deze klant gedeeld? Zo niet: "wordt voorbereid".
  const [sharedRow] = await db
    .select({ n: sql<number>`count(*)` })
    .from(contentCalendar)
    .where(and(eq(contentCalendar.clientId, clientId), isNull(contentCalendar.deletedAt), eq(contentCalendar.clientApproved, true)));
  const sharedCount = Number(sharedRow?.n ?? 0);
  if (sharedCount === 0) return { shared: false, weeks: [], total: 0 };

  const from = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
  const rows = await db
    .select({
      id: contentCalendar.id,
      title: contentCalendar.title,
      scheduledOn: contentCalendar.scheduledOn,
      scheduledAt: contentCalendar.scheduledAt,
      platforms: contentCalendar.platforms,
      status: contentCalendar.status,
    })
    .from(contentCalendar)
    .where(and(
      eq(contentCalendar.clientId, clientId),
      isNull(contentCalendar.deletedAt),
      eq(contentCalendar.clientApproved, true),
      gte(contentCalendar.scheduledOn, from),
    ))
    .orderBy(asc(contentCalendar.scheduledOn), asc(contentCalendar.scheduledAt));

  const byWeek = new Map<string, PortalContentPost[]>();
  for (const r of rows) {
    const post: PortalContentPost = {
      id: r.id,
      title: r.title,
      scheduledOn: r.scheduledOn,
      scheduledAt: r.scheduledAt ? r.scheduledAt.slice(0, 5) : null,
      platforms: Array.isArray(r.platforms) ? (r.platforms as string[]) : [],
      status: r.status,
      isOnline: r.status === "published",
    };
    const wk = mondayOf(r.scheduledOn);
    const list = byWeek.get(wk);
    if (list) list.push(post);
    else byWeek.set(wk, [post]);
  }

  // Doorlopende weken, óók als er niks gepland staat: de klant moet deze week en
  // de weken erna altijd zien (met lege dagen), zodat de planning zichtbaar
  // doorloopt i.p.v. alleen weken mét posts te tonen.
  const addWeeks = (mondayIso: string, n: number): string => {
    const d = new Date(`${mondayIso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n * 7);
    return d.toISOString().slice(0, 10);
  };
  const todayIso = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
  const thisMonday = mondayOf(todayIso);
  const postedWeeks = [...byWeek.keys()].sort((a, b) => a.localeCompare(b));
  // Start: vroegste geplande week of deze week (de vroegste van de twee).
  const startWeek = postedWeeks.length && postedWeeks[0]! < thisMonday ? postedWeeks[0]! : thisMonday;
  // Einde: minimaal deze week + 5 (dus deze + 5 volgende weken), of verder als er
  // later nog iets gepland staat.
  const defaultEnd = addWeeks(thisMonday, 5);
  const lastPosted = postedWeeks.length ? postedWeeks[postedWeeks.length - 1]! : thisMonday;
  let endWeek = lastPosted > defaultEnd ? lastPosted : defaultEnd;
  // Veiligheidsplafond: nooit meer dan ~16 weken tonen.
  const maxEnd = addWeeks(startWeek, 16);
  if (endWeek > maxEnd) endWeek = maxEnd;

  const weeks: PortalContentWeek[] = [];
  for (let wk = startWeek; wk <= endWeek; wk = addWeeks(wk, 1)) {
    weeks.push({ weekStart: wk, label: weekLabel(wk), posts: byWeek.get(wk) ?? [] });
  }

  return { shared: true, weeks, total: rows.length };
}
