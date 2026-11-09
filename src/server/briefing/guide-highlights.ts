/* ------------------------------------------------------------------ *
 * Highlights uit de Editing Guide van de klant.
 *
 * De AI KIEST alleen: hij mag maximaal 7 regels selecteren die letterlijk in
 * de guide staan en er een korte categorie bij zetten. Elke regel wordt daarna
 * gecontroleerd tegen de tekst van de guide; wat er niet letterlijk in staat,
 * valt weg. Zo kan een klantafspraak nooit veranderen of verzonnen worden.
 * Het resultaat wordt per guide-versie (sha256) bewaard: geen AI-kosten zolang
 * de guide niet verandert.
 * ------------------------------------------------------------------ */
import { loadPdfjs } from "./pdfjs-server";

export type GuideHighlight = {
  /** true = iets wat juist NIET mag (stond in de guide onder Niet/Nooit/Verboden). */
  niet: boolean;
  /** Korte categorie, bijv. "Ondertiteling" of "Niet doen". */
  categorie: string;
  /** Letterlijk uit de Editing Guide. */
  tekst: string;
  /** Klantafspraak die absoluut niet vergeten mag worden. */
  kritiek: boolean;
};

export const MAX_HIGHLIGHTS = 7;

/** Normaliseren voor de letterlijkheidscontrole (opmaakverschillen negeren). */
export function normGuide(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[‘’‚‛`´]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Platte tekst uit een PDF (server). Regels per tekstfragment. */
export async function pdfPlainText(data: Uint8Array): Promise<string> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: data.slice(), disableFontFace: true, isEvalSupported: false, useSystemFonts: false }).promise;
  const out: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    let line = "";
    for (const it of tc.items as Array<{ str?: string; hasEOL?: boolean }>) {
      if (typeof it.str !== "string") continue;
      line += it.str;
      if (it.hasEOL) {
        if (line.trim()) out.push(line.trim());
        line = "";
      } else if (it.str && !/\s$/.test(it.str)) {
        line += " ";
      }
    }
    if (line.trim()) out.push(line.trim());
  }
  await doc.destroy();
  return out.join("\n");
}

/** Houdt alleen highlights over die letterlijk in de guide staan. */
export function verifyHighlights(candidates: unknown, guideText: string): GuideHighlight[] {
  const hay = normGuide(guideText);
  const seen = new Set<string>();
  const list = Array.isArray(candidates) ? candidates : [];
  const out: GuideHighlight[] = [];
  for (const c of list) {
    if (!c || typeof c !== "object") continue;
    const tekst = String((c as { tekst?: unknown }).tekst ?? "").trim();
    const categorie = String((c as { categorie?: unknown }).categorie ?? "").trim().slice(0, 32);
    if (!tekst || tekst.length > 220) continue;
    const n = normGuide(tekst);
    if (n.length < 6 || !hay.includes(n) || seen.has(n)) continue;
    seen.add(n);
    out.push({
      categorie: categorie || "Richtlijn",
      tekst,
      // "Geen logo over het beeld" is zelf al een verbod: geen dubbel "Niet:".
      niet: Boolean((c as { niet?: unknown }).niet) && !/^(geen|nooit|niet|verboden|vermijd)\b/i.test(tekst),
      kritiek: Boolean((c as { kritiek?: unknown }).kritiek),
    });
    if (out.length >= MAX_HIGHLIGHTS) break;
  }
  return out;
}

export const HIGHLIGHT_SYSTEM = `Je selecteert de belangrijkste montageregels uit de Editing Guide van één klant van Shortclips (short video bureau). Een freelance editor leest deze highlights voordat hij begint; de volledige guide staat ernaast.

STRENGE REGELS:
- "tekst" is ALTIJD een letterlijk fragment uit de guide: exact dezelfde woorden, getallen en volgorde. Niet samenvatten, niet herschrijven, niets toevoegen, geen woorden weglaten in het midden. Je mag alleen een fragment kiezen dat zelf al kort en duidelijk is.
- Een fragment dat niet letterlijk in de guide staat, wordt automatisch verwijderd. Liever 5 goede letterlijke regels dan 7 twijfelachtige.
- Kies 5 tot 7 regels, verspreid over: montagetempo/energie, ondertiteling/tekststijl, muziek/geluid, kleur/uitstraling, logo's/grafische elementen, en wat absoluut NIET mag.
- Geef voorrang aan harde klantafspraken (nooit, verboden, altijd, exacte waarden) boven algemene stijltips.
- "niet": true wanneer het fragment iets beschrijft wat NIET mag (het staat in de guide onder NIET, NOOIT, VERBODEN of "Niet doen"). Een fragment als "Muziek boven de stem" onder NIET is dus niet:true. Twijfel je over de context, kies dan een ander fragment.
- "kritiek": true alleen voor afspraken die absoluut niet vergeten mogen worden (meestal verboden of verplicht). Maximaal 3.
- "categorie": 1 of 2 woorden, bijv. Tempo, Ondertiteling, Audio, Kleur, Branding, Niet doen.
- Verzin niets. Staat iets niet in de guide, dan neem je het niet op.

Geef UITSLUITEND geldige JSON terug: {"highlights":[{"categorie":"...","tekst":"...","niet":false,"kritiek":false}]}`;

export function highlightUserPrompt(clientName: string, guideText: string): string {
  return `Klant: ${clientName}\n\nDE EDITING GUIDE (platte tekst uit de PDF; kolommen kunnen door elkaar staan, kies alleen fragmenten die als geheel op één regel staan):\n\n${guideText.slice(0, 40000)}`;
}
