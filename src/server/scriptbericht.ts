import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { appSettings } from "@/db/schema";
import { env } from "@/lib/env";
import {
  EMPTY_SAVED,
  normaliseSaved,
  normaliseTemplates,
  type SavedScriptbericht,
  type Templates,
} from "@/lib/scriptbericht";

/**
 * Opslag voor het scriptbericht, volledig in app_settings (geen eigen tabel):
 *   - één centrale sleutel met de twee standaardtemplates (voor het hele team);
 *   - per opname een eigen sleutel met de persoonlijke versie en de link.
 * Een persoonlijke versie raakt het centrale template dus nooit.
 */
export const TEMPLATES_KEY = "scripting.scriptbericht.templates";
export const DAY_CATEGORY = "scriptbericht";
export const dayKey = (productionDayId: string) => `scriptbericht:${productionDayId}`;

export async function getScriptberichtTemplates(): Promise<{ templates: Templates; custom: boolean; updatedAt: string | null }> {
  try {
    const [row] = await db
      .select({ value: appSettings.value, updatedAt: appSettings.updatedAt })
      .from(appSettings)
      .where(eq(appSettings.key, TEMPLATES_KEY))
      .limit(1);
    if (!row) return { templates: normaliseTemplates(null), custom: false, updatedAt: null };
    return {
      templates: normaliseTemplates(row.value),
      custom: true,
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
    };
  } catch {
    return { templates: normaliseTemplates(null), custom: false, updatedAt: null };
  }
}

/** Opgeslagen scriptberichten per opname (alleen voor de gevraagde opnames). */
export async function getSavedScriptberichten(productionDayIds: string[]): Promise<Map<string, SavedScriptbericht>> {
  const out = new Map<string, SavedScriptbericht>();
  if (productionDayIds.length === 0) return out;
  try {
    const rows = await db
      .select({ key: appSettings.key, value: appSettings.value })
      .from(appSettings)
      .where(inArray(appSettings.key, productionDayIds.map(dayKey)));
    for (const r of rows) out.set(r.key.slice("scriptbericht:".length), normaliseSaved(r.value));
  } catch {
    // Opslag niet bereikbaar: functie werkt dan gewoon met de standaardtekst.
  }
  return out;
}

export async function getSavedScriptbericht(productionDayId: string): Promise<SavedScriptbericht> {
  return (await getSavedScriptberichten([productionDayId])).get(productionDayId) ?? EMPTY_SAVED;
}

/** Alle opgeslagen scriptberichten (voor de controle op links van andere klanten). */
export async function getAllSavedScriptberichten(): Promise<Map<string, SavedScriptbericht>> {
  const out = new Map<string, SavedScriptbericht>();
  const rows = await db
    .select({ key: appSettings.key, value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.category, DAY_CATEGORY));
  for (const r of rows) out.set(r.key.slice("scriptbericht:".length), normaliseSaved(r.value));
  return out;
}

/** Directe link naar de scriptcontrole van deze opname in het klantportaal. */
export function portalScriptLink(reviewId: string | null): string | null {
  if (!reviewId) return null;
  return `${env.APP_URL.replace(/\/$/, "")}/portal/scripts/${reviewId}`;
}
