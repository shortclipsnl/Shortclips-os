/* ------------------------------------------------------------------ *
 * Script-PDF → letterlijke scripts per video.
 *
 * Deterministisch: er zit GEEN AI tussen. We lezen de tekst uit de PDF met
 * pdfjs en herkennen de structuur aan de opmaak die elk Shortclips-script heeft:
 *  - videotitel  = grote letter (± 3× de bodytekst);
 *  - sectiekop   = vetgedrukte regel in hoofdletters (HOOK, MIDDENSTUK, SKETCH…);
 *  - de rest     = scripttekst, letterlijk, inclusief vet (sprekers) en cursief
 *                  (regie-aanwijzingen).
 * Er wordt niets samengevat, herschreven of aangevuld. Wordt de structuur niet
 * herkend, dan valt de briefing terug op de volledige tekst per pagina.
 * ------------------------------------------------------------------ */
import { loadPdfjs } from "./pdfjs-server";

export type ScriptSpan = { t: string; b?: true; i?: true };
export type ScriptLine = { spans: ScriptSpan[]; bullet?: true };
export type SectionKind = "uitleg" | "hook" | "scene" | "cta" | "intro";
export type ScriptSection = { label: string | null; kind: SectionKind; lines: ScriptLine[] };
export type ParsedScript = {
  /** Volgnummer in de PDF (1-based). */
  index: number;
  /** Titel letterlijk uit de PDF (zonder eventuele "3. "-nummering). */
  title: string;
  sections: ScriptSection[];
  /** Links die letterlijk in het script staan (bijv. referentievideo's). */
  links: string[];
  pages: number[];
};
export type ParsedScriptPdf = {
  structured: boolean;
  scripts: ParsedScript[];
  /** Pagina's zonder tekst (beeld-/moodboardpagina's). */
  imagePages: number[];
  pageCount: number;
  warnings: string[];
};

type RawItem = { str: string; x: number; y: number; w: number; size: number; eol: boolean; b: boolean; i: boolean };
export type RawLine = { page: number; y: number; size: number; spans: ScriptSpan[]; text: string; gapBefore: number };

const URL_RE = /https?:\/\/[^\s)]+/g;

function fontStyle(name: string | undefined): { b: boolean; i: boolean } {
  const n = (name ?? "").toLowerCase();
  return { b: /bold|black|heavy|semibold/.test(n), i: /italic|oblique/.test(n) };
}

function pushSpan(spans: ScriptSpan[], t: string, b: boolean, i: boolean) {
  if (!t) return;
  const last = spans[spans.length - 1];
  if (last && !!last.b === b && !!last.i === i) last.t += t;
  else spans.push({ t, ...(b ? { b: true as const } : {}), ...(i ? { i: true as const } : {}) });
}

const lineText = (spans: ScriptSpan[]) => spans.map((s) => s.t).join("");

