import "server-only";
import { and, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clients } from "@/db/schema";
import { loadPostAnalysis } from "@/server/content-research/sources";
import { ensureStyleProfile, loadStoredStyle } from "@/server/content-research/style";

/**
 * Houdt het stijlprofiel per klant (uit de echte scripts in Google Drive) actueel.
 *
 * Dit deed voorheen de wekelijkse Content Research-ronde. Die pagina is weg
 * (nov 2026), maar het Contentgeheugen (contentstrategie, hookalternatieven)
 * leest dit profiel nog steeds. Het profiel wordt alleen opnieuw gemaakt als de
 * scripts veranderen of na 30 dagen (zie ensureStyleProfile), dus de meeste
 * aanroepen kosten niets. Per aanroep blijven we ruim binnen de 5 minuten.
 */
const BUDGET_MS = 240_000;
const REFRESH_DAYS = 30;

export async function runStyleProfileRefresh() {
  const started = Date.now();
  const active = await db
    .select({ id: clients.id, name: clients.name })
    .from(clients)
    .where(and(isNull(clients.deletedAt), inArray(clients.status, ["active", "onboarding"])))
    .limit(500);

  // Oudste of ontbrekende profielen eerst, zodat elke klant aan de beurt komt.
  const withAge = await Promise.all(
    active.map(async (c) => {
      const s = await loadStoredStyle(c.id).catch(() => null);
      return { ...c, updatedAt: s?.updatedAt?.getTime() ?? 0 };
    }),
  );
  withAge.sort((a, b) => a.updatedAt - b.updatedAt);

  let checked = 0;
  let refreshed = 0;
  const errors: string[] = [];
  for (const c of withAge) {
    if (Date.now() - started > BUDGET_MS) break;
    checked++;
    try {
      // Een vers profiel hoeft geen video-analyse te laden: ensureStyleProfile
      // controleert zelf de vingerafdruk van de scripts.
      const stale = !c.updatedAt || Date.now() - c.updatedAt > REFRESH_DAYS * 86_400_000;
      const posts = stale ? await loadPostAnalysis(c.id).catch(() => null) : null;
      const res = await ensureStyleProfile(c.id, c.name, { videoAnalysis: posts });
      if (res.changed) refreshed++;
      if (!res.ok && res.error) errors.push(`${c.name}: ${res.error}`);
    } catch (e) {
      errors.push(`${c.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { clients: active.length, checked, refreshed, errors: errors.slice(0, 5) };
}
