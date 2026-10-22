/**
 * Bouwt een scriptbestand als PDF in de vaste Shortclips-huisstijl.
 *
 * De opmaak komt 1-op-1 uit het PowerPoint-sjabloon "Organisch - Scripts -
 * Shortclips": A4 staand, 13 merkpagina's met volledige achtergrond. Alleen de
 * cover (klantnaam + opnamedag) en de scriptpagina (onderwerp + scripttekst)
 * hebben dynamische tekst; die leggen we hier op de juiste plek over de
 * achtergrond heen. De scriptpagina wordt per script herhaald tussen de vaste
 * voor- (1–5) en achterpagina's (7–13).
 *
 * De afbeeldingen staan in /public/script-template/slideN.png en worden via de
 * injecteerbare `load`-functie opgehaald (in de browser met fetch; in tests van
 * schijf), zodat ze niet in de JS-bundle terechtkomen.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage } from "pdf-lib";

export type ScriptForPdf = { onderwerp: string; tekst: string };
export type ScriptPdfInput = { klantnaam: string; opnamedag: string; scripts: ScriptForPdf[] };

/** Haalt de PNG van sjabloonpagina `slide` op als bytes. */
export type TemplateImageLoader = (slide: number) => Promise<Uint8Array>;

// A4 staand in punten (1 inch = 72 pt). Komt overeen met het sjabloon.
const PAGE_W = 595.276;
const PAGE_H = 841.89;
const IN = 72;

// Vaste pagina's rond de scripts (slidenummers in het sjabloon).
const FRONT_PAGES = [1, 2, 3, 4, 5];
const SCRIPT_PAGE = 6;
const BACK_PAGES = [7, 8, 9, 10, 11, 12, 13];

// Kleuren uit de huisstijl.
const NAVY = rgb(0, 0, 59 / 255);
const WHITE = rgb(1, 1, 1);
const BODY = rgb(0.1, 0.1, 0.14);

// Posities van de tekstvakken, overgenomen uit het sjabloon (inch → pt).
const COVER_KLANT = { x: 0.69 * IN, topY: 6.18 * IN };
const COVER_DATUM = { x: 3.62 * IN, topY: 6.18 * IN };
const SCRIPT_TITLE = { x: 0.67 * IN, topY: 0.92 * IN, maxW: 5.2 * IN };
const SCRIPT_BODY = { x: 0.78 * IN, topY: 2.86 * IN, maxW: 6.68 * IN, bottomY: 1.15 * IN };

/** Splitst een regel in zoveel regels als nodig om binnen maxWidth te passen. */
function wrapLine(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) <= maxWidth || !cur) {
      cur = test;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Een regel is een kop als hij kort is en (op cijfers/leestekens na) volledig in hoofdletters staat. */
function isHeading(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 42) return false;
  if (!/[A-ZÀ-Þ]/.test(t)) return false;
  return t === t.toUpperCase();
}

/** Verwijdert een eventueel nummer vooraan ("1. " → "") zodat de kop schoon op de band staat. */
function cleanTitle(s: string): string {
  return s.replace(/^\s*\d+\.\s*/, "").trim();
}

function drawFullPage(page: { drawImage: (img: PDFImage, o: { x: number; y: number; width: number; height: number }) => void }, img: PDFImage) {
  page.drawImage(img, { x: 0, y: 0, width: PAGE_W, height: PAGE_H });
}

