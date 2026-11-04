import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { deliverables, productionDays, users } from "@/db/schema";
import { firstNameKey } from "@/lib/editors";

/**
 * Integriteit van het editing-systeem: één editing-project per opname en één
 * centrale editortoewijzing die overal gelijk loopt (Editing-board, opname-
 * planning, klantprojecten en de persoonlijke editorportalen).
 *
 * Achtergrond: de editor stond op drie plekken (klant, opnamedag en editing-
 * project) en elke knop wijzigde maar een deel daarvan. Daarnaast konden er
 * meerdere editing-projecten aan één opnamedag hangen (Monday-import + agenda-
 * sync + koppel-job), waardoor editors dubbel werk zagen bij "Binnenkort
 * beschikbaar". Alles wat de editor of de koppeling wijzigt, loopt nu via dit
 * bestand.
 */

/** Statussen waarin nog niet aan een project gewerkt is: hier mag een
 *  editorwijziging automatisch doorgezet worden. */
export const UNSTARTED_STATUSES = ["recorded", "footage_upload", "awaiting_editor"] as const;
const UNSTARTED_SQL = sql.raw(`('${UNSTARTED_STATUSES.join("','")}')`);

/**
 * Voornaam → editor-account, deterministisch. Bestaan er twee accounts met
 * dezelfde (alias)voornaam (bijv. "Sem" via sam@ én sem@), dan wint het account
 * dat echt gebruikt wordt (laatst ingelogd), anders het oudste. Zo komt werk
 * nooit meer op een account terecht waar de editor niet mee inlogt.
 */
export async function editorIdsByKey(): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: users.id, fullName: users.fullName, lastLoginAt: users.lastLoginAt, createdAt: users.createdAt })
    .from(users)
    .where(and(eq(users.primaryRole, "editor"), eq(users.status, "active"), isNull(users.deletedAt)));
  rows.sort(
    (a, b) =>
      (b.lastLoginAt?.getTime() ?? 0) - (a.lastLoginAt?.getTime() ?? 0) ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  );
  const map = new Map<string, string>();
  for (const r of rows) {
    const k = firstNameKey(r.fullName);
    if (k && !map.has(k)) map.set(k, r.id);
  }
  return map;
}

/**
 * Editor van een klant gewijzigd → overal doorzetten waar nog niet gewerkt is:
 * alle niet-gestarte editing-projecten van de klant én de bijbehorende
 * opnamedagen (geplande opnames). Werk dat al loopt of klaar is blijft staan.
 */
export async function propagateClientEditor(clientId: string, editorId: string | null): Promise<{ projects: number; shoots: number }> {
  const dv = await db.execute(sql`
    update deliverables set editor_id = ${editorId}, updated_at = now()
    where client_id = ${clientId} and deleted_at is null
      and status in ${UNSTARTED_SQL}
      and editor_id is distinct from ${editorId}
    returning id
  `);
  const pd = await db.execute(sql`
    update production_days pd set editor_id = ${editorId}, updated_at = now()
    where pd.client_id = ${clientId} and pd.deleted_at is null
      and pd.status not in ('cancelled','completed')
      and pd.editor_id is distinct from ${editorId}
      and not exists (
        select 1 from deliverables d
        where d.production_day_id = pd.id and d.deleted_at is null and d.status not in ${UNSTARTED_SQL}
      )
    returning pd.id
  `);
  return { projects: rowCount(dv), shoots: rowCount(pd) };
}

/**
 * Editor van één opname/project gewijzigd → de opnamedag én alle editing-
 * projecten van die opname krijgen dezelfde editor, zodat de geplande opname,
 * "Binnenkort beschikbaar" en het editorportaal hetzelfde tonen.
 */
export async function propagateProjectEditor(productionDayId: string, editorId: string | null): Promise<void> {
  await db.update(productionDays).set({ editorId, updatedAt: new Date() }).where(eq(productionDays.id, productionDayId));
  await db
    .update(deliverables)
    .set({ editorId, updatedAt: new Date() })
    .where(and(eq(deliverables.productionDayId, productionDayId), isNull(deliverables.deletedAt)));
}

type DelRow = {
  id: string;
  status: string;
  current_version: number | null;
  frame_url: string | null;
  footage_url: string | null;
  script_url: string | null;
  script_id: string | null;
  drive_folder_id: string | null;
  briefing: string | null;
  planned_shorts: number | null;
  shoot_on: string | null;
  editor_id: string | null;
  refs: number;
  created_at: Date | string;
};

/** Velden die van een weg te halen duplicaat naar het behouden project gaan
 *  (alleen als het behouden project ze nog niet heeft). */
const CARRY_FIELDS = ["footage_url", "script_url", "script_id", "drive_folder_id", "briefing", "planned_shorts", "shoot_on", "editor_id"] as const;
const CARRY_TO_COLUMN: Record<(typeof CARRY_FIELDS)[number], string> = {
  footage_url: "footageUrl",
  script_url: "scriptUrl",
  script_id: "scriptId",
  drive_folder_id: "driveFolderId",
  briefing: "briefing",
  planned_shorts: "plannedShorts",
  shoot_on: "shootOn",
  editor_id: "editorId",
};

/** Is er al echt aan dit project gewerkt? Dan nooit automatisch weghalen. */
function hasRealWork(d: DelRow): boolean {
  return (
    !(UNSTARTED_STATUSES as readonly string[]).includes(d.status) ||
    Number(d.current_version ?? 0) > 0 ||
    !!d.frame_url ||
    Number(d.refs ?? 0) > 0
  );
}

function richness(d: DelRow): number {
  return CARRY_FIELDS.filter((f) => d[f] !== null && d[f] !== "").length;
}

