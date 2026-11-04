/**
 * Idempotente eenmalige datacorrecties die bij elke deploy veilig kunnen draaien
 * (draaien in vercel-build). Elke fix heeft een WHERE die ná toepassing niet meer
 * matcht, dus herhaald draaien verandert niets.
 */
import { sql } from "drizzle-orm";
import { db, rawClient } from "../src/db/client";

async function main() {
  // Naamcorrectie: "<...>collector Snake" → "<...>collector Museum". We
  // vergrendelen 'm (managed_fields += "name") zodat een geautomatiseerde update
  // de correctie niet terugzet. Match ongeacht Bans-/Benzcollector-spelling.
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

  // Records die geen echte klant van ons zijn (historisch meegekomen)
  // uit de resultatenpagina halen: show_in_results = false. Niet-destructief — ze
  // blijven elders bestaan en kunnen per klant weer aangezet worden. De WHERE
  // matcht ná toepassing niet meer, dus herhaald draaien verandert niets. Meer
  // namen kunnen hier veilig bij; het kantoorteam kan de rest zelf toggelen.
  const notClients = [
    "unive%", "univé%", "trif%", "%storiesje%", "%chatgpt%",
    "%oosteruterke%", "%oosterúterke%", "brita%", "%stitch society%", "%stitch soc%",
    // Echte klanten, maar niet (meer) actief voor resultaten — op verzoek uit de
    // "nog te koppelen"-lijst gehaald. Blijven elders gewoon bestaan en kunnen per
    // klant weer aangezet worden (klantpagina → tonen op resultaten).
    "%studsociety%", "%stud society%", "%kerstbomen thuisbezorgd%",
    "%shades by eric kuster%", "%campernet%",
  ];
  const hide = await db.execute(sql`
    UPDATE clients
    SET show_in_results = false, updated_at = now()
    WHERE show_in_results = true
      AND name ILIKE ANY (ARRAY[${sql.join(notClients.map((p) => sql`${p}`), sql`, `)}])
  `);
  const h = (hide as unknown as { rowCount?: number }).rowCount ?? 0;
  console.log(`[data-fixes] Niet-klanten verborgen op resultaten: ${h} rij(en) bijgewerkt.`);

  // Deadlinebewaking: de klant/script-feedbackregels matchen nu op een stabiele
  // marker i.p.v. een vaste "5 dagen", zodat de termijn instelbaar is. De seed
  // werkt onConflictDoNothing, dus bestaande regels bijwerken we hier (idempotent:
  // de WHERE matcht niet meer zodra de conditie al klopt).
  const r1 = await db.execute(sql`
    UPDATE automation_rules SET conditions = '{"awaitingClientStale": true}'::jsonb
    WHERE key IN ('client_silent_for_5_days','client_silent_5_days_reminds_client')
      AND conditions <> '{"awaitingClientStale": true}'::jsonb
  `);
  const r2 = await db.execute(sql`
    UPDATE automation_rules SET conditions = '{"awaitingClientScriptStale": true}'::jsonb
    WHERE key = 'script_silent_reminds_client'
      AND conditions <> '{"awaitingClientScriptStale": true}'::jsonb
  `);
  const a = ((r1 as unknown as { rowCount?: number }).rowCount ?? 0) + ((r2 as unknown as { rowCount?: number }).rowCount ?? 0);
  console.log(`[data-fixes] Feedback-automatiseringsregels op instelbare marker gezet: ${a} rij(en).`);

  // Milou wordt operationeel beheerder (tweede verantwoordelijke klantbeheer).
  // Idempotent: de rol-update matcht alleen zolang ze nog projectcoördinator is,
  // en de rol-koppeling wordt alleen bijgewerkt als die afwijkt. De rol zelf is
  // door rbac-sync al aangemaakt (draait eerder in de vercel-build).
  const milouRole = await db.execute(sql`
    UPDATE users SET primary_role = 'operational_manager', updated_at = now()
    WHERE email = 'milou@shortclips.nl' AND primary_role = 'project_coordinator'
  `);
  const mr = (milouRole as unknown as { rowCount?: number }).rowCount ?? 0;
  // Rol-koppeling (user_roles) gelijktrekken met de nieuwe primaryRole: oude
  // koppelingen weg, de operational_manager-rol erin (alleen als nodig).
  await db.execute(sql`
    DELETE FROM user_roles ur USING users u
    WHERE ur.user_id = u.id AND u.email = 'milou@shortclips.nl'
      AND ur.role_id <> (SELECT id FROM roles WHERE key = 'operational_manager')
  `);
  await db.execute(sql`
    INSERT INTO user_roles (user_id, role_id)
    SELECT u.id, r.id FROM users u, roles r
    WHERE u.email = 'milou@shortclips.nl' AND r.key = 'operational_manager'
    ON CONFLICT (user_id, role_id) DO NOTHING
  `);
  console.log(`[data-fixes] Milou als operationeel beheerder: ${mr} rol(len) gewijzigd.`);
}

main()
  .catch((e) => { console.error("[data-fixes] mislukt:", e); process.exit(1); })
  .finally(async () => {
    const raw = rawClient();
    if ("end" in raw && typeof raw.end === "function") await raw.end();
    else if ("close" in raw && typeof raw.close === "function") await raw.close();
  });
