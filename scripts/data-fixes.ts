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

  // Records die geen echte klant van ons zijn (meegekomen uit Monday/Metricool)
  // uit de resultatenpagina halen: show_in_results = false. Niet-destructief — ze
  // blijven elders bestaan en kunnen per klant weer aangezet worden. De WHERE
  // matcht ná toepassing niet meer, dus herhaald draaien verandert niets. Meer
  // namen kunnen hier veilig bij; het kantoorteam kan de rest zelf toggelen.
  const notClients = [
    "unive%", "univé%", "trif%", "%storiesje%", "%chatgpt%",
    "%oosteruterke%", "%oosterúterke%", "brita%", "%stitch society%", "%stitch soc%",
  ];
  const hide = await db.execute(sql`
    UPDATE clients
    SET show_in_results = false, updated_at = now()
    WHERE show_in_results = true
      AND name ILIKE ANY (ARRAY[${sql.join(notClients.map((p) => sql`${p}`), sql`, `)}])
  `);
  const h = (hide as unknown as { rowCount?: number }).rowCount ?? 0;
  console.log(`[data-fixes] Niet-klanten verborgen op resultaten: ${h} rij(en) bijgewerkt.`);
}

main()
  .catch((e) => { console.error("[data-fixes] mislukt:", e); process.exit(1); })
  .finally(async () => {
    const raw = rawClient();
    if ("end" in raw && typeof raw.end === "function") await raw.end();
    else if ("close" in raw && typeof raw.close === "function") await raw.close();
  });
