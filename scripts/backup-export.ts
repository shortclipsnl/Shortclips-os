/**
 * Exporteert de volledige productie-database naar JSON (één bestand per tabel)
 * plus een manifest. Leest read-only via de Supabase PostgREST-API met
 * SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (geen DB-wachtwoord nodig).
 *
 * Gebruik:  tsx scripts/backup-export.ts <uitvoermap>
 *
 * Herstellen gaat met `npm run restore:data -- <uitvoermap>` nadat het schema
 * via `npm run db:migrate` is opgebouwd. Deze combinatie is end-to-end getest.
 */
import { writeFileSync, mkdirSync } from "node:fs";

const OUT = process.argv[2];
if (!OUT) { console.error("Geef een uitvoermap mee."); process.exit(1); }
const BASE = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!BASE || !KEY) { console.error("SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY zijn verplicht."); process.exit(1); }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function fetchPage(table: string, order: string, offset: number, size: number) {
  return fetch(`${BASE}/rest/v1/${table}?select=*${order}`, { headers: { ...H, Range: `${offset}-${offset + size - 1}`, "Range-Unit": "items" } });
}

async function exportTable(table: string, orderCol: string | null): Promise<any[]> {
  const order = orderCol ? `&order=${orderCol}` : "";
  const rows: any[] = [];
  let size = 1000;
  for (let offset = 0; ; ) {
    const res = await fetchPage(table, order, offset, size);
    if (res.ok) {
      const batch = await res.json() as any[];
      rows.push(...batch);
      if (batch.length < size) break;
      offset += size;
    } else if (res.status === 500 && size > 25) {
      // Statement-timeout op grote/zware rijen → kleinere pagina en opnieuw.
      size = 25;
      await res.text().catch(() => "");
    } else {
      throw new Error(`${table} @${offset} (size ${size}): HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
    }
  }
  return rows;
}

async function main() {
  mkdirSync(`${OUT}/database/data`, { recursive: true });
  const spec = await fetch(`${BASE}/rest/v1/`, { headers: { ...H, Accept: "application/openapi+json" } }).then((r) => r.json()) as any;
  const defs = spec.definitions ?? spec.components?.schemas ?? {};
  const tables = Object.keys(defs).sort();

  const manifest: any = { exportedAt: new Date().toISOString(), supabaseHost: new URL(BASE!).host, tables: {} };
  let grand = 0;
  for (const t of tables) {
    const cols = Object.keys(defs[t]?.properties ?? {});
    // Stabiele sortering voor correcte paginering.
    const orderCol = cols.includes("id") ? "id.asc"
      : (cols.includes("created_at") ? "created_at.asc"
      : (cols.length >= 2 ? `${cols[0]}.asc,${cols[1]}.asc` : (cols[0] ? `${cols[0]}.asc` : null)));
    const rows = await exportTable(t, orderCol);
    writeFileSync(`${OUT}/database/data/${t}.json`, JSON.stringify(rows, null, 1));
    manifest.tables[t] = rows.length;
    grand += rows.length;
  }
  manifest.totalRows = grand;
  manifest.tableCount = tables.length;
  writeFileSync(`${OUT}/database/manifest.json`, JSON.stringify(manifest, null, 2));
  console.log(`Database-export klaar: ${tables.length} tabellen, ${grand} rijen -> ${OUT}/database/data/`);
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
