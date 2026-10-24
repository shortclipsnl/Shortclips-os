import "server-only";
import { and, asc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import { clients, productionDays, scripts, users } from "@/db/schema";
import { requireInternal, scopeToClients, type Viewer } from "@/server/auth/context";
import { CORE_STAFF_EMAILS, coreStaffRank } from "@/server/core-staff";
import { listClientDriveScriptLinks, type DriveScriptLink } from "@/server/scripts/drive-scripts";
import { subWorkingDays } from "@/lib/workdays";
import { nlHolidaySet } from "@/lib/holidays";

/** Aantal scriptingdagen vóór de opname dat de scripts klaar moeten zijn. */
export const SCRIPT_LEAD_DAYS = 7;

/** Vanaf "Klaar Shortclips" is de scriptdeadline gehaald → telt als afgerond
 *  (niet meer "te laat"). Alles daarna (scriptmeeting, final) ook. */
const SCRIPT_DONE_STATUSES = ["final"];

function parseUTC(d: string): number {
  return new Date(d.slice(0, 10) + "T00:00:00Z").getTime();
}
/** Gesigneerd verschil in kalenderdagen (a − b). */
function daysDiff(a: string, b: string): number {
  return Math.round((parseUTC(a) - parseUTC(b)) / 86_400_000);
}

export type ScriptingRow = {
  id: string;
  clientId: string;
  clientName: string;
  clientSlug: string;
  clientColor: string | null;
  clientLogo: string | null;
  scheduledOn: string;
  deadline: string;
  daysToShoot: number;
  daysToDeadline: number;
  status: string;
  /** Vrije notitie bij de status (wat er nog moet gebeuren). */
  note: string | null;
  done: boolean;
  /** Kleurindicatie: green / amber / red / done. */
  flag: "green" | "amber" | "red" | "done";
  /** Verantwoordelijke scriptschrijver (optioneel). */
  scriptWriterId: string | null;
  scriptWriterName: string | null;
  scriptWriterAvatar: string | null;
  /** Aan deze opname gekoppelde scripts (uit de scriptbibliotheek). */
  scripts: LinkedScript[];
  /** Scriptbestanden van deze klant in Google Drive (automatisch gelinkt). */
  driveScripts: DriveScriptLink[];
};

/** Eén aan de opname gekoppeld script, met status en volledige inhoud (voor
 *  "Bekijk scripts", zodat het team niet naar Drive of de generator hoeft). */
export type LinkedScript = {
  id: string;
  title: string;
  status: string;
  format: string | null;
  uitleg: string | null;
  hook: string | null;
  body: string | null;
  cta: string | null;
  version: number;
  updatedAt: string;
};

export type WriterOption = { id: string; fullName: string; avatarUrl: string | null };

/**
 * Scripting-overzicht: één regel per aankomende klantopname, rechtstreeks uit de
 * opnameplanning (production_days). Scriptingdeadline = opnamedatum − 7
 * kalenderdagen. De scriptingstatus staat op de opnamedag zelf, dus een
 * gewijzigde datum reset de status nooit; vervallen/verwijderde opnames vallen
 * vanzelf weg; nieuwe opnames verschijnen automatisch. Geen dubbele regels.
 */
export type ClientResponsible = {
  clientName: string;
  clientSlug: string;
  clientColor: string | null;
  clientLogo: string | null;
  responsibleName: string | null;
  responsibleAvatar: string | null;
};

export async function listScripting(viewer: Viewer) {
  await requireInternal();
  const today = new Date().toISOString().slice(0, 10);

  // Tweede users-join voor de vaste verantwoordelijke per klant (de
  // coördinator). Die gebruiken we als standaard-scriptschrijver wanneer er nog
  // niemand expliciet is gekoppeld, zodat dat niet handmatig hoeft.
  const coord = alias(users, "coord_user");

  const rows = await db
    .select({
      id: productionDays.id,
      scheduledOn: productionDays.scheduledOn,
      status: productionDays.scriptingStatus,
      note: productionDays.scriptingNote,
      clientId: clients.id,
      clientName: clients.name,
      clientSlug: clients.slug,
      clientColor: clients.color,
      clientLogo: clients.logoUrl,
      scriptWriterId: productionDays.scriptWriterId,
      scriptWriterName: users.fullName,
      scriptWriterAvatar: users.avatarUrl,
      coordinatorId: clients.coordinatorId,
      coordinatorName: coord.fullName,
      coordinatorAvatar: coord.avatarUrl,
    })
    .from(productionDays)
    .innerJoin(clients, eq(clients.id, productionDays.clientId))
    .leftJoin(users, eq(users.id, productionDays.scriptWriterId))
    .leftJoin(coord, eq(coord.id, clients.coordinatorId))
    .where(
      and(
        isNull(productionDays.deletedAt),
        ne(productionDays.status, "cancelled"),
        gte(productionDays.scheduledOn, today),
        scopeToClients(viewer, productionDays.clientId),
      ),
    )
    .orderBy(asc(productionDays.scheduledOn));

  // Aan deze opnames gekoppelde scripts uit de bibliotheek (via productionDayId),
  // zodat elke opname toont welke scripts eraan hangen en in welke status.
  const dayIds = rows.map((r) => r.id);
  const scriptRows = dayIds.length
    ? await db
        .select({ id: scripts.id, productionDayId: scripts.productionDayId, title: scripts.title, status: scripts.status, format: scripts.format, uitleg: scripts.internalNotes, hook: scripts.hook, body: scripts.body, cta: scripts.cta, version: scripts.currentVersion, updatedAt: scripts.updatedAt })
        .from(scripts)
        .where(and(inArray(scripts.productionDayId, dayIds), isNull(scripts.deletedAt)))
        .orderBy(asc(scripts.createdAt))
    : [];
  const scriptsByDay = new Map<string, LinkedScript[]>();
  for (const s of scriptRows) {
    if (!s.productionDayId) continue;
    const arr = scriptsByDay.get(s.productionDayId) ?? [];
    // De shortclip-uitleg staat in internalNotes met een vast voorvoegsel.
    const uitleg = s.uitleg ? s.uitleg.replace(/^Shortclip uitleg:\s*/i, "").trim() || null : null;
    arr.push({ id: s.id, title: s.title, status: s.status, format: s.format, uitleg, hook: s.hook, body: s.body, cta: s.cta, version: s.version, updatedAt: (s.updatedAt instanceof Date ? s.updatedAt : new Date(s.updatedAt as unknown as string)).toISOString() });
    scriptsByDay.set(s.productionDayId, arr);
  }

  // Scriptbestanden uit Google Drive per klant (categorie "Scripts") — in één
  // batch voor alle opnames, zodat het team de bestaande scripts meteen vanuit
  // het platform kan openen zonder naar Drive te hoeven.
  const driveByClient = await listClientDriveScriptLinks([...new Set(rows.map((r) => r.clientId))]);

  const holidays = nlHolidaySet();
  const list: ScriptingRow[] = rows.map((r) => {
    // Scriptdeadline = 7 wérkdagen vóór de opname (niet kalenderdagen), conform
    // de afspraak. Bijv. opname 21 okt → deadline 12 okt (niet 14 okt).
    const deadline = subWorkingDays(r.scheduledOn, SCRIPT_LEAD_DAYS, holidays);
    const daysToDeadline = daysDiff(deadline, today);
    const done = SCRIPT_DONE_STATUSES.includes(r.status);
    const flag: ScriptingRow["flag"] = done
      ? "done"
      : daysToDeadline < 0
        ? "red"
        : daysToDeadline <= SCRIPT_LEAD_DAYS
          ? "amber"
          : "green";
    return {
      id: r.id,
      clientId: r.clientId,
      clientName: r.clientName,
      clientSlug: r.clientSlug,
      clientColor: r.clientColor,
      clientLogo: r.clientLogo,
      scheduledOn: r.scheduledOn,
      deadline,
      daysToShoot: daysDiff(r.scheduledOn, today),
      daysToDeadline,
      status: r.status,
      note: r.note,
      done,
      flag,
      // Standaard de vaste verantwoordelijke (coördinator) tonen zolang er nog
      // niemand expliciet is gekoppeld — scheelt handmatig invullen.
      scriptWriterId: r.scriptWriterId ?? r.coordinatorId,
      scriptWriterName: r.scriptWriterName ?? r.coordinatorName,
      scriptWriterAvatar: r.scriptWriterAvatar ?? r.coordinatorAvatar,
      scripts: scriptsByDay.get(r.id) ?? [],
      driveScripts: driveByClient.get(r.clientId) ?? [],
    };
  });

  // Sorteren: afgerond onderaan, daarna op eerstvolgende scriptingdeadline.
  list.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return a.daysToDeadline - b.daysToDeadline;
  });

  const open = list.filter((r) => !r.done);
  const stats = {
    upcoming: list.length,
    notDone: open.length,
    deadlineSoon: open.filter((r) => r.daysToDeadline >= 0 && r.daysToDeadline <= SCRIPT_LEAD_DAYS).length,
    late: open.filter((r) => r.daysToDeadline < 0).length,
  };

  const clientOptions = [...new Set(list.map((r) => r.clientName))].sort();

  // Verantwoordelijken die scripts schrijven: het vaste kernteam (Jarno, Milou,
  // Jiska), ongeacht hun exacte rol — behalve de videograaf (Rutger). Zo staat
  // Jiska er altijd bij, ook als haar rol afwijkt.
  const writerOptions: WriterOption[] = (
    await db
      .select({ id: users.id, fullName: users.fullName, email: users.email, avatarUrl: users.avatarUrl })
      .from(users)
      .where(
        and(
          isNull(users.deletedAt),
          eq(users.status, "active"),
          sql`lower(${users.email}) in (${sql.join(CORE_STAFF_EMAILS.map((e) => sql`${e}`), sql`, `)})`,
          ne(users.primaryRole, "videographer"),
        ),
      )
  )
    .sort((a, b) => coreStaffRank(a.email) - coreStaffRank(b.email))
    .map((u) => ({ id: u.id, fullName: u.fullName, avatarUrl: u.avatarUrl }));

  // Vaste verantwoordelijke (coördinator) per actieve klant — voor het
  // overzicht onderaan de scriptingpagina. Zo is in één oogopslag duidelijk
  // wie standaard verantwoordelijk is voor de scripts van welke klant.
  const clientResponsibles: ClientResponsible[] = (
    await db
      .select({
        clientName: clients.name,
        clientSlug: clients.slug,
        clientColor: clients.color,
        clientLogo: clients.logoUrl,
        responsibleName: coord.fullName,
        responsibleAvatar: coord.avatarUrl,
      })
      .from(clients)
      .leftJoin(coord, eq(coord.id, clients.coordinatorId))
      .where(and(isNull(clients.deletedAt), eq(clients.status, "active"), scopeToClients(viewer, clients.id)))
      .orderBy(asc(clients.name))
  ).map((c) => ({ ...c }));

  return { rows: list, stats, clientOptions, writerOptions, clientResponsibles };
}
