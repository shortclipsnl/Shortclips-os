"use client";

import { Download } from "lucide-react";

type F = { id: string; fileName: string };

function href(code: string, fileId: string): string {
  return `/api/d/${encodeURIComponent(code)}/${encodeURIComponent(fileId)}`;
}

/**
 * Directe downloads rechtstreeks uit R2 (onze server zit niet in het datapad).
 * Eén bestand = één knop; meerdere bestanden = alles-knop + losse downloads.
 */
export function DownloadPanel({ code, files }: { code: string; files: F[] }) {
  function downloadAll() {
    // Elk bestand na elkaar aanstoten (korte stagger zodat de browser ze accepteert).
    files.forEach((f, i) => {
      setTimeout(() => {
        const a = document.createElement("a");
        a.href = href(code, f.id);
        a.download = f.fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }, i * 800);
    });
  }

  if (files.length === 1) {
    return (
      <a
        href={href(code, files[0]!.id)}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#2E90FA] px-4 py-3 text-sm font-semibold text-white transition hover:brightness-95"
      >
        <Download className="size-4" /> Download bestand
      </a>
    );
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={downloadAll}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#2E90FA] px-4 py-3 text-sm font-semibold text-white transition hover:brightness-95"
      >
        <Download className="size-4" /> Download alle bestanden
      </button>
      <div className="space-y-1">
        {files.map((f) => (
          <a
            key={f.id}
            href={href(code, f.id)}
            className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
          >
            <Download className="size-3.5 shrink-0 text-slate-400" />
            <span className="min-w-0 flex-1 truncate">{f.fileName}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
