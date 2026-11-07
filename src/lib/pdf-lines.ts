/**
 * Zet de tekstfragmenten van een PDF-pagina (pdf.js) om naar regels met de
 * kolomopbouw intact: fragmenten op dezelfde hoogte vormen één regel, en een
 * grote horizontale afstand wordt drie spaties (kolomgrens). Puur en
 * testbaar; draait zowel in de browser als in Node.
 */
export type PdfItem = { str: string; x: number; y: number; w: number };

export function itemsToLines(pages: PdfItem[][]): string {
  const out: string[] = [];
  for (const items of pages) {
    const rows: { y: number; items: PdfItem[] }[] = [];
    for (const it of items) {
      if (!it.str) continue;
      const row = rows.find((r) => Math.abs(r.y - it.y) < 2.5);
      if (row) row.items.push(it);
      else rows.push({ y: it.y, items: [it] });
    }
    rows.sort((a, b) => b.y - a.y); // PDF-coördinaten: hoger = eerder op de pagina
    for (const r of rows) {
      r.items.sort((a, b) => a.x - b.x);
      let line = "";
      let end: number | null = null;
      for (const it of r.items) {
        const gap = end == null ? 0 : it.x - end;
        line += end == null ? "" : gap > 8 ? "   " : gap > 0.8 ? " " : "";
        line += it.str;
        end = it.x + it.w;
      }
      if (line.trim()) out.push(line);
    }
    out.push("");
  }
  return out.join("\n");
}
