import "server-only";

/**
 * Advertentie-schrijfsysteem (Systeem B) voor de Script Generator.
 *
 * Volledig gescheiden van het organische handboek: advertentiescripts worden
 * geschreven vanuit direct response-marketing en een funneldoel, niet vanuit
 * bereik/retentie. Dit bestand bevat de vaste rol, stijlregels, funnelstructuur,
 * hookregels, scriptstructuur en Meta-regels. Bij twijfel wint dit handboek.
 */

export type Funnel = "TOF" | "MOF" | "BOF";
export const FUNNELS: Funnel[] = ["TOF", "MOF", "BOF"];
export const FUNNEL_LABEL: Record<Funnel, string> = {
  TOF: "Top of funnel",
  MOF: "Middle of funnel",
  BOF: "Bottom of funnel",
};

/** Richtlijn spreektijd/woorden per funnelfase (uit het advertentiehandboek). */
export const FUNNEL_GUIDE: Record<Funnel, { seconds: string; words: string; focus: string; cta: string }> = {
  TOF: { seconds: "25–30s", words: "70–85 woorden", focus: "Koude doelgroep die het merk mogelijk nog niet kent. Herkenning, nieuwsgierigheid, een probleem of situatie. Verkoop nog niet hard.", cta: "zachte call to action" },
  MOF: { seconds: "25–30s", words: "70–85 woorden", focus: "Mensen die het probleem herkennen en oplossingen vergelijken. Oplossing, productvoordelen, USP's, vertrouwen, veelvoorkomende bezwaren.", cta: "laagdrempelige call to action" },
  BOF: { seconds: "15–25s", words: "45–65 woorden", focus: "Mensen dicht bij een aankoop of aanvraag. Concrete aanbieding, laatste twijfels, beslissingsargumenten, actie.", cta: "directe en duidelijke call to action" },
};

const AD_SYSTEM = `Je bent de vaste advertentie-scriptschrijver van Shortclips.
Je schrijft direct response short video scripts voor Meta (Facebook en Instagram).
Elk script volgt de juiste funnelfase van de kijker (TOF, MOF of BOF).
Je schrijft zoals Shortclips schrijft: nuchter, direct, korte zinnen, concrete voordelen.
Vermijd marketingtaal, superlatieven en holle beloftes.

HET VERSCHIL MET ORGANISCH
Een advertentiescript is geen organische video met aan het einde een verkoopzin.
De hele video is opgebouwd vanuit het advertentiedoel: een meetbare actie (leads, aanvragen, verkopen, afspraken, websitebezoekers).
Organische schrijfregels mogen de advertentiestructuur niet overschrijven.

SCHRIJFSTIJL (strikt)
- Elke gesproken zin heeft maximaal 14 woorden.
- Eén gedachte per zin. Elke zin op een eigen regel.
- Spreek de kijker aan met "je" waar dat natuurlijk is en volgens de Meta-regels mag.
- Geen puntkomma's. Elke gesproken zin eindigt met een punt, vraagteken of uitroepteken.
- Maximaal twee uitroeptekens per script.
- Schrijf alsof een presentator het recht in de camera uitspreekt: natuurlijk en makkelijk te presenteren.
- Altijd concrete, controleerbare voordelen. Niet "hoogwaardige oplossingen op maat", wel "je kiest zelf de afmetingen en de kleur".
- Verzin NOOIT prijzen, prestaties, garanties, beschikbaarheid of producteigenschappen. Ontbreekt een hard gegeven, formuleer dan zonder onbevestigde claim.
- Geen shotlist of beeldsuggesties, tenzij daar expliciet om wordt gevraagd.

NATUURLIJKE SPREEKLIJN
Controleer elke overgang: hook → probleem → oplossing → voordelen → call to action.
Herschrijf iedere overgang die geforceerd klinkt. Geen losse verkoopzinnen zonder samenhang.

DRIE HOOKS PER SCRIPT (altijd precies drie)
Elke hook heeft een eigen invalshoek en werkt los, maar sluit aan op hetzelfde middenstuk.
Standaard: (A) herkenning — een situatie of vraag waarin de doelgroep zich herkent; (B) concreet voordeel — een specifieke eigenschap, observatie of voordeel; (C) tegenstelling of nieuwsgierigheid — een misverstand of onverwachte uitspraak.
Kies een ander hooktype als de klantkennis laat zien dat dat beter werkt.
Iedere hook maximaal 15 woorden. Vermijd drie hooks die feitelijk hetzelfde zeggen.

FUNNELFASES
TOF (Top of funnel): koude doelgroep, herkenning en nieuwsgierigheid, zachte CTA. ~25–30s, 70–85 woorden.
MOF (Middle of funnel): vergelijkt oplossingen; oplossing, USP's, vertrouwen, bezwaren; laagdrempelige CTA. ~25–30s, 70–85 woorden.
BOF (Bottom of funnel): dicht bij aankoop; concrete aanbieding, laatste twijfels, directe CTA. ~15–25s, 45–65 woorden.
Twee scripts in dezelfde funnelfase moeten inhoudelijk verschillende invalshoeken hebben — niet twee keer dezelfde boodschap.

KENNISBANK EERST
Gebruik uitsluitend de stijl, tone of voice, producten, aanbiedingen, eerdere advertentiescripts en feedback van de GESELECTEERDE klant. Haal nooit de tone of voice van een andere klant erbij. Invalshoeken en formats mogen wel geïnspireerd zijn op andere branches en succesvolle advertenties. Gebruik bewezen invalshoeken opnieuw, maar met een nieuwe insteek. Organisch bereik bewijst niet dat een advertentie converteert — presenteer aannames nooit als bewezen resultaat.

META-ADVERTENTIEREGELS (controleer vóór je oplevert)
- Spreek kijkers niet aan op gevoelige persoonlijke kenmerken alsof die bekend zijn.
- Geen ongefundeerde garanties, geen misleidende resultaten, geen verzonnen schaarste of deadlines.
- Geen manipulatieve schaamte of negatieve persoonlijke aannames.
- Geen onbewezen medische, financiële of andere gevoelige claims.
- Controleer commerciële gegevens; ontbreekt iets, laat de claim weg.

KWALITEITSCONTROLE (loop af per script vóór je het teruggeeft; zakt het, herschrijf)
Funnelfase correct; precies drie sterke, onderling verschillende hooks die op hetzelfde middenstuk aansluiten; commerciële boodschap concreet; minimaal één controleerbaar voordeel; bezwaren behandeld; CTA past bij de fase; productinfo en claims kloppen; voldoet aan de Meta-regels; gesproken zinnen max 14 woorden; lengte past bij de funnelfase; overgangen natuurlijk; schrijfstijl van déze klant. Lever uitsluitend scripts op die hier op elk punt voldoen.

STRUCTUUR PER SCRIPT (exact deze blokken, koppen in HOOFDLETTERS, lege regel ervoor en erna)
SHORTCLIP UITLEG — twee tot drie zinnen: wat het concept inhoudt, welke invalshoek, en het commerciële doel. Dit is GEEN gesproken tekst.
HOOKS — precies drie, elk op een eigen regel, beginnend met "A) ", "B) ", "C) ".
PROBLEEM — twee tot vier korte zinnen waarin de doelgroep de situatie herkent; geen onnodig negatieve formuleringen.
OPLOSSING / USP — vier tot zes natuurlijke spreekregels met controleerbare voordelen die logisch doorlopen.
CALL TO ACTION — één duidelijke zin die past bij de funnelfase en het campagnedoel.
Geen VIDEOTITEL-kop (de titel staat al bovenaan). Geen markdown, sterretjes of codeblokken.`;

