/**
 * Zet de vaste Shortclips-offertesjablonen klaar, nagebouwd naar de aangeleverde
 * bestanden: Verlenging, Organische shorts en Advertentie creatives. Navy cover
 * in huisstijl, met de statistieken, prijs ("Niveau vast" € 3.450 p/m) en de
 * klant-placeholders ({{bedrijf}}, {{contactpersoon}}, {{datum}}) die bij een
 * nieuwe offerte automatisch ingevuld worden.
 *
 *   npm run quotes:seed-templates
 *
 * Idempotent (op naam). Ruimt de eerdere generieke sjablonen op.
 */
import { and, eq, isNull, like, or } from "drizzle-orm";
import { db } from "@/db/client";
import { quoteTemplates, quoteTemplateVersions } from "@/db/schema";
import type { QuoteContent, QuoteStat } from "@/lib/quotes";

const STATS: QuoteStat[] = [
  { value: "500M+", label: "gegenereerde views" },
  { value: "50+", label: "tevreden klanten" },
  { value: "9", label: "specialisten" },
];

const TERMS =
  "Deze offerte is 30 dagen geldig. Minimaal 3 maanden, daarna maandelijks opzegbaar. Prijzen zijn exclusief btw. Levering en planning volgens de afgesproken contentkalender.";

const PRICE = 3450;

function content(opts: { eyebrow: string; title: string; subtitle: string; heading: string; body: string; lineDescription: string; price?: number }): QuoteContent {
  return {
    intro: "Beste {{contactpersoon}},\n\nWat leuk dat {{bedrijf}} met Shortclips aan de slag gaat. Hieronder ons voorstel voor de samenwerking.",
    blocks: [
      { type: "cover", eyebrow: opts.eyebrow, title: opts.title, subtitle: opts.subtitle, stats: STATS },
      { type: "heading", text: opts.heading },
      { type: "paragraph", text: opts.body },
      { type: "lineItems", title: "Investering — Niveau vast" },
      { type: "terms", title: "Voorwaarden", text: TERMS },
    ],
    defaultLines: [{ description: opts.lineDescription, quantity: 1, unitPrice: opts.price ?? PRICE }],
  };
}

const TEMPLATES: { name: string; content: QuoteContent }[] = [
  {
    name: "Verlenging",
    content: content({
      eyebrow: "Verlengingsvoorstel",
      title: "Samen door naar het volgende jaar.",
      subtitle: "We verlengen onze samenwerking en bouwen voort op de resultaten tot nu toe — dezelfde volledige short content-afdeling, elke maand.",
      heading: "Wat we blijven doen",
      body: "We blijven elke maand jouw short content verzorgen: strategie, scripts, opname, montage en publicatie, met maandelijkse bijsturing op basis van de resultaten. Zo groeit jouw merk gewoon door.",
      lineDescription: "Verlenging samenwerking — Niveau vast (maandelijks)",
    }),
  },
  {
    name: "Organische shorts",
    content: content({
      eyebrow: "Offerte 2026",
      title: "Organische shorts die blijven hangen.",
      subtitle: "Wij nemen de volledige verantwoordelijkheid voor jouw organische short content. Van strategie en scripts tot productie, publicatie en maandelijkse bijsturing.",
      heading: "Wat we voor je doen",
      body: "Elke maand bedenken, filmen en monteren we professionele organische short-video's voor je kanalen, inclusief de contentkalender en het plaatsen. Kant-en-klare content die je volgers laat groeien.",
      lineDescription: "Organische shorts — Niveau vast (maandelijks)",
    }),
  },
  {
    name: "Advertentie creatives",
    content: content({
      eyebrow: "Offerte 2026",
      title: "Advertentie creatives die converteren.",
      subtitle: "Wij produceren de advertentievideo's die jouw campagnes laten presteren — van hook tot call-to-action, getest en geoptimaliseerd.",
      heading: "Wat we voor je doen",
      body: "We maken maandelijks performance-gerichte advertentie-creatives: meerdere hooks en varianten per concept, klaar voor Meta/TikTok, met focus op wat daadwerkelijk converteert. We sturen bij op basis van de advertentieresultaten.",
      lineDescription: "Advertentie creatives — Niveau vast (maandelijks)",
    }),
  },
];

async function main() {
  // Eerdere generieke sjablonen opruimen (zacht verwijderen).
  await db
    .update(quoteTemplates)
    .set({ deletedAt: new Date() })
    .where(and(isNull(quoteTemplates.deletedAt), or(like(quoteTemplates.name, "Externe short content afdeling%"), like(quoteTemplates.name, "Externe Short Creative afdeling%"))));

  let created = 0, skipped = 0;
  for (const t of TEMPLATES) {
    const [existing] = await db.select({ id: quoteTemplates.id }).from(quoteTemplates).where(and(eq(quoteTemplates.name, t.name), isNull(quoteTemplates.deletedAt))).limit(1);
    if (existing) { skipped++; continue; }
    const [tpl] = await db.insert(quoteTemplates).values({ name: t.name }).returning({ id: quoteTemplates.id });
    await db.insert(quoteTemplateVersions).values({ templateId: tpl!.id, version: 1, content: t.content });
    created++;
    console.log(`  ✓ ${t.name}`);
  }
  console.log(`\n✓ Sjablonen: ${created} aangemaakt, ${skipped} overgeslagen (bestonden al). Generieke sjablonen opgeruimd.`);
  process.exit(0);
}

main().catch((e) => { console.error("✗ Mislukt:", e instanceof Error ? e.message : e); process.exit(1); });
