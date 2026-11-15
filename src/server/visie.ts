import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { appSettings } from "@/db/schema";
import { normaliseer, standaardVisie, type Visie } from "@/lib/visie/data";
import { isOwner, type Viewer } from "@/server/auth/context";

/**
 * Onze visie staat als één JSON-instelling in app_settings (zelfde opzet als
 * Mijn verantwoordelijkheden, geen eigen tabel). Zolang Jarno niets heeft
 * opgeslagen, geldt het voorstel uit src/lib/visie/data.ts, met status
 * "voorstel".
 */
export const VISIE_SETTING_KEY = "team.visie";

export const getVisie = cache(async (): Promise<Visie> => {
  try {
    const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, VISIE_SETTING_KEY)).limit(1);
    return row ? normaliseer(row.value) : standaardVisie();
  } catch {
    return standaardVisie();
  }
});

/**
 * De visie zoals deze kijker haar mag zien. Een voorstel is alleen zichtbaar
 * voor de eigenaar; het team ziet de visie (en alles in het portaal dat eruit
 * leest) pas nadat Jarno haar heeft vastgesteld. Null = niets tonen.
 */
export async function getVisieVoor(viewer: Viewer | null): Promise<Visie | null> {
  if (!viewer || viewer.isPortalUser) return null;
  const v = await getVisie();
  if (v.status === "definitief" || isOwner(viewer)) return v;
  return null;
}

/** Zonder kijker (bv. automatisch gegenereerde briefings): alleen een vastgestelde visie. */
export async function getVastgesteldeVisie(): Promise<Visie | null> {
  const v = await getVisie();
  return v.status === "definitief" ? v : null;
}

export async function saveVisie(visie: Visie, updatedById: string): Promise<Visie> {
  const schoon = normaliseer(visie);
  schoon.bijgewerktOp = new Date().toISOString();
  await db
    .insert(appSettings)
    .values({
      key: VISIE_SETTING_KEY,
      value: schoon,
      category: "team",
      description: "Onze visie: missie, visie, positionering, kernprincipes en vertaling per functie (beheer door Jarno).",
      updatedById,
    })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: schoon, updatedById, updatedAt: new Date() } });
  return schoon;
}
