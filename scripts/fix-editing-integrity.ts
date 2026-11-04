/**
 * Eenmalige opschoning editing-integriteit (nov 2026).
 *
 *  1. Dubbel editor-account "Sem" (sam@, nooit ingelogd) samenvoegen met het
 *     account waarmee Sem werkt (sem@). Werk, opnames, meldingen en capaciteit
 *     gaan naar sem@, daarna gaat sam@ op "suspended" (niet verwijderd).
 *  2. Dubbele editing-projecten per opname samenvoegen (zelfde logica als de
 *     doorlopende opschoning in src/server/editing/integrity.ts).
 *  3. Niet-gestarte projecten en geplande opnames gelijktrekken met de editor
 *     die per klant is ingesteld (de centrale toewijzing).
 *
 * Standaard een DRY-RUN (alleen rapport). Uitvoeren met --apply.
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/fix-editing-integrity.ts [--apply]
 */
import { sql } from "drizzle-orm";

const apply = process.argv.includes("--apply");

function rows<T>(res: unknown): T[] {
  const r = res as { rows?: T[] } | T[];
  return Array.isArray(r) ? r : (r.rows ?? []);
}

async function main() {
  const { db } = await import("@/db/client");
  const integ = await import("@/server/editing/integrity");
  const { firstNameKey } = await import("@/lib/editors");
  const UNSTARTED = sql.raw(`('recorded','footage_upload','awaiting_editor')`);

  const report = async (label: string) => {
    const dups = rows<{ client: string; scheduled_on: string; n: number; titles: string }>(await db.execute(sql`
      select c.name client, pd.scheduled_on::text, count(*)::int n, string_agg(d.title || ' [' || d.status || ', ' || coalesce(u.email,'geen editor') || ']', ' | ' order by d.created_at) titles
      from deliverables d join production_days pd on pd.id = d.production_day_id join clients c on c.id = d.client_id
      left join users u on u.id = d.editor_id
      where d.deleted_at is null group by 1,2 having count(*) > 1 order by 2`));
    const mism = rows<{ client: string; editor_name: string; what: string; current: string | null; n: number }>(await db.execute(sql`
      select c.name client, c.editor_name, 'project' what, coalesce(u.full_name || ' <' || u.email || '>', 'geen') current, count(*)::int n
      from deliverables d join clients c on c.id = d.client_id left join users u on u.id = d.editor_id
      where d.deleted_at is null and d.status in ${UNSTARTED} and c.editor_name is not null
        and coalesce(lower(split_part(u.full_name,' ',1)),'') not in (lower(c.editor_name), case when lower(c.editor_name)='sem' then 'sam' else lower(c.editor_name) end)
      group by 1,2,3,4
      union all
      select c.name, c.editor_name, 'opname', coalesce(u.full_name || ' <' || u.email || '>', 'geen'), count(*)::int
      from production_days pd join clients c on c.id = pd.client_id left join users u on u.id = pd.editor_id
      where pd.deleted_at is null and pd.status not in ('cancelled','completed') and c.editor_name is not null
        and not exists (select 1 from deliverables d where d.production_day_id = pd.id and d.deleted_at is null and d.status not in ${UNSTARTED})
        and coalesce(lower(split_part(u.full_name,' ',1)),'') <> lower(c.editor_name)
      group by 1,2,3,4 order by 1`));
    const sam = rows<{ t: string; n: number }>(await db.execute(sql`
      select 'deliverables' t, count(*)::int n from deliverables where editor_id = (select id from users where lower(email)='sam@shortclips.nl')
      union all select 'production_days', count(*)::int from production_days where editor_id = (select id from users where lower(email)='sam@shortclips.nl')`));
    console.log(`\n=== ${label} ===`);
    console.log(`Dubbele editing-projecten per opname: ${dups.length}`);
    for (const d of dups) console.log(`  ${d.scheduled_on} ${d.client} (${d.n}×): ${d.titles}`);
    console.log(`Afwijkend van de editor per klant (niet-gestart werk): ${mism.length} regels`);
    for (const m of mism) console.log(`  ${m.client}: klant=${m.editor_name}, ${m.what} staat op ${m.current} (${m.n}×)`);
    console.log(`Werk op sam@ (oud Sem-account): ${sam.map((x) => `${x.t}=${x.n}`).join(", ")}`);
  };

  await report("VOOR");
  if (!apply) {
    console.log("\nDry-run: niets gewijzigd. Draai met --apply om uit te voeren.");
    process.exit(0);
  }

  // 1. Sem-accounts samenvoegen.
  const [sam] = rows<{ id: string }>(await db.execute(sql`select id from users where lower(email) = 'sam@shortclips.nl'`));
  const [sem] = rows<{ id: string }>(await db.execute(sql`select id from users where lower(email) = 'sem@shortclips.nl'`));
  if (sam && sem) {
    await db.execute(sql`update deliverables set editor_id = ${sem.id}, updated_at = now() where editor_id = ${sam.id}`);
    await db.execute(sql`update production_days set editor_id = ${sem.id}, updated_at = now() where editor_id = ${sam.id}`);
    await db.execute(sql`update notifications set user_id = ${sem.id} where user_id = ${sam.id}`);
    await db.execute(sql`update capacity_people set user_id = ${sem.id}, updated_at = now() where user_id = ${sam.id} and not exists (select 1 from capacity_people x where x.user_id = ${sem.id})`);
    await db.execute(sql`update users set status = 'suspended', updated_at = now() where id = ${sam.id}`);
    console.log("\nSem-accounts samengevoegd: alles op sem@, sam@ op suspended.");
  }

  // 2. Dubbele projecten samenvoegen.
  const m1 = await integ.mergeDuplicateDeliverables();
  console.log(`Samengevoegd: ${m1.merged} dubbele projecten (${m1.keptWithWork} met werk bewust laten staan), ${m1.aligned} opname-editors gelijkgetrokken.`);

  // 3. Centrale editor per klant doorzetten op niet-gestart werk.
  const byKey = await integ.editorIdsByKey();
  const cls = rows<{ id: string; name: string; editor_name: string }>(await db.execute(sql`select id, name, editor_name from clients where deleted_at is null and editor_name is not null`));
  for (const c of cls) {
    const id = byKey.get(firstNameKey(c.editor_name));
    if (!id) { console.log(`  Overgeslagen: ${c.name} (geen account voor "${c.editor_name}")`); continue; }
    const r = await integ.propagateClientEditor(c.id, id);
    if (r.projects || r.shoots) console.log(`  ${c.name} → ${c.editor_name}: ${r.projects} projecten, ${r.shoots} opnames bijgewerkt`);
  }
  const m2 = await integ.mergeDuplicateDeliverables();
  if (m2.merged || m2.aligned) console.log(`Nacontrole: ${m2.merged} samengevoegd, ${m2.aligned} gelijkgetrokken.`);

  await report("NA");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
