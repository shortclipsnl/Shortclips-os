"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

/**
 * De scriptpagina's exact zoals in de script-PDF, als pagina's onder elkaar.
 * Rendert met pdf.js in de browser (werkt ook op mobiel, waar een ingebedde
 * PDF vaak alleen de eerste pagina toont).
 */
export function ScriptPages({ url }: { url: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"laden" | "klaar" | "fout">("laden");
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let doc: any = null;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;
        doc = await pdfjs.getDocument({ url, withCredentials: true }).promise;
        if (cancelled || !box.current) return;
        setCount(doc.numPages);
        const width = box.current.clientWidth;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        box.current.innerHTML = "";
        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n);
          if (cancelled || !box.current) return;
          const base = page.getViewport({ scale: 1 });
          const vp = page.getViewport({ scale: (width / base.width) * ratio });
          const canvas = document.createElement("canvas");
          canvas.width = vp.width;
          canvas.height = vp.height;
          canvas.style.width = "100%";
          canvas.className = "rounded-[6px] border border-[var(--color-line)] bg-white shadow-sm";
          box.current.appendChild(canvas);
          await page.render({ canvasContext: canvas.getContext("2d")!, viewport: vp }).promise;
        }
        if (!cancelled) setState("klaar");
      } catch {
        if (!cancelled) setState("fout");
      }
    })();
    return () => {
      cancelled = true;
      if (doc) doc.destroy();
    };
  }, [url]);

  return (
    <section className="mt-6">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-[var(--color-ink)]">Scripts</h2>
        <span className="text-2xs text-[var(--color-ink-muted)]">
          {count ? `${count} pagina${count === 1 ? "" : "'s"}, exact zoals in de script-PDF` : "Exact zoals in de script-PDF"}
        </span>
      </div>
      {state === "laden" ? (
        <div className="flex items-center gap-2 py-10 text-sm text-[var(--color-ink-muted)]">
          <Loader2 className="size-4 animate-spin" /> Scripts laden…
        </div>
      ) : null}
      {state === "fout" ? (
        <p className="py-6 text-sm text-[var(--color-ink-muted)]">
          De scripts konden hier niet worden getoond. <a href={url} target="_blank" rel="noreferrer" className="underline">Open de scriptpagina&apos;s als PDF</a>.
        </p>
      ) : null}
      <div ref={box} className="flex flex-col gap-4" />
    </section>
  );
}
