"use client";

import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";

export function PrintBar({ backHref }: { backHref: string }) {
  return (
    <div className="no-print fixed top-4 right-4 z-50 flex items-center gap-2">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 text-xs font-medium text-[#0B2447] shadow hover:bg-white"
      >
        <ArrowLeft className="size-3.5" /> Terug
      </Link>
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex items-center gap-1.5 rounded-full bg-[#FF6A00] px-3 py-1.5 text-xs font-semibold text-white shadow hover:opacity-90"
      >
        <Printer className="size-3.5" /> Print / PDF
      </button>
    </div>
  );
}
