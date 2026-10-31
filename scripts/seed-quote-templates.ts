/**
 * Zet de vaste Shortclips-offertesjablonen klaar in de Offertes-module, nagebouwd
 * naar de PandaDoc-sjablonen (navy cover in huisstijl). Idempotent: een sjabloon
 * met dezelfde naam wordt overgeslagen.
 *
 *   npm run quotes:seed-templates
 *
 * De prijzen van de "short content afdeling"-sjablonen zijn bekend (€2.350 /
 * €2.950 p/m); voor de "Short Creative"-sjablonen (6/8 video's) staat de prijs op
 * 0 — vul die aan op /offertes/sjablonen of per offerte.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { quoteTemplates, quoteTemplateVersions } from "@/db/schema";
import type { QuoteContent } from "@/lib/quotes";

const SUBTITLE =
  "Wij nemen de volledige verantwoordelijkheid voor jouw short content. Van strategie en scripts tot productie, publicatie en maandelijkse bijsturing.";

const WAT_WE_DOEN =
  "Elke maand verzorgen we professionele short-video's voor je kanalen: we bedenken de strategie, schrijven de scripts, filmen en monteren, en leveren kant-en-klare content op die je direct kunt plaatsen. We sturen maandelijks bij op basis van de resultaten.";

const TERMS =
  "Deze offerte is 30 dagen geldig. Prijzen zijn exclusief btw. De samenwerking loopt per maand, met een opzegtermijn van één kalendermaand. Levering en planning volgens de afgesproken contentkalender.";

function content(coverTitle: string, lineDescription: string, price: number): QuoteContent {
  return {
    intro: "Beste {{contactpersoon}},\n\nWat leuk dat {{bedrijf}} met Shortclips aan de slag wil. Hieronder ons voorstel voor de samenwerking.",
    blocks: [
      { type: "cover", eyebrow: "Offerte 2026", title: coverTitle, subtitle: SUBTITLE },
      { type: "heading", text: "Wat we voor je doen" },
      { type: "paragraph", text: WAT_WE_DOEN },
      { type: "lineItems", title: "Investering" },
      { type: "terms", title: "Voorwaarden", text: TERMS },
    ],
    defaultLines: [{ description: lineDescription, quantity: 1, unitPrice: price }],
  };
}

const TEMPLATES: { name: string; content: QuoteContent }[] = [
  { name: "Externe short content afdeling — € 2.350 p/m", content: content("De short content afdeling van jouw merk.", "Externe short content afdeling — maandelijkse samenwerking", 2350) },
  { name: "Externe short content afdeling — € 2.950 p/m", content: content("De short content afdeling van jouw merk.", "Externe short content afdeling — maandelijkse samenwerking", 2950) },
  { name: "Externe Short Creative afdeling — 6 video's", content: content("De Short Creative afdeling van jouw merk.", "Externe Short Creative afdeling — 6 video's per maand", 0) },
  { name: "Externe Short Creative afdeling — 8 video's", content: content("De Short Creative afdeling van jouw merk.", "Externe Short Creative afdeling — 8 video's per maand", 0) },
];

async function main() {
  let created = 0, skipped = 0;
  for (const t of TEMPLATES) {
    const [existing] = await db.select({ id: quoteTemplates.id }).from(quoteTemplates).where(eq(quoteTemplates.name, t.name)).limit(1);
    if (existing) { skipped++; continue; }
    const [tpl] = await db.insert(quoteTemplates).values({ name: t.name }).returning({ id: quoteTemplates.id });
    await db.insert(quoteTemplateVersions).values({ templateId: tpl!.id, version: 1, content: t.content });
    created++;
    console.log(`  ✓ ${t.name}`);
  }
  console.log(`\n✓ Sjablonen: ${created} aangemaakt, ${skipped} overgeslagen (bestonden al).`);
  process.exit(0);
}

main().catch((e) => { console.error("✗ Mislukt:", e instanceof Error ? e.message : e); process.exit(1); });
