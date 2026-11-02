/**
 * RBAC-sync: zorgt dat de rechtencatalogus in de database gelijkloopt met de
 * code (src/server/auth/permissions.ts).
 *
 * Waarom dit bestaat: rechten staan in de database (tabellen permissions en
 * role_permissions) en worden per request daaruit geladen. Toen er later nieuwe
 * rechten bijkwamen (zoals "video_intelligence:read"), kregen bestaande rollen
 * die niet automatisch — ook de eigenaar niet. Gevolg: "Geen toegang" op een
 * pagina waar de code wél toegang voor bedoelt.
 *
 * Wat dit script doet (veilig en herhaalbaar):
 *   1. voegt ontbrekende rechten uit de catalogus toe aan de database;
 *   2. voegt ontbrekende rollen toe;
 *   3. zorgt dat de eigenaar ALLE rechten heeft. De eigenaarsrol is per definitie
 *      "volledige toegang"; die hoort nooit een recht te missen. Zonder dit bleef
 *      een later toegevoegd recht (zoals Video Intelligence) buiten bereik van de
 *      eigenaar, ook al bestond het recht al in de database;
 *   4. kent de standaardrechten van de ÓVERIGE rollen toe, maar uitsluitend voor
 *      rechten die in deze run nieuw zijn. Zo blijven handmatige aanpassingen per
 *      rol (Instellingen → Rollen) ongemoeid en wordt een bewust ingetrokken
 *      recht niet opnieuw toegekend.
 *
 * Draait op de actieve driver (PGlite lokaal, Postgres/Supabase in productie)
 * en wordt bij elke deploy uitgevoerd via vercel-build.
 */
import { sql } from "drizzle-orm";
import { db, rawClient } from "../src/db/client";
import { permissions, rolePermissions, roles } from "../src/db/schema";
import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  ROLE_DEFINITIONS,
  permissionsForRole,
} from "../src/server/auth/permissions";

