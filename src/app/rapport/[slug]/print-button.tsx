"use client";

const BLUE = "#2E90FA";

export function PrintButton({ slug, days }: { slug: string; days: number }) {
  const pdfHref = `/api/reports/${encodeURIComponent(slug)}/pdf?dagen=${days}`;
  return (
    <div
      className="no-print"
      style={{ position: "fixed", top: 20, right: 24, zIndex: 50, display: "flex", gap: 8 }}
    >
      <a
        href={pdfHref}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          background: BLUE,
          color: "#fff",
          borderRadius: 10,
          padding: "10px 18px",
          fontWeight: 700,
          fontSize: 14,
          textDecoration: "none",
          boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
        }}
      >
        ⬇ Download PDF
      </a>
      <button
        type="button"
        onClick={() => window.print()}
        style={{
          background: "#fff",
          color: "#1c2230",
          border: "1px solid #d7dbe4",
          borderRadius: 10,
          padding: "10px 16px",
          fontWeight: 600,
          fontSize: 14,
          cursor: "pointer",
          boxShadow: "0 4px 14px rgba(0,0,0,0.10)",
        }}
      >
        Printen
      </button>
    </div>
  );
}
