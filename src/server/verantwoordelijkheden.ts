import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { appSettings } from "@/db/schema";
import { normaliseer, standaardConfig, type Categorie, type Config } from "@/lib/verantwoordelijkheden/data";
import type { WorkOverview } from "@/server/werkoverzicht";

/**
 * Mijn verantwoordelijkheden: de verdeling staat als één JSON-instelling in
 * app_settings (geen eigen tabel nodig). Zolang Jarno niets heeft opgeslagen,
 * geldt het voorstel uit src/lib/verantwoordelijkheden/data.ts als concept.
 */
export const SETTING_KEY = "team.verantwoordelijkheden";

export async function getVerantwoordelijkheden(): Promise<Config> {
  try {
    const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, SETTING_KEY)).limit(1);
    return row ? normaliseer(row.value) : standaardConfig();
  } catch {
    return standaardConfig();
  }
}

export async function saveVerantwoordelijkheden(config: Config, updatedById: string): Promise<Config> {
  const schoon = normaliseer(config);
  schoon.bijgewerktOp = new Date().toISOString();
  await db
    .insert(appSettings)
    .values({
      key: SETTING_KEY,
      value: schoon,
      category: "team",
      description: "Mijn verantwoordelijkheden: verdeling per medewerker (beheer door Jarno).",
      updatedById,
    })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: schoon, updatedById, updatedAt: new Date() } });
  return schoon;
}

export type Telling = { open: number; laat: number };

/**
 * Live koppeling met het bestaande werkoverzicht (zelfde bron als Vandaag):
 * per categorie hoeveel er openstaat en hoeveel te laat is. Geen nieuwe taken,
 * alleen tellen wat er al is.
 */
export function telPerCategorie(work: WorkOverview | null): Record<Categorie, Telling> {
  const leeg = (): Telling => ({ open: 0, laat: 0 });
  const uit: Record<Categorie, Telling> = {
    klantcontact: leeg(), scripting: leeg(), opname: leeg(), editing: leeg(), publicatie: leeg(), intern: leeg(), alle: leeg(),
  };
  if (!work) return uit;
  const gezien = new Set<string>();
  const items = [...work.columns.today, ...work.columns.next, ...work.columns.week, ...work.undated];
  for (const it of items) {
    if (gezien.has(it.key)) continue;
    gezien.add(it.key);
    const laat = it.state === "late" ? 1 : 0;
    uit[it.category].open += 1;
    uit[it.category].laat += laat;
    uit.alle.open += 1;
    uit.alle.laat += laat;
  }
  return uit;
}
