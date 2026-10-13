import "server-only";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { capacityParams, capacityPeople, users } from "@/db/schema";
import { monday, type MondayItem } from "@/server/integrations/monday";
import { runJob } from "./runner";

/*
 * CAPACITEIT TEAM + CAPACITEIT INSTELLINGEN → eigen teamcapaciteit.
 * We nemen de handmatige configuratie per persoon over (de "auto"-kolommen
 * berekenen we zelf, native) en de globale aannames. Idempotent op naam/sleutel.
 */
const TEAM_BOARD = "5105713231";
const PARAMS_BOARD = "5105713236";

const T = {
  dienstverband: "dienstverband",
  rol: "rol",
  alias: "naam_in_monday",
  werkdagen: "werkdagen",
  contracturen: "contracturen",
  productief: "productief",
  eenheid: "eenheid",
  grensGroen: "grens_groen",
  grensOranje: "grens_oranje",
  grensMax: "grens_max",
  kosten: "kosten_maand",
  toelichting: "toelichting",
};
const P = { sleutel: "sleutel", waarde: "waarde", eenheid: "eenheid", zekerheid: "zekerheid" };

function col(item: MondayItem, id: string): string {
  return (item.column_values.find((c) => c.id === id)?.text ?? "").trim();
}
function numOrNull(s: string): string | null {
  const v = s.replace(",", ".").trim();
  return v && !Number.isNaN(Number(v)) ? v : null;
}
function mapUnit(label: string): "opnames_4w" | "shorts_4w" | "cc_uren_maand" | "niet_gemeten" {
  const s = label.toLowerCase();
  if (s.includes("opnames")) return "opnames_4w";
  if (s.includes("shorts")) return "shorts_4w";
  if (s.includes("cc-uren") || s.includes("cc uren")) return "cc_uren_maand";
  return "niet_gemeten";
}

/** Gebruiker zoeken op de naam of één van de aliassen (voornaam@shortclips.nl of volledige naam). */
async function matchUser(name: string, aliases: string): Promise<string | null> {
  const candidates = [name, ...aliases.split(",")].map((s) => s.trim()).filter(Boolean);
  for (const c of candidates) {
    const first = c.split(/\s+/)[0]!.toLowerCase();
    const [hit] = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          isNull(users.deletedAt),
          or(eq(users.email, `${first}@shortclips.nl`), sql`lower(${users.fullName}) like ${first + "%"}`),
        ),
      )
      .limit(1);
    if (hit) return hit.id;
  }
  return null;
}

export async function runMondayCapacityImport() {
  return runJob("monday", "monday.import_capacity", {}, async (ctx) => {
    // 1) Per-persoon capaciteitsconfiguratie.
    const people = await monday.listItems(TEAM_BOARD, 100);
    ctx.log(`${people.length} personen op CAPACITEIT TEAM`);
    for (const item of people) {
      const name = (item.name ?? "").trim();
      if (!name) continue;
      const aliases = col(item, T.alias);
      const base = {
        userId: await matchUser(name, aliases),
        name,
        aliases: aliases || null,
        employment: col(item, T.dienstverband).toLowerCase() || null,
        role: col(item, T.rol) || null,
        unit: mapUnit(col(item, T.eenheid)),
        workdaysPerWeek: numOrNull(col(item, T.werkdagen)),
        contractHoursPerWeek: numOrNull(col(item, T.contracturen)),
        productiveHoursPerMonth: numOrNull(col(item, T.productief)),
        limitGreen: numOrNull(col(item, T.grensGroen)),
        limitOrange: numOrNull(col(item, T.grensOranje)),
        limitMax: numOrNull(col(item, T.grensMax)),
        costPerMonth: numOrNull(col(item, T.kosten)),
        note: col(item, T.toelichting) || null,
        updatedAt: new Date(),
      };
      await db
        .insert(capacityPeople)
        .values(base)
        .onConflictDoUpdate({ target: capacityPeople.name, set: base });
      ctx.counters.processed++;
    }

    // 2) Globale aannames (sleutel = technische naam die het dashboard gebruikt).
    const params = await monday.listItems(PARAMS_BOARD, 100);
    ctx.log(`${params.length} aannames op CAPACITEIT INSTELLINGEN`);
    for (const item of params) {
      const key = col(item, P.sleutel);
      if (!key) continue;
      const base = {
        key,
        label: (item.name ?? "").trim() || null,
        value: numOrNull(col(item, P.waarde)),
        unit: col(item, P.eenheid) || null,
        confidence: col(item, P.zekerheid) || null,
        updatedAt: new Date(),
      };
      await db
        .insert(capacityParams)
        .values(base)
        .onConflictDoUpdate({ target: capacityParams.key, set: base });
      ctx.counters.updated++;
    }

    ctx.log(`Klaar: ${ctx.counters.processed} personen, ${ctx.counters.updated} aannames.`);
  });
}
