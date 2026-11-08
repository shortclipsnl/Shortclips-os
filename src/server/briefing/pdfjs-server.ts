/**
 * pdf.js op de server (Node/Vercel). De worker wordt expliciet in de main
 * thread geladen: zo hoeft pdf.js geen los workerbestand van schijf te zoeken
 * en neemt de bundler/tracer het bestand gewoon mee.
 */
export async function loadPdfjs() {
  const g = globalThis as unknown as { pdfjsWorker?: unknown };
  if (!g.pdfjsWorker) {
    // @ts-expect-error -- de worker heeft geen typedefinities; we gebruiken alleen de module zelf.
    g.pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  }
  return import("pdfjs-dist/legacy/build/pdf.mjs");
}

/** Alleen de opgegeven pagina's (1-based, in volgorde) als nieuwe PDF. */
export async function extractPages(data: Uint8Array, pages: number[]): Promise<Uint8Array> {
  const { PDFDocument } = await import("pdf-lib");
  const src = await PDFDocument.load(data, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const idx = pages.map((p) => p - 1).filter((i) => i >= 0 && i < src.getPageCount());
  const copied = await out.copyPages(src, idx);
  copied.forEach((p) => out.addPage(p));
  return out.save();
}

/** Plakt PDF's achter elkaar. */
export async function mergePdfs(parts: Uint8Array[]): Promise<Uint8Array> {
  const { PDFDocument } = await import("pdf-lib");
  const out = await PDFDocument.create();
  for (const part of parts) {
    const src = await PDFDocument.load(part, { ignoreEncryption: true });
    const copied = await out.copyPages(src, src.getPageIndices());
    copied.forEach((p) => out.addPage(p));
  }
  return out.save();
}