/**
 * Eén editing-project per opnamedag. Hangen er meerdere projecten aan dezelfde
 * opname, dan blijft er één over: het project waar al aan gewerkt is, anders het
 * meest complete (oudste bij gelijkspel). Downloadlink, script, briefing, aantal
 * shorts en editor van de duplicaten worden eerst overgenomen, daarna gaat het
 * lege duplicaat op soft-delete (omkeerbaar). Projecten waar al echt werk in zit
 * (versies, reviews, kosten, status voorbij "wacht op editor") worden nooit
 * weggehaald. Tot slot krijgt de opnamedag dezelfde editor als zijn project.
 */
export async function mergeDuplicateDeliverables(): Promise<{ merged: number; keptWithWork: number; aligned: number }> {
  // Projecten die nog aan een geannuleerde opname hangen terwijl er voor dezelfde
  // klant op dezelfde datum precies één actieve opname is (de afspraak is in
  // Google verwijderd en opnieuw aangemaakt): verhuizen naar die actieve opname,
  // zodat ze daar hieronder worden samengevoegd.
  await db.execute(sql`
    update deliverables d set production_day_id = act.id, updated_at = now()
    from production_days old, production_days act
    where d.production_day_id = old.id and d.deleted_at is null
      and old.status = 'cancelled' and old.deleted_at is null
      and act.client_id = old.client_id and act.scheduled_on = old.scheduled_on
      and act.deleted_at is null and act.status <> 'cancelled'
      and (select count(*) from production_days x
           where x.client_id = old.client_id and x.scheduled_on = old.scheduled_on
             and x.deleted_at is null and x.status <> 'cancelled') = 1
  `);

  const groups = rowsOf<{ pd: string }>(
    await db.execute(sql`
      select production_day_id as pd from deliverables
      where deleted_at is null and production_day_id is not null
      group by production_day_id having count(*) > 1
    `),
  );

  let merged = 0;
  let keptWithWork = 0;
  for (const g of groups) {
    // Let op: elk project krijgt automatisch een lege QC-checklist; alleen
    // afgevinkte checks tellen als werk.
    const rows = rowsOf<DelRow>(
      await db.execute(sql`
        select d.id, d.status, d.current_version, d.frame_url, d.footage_url, d.script_url, d.script_id,
               d.drive_folder_id, d.briefing, d.planned_shorts, d.shoot_on, d.editor_id, d.created_at,
               ( (select count(*) from review_threads x where x.deliverable_id = d.id)
               + (select count(*) from video_versions x where x.deliverable_id = d.id)
               + (select count(*) from qc_checks x where x.deliverable_id = d.id and x.done = true)
               + (select count(*) from editor_costs x where x.deliverable_id = d.id)
               + (select count(*) from publications x where x.deliverable_id = d.id)
               + (select count(*) from editor_awards x where x.video_id = d.id)
               + (select count(*) from video_analyses x where x.deliverable_id = d.id)
               + (select count(*) from editor_assignments x where x.deliverable_id = d.id)
               )::int as refs
        from deliverables d
        where d.production_day_id = ${g.pd} and d.deleted_at is null
        order by d.created_at asc
      `),
    );
    if (rows.length < 2) continue;

    const withWork = rows.filter(hasRealWork);
    const canonical =
      withWork[0] ??
      [...rows].sort((a, b) => richness(b) - richness(a) || new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0]!;

    const patch: Record<string, unknown> = {};
    for (const d of rows) {
      if (d.id === canonical.id) continue;
      if (hasRealWork(d)) { keptWithWork++; continue; }
      for (const f of CARRY_FIELDS) {
        const have = patch[CARRY_TO_COLUMN[f]] ?? canonical[f];
        if ((have === null || have === "") && d[f] !== null && d[f] !== "") patch[CARRY_TO_COLUMN[f]] = d[f];
      }
      await db.update(deliverables).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(deliverables.id, d.id));
      merged++;
    }
    if (Object.keys(patch).length) {
      await db.update(deliverables).set({ ...patch, updatedAt: new Date() }).where(eq(deliverables.id, canonical.id));
    }
  }

  // Opnamedag volgt de editor van zijn (enige) editing-project, zodat de
  // geplande opname bovenaan en het project altijd dezelfde editor tonen.
  const aligned = rowCount(
    await db.execute(sql`
      update production_days pd set editor_id = d.editor_id, updated_at = now()
      from deliverables d
      where d.production_day_id = pd.id and d.deleted_at is null and d.editor_id is not null
        and pd.deleted_at is null and pd.editor_id is distinct from d.editor_id
        and (select count(*) from deliverables d2 where d2.production_day_id = pd.id and d2.deleted_at is null) = 1
      returning pd.id
    `),
  );

  return { merged, keptWithWork, aligned };
}

/** Losse editing-projecten van één opnamedag ophalen (voor sibling-updates). */
export async function deliverableIdsForShoot(productionDayId: string): Promise<string[]> {
  const rows = await db
    .select({ id: deliverables.id })
    .from(deliverables)
    .where(and(eq(deliverables.productionDayId, productionDayId), isNull(deliverables.deletedAt)));
  return rows.map((r) => r.id);
}

function rowsOf<T>(res: unknown): T[] {
  const r = res as { rows?: T[] } | T[];
  return Array.isArray(r) ? r : (r.rows ?? []);
}
function rowCount(res: unknown): number {
  const r = res as { rows?: unknown[]; rowCount?: number | null } | unknown[];
  if (Array.isArray(r)) return r.length;
  return r.rows?.length ?? r.rowCount ?? 0;
}
