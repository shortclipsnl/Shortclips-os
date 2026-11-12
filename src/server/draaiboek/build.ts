/* ------------------------------------------------------------------ *
 * Script-PDF (geparsed) → draaiboek. Deterministisch, zonder AI.
 *
 *  - Hook, middenstuk en call to action: de scripttekst letterlijk, onder elkaar.
 *  - Cursieve regie-regels en beeldregels ("Beeld: ...") worden korte
 *    shotaanwijzingen bij het onderdeel waar ze staan.
 *  - Regels die B-roll noemen gaan naar de B-roll-lijst.
 *  - "Tekst in beeld" is voor de editor en blijft weg uit het draaiboek.
 * ------------------------------------------------------------------ */
import type { ParsedScript, ParsedScriptPdf, ScriptLine } from "@/server/briefing/script-pdf";
import type { DraaiboekContent, DraaiboekPart, DraaiboekVideo } from "./types";

const lineText = (l: ScriptLine) => l.spans.map((s) => s.t).join("").replace(/\s+/g, " ").trim();
const isRegie = (l: ScriptLine) => l.spans.filter((s) => s.t.trim()).every((s) => s.i);

const BEELD_RE = /^(beeld|shot|camera|opname)\s*[:\-–]\s*/i;
const BROLL_RE = /^b[\s-]?roll\s*[:\-–]?\s*/i;
const TIB_RE = /^(tekst in beeld|tib)\b/i;
const MIDDEN_LABEL_RE = /^MIDDENSTUK/i;

/** "B-roll: keuken, details van de woning en entree" → losse, afvinkbare beelden. */
export function splitBroll(t: string): string[] {
  return t
    .replace(/[.;]+\s*$/, "")
    .split(/,\s+|;\s+|\s+en\s+(?=[^,]*$)/)
    .map((x) => x.trim().replace(/^(en|of)\s+/i, ""))
    .filter((x) => x.length > 1)
    .map((x) => x.charAt(0).toUpperCase() + x.slice(1));
}

function emptyPart(): DraaiboekPart {
  return { tekst: "", aanwijzingen: [] };
}

function addHint(part: DraaiboekPart, hint: string) {
  const h = hint.replace(/^[•·▪●◦\-–]\s*/, "").replace(/\s+/g, " ").trim();
  if (h && !part.aanwijzingen.some((x) => x.toLowerCase() === h.toLowerCase())) part.aanwijzingen.push(h);
}

export function scriptToVideo(s: ParsedScript, nr: number): DraaiboekVideo {
  const parts = { hook: emptyPart(), middenstuk: emptyPart(), cta: emptyPart() };
  const broll: string[] = [];
  const hookSections = s.sections.filter((x) => x.kind === "hook");
  const hasHook = hookSections.length > 0;
  const sceneSections = s.sections.filter((x) => x.kind === "scene");

  for (const sec of s.sections) {
    let target: DraaiboekPart | null = null;
    if (sec.kind === "hook") target = parts.hook;
    else if (sec.kind === "cta") target = parts.cta;
    else if (sec.kind === "scene") target = parts.middenstuk;
    else if (sec.kind === "intro" && !hasHook) target = parts.middenstuk;
    if (!target) continue; // Shortclip uitleg en voorblad: niet nodig tijdens de opname.

    const out: string[] = [];
    // Meerdere hooks of afwijkende middenstuk-koppen (bv. SKETCH): kop als regel meenemen.
    if (sec.kind === "hook" && hookSections.length > 1 && sec.label) out.push(sec.label);
    if (sec.kind === "scene" && sec.label && (!MIDDEN_LABEL_RE.test(sec.label) || sceneSections.length > 1)) out.push(sec.label);

    for (const l of sec.lines) {
      const t = lineText(l);
      if (!t) continue;
      if (TIB_RE.test(t)) continue;
      if (BROLL_RE.test(t)) {
        broll.push(...splitBroll(t.replace(BROLL_RE, "")));
        continue;
      }
      if (BEELD_RE.test(t)) {
        addHint(target, t.replace(BEELD_RE, ""));
        continue;
      }
      if (isRegie(l)) {
        addHint(target, t);
        continue;
      }
      out.push(t);
    }
    if (out.length) target.tekst = [target.tekst, out.join("\n")].filter(Boolean).join("\n");
  }

  // Geen middenstuk in het script (bv. een teamvideo met alleen een uitleg)? Dan
  // de Shortclip uitleg tonen, zodat de videograaf weet wat er opgenomen moet worden.
  if (!parts.middenstuk.tekst.trim()) {
    const uitleg = s.sections
      .filter((x) => x.kind === "uitleg" || (x.kind === "intro" && hasHook))
      .flatMap((x) => x.lines.map(lineText))
      .filter((t) => t && !TIB_RE.test(t));
    if (uitleg.length) parts.middenstuk.tekst = uitleg.join("\n");
  }

  return {
    key: `v${nr}`,
    nr,
    titel: s.title,
    hook: parts.hook,
    middenstuk: parts.middenstuk,
    cta: parts.cta,
    broll: [...new Set(broll)],
  };
}

export function buildDraaiboekContent(parsed: ParsedScriptPdf): DraaiboekContent {
  const videos = parsed.scripts.map((s, i) => scriptToVideo(s, i + 1));
  const warnings = [...parsed.warnings];
  for (const v of videos) {
    if (!v.hook.tekst.trim()) warnings.push(`Video ${v.nr} (${v.titel}): geen hook herkend in het script.`);
    if (!v.cta.tekst.trim()) warnings.push(`Video ${v.nr} (${v.titel}): geen call to action herkend in het script.`);
  }
  return { v: 1, videos, warnings };
}

/** AI-suggesties toevoegen: kort, praktisch en nooit uitgesproken tekst. */
export function mergeHints(
  content: DraaiboekContent,
  ai: unknown,
  limits = { perPart: 2, broll: 4, words: 9 },
): DraaiboekContent {
  const list = (ai && typeof ai === "object" && Array.isArray((ai as { videos?: unknown }).videos) ? (ai as { videos: unknown[] }).videos : []) as Array<Record<string, unknown>>;
  const clean = (x: unknown): string[] =>
    (Array.isArray(x) ? x : [])
      .filter((s): s is string => typeof s === "string")
      .map((s) => s.replace(/\s+/g, " ").replace(/[.]+$/, "").trim())
      .filter((s) => s.length > 2 && s.split(" ").length <= limits.words);
  for (const v of content.videos) {
    const a = list.find((x) => Number(x.nr) === v.nr);
    if (!a) continue;
    for (const k of ["hook", "middenstuk", "cta"] as const) {
      if (!v[k].tekst.trim()) continue;
      for (const h of clean(a[k])) {
        if (v[k].aanwijzingen.length >= limits.perPart) break;
        // Nooit iets dat letterlijk in de uitgesproken tekst staat (geen tekst verzinnen of herhalen).
        if (v[k].tekst.toLowerCase().includes(h.toLowerCase())) continue;
        addHint(v[k], h);
      }
    }
    for (const b of clean(a.broll)) {
      if (v.broll.length >= limits.broll) break;
      if (!v.broll.some((x) => x.toLowerCase() === b.toLowerCase())) v.broll.push(b);
    }
  }
  return content;
}
