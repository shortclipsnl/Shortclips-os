/**
 * Idempotente eenmalige datacorrecties die bij elke deploy veilig kunnen draaien
 * (draaien in vercel-build). Elke fix heeft een WHERE die ná toepassing niet meer
 * matcht, dus herhaald draaien verandert niets.
 */
import { sql } from "drizzle-orm";
import { db, rawClient } from "../src/db/client";

async function main() {
  // Naamcorrectie: "<...>collector Snake" → "<...>collector Museum". De naam komt
  // uit Monday; we vergrendelen 'm (managed_fields += "name") zodat de nachtelijke
  // sync de correctie niet terugzet. Match ongeacht Bans-/Benzcollector-spelling.
  const res = await db.execute(sql`
    UPDATE clients
    SET name = regexp_replace(name, 'snake', 'Museum', 'gi'),
        managed_fields = CASE
          WHEN managed_fields @> '["name"]'::jsonb THEN managed_fields
          ELSE COALESCE(managed_fields, '[]'::jsonb) || '["name"]'::jsonb
        END,
        updated_at = now()
    WHERE name ~* 'collector.*snake'
  `);
  const n = (res as unknown as { rowCount?: number }).rowCount ?? 0;
  console.log(`[data-fixes] Banscollector-naamcorrectie: ${n} rij(en) bijgewerkt.`);
}

main()
  .catch((e) => { console.error("[data-fixes] mislukt:", e); process.exit(1); })
  .finally(async () => {
    const raw = rawClient();
    if ("end" in raw && typeof raw.end === "function") await raw.end();
    else if ("close" in raw && typeof raw.close === "function") await raw.close();
  });