/** Leest alle tekstregels met opmaak uit de PDF. */
async function readLines(data: Uint8Array): Promise<{ lines: RawLine[]; pageCount: number; emptyPages: number[] }> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: data.slice(), disableFontFace: true, isEvalSupported: false, useSystemFonts: false }).promise;
  const lines: RawLine[] = [];
  const emptyPages: number[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    await page.getOperatorList(); // laadt de fonts zodat we vet/cursief kunnen zien
    const tc = await page.getTextContent();
    const items: RawItem[] = [];
    for (const it of tc.items as Array<{ str?: string; transform: number[]; width: number; hasEOL?: boolean; fontName: string }>) {
      if (typeof it.str !== "string") continue;
      let fontName: string | undefined;
      try {
        fontName = page.commonObjs.has(it.fontName) ? (page.commonObjs.get(it.fontName) as { name?: string })?.name : undefined;
      } catch {
        fontName = undefined;
      }
      const st = fontStyle(fontName);
      items.push({
        str: it.str,
        x: it.transform[4],
        y: it.transform[5],
        w: it.width,
        size: Math.hypot(it.transform[2], it.transform[3]),
        eol: Boolean(it.hasEOL),
        ...st,
      });
    }
    // Groeperen per regel (zelfde y, ±2pt), van boven naar beneden.
    const rows: RawItem[][] = [];
    for (const it of items) {
      if (!it.str && !it.eol) continue;
      const row = rows.find((r) => Math.abs(r[0]!.y - it.y) <= 2);
      if (row) row.push(it);
      else rows.push([it]);
    }
    rows.sort((a, b) => b[0]!.y - a[0]!.y);
    let prevY: number | null = null;
    let pageHasText = false;
    for (const row of rows) {
      const parts = row.filter((r) => r.str !== "").sort((a, b) => a.x - b.x);
      if (parts.length === 0) continue;
      const spans: ScriptSpan[] = [];
      let size = 0;
      let end: number | null = null;
      for (const it of parts) {
        size = Math.max(size, it.size);
        if (end !== null) {
          const gap = it.x - end;
          const prev = spans[spans.length - 1]?.t ?? "";
          if (gap > it.size * 0.12 && !/\s$/.test(prev) && !/^\s/.test(it.str)) pushSpan(spans, " ", false, false);
        }
        pushSpan(spans, it.str, it.b, it.i);
        end = it.x + it.w;
      }
      // Spaties aan de randen weg; lege spans opruimen.
      if (spans[0]) spans[0].t = spans[0].t.replace(/^\s+/, "");
      const lastSpan = spans[spans.length - 1];
      if (lastSpan) lastSpan.t = lastSpan.t.replace(/\s+$/, "");
      const clean = spans.filter((s) => s.t !== "");
      const text = lineText(clean);
      if (!text.trim()) continue;
      pageHasText = true;
      const y = row[0]!.y;
      lines.push({ page: p, y, size, spans: clean, text, gapBefore: prevY === null ? Infinity : prevY - y });
      prevY = y;
    }
    if (!pageHasText) emptyPages.push(p);
  }
  return { lines, pageCount: doc.numPages, emptyPages };
}

