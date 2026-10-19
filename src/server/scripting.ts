import "server-only";
import { and, asc, eq, gte, inArray, isNull, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, productionDays, users } from "@/db/schema";
import { requireInternal, scopeToClients, type Viewer } from "@/server/auth/context";

/** Aantal scriptingdagen vóór de opname dat de scripts klaar moeten zijn. */
export const SCRIPT_LEAD_DAYS = 7;

function parseUTC(d: string): number {
  return new Date(d.slice(0, 10) + "T00:00:00Z").getTime();
}
function addCalendarDays(dateStr: string, n: number): string {
  const d = new Date(parseUTC(dateStr) + n * 86_400_000);
  return d.toISOString().slice(0, 10);
}
/** Gesigneerd verschil in kalenderdagen (a − b). */
function daysDiff(a: string, b: string): number {
  return Math.round((parseUTC(a) - parseUTC(b)) / 86_400_000);
}

export type ScriptingRow = {
  id: string;
  clientName: string;
  clientSlug: string;
  clientColor: string | null;
  clientLogo: string | null;
  scheduledOn: string;
  deadline: string;
  daysToShoot: number;
  daysToDeadline: number;
  status: string;
  done: boolean;
  /** Kleurindicatie: green / amber / red / done. */
  flag: "green" | "amber" | "red" | "done";
  /** Verantwoordelijke scriptschrijver (optioneel). */
  scriptWriterId: string | null;
  scriptWriterName: string | null;
};

export type WriterOption = { id: string; fullName: string };

/**
 * Scripting-overzicht: één regel per aankomende klantopname, rechtstreeks uit de
 * opnameplanning (production_days). Scriptingdeadline = opnamedatum − 7
 * kalenderdagen. De scriptingstatus staat op de opnamedag zelf, dus een
 * gewijzigde datum reset de status nooit; vervallen/verwijderde opnames vallen
 * vanzelf weg; nieuwe opnames verschijnen automatisch. Geen dubbele regels.
 */
export async function listScripting(viewer: Viewer) {
  await requireInternal();
  const today = new Date().toISOString().slice(0, 10);

  const rows = await db
    .select({
      id: productionDays.id,
      scheduledOn: productionDays.scheduledOn,
      status: productionDays.scriptingStatus,
      clientName: clients.name,
      clientSlug: clients.slug,
      clientColor: clients.color,
      clientLogo: clients.logoUrl,
      scriptWriterId: productionDays.scriptWriterId,
      scriptWriterName: users.fullName,
    })
    .from(productionDays)
    .innerJoin(clients, eq(clients.id, productionDays.clientId))
    .leftJoin(users, eq(users.id, productionDays.scriptWriterId))
    .where(
      and(
        isNull(productionDays.deletedAt),
        ne(productionDays.status, "cancelled"),
        gte(productionDays.scheduledOn, today),
        scopeToClients(viewer, productionDays.clientId),
      ),
    )
    .orderBy(asc(productionDays.scheduledOn));

  const list: ScriptingRow[] = rows.map((r) => {
    const deadline = addCalendarDays(r.scheduledOn, -SCRIPT_LEAD_DAYS);
    const daysToDeadline = daysDiff(deadline, today);
    const done = r.status === "final";
    const flag: ScriptingRow["flag"] = done
      ? "done"
      : daysToDeadline < 0
        ? "red"
        : daysToDeadline <= SCRIPT_LEAD_DAYS
          ? "amber"
          : "green";
    return {
      id: r.id,
      clientName: r.clientName,
      clientSlug: r.clientSlug,
      clientColor: r.clientColor,
      clientLogo: r.clientLogo,
      scheduledOn: r.scheduledOn,
      deadline,
      daysToShoot: daysDiff(r.scheduledOn, today),
      daysToDeadline,
      status: r.status,
      done,
      flag,
      scriptWriterId: r.scriptWriterId,
      scriptWriterName: r.scriptWriterName,
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

  // Verantwoordelijken die scripts schrijven: eigenaar + projectcoördinatoren
  // (Milou, Jiska, Jarno). Zo kun je per opname kiezen wie het script oppakt.
  const writerOptions: WriterOption[] = (
    await db
      .select({ id: users.id, fullName: users.fullName })
      .from(users)
      .where(
        and(
          isNull(users.deletedAt),
          eq(users.status, "active"),
          inArray(users.primaryRole, ["owner", "project_coordinator"]),
        ),
      )
      .orderBy(asc(users.fullName))
  ).map((u) => ({ id: u.id, fullName: u.fullName }));

  return { rows: list, stats, clientOptions, writerOptions };
}
