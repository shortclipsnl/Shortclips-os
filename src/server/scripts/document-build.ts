import { AlignmentType, BorderStyle, Document, PageBreak, Packer, Paragraph, TextRun } from "docx";

/**
 * Shortclips-scriptdocumentgenerator. Zet één script of een hele opnamesessie
 * om naar een bewerkbaar Word-document (.docx) in de vaste Shortclips-opmaak:
 * Poppins voor titels en sectiekoppen, Arial voor de gesproken tekst, en de
 * vaste sectievolgorde per script (TYPE VIDEO, SHORTCLIP UITLEG, HOOK,
 * MIDDENSTUK, CALL TO ACTION). Meerdere scripts komen in één document met een
 * nette paginaovergang ertussen.
 */

const NAVY = "00003b";
const GREY = "555560";
const LINE = "d4d4dc";
const HEAD = "Poppins";
const BODY = "Arial";

export type ScriptForDoc = {
  id: string;
  title: string;
  pillar: string | null;
  format: string | null;
  hook: string | null;
  body: string | null;
  cta: string | null;
  locationName: string | null;
  presenter: string | null;
  requirements: string | null;
};

export type ScriptSections = {
  typeVideo: string;
  uitleg: string;
  hook: string;
  middenstuk: string;
  cta: string;
};

/** Haalt de losse secties uit een script. Gebruikt de aparte velden (hook/body/
 *  cta) en valt terug op gelabelde tekst in de body ([Hook]/[Kern]/[Afsluiting]
 *  of HOOK/MIDDENSTUK/CTA) als die velden leeg zijn. */
export function scriptSections(s: ScriptForDoc): ScriptSections {
  const body = (s.body ?? "").trim();
  const marked = parseLabeledBody(body);

  const hook = (s.hook ?? "").trim() || marked.hook;
  const cta = (s.cta ?? "").trim() || marked.cta;
  // Middenstuk: het gelabelde kern-blok, anders het losse body-veld, anders de
  // hele body als die geen labels bevatte.
  const middenstuk = marked.kern || (marked.hasLabels ? "" : body) || (!s.hook && !s.cta ? body : "");

  const typeParts = [
    s.format ? s.format : "",
    s.locationName ? `Locatie: ${s.locationName}` : "",
    s.presenter ? `Presentator: ${s.presenter}` : "",
    s.requirements ? s.requirements : "",
  ].filter(Boolean);

  return {
    typeVideo: typeParts.join(" · "),
    uitleg: (s.pillar ?? "").trim(),
    hook,
    middenstuk: middenstuk.trim(),
    cta,
  };
}

function parseLabeledBody(body: string): { hook: string; kern: string; cta: string; hasLabels: boolean } {
  const re = /^\s*(?:\[\s*)?(hook|kern|middenstuk|midden|afsluiting|cta|call to action)\s*(?:\])?\s*:?\s*$/i;
  const lines = body.split(/\r?\n/);
  const buckets: Record<string, string[]> = {};
  let current: string | null = null;
  let found = false;
  for (const line of lines) {
    const m = line.match(re);
    if (m) {
      found = true;
      const k = m[1]!.toLowerCase();
      current = k === "hook" ? "hook" : k === "afsluiting" || k === "cta" || k === "call to action" ? "cta" : "kern";
      buckets[current] = buckets[current] ?? [];
      continue;
    }
    if (current) (buckets[current] ??= []).push(line);
  }
  const join = (k: string) => (buckets[k] ?? []).join("\n").trim();
  return { hook: join("hook"), kern: join("kern"), cta: join("cta"), hasLabels: found };
}

/* ------------------------------ Opmaak ------------------------------ */

function textBlocks(text: string, opts: { italic?: boolean; size?: number; color?: string }): Paragraph[] {
  const size = opts.size ?? 22;
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  if (blocks.length === 0) {
    return [new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: "—", font: BODY, size, color: GREY })] })];
  }
  return blocks.map((block) => {
    const lines = block.split(/\n/);
    const runs: TextRun[] = [];
    lines.forEach((line, i) => {
      if (i > 0) runs.push(new TextRun({ break: 1 }));
      runs.push(new TextRun({ text: line, font: BODY, size, italics: opts.italic, color: opts.color }));
    });
    return new Paragraph({ spacing: { after: 140, line: 276 }, children: runs });
  });
}

function sectionHeading(label: string): Paragraph {
  return new Paragraph({
    spacing: { before: 220, after: 60 },
    children: [new TextRun({ text: label, font: HEAD, bold: true, size: 22, color: NAVY, allCaps: true })],
  });
}

function scriptTitle(n: number, title: string): Paragraph {
  return new Paragraph({
    spacing: { before: 120, after: 160 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: LINE, space: 6 } },
    children: [new TextRun({ text: `SCRIPT ${n}: ${title.toUpperCase()}`, font: HEAD, bold: true, size: 30, color: NAVY })],
  });
}

function scriptParagraphs(s: ScriptForDoc, n: number, withPageBreak: boolean): Paragraph[] {
  const sec = scriptSections(s);
  const out: Paragraph[] = [];
  if (withPageBreak) out.push(new Paragraph({ children: [new PageBreak()] }));
  out.push(scriptTitle(n, s.title));

  out.push(sectionHeading("Type video"));
  out.push(...textBlocks(sec.typeVideo, {}));

  out.push(sectionHeading("Shortclip uitleg"));
  out.push(...textBlocks(sec.uitleg, { italic: true, color: GREY }));

  out.push(sectionHeading("Hook"));
  out.push(...textBlocks(sec.hook, {}));

  out.push(sectionHeading("Middenstuk"));
  out.push(...textBlocks(sec.middenstuk, {}));

  out.push(sectionHeading("Call to action"));
  out.push(...textBlocks(sec.cta, {}));

  return out;
}

/** Bouwt het volledige Word-document (als Buffer) voor één of meer scripts. */
export async function buildScriptDocx(list: ScriptForDoc[], meta: { title: string; subtitle?: string }): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({ alignment: AlignmentType.LEFT, spacing: { after: 40 }, children: [new TextRun({ text: "Shortclips", font: HEAD, bold: true, size: 48, color: NAVY })] }),
    new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: meta.title, font: HEAD, bold: true, size: 30, color: NAVY })] }),
    ...(meta.subtitle ? [new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: meta.subtitle, font: HEAD, size: 22, color: GREY })] })] : []),
  ];
  list.forEach((s, i) => children.push(...scriptParagraphs(s, i + 1, i > 0)));

  const doc = new Document({
    creator: "Shortclips Hub",
    title: meta.title,
    styles: { default: { document: { run: { font: BODY, size: 22 } } } },
    sections: [{
      properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
      children,
    }],
  });
  return Packer.toBuffer(doc);
}