function median(ns: number[]): number {
  if (!ns.length) return 0;
  const s = [...ns].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

function isLabel(l: RawLine, body: number): boolean {
  const t = l.text.trim();
  if (t.length < 3 || t.length > 48) return false;
  if (/[!?:]$/.test(t)) return false;
  if (!l.spans.every((s) => s.b || !s.t.trim())) return false;
  const letters = t.replace(/[^\p{L}]/gu, "");
  if (letters.length < 3) return false;
  if (letters !== letters.toLocaleUpperCase("nl-NL")) return false;
  return l.size <= body * 1.4;
}

export function sectionKind(label: string | null): SectionKind {
  if (!label) return "intro";
  const l = label.toUpperCase();
  if (/^HOOK/.test(l)) return "hook";
  if (/CALL TO ACTION|^CTA\b|AFSLUITING|^SLOT\b|^OUTRO/.test(l)) return "cta";
  if (/UITLEG|^CONCEPT|^IDEE\b|^DOEL\b/.test(l)) return "uitleg";
  return "scene";
}

const normTitle = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Bouwt de scripts op uit de regels. Exporteerbaar voor tests.
 */
export function structureLines(lines: RawLine[], pageCount: number, emptyPages: number[]): ParsedScriptPdf {
  const warnings: string[] = [];
  const body = median(lines.map((l) => l.size)) || 10;
  const titleMin = body * 1.6;

  const scripts: ParsedScript[] = [];
  let cur: ParsedScript | null = null;
  let section: ScriptSection | null = null;
  let lastLine: RawLine | null = null;

  const startSection = (label: string | null) => {
    section = { label, kind: sectionKind(label), lines: [] };
    cur!.sections.push(section);
  };

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (l.size >= titleMin) {
      // Titel kan over meerdere regels lopen (zelfde pagina, direct onder elkaar).
      const parts = [l.text.trim()];
      while (i + 1 < lines.length && lines[i + 1]!.size >= titleMin && lines[i + 1]!.page === l.page) parts.push(lines[++i]!.text.trim());
      let title = parts.join(" ").replace(/\s+/g, " ").trim();
      const num = title.match(/^(\d{1,2})[.)]\s*(.+)$/);
      if (num) title = num[2]!.trim();
      // Vervolgpagina met dezelfde titel → hetzelfde script.
      if (cur && normTitle(cur.title) === normTitle(title)) {
        if (!cur.pages.includes(l.page)) cur.pages.push(l.page);
        lastLine = null;
        continue;
      }
      cur = { index: scripts.length + 1, title, sections: [], links: [], pages: [l.page] };
      scripts.push(cur);
      section = null;
      lastLine = null;
      continue;
    }
    if (!cur) continue; // voorblad (klant + datum) vóór het eerste script
    if (!cur.pages.includes(l.page)) cur.pages.push(l.page);

    if (isLabel(l, body)) {
      startSection(l.text.trim());
      lastLine = null;
      continue;
    }
    if (!section) startSection(null);
    const sec = section as unknown as ScriptSection;

    const text = l.text;
    const bullet = /^[•·▪●◦\-–]\s/.test(text.trim());
    const startsBold = Boolean(l.spans[0]?.b);
    const prevLine = sec.lines[sec.lines.length - 1];
    const newPara =
      !prevLine ||
      !lastLine ||
      lastLine.page !== l.page ||
      bullet ||
      startsBold ||
      l.gapBefore > l.size * 1.75 ||
      /[:]$/.test(lastLine.text.trim());

    if (newPara) {
      sec.lines.push({ spans: l.spans.map((s) => ({ ...s })), ...(bullet ? { bullet: true as const } : {}) });
    } else {
      // Afgebroken regel: letterlijk doorlopen met één spatie.
      pushSpan(prevLine!.spans, " ", false, false);
      for (const s of l.spans) pushSpan(prevLine!.spans, s.t, Boolean(s.b), Boolean(s.i));
    }
    for (const m of text.matchAll(URL_RE)) if (!cur.links.includes(m[0])) cur.links.push(m[0]);
    lastLine = l;
  }

  // Lege secties (bijv. kop zonder tekst) blijven staan: ze komen zo uit het script.
  const structured = scripts.length > 0 && scripts.some((s) => s.sections.some((x) => x.label));
  if (scripts.length === 0) warnings.push("Er zijn geen videotitels herkend in de script-PDF.");
  else if (!structured) warnings.push("De indeling (hook, middenstuk, CTA) is niet herkend; het script staat er volledig als doorlopende tekst.");
  for (const s of scripts) {
    if (!s.sections.some((x) => x.lines.length > 0)) warnings.push(`"${s.title}" bevat geen leesbare tekst in de PDF.`);
  }
  return { structured, scripts, imagePages: emptyPages, pageCount, warnings };
}

/** Volledige pipeline: PDF-bytes → letterlijke scripts. */
export async function parseScriptPdf(data: Uint8Array): Promise<ParsedScriptPdf> {
  const { lines, pageCount, emptyPages } = await readLines(data);
  if (lines.length === 0) {
    return { structured: false, scripts: [], imagePages: emptyPages, pageCount, warnings: ["De script-PDF bevat geen leesbare tekst (mogelijk alleen afbeeldingen)."] };
  }
  return structureLines(lines, pageCount, emptyPages);
}

/** Platte tekst van één script, voor controle (letterlijkheidstest). */
export function scriptPlainText(s: ParsedScript): string {
  return s.sections
    .map((sec) => [sec.label ?? "", ...sec.lines.map((l) => lineText(l.spans))].filter(Boolean).join("\n"))
    .join("\n");
}