export async function buildScriptPdfBytes(input: ScriptPdfInput, load: TemplateImageLoader): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  // Helvetica is de standaard Arial-vervanger in PDF (vrijwel identieke letter).
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

  // Alle sjabloonafbeeldingen die we nodig hebben één keer inbedden.
  const needed = [...FRONT_PAGES, SCRIPT_PAGE, ...BACK_PAGES];
  const images = new Map<number, PDFImage>();
  for (const n of needed) {
    const bytes = await load(n);
    images.set(n, await doc.embedPng(bytes));
  }

  // ---- Voorpagina's (1–5), met cover-tekst op pagina 1. ----
  for (const n of FRONT_PAGES) {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    drawFullPage(page, images.get(n)!);
    if (n === 1) {
      const size = 13;
      if (input.klantnaam.trim()) {
        page.drawText(input.klantnaam.trim(), { x: COVER_KLANT.x, y: PAGE_H - COVER_KLANT.topY - size, size, font: bold, color: WHITE });
      }
      if (input.opnamedag.trim()) {
        page.drawText(input.opnamedag.trim(), { x: COVER_DATUM.x, y: PAGE_H - COVER_DATUM.topY - size, size, font: bold, color: WHITE });
      }
    }
  }

  // ---- Scriptpagina's (sjabloonpagina 6 herhaald). ----
  const scriptImg = images.get(SCRIPT_PAGE)!;
  input.scripts.forEach((s, i) => {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    drawFullPage(page, scriptImg);

    // Genummerde titel (wit, vet) op de navy band: "1. <titel>". Krimpt tot 2 regels.
    const title = `${i + 1}. ${cleanTitle(s.onderwerp) || "Script"}`;
    let titleSize = 22;
    let titleLines = wrapLine(title, bold, titleSize, SCRIPT_TITLE.maxW);
    while (titleLines.length > 2 && titleSize > 14) {
      titleSize -= 1;
      titleLines = wrapLine(title, bold, titleSize, SCRIPT_TITLE.maxW);
    }
    let ty = PAGE_H - SCRIPT_TITLE.topY - titleSize;
    for (const line of titleLines.slice(0, 2)) {
      page.drawText(line, { x: SCRIPT_TITLE.x, y: ty, size: titleSize, font: bold, color: WHITE });
      ty -= titleSize * 1.15;
    }

    // Scripttekst. Koppen (HOOFDLETTERS) worden navy + vet; de tekst onder
    // SHORTCLIP UITLEG wordt volledig schuingedrukt; de rest staat normaal.
    const rawLines = (s.tekst || "").replace(/\r/g, "").split("\n");
    // Bepaal per regel het lettertype: koppen vet, uitleg-tekst cursief, rest normaal.
    let section = "";
    const styled = rawLines.map((raw) => {
      const t = raw.trim();
      if (t === "") return { text: "", f: font, color: BODY, heading: false };
      if (isHeading(t)) { section = t.toUpperCase(); return { text: t, f: bold, color: NAVY, heading: true }; }
      const uitleg = section.startsWith("SHORTCLIP UITLEG");
      return { text: t, f: uitleg ? italic : font, color: BODY, heading: false };
    });

    const available = (PAGE_H - SCRIPT_BODY.topY) - SCRIPT_BODY.bottomY;
    // Lettergrootte zo kiezen dat alles past (auto-fit, min 8pt).
    const fit = (size: number) => {
      const lh = size * 1.32;
      let count = 0;
      for (const l of styled) {
        if (l.text === "") { count += 0.6; continue; }
        count += wrapLine(l.text, l.f, size, SCRIPT_BODY.maxW).length;
      }
      return count * lh;
    };
    let bodySize = 11;
    while (bodySize > 8 && fit(bodySize) > available) bodySize -= 0.5;
    const lh = bodySize * 1.32;

    let by = PAGE_H - SCRIPT_BODY.topY - bodySize;
    for (const l of styled) {
      if (l.text === "") { by -= lh * 0.6; continue; }
      for (const line of wrapLine(l.text, l.f, bodySize, SCRIPT_BODY.maxW)) {
        if (by < SCRIPT_BODY.bottomY) break;
        page.drawText(line, { x: SCRIPT_BODY.x, y: by, size: bodySize, font: l.f, color: l.color });
        by -= lh;
      }
    }
  });

  // ---- Achterpagina's (7–13). ----
  for (const n of BACK_PAGES) {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    drawFullPage(page, images.get(n)!);
  }

  return doc.save();
}

/** Browser-helper: bouwt de PDF en start de download. */
export async function downloadScriptPdf(input: ScriptPdfInput): Promise<void> {
  const load: TemplateImageLoader = async (n) => {
    const res = await fetch(`/script-template/slide${n}.png`);
    if (!res.ok) throw new Error(`Sjabloonpagina ${n} kon niet worden geladen.`);
    return new Uint8Array(await res.arrayBuffer());
  };
  const bytes = await buildScriptPdfBytes(input, load);
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safe = (input.klantnaam || "Shortclips").replace(/[^\p{L}\p{N} _-]/gu, "").trim() || "Shortclips";
  a.href = url;
  a.download = `Scripts - ${safe}${input.opnamedag ? ` - ${input.opnamedag}` : ""}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
