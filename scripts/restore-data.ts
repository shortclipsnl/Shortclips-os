/**
 * Zet een data-backup (map met <tabel>.json, gemaakt door de backup-job) terug
 * in een database. Werkt tegen zowel PGlite (lokaal) als Postgres/Supabase.
 *
 * Gebruik (schema moet al bestaan via `npm run db:migrate`):
 *   # PGlite (lokaal/herstel-test):
 *   DATABASE_DRIVER=pglite PGLITE_DATA_DIR=.data/restore \
 *     tsx scripts/restore-data.ts <map-met-json>
 *   # Postgres (echte Supabase-herstel):
 *   DATABASE_DRIVER=postgres DATABASE_URL="postgres://...6543/postgres" \
 *     tsx scripts/restore-data.ts <map-met-json>
 *
 * Veilig: zet foreign-key-checks tijdelijk uit (session_replication_role),
 * laadt elke tabel en zet ze weer aan. Bestaande rijen worden overschreven via
 * de primaire sleutel (ON CONFLICT DO NOTHING overslaan kan met --skip-existing).
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

type Q = (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;

const dataDir = process.argv[2];
if (!dataDir) { console.error("Geef de map met <tabel>.json mee."); process.exit(1); }

const HEX = /^\\x[0-9a-fA-F]*$/;

async function openDb(): Promise<{ query: Q; close: () => Promise<void> }> {
  const driver = process.env.DATABASE_DRIVER ?? "pglite";
  if (driver === "postgres") {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL, max: 1, ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false } });
    return { query: (s, p) => pool.query(s, p as any[]), close: () => pool.end() };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const dir = process.env.PGLITE_DATA_DIR ?? ".data/pglite";
  const pg = new PGlite(dir);
  return { query: (s, p) => pg.query(s, p as any[]) as any, close: () => pg.close() };
}

async function main() {
  const db = await openDb();
  // Kolomtypes ophalen zodat we json/bytea/arrays correct terugzetten.
  const colsRes = await db.query(
    `select table_name, column_name, data_type, udt_name
       from information_schema.columns
      where table_schema = 'public' order by table_name, ordinal_position`,
  );
  const typeOf = new Map<string, string>(); // "table.col" -> udt/data_type
  const tableCols = new Map<string, string[]>();
  for (const r of colsRes.rows) {
    typeOf.set(`${r.table_name}.${r.column_name}`, `${r.data_type}|${r.udt_name}`);
    if (!tableCols.has(r.table_name)) tableCols.set(r.table_name, []);
    tableCols.get(r.table_name)!.push(r.column_name);
  }

  const files = readdirSync(dataDir).filter((f) => f.endsWith(".json")).sort();
  await db.query(`set session_replication_role = replica;`); // FK/triggers uit

  let totalRows = 0, totalTables = 0;
  for (const file of files) {
    const table = path.basename(file, ".json");
    const schemaCols = tableCols.get(table);
    if (!schemaCols) { console.log(`  overslaan (geen tabel in schema): ${table}`); continue; }
    const rows = JSON.parse(readFileSync(path.join(dataDir, file), "utf8")) as any[];
    if (rows.length === 0) { totalTables++; continue; }

    // Alleen kolommen die zowel in de data als in het schema bestaan.
    const cols = Object.keys(rows[0]).filter((c) => schemaCols.includes(c));
    const qCols = cols.map((c) => `"${c}"`).join(", ");

    const BATCH = 200;
    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH);
      const params: unknown[] = [];
      const tuples: string[] = [];
      for (const row of slice) {
        const ph: string[] = [];
        for (const c of cols) {
          let v = row[c];
          const t = typeOf.get(`${table}.${c}`) ?? "";
          if (v !== null && v !== undefined) {
            if (t.includes("bytea") && typeof v === "string" && HEX.test(v)) {
              v = Buffer.from(v.slice(2), "hex");
            } else if ((t.includes("json") || t.endsWith("|jsonb") || t.endsWith("|json")) && typeof v === "object") {
              v = JSON.stringify(v);
            }
          }
          params.push(v);
          ph.push(`$${params.length}`);
        }
        tuples.push(`(${ph.join(", ")})`);
      }
      await db.query(`insert into "${table}" (${qCols}) values ${tuples.join(", ")} on conflict do nothing`, params);
    }
    totalRows += rows.length; totalTables++;
    console.log(`  ${String(rows.length).padStart(6)}  ${table}`);
  }

  await db.query(`set session_replication_role = origin;`); // FK/triggers weer aan
  await db.close();
  console.log(`\nKlaar: ${totalTables} tabellen, ${totalRows} rijen teruggezet.`);
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
