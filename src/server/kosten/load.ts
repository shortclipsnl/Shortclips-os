import "server-only";
import { requirePermission } from "@/server/auth/context";
import { db } from "@/db/client";
import { kostenOmzet, kostenRegels } from "@/db/schema";
import { CANON_SUBS, type KostenData, type Regel } from "./shared";

/**
 * Laadt alle kostenregels + omzet uit de database en bouwt daar het compacte
 * `D`-object van op dat de pagina gebruikt (zelfde vorm als de oude
 * Kostenmonitor). Zo blijft de reken- en weergavelogica één op één.
 *
 * Uitsluitend voor de eigenaar: `finance:read` is feitelijk alleen aan de
 * eigenaarsrol toegekend.
 */
export async function getKostenData(): Promise<KostenData> {
  await requirePermission("finance:read");

  const [regels, omzetRows] = await Promise.all([
    db
      .select({
        maand: kostenRegels.maand,
        leverancier: kostenRegels.leverancier,
        subcategorie: kostenRegels.subcategorie,
        groep: kostenRegels.groep,
        soort: kostenRegels.soort,
        metBtw: kostenRegels.metBtw,
        zonderBtw: kostenRegels.zonderBtw,
        aantal: kostenRegels.aantal,
        bijgewerkt: kostenRegels.bijgewerkt,
      })
      .from(kostenRegels),
    db.select({ maand: kostenOmzet.maand, omzet: kostenOmzet.omzet }).from(kostenOmzet),
  ]);

  // Subcategorieën: de vaste canonieke lijst, plus eventuele onbekende die toch
  // in de data opduiken (achteraan toegevoegd, zodat de volgorde stabiel blijft).
  const subs: [string, string, string][] = CANON_SUBS.map((s) => [...s] as [string, string, string]);
  const subIndex = new Map<string, number>();
  subs.forEach((s, i) => subIndex.set(s[0], i));

  const levIndex = new Map<string, number>();
  const lev: string[] = [];
  const m: Record<string, Regel[]> = {};
  let bijgewerkt: string | null = null;

  for (const r of regels) {
    if (!subIndex.has(r.subcategorie)) {
      subIndex.set(r.subcategorie, subs.length);
      subs.push([r.subcategorie, r.groep, r.soort]);
    }
    let li = levIndex.get(r.leverancier);
    if (li === undefined) {
      li = lev.length;
      levIndex.set(r.leverancier, li);
      lev.push(r.leverancier);
    }
    const si = subIndex.get(r.subcategorie)!;
    (m[r.maand] ??= []).push([li, si, Math.round(Number(r.metBtw)), Math.round(Number(r.zonderBtw)), r.aantal]);
    if (r.bijgewerkt && (!bijgewerkt || r.bijgewerkt > bijgewerkt)) bijgewerkt = r.bijgewerkt;
  }

  const omzet: Record<string, number> = {};
  for (const o of omzetRows) omzet[o.maand] = Math.round(Number(o.omzet));

  return { bijgewerkt, lev, subs, m, omzet };
}
