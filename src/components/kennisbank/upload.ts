"use client";

const PART = 3 * 1024 * 1024;

export type UploadedAsset = { id: string; kind: string; fileName: string; contentType: string; url: string };

/** Uploadt een bestand in delen van 3 MB (binnen de serverless limieten). */
export async function uploadKbFile(file: File, onProgress?: (pct: number) => void): Promise<UploadedAsset> {
  const contentType = file.type || "application/octet-stream";
  const init = await fetch("/api/kennisbank/assets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: file.name, contentType, byteSize: file.size }),
  }).then((r) => r.json());
  if (!init.ok) throw new Error(init.message ?? "Upload mislukt.");
  const parts = Math.max(1, Math.ceil(file.size / PART));
  for (let i = 0; i < parts; i++) {
    const blob = file.slice(i * PART, (i + 1) * PART);
    let attempt = 0;
    for (;;) {
      const res = await fetch(`/api/kennisbank/assets/${init.id}?part=${i}`, { method: "PUT", body: blob });
      if (res.ok) break;
      if (++attempt >= 3) throw new Error("Upload van een deel mislukt. Probeer het opnieuw.");
    }
    onProgress?.(Math.round(((i + 1) / parts) * 100));
  }
  const done = await fetch(`/api/kennisbank/assets/${init.id}/complete`, { method: "POST" }).then((r) => r.json());
  if (!done.ok) throw new Error(done.message ?? "Upload kon niet worden afgerond.");
  return { id: init.id, kind: init.kind, fileName: file.name, contentType, url: `/api/kennisbank/assets/${init.id}` };
}
