"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Upload, X } from "lucide-react";
import { importFinancieleExports, type FinanceUploadResult } from "@/server/actions/finance-upload";
import { itemsToLines, type PdfItem } from "@/lib/pdf-lines";
import { Button } from "@/components/ui";

/** PDF-tekst in de browser uitlezen (kolommen intact), zodat alleen tekst naar de server gaat. */
async function pdfNaarTekst(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: PdfItem[][] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent();
    pages.push(
      c.items.map((it) => {
        const t = it as { str?: string; transform?: number[]; width?: number };
        return { str: t.str ?? "", x: t.transform?.[4] ?? 0, y: t.transform?.[5] ?? 0, w: t.width ?? 0 };
      }),
    );
  }
  await doc.destroy();
  return itemsToLines(pages);
}

/**
 * Knop "Exports toevoegen" op elke financiële pagina. Accepteert Knab CAMT.053 (.xml),
 * Revolut-afschrift (.pdf of .csv) en DigiBoox-exports (.xlsx), meerdere tegelijk.
 * Na verwerking worden alle financiële pagina's ververst.
 */
export function FinanceUpload() {
  const ref = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [res, setRes] = useState<FinanceUploadResult | null>(null);
  const router = useRouter();

  function kies(list: FileList | null) {
    if (!list?.length) return;
    const files = Array.from(list);
    start(async () => {
      const fd = new FormData();
      const fouten: string[] = [];
      for (const f of files) {
        if (/\.pdf$/i.test(f.name)) {
          try {
            fd.append("files", new File([await pdfNaarTekst(f)], `${f.name}.revolut-tekst.txt`, { type: "text/plain" }));
          } catch {
            fouten.push(`${f.name}: PDF kon niet worden gelezen.`);
          }
        } else fd.append("files", f);
      }
      const r: FinanceUploadResult = fd.getAll("files").length ? await importFinancieleExports(fd) : { ok: false, regels: [], fouten: [] };
      setRes({ ...r, fouten: [...fouten, ...r.fouten] });
      router.refresh();
      if (ref.current) ref.current.value = "";
    });
  }

  return (
    <div className="relative print:hidden">
      <input ref={ref} type="file" multiple accept=".xml,.csv,.pdf,.xlsx,.txt" className="hidden" onChange={(e) => kies(e.target.files)} />
      <Button onClick={() => ref.current?.click()} disabled={pending} title="Knab CAMT.053 (.xml), Revolut-afschrift (.pdf of .csv) en DigiBoox-exports (.xlsx). Meerdere bestanden tegelijk.">
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} {pending ? "Verwerken..." : "Exports toevoegen"}
      </Button>
      {res ? (
        <div className="absolute right-0 z-30 mt-2 w-[min(560px,90vw)] rounded-[var(--radius-md)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] p-4 text-left text-xs shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold">{res.fouten.length ? "Verwerkt, met aandachtspunten" : "Alles is bijgewerkt"}</span>
            <button type="button" onClick={() => setRes(null)} className="text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]" aria-label="Sluiten">
              <X className="size-4" />
            </button>
          </div>
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {res.regels.map((r, i) => (
              <li key={"r" + i} className="flex gap-1.5">
                <Check className="mt-0.5 size-3.5 shrink-0 text-[var(--color-good)]" />
                {r}
              </li>
            ))}
            {res.fouten.map((f, i) => (
              <li key={"f" + i} className="text-[var(--color-bad)]">{f}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
