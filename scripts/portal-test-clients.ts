/**
 * Portaal-testaccounts voor de 5 pilotklanten klaarzetten — veilig en herhaalbaar.
 *
 * Wat dit WEL doet:
 *   - zoekt elke pilotklant op NAAM in de bestaande klanten (maakt NOOIT een
 *     nieuwe klant aan — geen duplicaten);
 *   - zet per gevonden klant één portaalgebruiker klaar, gekoppeld aan precies
 *     die klant (users.client_id dwingt de scheiding af), met status "active" en
 *     een vers tijdelijk wachtwoord, zodat we INTERN kunnen inloggen en testen;
 *   - is idempotent: opnieuw draaien zet het wachtwoord opnieuw, geen duplicaten.
 *
 * Wat dit NIET doet:
 *   - geen klant aanmaken of wijzigen;
 *   - geen e-mail versturen (de klant wordt niet uitgenodigd);
 *   - geen bestaand team- of andere-klant-account overschrijven (dat weigert het).
 *
 * Het tijdelijke wachtwoord wordt alleen hier in de console getoond (de database
 * bewaart uitsluitend de scrypt-hash). Geef het veilig door of gebruik het zelf
 * om in te loggen als die klant tijdens het testen.
 *
 * Gebruik:
 *   npm run portal:testclients          # bereidt de accounts voor
 *   npm run portal:testclients -- --dry # toont alleen wat het zou doen
 *
 * Draait op de actieve driver: PGlite lokaal, Postgres/Supabase in productie
 * (zet DATABASE_URL naar de productie-pooler om op productie te draaien).
 */
import { and, eq, isNull } from "drizzle-orm";
import { db, rawClient } from "../src/db/client";
import { clientContacts, clients, roles, userRoles, users } from "../src/db/schema";
import { hashPassword } from "../src/server/auth/password";
import { randomBytes } from "node:crypto";

/** De 5 pilotklanten (exact zoals aangeleverd). */
const TARGETS = [
  "Marco van Beek Premium Cars",
  "Auto Christian",
  "Luxewagen",
  "Koop Chalets & Stacaravans",
  "Benz Collector Museum",
];

/** Woorden die we bij het losjes matchen negeren (lidwoorden/voegwoorden). */
const STOPWORDS = new Set(["van", "de", "het", "en", "the", "&", "of"]);

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
function tokens(s: string): string[] {
  return norm(s).split(" ").filter((t) => t && !STOPWORDS.has(t));
}

function tempPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(14);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${out.slice(0, 5)}-${out.slice(5, 10)}-${out.slice(10, 14)}`;
}

function slugFor(name: string): string {
  return norm(name).replace(/ /g, "-").slice(0, 40) || "klant";
}

type Match = { kind: "exact" | "benaderend"; id: string; name: string; slug: string; status: string };

async function main() {
  const dry = process.argv.includes("--dry");
  console.log(`[portal:testclients] ${dry ? "DRY-RUN — alleen tonen" : "accounts voorbereiden"}\n`);

  const [clientRole] = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, "client")).limit(1);
  if (!clientRole) {
    console.error("[portal:testclients] ✗ Rol 'client' ontbreekt — draai eerst de seed/rbac-sync.");
    process.exit(1);
  }

  const allClients = await db
    .select({ id: clients.id, name: clients.name, slug: clients.slug, status: clients.status })
    .from(clients)
    .where(isNull(clients.deletedAt));

  let prepared = 0;
  let missing = 0;
  let ambiguous = 0;

  for (const target of TARGETS) {
    const tNorm = norm(target);
    const tTokens = tokens(target);

    const exact = allClients.filter((c) => norm(c.name) === tNorm);
    const approx = exact.length
      ? []
      : allClients.filter((c) => {
          const cTokens = new Set(tokens(c.name));
          return tTokens.length > 0 && tTokens.every((t) => cTokens.has(t));
        });

    let match: Match | null = null;
    if (exact.length === 1) {
      match = { kind: "exact", ...exact[0]! };
    } else if (exact.length > 1) {
      console.log(`⚠  "${target}" → MEERDERE exacte matches (${exact.map((c) => c.name).join(", ")}). Overgeslagen — kies handmatig.`);
      ambiguous++;
      continue;
    } else if (approx.length === 1) {
      match = { kind: "benaderend", ...approx[0]! };
    } else if (approx.length > 1) {
      console.log(`⚠  "${target}" → MEERDERE mogelijke matches (${approx.map((c) => c.name).join(", ")}). Overgeslagen — kies handmatig.`);
      ambiguous++;
      continue;
    } else {
      console.log(`✗  "${target}" → NIET gevonden in de klanten. (Geen klant aangemaakt.)`);
      missing++;
      continue;
    }

    const flag = match.kind === "benaderend" ? "  (benaderende match — controleer!)" : "";
    console.log(`✓  "${target}" → ${match.name}${flag}  [status: ${match.status}]`);

    if (dry) continue;

    // Contactpersoon-e-mail of een duidelijk testadres (er wordt niets gemaild).
    const contacts = await db
      .select({ fullName: clientContacts.fullName, email: clientContacts.email, isPrimary: clientContacts.isPrimary })
      .from(clientContacts)
      .where(and(eq(clientContacts.clientId, match.id), isNull(clientContacts.deletedAt)));
    const contact = contacts.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)).find((c) => c.email) ?? contacts[0] ?? null;
    const email = (contact?.email ?? `${match.slug}@portaal-test.shortclips.nl`).trim().toLowerCase();
    const fullName = contact?.fullName ?? match.name;

    // Harde guard: e-mail mag niet bij een teamaccount of een andere klant horen.
    const [existing] = await db
      .select({ id: users.id, primaryRole: users.primaryRole, clientId: users.clientId })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (existing && existing.primaryRole !== "client" && existing.clientId == null) {
      console.log(`   ↳ ⚠ e-mail ${email} hoort bij een teamaccount — overgeslagen.`);
      continue;
    }
    if (existing && existing.clientId && existing.clientId !== match.id) {
      console.log(`   ↳ ⚠ e-mail ${email} is al aan een andere klant gekoppeld — overgeslagen.`);
      continue;
    }

    const password = tempPassword();
    const passwordHash = await hashPassword(password);

    let userId: string;
    let action: "aangemaakt" | "bijgewerkt";
    if (existing) {
      await db
        .update(users)
        .set({ passwordHash, fullName, primaryRole: "client", clientId: match.id, status: "active", lockedUntil: null, failedLoginCount: 0, updatedAt: new Date() })
        .where(eq(users.id, existing.id));
      userId = existing.id;
      action = "bijgewerkt";
    } else {
      const [created] = await db
        .insert(users)
        .values({ email, fullName, passwordHash, primaryRole: "client", clientId: match.id, status: "active" })
        .returning({ id: users.id });
      userId = created!.id;
      action = "aangemaakt";
    }
    await db.insert(userRoles).values({ userId, roleId: clientRole.id }).onConflictDoNothing();

    console.log(`   ↳ account ${action}:  ${email}   wachtwoord: ${password}`);
    prepared++;
  }

  console.log(`\n[portal:testclients] klaar — ${prepared} voorbereid, ${missing} niet gevonden, ${ambiguous} dubbelzinnig (${TARGETS.length} pilotklanten).`);
  if (!dry && prepared > 0) {
    console.log("Let op: de wachtwoorden staan alleen hierboven. Er is GEEN e-mail verstuurd naar klanten.");
  }
}

main()
  .catch((error) => {
    console.error("[portal:testclients] ✗ mislukt:", error);
    process.exit(1);
  })
  .finally(async () => {
    const raw = rawClient();
    if ("end" in raw && typeof raw.end === "function") await raw.end();
    else if ("close" in raw && typeof raw.close === "function") await raw.close();
  });
