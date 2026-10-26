"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Minus, Plus } from "lucide-react";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * In-portaal PDF-viewer op basis van pdf.js (al in de dependencies). Rendert alle
 * pagina's in een scrollbaar kader zodat de klant door de scripts bladert, met
 * zoom-knoppen. Bewust licht gehouden; de annotatie-laag (klik om te reageren)
 * komt hier in een volgende fase bovenop (elke pagina zit al in een eigen,
 * gepositioneerde container).
 */
export function PdfViewer({ url }: { url: string }) {
  const [doc, setDoc] = useState<any | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let loaded: any = null;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;
        const task = pdfjs.getDocument({ url, withCredentials: true });
        loaded = await task.promise;
        if (cancelled) { loaded.destroy(); return; }
        setDoc(loaded);
        setNumPages(loaded.numPages);
      } catch {
        if (!cancelled) setError("De PDF kon niet worden geladen. Probeer de pagina te verversen.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (loaded) loaded.destroy();
    };
  }, [url]);

  return (
    <div className="flex flex-col">
      {/* Werkbalk: zoom */}
      <div className="sticky top-0 z-10 mb-3 flex items-center justify-between gap-2 rounded-[12px] border border-white/10 bg-[rgba(10,12,38,0.85)] px-3 py-2 backdrop-blur">
        <span className="text-[12px] text-[var(--color-ink-muted)]">{numPages > 0 ? `${numPages} pagina${numPages === 1 ? "" : "'s"}` : "PDF"}</span>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Uitzoomen" onClick={() => setScale((s) => Math.max(0.6, Math.round((s - 0.15) * 100) / 100))}
            className="grid size-8 place-items-center rounded-[8px] border border-white/10 text-[var(--color-ink)] hover:bg-white/10"><Minus className="size-4" /></button>
          <span className="w-12 text-center text-[12px] tabular-nums text-[var(--color-ink-muted)]">{Math.round(scale * 100)}%</span>
          <button type="button" aria-label="Inzoomen" onClick={() => setScale((s) => Math.min(2.2, Math.round((s + 0.15) * 100) / 100))}
            className="grid size-8 place-items-center rounded-[8px] border border-white/10 text-[var(--color-ink)] hover:bg-white/10"><Plus className="size-4" /></button>
        </div>
      </div>

      <div className="max-h-[78vh] overflow-auto rounded-[14px] border border-white/10 bg-[rgba(4,6,20,0.6)] p-3">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--color-ink-muted)]">
            <Loader2 className="size-4 animate-spin" /> PDF laden…
          </div>
        ) : error ? (
          <p className="py-16 text-center text-sm text-[var(--color-ink-muted)]">{error}</p>
        ) : (
          <div className="flex flex-col items-center gap-4">
            {Array.from({ length: numPages }, (_, i) => (
              <PdfPage key={i} doc={doc} pageNumber={i + 1} scale={scale} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PdfPage({ doc, pageNumber, scale }: { doc: any; pageNumber: number; scale: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    let task: any = null;
    (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      task = page.render({ canvasContext: ctx, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined });
      try { await task.promise; } catch { /* render geannuleerd bij zoom/unmount */ }
    })();
    return () => {
      cancelled = true;
      if (task) { try { task.cancel(); } catch { /* ignore */ } }
    };
  }, [doc, pageNumber, scale]);

  return (
    <div className="relative max-w-full">
      <canvas ref={canvasRef} className="block max-w-full rounded-[6px] bg-white shadow-[0_6px_20px_-8px_rgba(0,0,0,0.6)]" />
    </div>
  );
}
