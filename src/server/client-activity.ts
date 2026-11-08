import "server-only";
import { and, inArray, isNull, sql, type SQL } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm";
import { db } from "@/db/client";
import { clients } from "@/db/schema";
import {
  ACTIVE_CLIENT_STATUSES,
  INACTIVE_CLIENT_STATUSES,
  type ClientStatusFilter,
} from "@/lib/client-status";

/**
 * Server-kant van de centrale klantstatus (zie `@/lib/client-status`).
 *
 * Alle achtergrondprocessen, meldingen en operationele overzichten gebruiken
 * deze hulpen, zodat "niet actief" overal hetzelfde betekent en niet per pagina
 * opnieuw wordt bedacht. Verwijderde klanten tellen ook als niet actief.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ACTIVE_SQL = sql.join(ACTIVE_CLIENT_STATUSES.map((s) => sql`${s}`), sql`, `);
const INACTIVE_SQL = sql.join(INACTIVE_CLIENT_STATUSES.map((s) => sql`${s}`), sql`, `);

/** WHERE voor de clients-tabel zelf: alleen actieve klanten (active/onboarding). */
export function activeClientsWhere(): SQL {
  return and(isNull(clients.deletedAt), inArray(clients.status, [...ACTIVE_CLIENT_STATUSES]))!;
}

/** WHERE voor de clients-tabel volgens het gekozen paginafilter. */
export function clientsStatusWhere(filter: ClientStatusFilter): SQL | undefined {
  if (filter === "alle") return undefined;
  if (filter === "actief") return activeClientsWhere();
  return sql`(${clients.deletedAt} is null and ${clients.status} in (${INACTIVE_SQL}))`;
}

/**
 * Rij-filter voor tabellen met een client_id (taken, video's, opnames, scripts,
 * rapporten …): de rij hoort NIET bij een niet actieve of verwijderde klant.
 * Rijen zonder klant (interne taken) en prospects blijven staan.
 */
export function notInactiveClient(clientIdColumn: AnyColumn | SQL): SQL {
  return sql`(${clientIdColumn} is null or not exists (
    select 1 from clients ci where ci.id = ${clientIdColumn}
      and (ci.deleted_at is not null or ci.status in (${INACTIVE_SQL}))
  ))`;
}

/** Rij-filter: de rij hoort bij een actieve klant (active/onboarding). */
export function belongsToActiveClient(clientIdColumn: AnyColumn | SQL): SQL {
  return sql`exists (
    select 1 from clients ca where ca.id = ${clientIdColumn}
      and ca.deleted_at is null and ca.status in (${ACTIVE_SQL})
  )`;
}

/** Ids van alle niet actieve (gepauzeerde, gestopte of verwijderde) klanten uit een set. */
export async function inactiveClientIds(ids: Iterable<string | null | undefined>): Promise<Set<string>> {
  const list = [...new Set([...ids].filter((x): x is string => !!x && UUID.test(x)))];
  if (list.length === 0) return new Set();
  const rows = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(
      inArray(clients.id, list),
      sql`(${clients.deletedAt} is not null or ${clients.status} in (${INACTIVE_SQL}))`,
    ));
  return new Set(rows.map((r) => r.id));
}

/** Is deze klant niet actief? Geen klant (intern werk) → false. */
export async function isClientInactive(clientId: string | null | undefined): Promise<boolean> {
  if (!clientId) return false;
  return (await inactiveClientIds([clientId])).has(clientId);
}

/**
 * Filtert automatisch aangemaakte rijen (taken, meldingen) voor niet actieve
 * klanten weg. Gebruik vóór elke automatische insert, zodat er voor een niet
 * actieve klant nooit nieuw werk ontstaat, ongeacht welke job het probeert.
 */
export async function withoutInactiveClients<T>(rows: T[], clientIdOf: (row: T) => string | null | undefined): Promise<T[]> {
  if (rows.length === 0) return rows;
  const inactive = await inactiveClientIds(rows.map(clientIdOf));
  if (inactive.size === 0) return rows;
  return rows.filter((r) => {
    const id = clientIdOf(r);
    return !id || !inactive.has(id);
  });
}

/**
 * Meldingtypes die een direct gevolg zijn van een handeling van een mens
 * (toewijzen, goedkeuren, vraag stellen, offerte). Die mogen ook bij een niet
 * actieve klant door, bijvoorbeeld bij het handmatig afronden van lopend werk
 * of een offerte om een oud-klant terug te winnen. Alle andere (automatische)
 * meldingen voor een niet actieve klant worden tegengehouden.
 */
export const MANUAL_NOTIFICATION_TYPES = new Set<string>([
  "task_assigned",
  "attention_assigned",
  "report_published",
  "scripting_controle",
  "retention_urgent",
  "script_review_ready",
  "script_review_feedback",
  "script_review_approved",
  "editor_question",
  "improvement_shared",
  "client_account_locked",
  "client_status_review",
  "quote.accepted",
  "quote.declined",
  "quote.signed",
  "quote.opened",
]);

/** Status-voorwaarde op de clients-tabel: actief (active/onboarding). */
export function clientIsActive(): SQL {
  return inArray(clients.status, [...ACTIVE_CLIENT_STATUSES]);
}

/** Rij-filter op een client_id-kolom volgens het paginafilter (actief / niet actief / alle). */
export function clientColumnStatusFilter(clientIdColumn: AnyColumn | SQL, filter: ClientStatusFilter): SQL | undefined {
  if (filter === "alle") return undefined;
  if (filter === "actief") return belongsToActiveClient(clientIdColumn);
  return sql`exists (
    select 1 from clients cn where cn.id = ${clientIdColumn}
      and cn.deleted_at is null and cn.status in (${INACTIVE_SQL})
  )`;
}
