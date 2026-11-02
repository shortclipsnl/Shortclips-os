import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, isNotNull, isNull, notInArray } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, deliverables, productionDays, users } from "@/db/schema";
import { env } from "@/lib/env";

/* ------------------------------------------------------------------ *
 * Persoonlijke iCal-agendafeed per editor.
 *
 * Elke editor heeft een uniek, geheim token. De feed-URL
 *   <APP_URL>/api/editor/agenda/<token>.ics
 * levert een dynamische VCALENDAR met de deadlines van de video's die aan die
 * editor zijn toegewezen — live uit de database. Google Agenda abonneert op de
 * URL en ververst periodiek; nieuw werk verschijnt, deadlines worden bijgewerkt
 * en hertoegewezen/verwijderd werk verdwijnt vanzelf (stabiele UID per project,
 * dus nooit dubbel). De feed toont uitsluitend het eigen werk van de editor.
 * ------------------------------------------------------------------ */

/** Afgeronde/gepubliceerde statussen horen niet meer in de agenda. */
const DONE_STATUSES = ["approved", "ready_to_publish", "scheduled", "published", "analysis_available"];

function newToken(): string {
  return randomBytes(24).toString("base64url"); // 32 tekens, url-veilig
}

/** Haalt het token van de gebruiker op, of maakt er één aan als het nog ontbreekt. */
export async function getOrCreateIcalToken(userId: string): Promise<string> {
  const [u] = await db.select({ token: users.icalToken }).from(users).where(eq(users.id, userId)).limit(1);
  if (u?.token) return u.token;
  const token = newToken();
  await db.update(users).set({ icalToken: token, updatedAt: new Date() }).where(eq(users.id, userId));
  return token;
}

/** Maakt een nieuw token aan (trekt de oude abonnementslink in). */
export async function regenerateIcalToken(userId: string): Promise<string> {
  const token = newToken();
  await db.update(users).set({ icalToken: token, updatedAt: new Date() }).where(eq(users.id, userId));
  return token;
}

/** De basis-URL voor de feed (webcal-vriendelijk). */
export function icalFeedUrl(token: string): string {
  const base = (env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
  return `${base}/api/editor/agenda/${token}.ics`;
}

/* ------------------------------ Feed bouwen ------------------------------ */

type FeedRow = {
  id: string; title: string; dueOn: string | null; clientName: string; opnameOn: string | null; updatedAt: Date | string;
};

/** De actieve, toegewezen video's van één editor met een deadline. */
async function editorFeedRows(userId: string): Promise<FeedRow[]> {
  const rows = await db
    .select({
      id: deliverables.id,
      title: deliverables.title,
      dueOn: deliverables.dueOn,
      updatedAt: deliverables.updatedAt,
      clientName: clients.name,
      opnameOn: productionDays.scheduledOn,
    })
    .from(deliverables)
    .innerJoin(clients, eq(clients.id, deliverables.clientId))
    .leftJoin(productionDays, eq(productionDays.id, deliverables.productionDayId))
    .where(
      and(
        eq(deliverables.editorId, userId),
        isNull(deliverables.deletedAt),
        isNotNull(deliverables.dueOn),
        notInArray(deliverables.status, DONE_STATUSES),
      ),
    );
  return rows as FeedRow[];
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const ymd = (iso: string) => iso.replace(/-/g, "");
function addDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}
function stamp(d: Date | string): string {
  return new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
/** iCal-regels langer dan 75 octetten vouwen (RFC 5545). */
function fold(line: string): string {
  if (line.length <= 73) return line;
  const out: string[] = [];
  let s = line;
  out.push(s.slice(0, 73));
  s = s.slice(73);
  while (s.length) { out.push(" " + s.slice(0, 72)); s = s.slice(72); }
  return out.join("\r\n");
}

/** Bouwt de VCALENDAR-tekst voor één editor. */
export async function buildEditorIcal(user: { id: string; fullName: string }): Promise<string> {
  const rows = await editorFeedRows(user.id);
  const base = (env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
  const now = stamp(new Date());

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Shortclips//Editor-agenda//NL",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:Shortclips — ${esc(user.fullName.split(" ")[0] || "editor")} (deadlines)`,
    "X-WR-TIMEZONE:Europe/Amsterdam",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];

  for (const r of rows) {
    if (!r.dueOn) continue;
    const link = `${base}/videos/${r.id}`;
    const descParts = [`Klant: ${r.clientName}`];
    if (r.opnameOn) descParts.push(`Opnamedatum: ${r.opnameOn}`);
    descParts.push(`Project: ${link}`);
    // Hele-dag "deadline"-markering: blokkeert de werkdag niet.
    lines.push(
      "BEGIN:VEVENT",
      `UID:deliverable-${r.id}@shortclips.nl`,
      `DTSTAMP:${now}`,
      `LAST-MODIFIED:${stamp(r.updatedAt)}`,
      `DTSTART;VALUE=DATE:${ymd(r.dueOn)}`,
      `DTEND;VALUE=DATE:${addDay(r.dueOn)}`,
      fold(`SUMMARY:⏰ Deadline: ${esc(r.clientName)} — ${esc(r.title)}`),
      fold(`DESCRIPTION:${esc(descParts.join("\n"))}`),
      fold(`URL:${link}`),
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

/** Zoekt de actieve editor bij een feed-token. */
export async function resolveUserByIcalToken(token: string): Promise<{ id: string; fullName: string } | null> {
  if (!token || token.length < 16) return null;
  const [u] = await db
    .select({ id: users.id, fullName: users.fullName })
    .from(users)
    .where(and(eq(users.icalToken, token), isNull(users.deletedAt), eq(users.status, "active")))
    .limit(1);
  return u ?? null;
}
