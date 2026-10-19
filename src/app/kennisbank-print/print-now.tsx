"use client";

import { Download, Printer } from "lucide-react";

/** Kleine balk bovenaan de printpagina (verdwijnt in de PDF/print zelf). */
export function PrintBar({ pdfHref }: { pdfHref: string }) {
  return (
    <div
      className="no-print"
      style={{ position: "sticky", top: 0, zIndex: 10, display: "flex", gap: 8, justifyContent: "center", padding: "10px", background: "#f4f5f8", borderBottom: "1px solid #e6e8ee" }}
    >
      <a
        href={pdfHref}
        style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 8, background: "#2E90FA", color: "#fff", padding: "8px 14px", fontSize: 14, fontWeight: 600, textDecoration: "none" }}
      >
        <Download size={16} /> Download als PDF
      </a>
      <button
        type="button"
        onClick={() => window.print()}
        style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 8, border: "1px solid #c9ccd6", background: "#fff", color: "#1c2230", padding: "8px 14px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
      >
        <Printer size={16} /> Printen
      </button>
    </div>
  );
}
