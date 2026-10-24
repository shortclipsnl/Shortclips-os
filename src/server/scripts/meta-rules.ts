import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { aiKnowledge } from "@/db/schema";
import { runResearch } from "@/server/ai/client";

/**
 * Actuele Meta-advertentieregels. In plaats van alleen vaste regels in de prompt
 * halen we periodiek/op verzoek een samenvatting van de huidige Meta Advertising
 * Policies op (via web-onderzoek) en cachen die in de centrale kennisbank. De
 * advertentie-generator leest die mee, náást de vaste basisregels (fallback).
 */

const CAT = "meta_advertentieregels";
const TITLE = "Meta advertentieregels (actueel)";

export async function getMetaRules(): Promise<{ body: string; updatedAt: Date } | null> {
  const [row] = await db
    .select({ body: aiKnowledge.body, updatedAt: aiKnowledge.updatedAt })
    .from(aiKnowledge)
    .where(and(eq(aiKnowledge.category, CAT), isNull(aiKnowledge.deletedAt)))
    .orderBy(desc(aiKnowledge.updatedAt))
    .limit(1);
  return row ? { body: row.body, updatedAt: row.updatedAt } : null;
}

export async function refreshMetaRules(): Promise<{ ok: true; updatedAt: Date } | { ok: false; message: string }> {
  const system = `Je vat de ACTUELE advertentieregels van Meta (Facebook/Instagram) samen voor scriptschrijvers, op basis van de officiële Meta-documentatie (Advertising Standards / Advertising Policies). Gebruik de web-tools om de huidige regels te controleren.

Geef een bondige, praktische lijst (bulletpoints) van de regels die relevant zijn voor GESPROKEN short-video advertentieteksten: wat niet mag of beperkt is (bijv. ongefundeerde garanties, misleidende of overdreven resultaten, gevoelige persoonlijke kenmerken als bekend veronderstellen, verboden/beperkte producten, verzonnen schaarste of urgentie, onbewezen medische/financiële/gezondheidsclaims, negatieve zelfperceptie/schaamte). Verzin geen regels; baseer je uitsluitend op de officiële bronnen. Maximaal ~18 bullets. Noem onderaan de bron-URL('s).`;
  const user = `Vat de actuele Meta-advertentieregels samen die relevant zijn voor het SCHRIJVEN van gesproken short-video advertentieteksten (dus niet de targeting- of technische opzet). Baseer je op de officiële Meta Advertising Standards/Policies.`;

  const res = await runResearch({ system, user, maxUses: 8, maxTokens: 4000 });
  if (!res.ok) return { ok: false, message: res.reason === "no_provider" ? "AI-sleutel ontbreekt." : (res.error ?? "Ophalen mislukt.") };
  const body = res.text.trim().slice(0, 8000);
  if (!body) return { ok: false, message: "Geen regels opgehaald." };

  // Vervang de bestaande cache (één actieve rij).
  await db.update(aiKnowledge).set({ deletedAt: new Date() }).where(and(eq(aiKnowledge.category, CAT), isNull(aiKnowledge.deletedAt)));
  const [row] = await db.insert(aiKnowledge).values({ category: CAT, title: TITLE, body }).returning({ updatedAt: aiKnowledge.updatedAt });
  return { ok: true, updatedAt: row!.updatedAt };
}
