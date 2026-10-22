/**
 * Haalt de tekst uit een PDF in de browser (pdf.js). Zo kunnen ook grote
 * scriptbestanden worden toegevoegd: we sturen alleen de (kleine) tekst naar de
 * server, niet het hele bestand — dat omzeilt de upload-limiet.
 *
 * pdf.js wordt pas geladen wanneer het nodig is (dynamische import), zodat het
 * niet in de hoofdbundle komt.
 */
export async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  // Worker van cdnjs met exact dezelfde versie als het pakket (anders klaagt pdf.js).
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const line = content.items.map((it) => ((it as { str?: string }).str ?? "")).join(" ");
    if (line.trim()) parts.push(line);
    if (parts.join("\n").length > 30000) break; // ruim genoeg als stijlreferentie
  }
  await doc.destroy();
  return parts.join("\n").trim();
}