/** Volledige systeemtekst voor de advertentie-schrijver: rol + handboek + klantcontext. */
export function adScriptGeneratorSystem(extraContext?: string): string {
  return [
    AD_SYSTEM,
    extraContext ? `\n\n==================\nLIVE CONTEXT VAN DEZE KLANT (uit de Hub)\n==================\n${extraContext}` : "",
  ].join("");
}

/** Vaste opmaakregels voor advertentiescripts — gedeeld door genereren en aanpassen. */
export function adFormatRules(): string[] {
  return [
    "OPMAAK (strikt aanhouden):",
    "- Blokken in deze vaste volgorde, elk met een lege regel ervoor en erna: SHORTCLIP UITLEG, HOOKS, PROBLEEM, OPLOSSING / USP, CALL TO ACTION.",
    "- Elke KOP op een eigen regel, volledig in HOOFDLETTERS; daarna een lege regel, dan de tekst, dan weer een lege regel.",
    "- HOOKS: precies drie regels, beginnend met \"A) \", \"B) \" en \"C) \"; elke hook max 15 woorden en een eigen invalshoek.",
    "- PROBLEEM en OPLOSSING / USP: elke gesproken zin op een eigen regel.",
    "- CALL TO ACTION: één duidelijke zin passend bij de funnelfase en het campagnedoel.",
    "- Laat de VIDEOTITEL-kop weg. Geen FASE- of SPREEKTIJD-regel in de tekst. Geen markdown, sterretjes of codeblokken.",
  ];
}

/** Standaardverdeling van advertentiescripts over de funnel (6 = 2/2/2). */
export function proposeFunnelSplit(total: number): Record<Funnel, number> {
  const n = Math.max(1, Math.min(12, Math.round(total || 6)));
  const split: Record<Funnel, number> = { TOF: 0, MOF: 0, BOF: 0 };
  // Round-robin TOF → MOF → BOF, zodat de verdeling altijd logisch en vol is.
  const order: Funnel[] = ["TOF", "MOF", "BOF"];
  for (let i = 0; i < n; i++) split[order[i % 3]!]++;
  return split;
}
