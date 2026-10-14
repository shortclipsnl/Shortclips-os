import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { requireOwner } from "@/server/auth/context";

export type DuplicateGroup = {
  clientName: string | null;
  title: string;
  count: number;
  keepId: string;
  closeIds: string[];
};

/**
 * Open taken die er meerdere keren hetzelfde uitzien (zelfde klant + titel +
 * entiteit) — vrijwel altijd dubbel aangemaakt door een automatisering vóór de
 * dedupe-fix. We tonen ze eerst; sluiten gebeurt pas na akkoord.
 */
export async function findDuplicateTaskGroups(): Promise<DuplicateGroup[]> {
  await requireOwner();
  const res = await db.execute(sql`
    with open_tasks as (
      select t.id, t.title, t.client_id, t.entity_type, t.entity_id, t.created_at, c.name client_name
      from tasks t
      left join clients c on c.id = t.client_id
      where t.deleted_at is null and t.archived_at is null and t.status <> 'done'
    ),
    grp as (
      select title, client_id, entity_type, coalesce(entity_id::text,'') ent,
             count(*) n,
             (array_agg(id order by created_at asc))[1] keep_id,
             (array_agg(id order by created_at asc)) all_ids,
             min(client_name) client_name
      from open_tasks
      group by title, client_id, entity_type, coalesce(entity_id::text,'')
      having count(*) > 1
    )
    select title, client_name, n, keep_id, all_ids from grp order by n desc, client_name
  `);
  const rows = ((res as { rows?: unknown[] }).rows ?? (res as unknown as unknown[])) as Array<{
    title: string; client_name: string | null; n: number; keep_id: string; all_ids: string[];
  }>;
  return rows.map((r) => ({
    clientName: r.client_name,
    title: r.title,
    count: Number(r.n),
    keepId: r.keep_id,
    closeIds: (r.all_ids ?? []).filter((id) => id !== r.keep_id),
  }));
}
