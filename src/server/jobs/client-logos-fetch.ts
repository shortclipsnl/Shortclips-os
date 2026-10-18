import "server-only";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients } from "@/db/schema";
import { fetchLogoDataUrl, normalizeDomain } from "@/server/client-logos";

/**
 * Haalt voor klanten zonder logo een logo van internet (favicon, 128px) op.
 * Het domein komt uit het ingevulde website-veld, en anders uit een gok op
 * basis van de bedrijfsnaam (<naam>.nl / .com). Google geeft een leeg globe-
 * icoon terug als er niets is; dat filtert fetchLogoDataUrl eruit → dan blijft
 * de nette initialen-chip staan (geen willekeurig logo). Idempotent: klanten
 * die al een logo hebben worden overgeslagen.
 */

/** Mogelijke domeinen voor een klant, meest betrouwbaar eerst. */
function candidateDomains(website: string | null, name: string): string[] {
  const out: string[] = [];
  const w = normalizeDomain(website);
  if (w) out.push(w);
  const base = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // accenten weg
    .replace(/\b(nederland|holland|bv|b\.v\.)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
  if (base.length >= 3) {
    out.push(`${base}.nl`);
    out.push(`${base}.com`);
  }
  return [...new Set(out)];
}

export async function fetchMissingClientLogos(limit = 15): Promise<{
  ok: boolean;
  checked: number;
  set: number;
  setList: Array<{ name: string; domain: string }>;
  failed: string[];
  remaining: number;
}> {
  const rows = (
    await db
      .select({ id: clients.id, name: clients.name, website: clients.website, logoUrl: clients.logoUrl })
      .from(clients)
      .where(and(isNull(clients.deletedAt), or(isNull(clients.logoUrl), eq(clients.logoUrl, sql`''`))))
  ).filter((c) => !c.logoUrl && !/test/i.test(c.name));

  let set = 0;
  const setList: Array<{ name: string; domain: string }> = [];
  const failed: string[] = [];
  let checked = 0;

  for (const c of rows) {
    if (checked >= limit) break; // rest volgende aanroep
    checked++;

    let logo: string | null = null;
    let used = "";
    for (const domain of candidateDomains(c.website, c.name)) {
      logo = await fetchLogoDataUrl(domain);
      if (logo) {
        used = domain;
        break;
      }
    }

    if (logo) {
      await db.update(clients).set({ logoUrl: logo, updatedAt: new Date() }).where(eq(clients.id, c.id));
      set++;
      setList.push({ name: c.name, domain: used });
    } else {
      failed.push(c.name);
    }
  }

  return { ok: true, checked, set, setList, failed, remaining: Math.max(0, rows.length - checked) };
}
