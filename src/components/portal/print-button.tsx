"use client";

import { Download } from "lucide-react";

/** Opent het printdialoog (→ "Opslaan als PDF") voor het resultatenrapport. */
export function PrintButton({ label = "Download als PDF" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print inline-flex items-center gap-2 rounded-full bg-[#00003b] px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
    >
      <Download className="size-4" /> {label}
    </button>
  );
}
