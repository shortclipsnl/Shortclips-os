"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print"
      style={{
        position: "fixed",
        top: 20,
        right: 24,
        zIndex: 50,
        background: "#2E90FA",
        color: "#fff",
        border: "none",
        borderRadius: 10,
        padding: "10px 18px",
        fontWeight: 700,
        fontSize: 14,
        cursor: "pointer",
        boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
      }}
    >
      ⬇ Opslaan als PDF
    </button>
  );
}