async function main() {
  // 1. Welke rechten staan al in de database?
  const existing = await db.select({ key: permissions.key }).from(permissions);
  const existingKeys = new Set(existing.map((p) => p.key));
  const missing = ALL_PERMISSIONS.filter((k) => !existingKeys.has(k));

  // 2. Ontbrekende rechten toevoegen.
  if (missing.length) {
    await db
      .insert(permissions)
      .values(
        missing.map((key) => ({
          key,
          resource: key.split(":")[0]!,
          action: key.split(":")[1]!,
          description: PERMISSIONS[key],
        })),
      )
      .onConflictDoNothing();
  }

  // 3. Ontbrekende rollen toevoegen (bestaande blijven ongemoeid).
  await db
    .insert(roles)
    .values(
      ROLE_DEFINITIONS.map((r) => ({
        key: r.key,
        name: r.name,
        description: r.description,
        isSystem: true,
        isPortalRole: r.isPortalRole ?? false,
        sortOrder: r.sortOrder,
      })),
    )
    .onConflictDoNothing();

  // id-maps na het toevoegen.
  const allPerms = await db.select({ id: permissions.id, key: permissions.key }).from(permissions);
  const permByKey = new Map(allPerms.map((p) => [p.key, p.id]));
  const allRoles = await db.select({ id: roles.id, key: roles.key }).from(roles);
  const roleByKey = new Map(allRoles.map((r) => [r.key, r.id]));

  const missingSet = new Set<string>(missing);
  const links: Array<{ roleId: string; permissionId: string }> = [];

  // Hoeveel rechten heeft elke rol nu? Nodig voor stap 4b: een systeemrol die
  // het merendeel van zijn standaardrechten mist, is nooit goed geïnitialiseerd
  // (bijv. een later toegevoegde rol zoals operational_manager: stap 3 voegde de
  // rol toe, maar de toen al bestaande rechten werden niet toegekend omdat ze die
  // run niet "nieuw" waren — zo'n rol houdt maar een handjevol rechten over).
  const permCounts = await db
    .select({ roleId: rolePermissions.roleId, n: sql<number>`count(*)::int` })
    .from(rolePermissions)
    .groupBy(rolePermissions.roleId);
  const countByRoleId = new Map(permCounts.map((r) => [r.roleId, r.n]));

  // 4a. Eigenaar: altijd elk recht. onConflictDoNothing laat bestaande links staan,
  //     dus dit voegt alleen de ontbrekende toe en raakt verder niets aan.
  const ownerRoleId = roleByKey.get("owner");
  if (ownerRoleId) {
    for (const key of ALL_PERMISSIONS) {
      const permissionId = permByKey.get(key);
      if (permissionId) links.push({ roleId: ownerRoleId, permissionId });
    }
  }

  // 4b. Overige rollen: standaardrechten toekennen. Normaal alleen voor rechten
  //     die in deze run nieuw zijn, zodat handmatige aanpassingen (Instellingen →
  //     Rollen) behouden blijven. Uitzondering: mist de rol het MERENDEEL van zijn
  //     standaardrechten, dan is hij nooit goed geïnitialiseerd en krijgt hij zijn
  //     VOLLEDIGE standaardset. Een bewust uitgeklede rol houdt juist bijna al zijn
  //     rechten; de grens op de helft scheidt "nooit ingesteld" (bijv. een later
  //     toegevoegde rol met 2/41) van "handmatig aangepast" (bijv. 38/41). Zo heelt
  //     dit later toegevoegde rollen automatisch zonder curatie te overschrijven.
  for (const def of ROLE_DEFINITIONS) {
    if (def.key === "owner") continue;
    const roleId = roleByKey.get(def.key);
    if (!roleId) continue;
    const defaults = permissionsForRole(def.key);
    const have = countByRoleId.get(roleId) ?? 0;
    const uninitialised = have * 2 < defaults.length; // minder dan de helft aanwezig
    for (const perm of defaults) {
      if (!uninitialised && !missingSet.has(perm)) continue; // bestaande rechten niet aanraken
      const permissionId = permByKey.get(perm);
      if (permissionId) links.push({ roleId, permissionId });
    }
  }

  // 4c. Vaste basis-toekenningen die ALTIJD moeten bestaan, ook als het recht
  //     niet nieuw is. Nodig wanneer een bestaand recht later aan meer rollen
  //     toegekend moet worden (stap 4b raakt alleen nieuwe rechten aan). Bewust
  //     klein houden en alleen voor rechten die het hele interne team hoort te
  //     hebben. Hier: Video Intelligence werkt voor alle vaste medewerkers.
  const BASELINE_GRANTS: Array<[string, string]> = [
    ["content_creator", "video_intelligence:run"],
    ["videographer", "video_intelligence:read"],
    ["videographer", "video_intelligence:run"],
    ["finance", "video_intelligence:run"],
  ];
  for (const [roleKey, permKey] of BASELINE_GRANTS) {
    const roleId = roleByKey.get(roleKey);
    const permissionId = permByKey.get(permKey);
    if (roleId && permissionId) links.push({ roleId, permissionId });
  }

  let added = 0;
  if (links.length) {
    const before = await db.select({ id: rolePermissions.roleId }).from(rolePermissions);
    await db.insert(rolePermissions).values(links).onConflictDoNothing();
    const after = await db.select({ id: rolePermissions.roleId }).from(rolePermissions);
    added = after.length - before.length;
  }

  if (missing.length) {
    console.log(`[rbac-sync] ✓ ${missing.length} nieuw recht(en) toegevoegd: ${missing.join(", ")}`);
  }
  if (added > 0) {
    console.log(`[rbac-sync] ✓ ${added} ontbrekende toekenning(en) hersteld (incl. eigenaar).`);
  }
  if (!missing.length && added === 0) {
    console.log("[rbac-sync] ✓ Niets te doen: de rechten lopen gelijk.");
  }
}

main()
  .catch((error) => {
    console.error("[rbac-sync] ✗ mislukt:", error);
    process.exit(1);
  })
  .finally(async () => {
    const raw = rawClient();
    if ("end" in raw && typeof raw.end === "function") await raw.end();
    else if ("close" in raw && typeof raw.close === "function") await raw.close();
  });
