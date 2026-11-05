"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload } from "lucide-react";
import type { ClientDocumentKind } from "@/db/schema";

/**
 * Upload of vervang een Klanten Guide / Editing Guide in de centrale bron.
 * Gaat in delen van max. 3 MB (onder de Vercel-limiet per verzoek). Na afronding
 * is de nieuwe versie direct de geldende op alle plekken in het portaal.
 */
export function ClientDocUpload({
  clientId,
  kind,
  variant = "",
  label,
  hasDoc,
}: {
  clientId: string;
  kind: ClientDocumentKind;
  variant?: string;
  label: string;
  hasDoc: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const base = `/api/klantdocumenten/${clientId}/${kind}`;

  async function onFile(file?: File) {
    if (!file) return;
    setMsg(null);
    if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) {
      setMsg({ ok: false, text: "Kies een PDF-bestand." });
      return;
    }
    setBusy(true);
    try {
      const start = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: file.name, byteSize: file.size, contentType: file.type || "application/pdf" }) }).then((r) => r.json());
      if (!start.ok) throw new Error(start.message ?? "Uploaden mislukt.");
      const partSize: number = start.partSize;
      for (let part = 0, off = 0; off < file.size; part++, off += partSize) {
        const res = await fetch(`${base}?asset=${start.assetId}&part=${part}`, { method: "PUT", body: file.slice(off, off + partSize) }).then((r) => r.json());
        if (!res.ok) throw new Error(res.message ?? "Uploaden mislukt.");
      }
      const done = await fetch(base, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assetId: start.assetId, fileName: file.name, variant }) }).then((r) => r.json());
      if (!done.ok) throw new Error(done.message ?? "Afronden mislukt.");
      setMsg({ ok: true, text: "Bijgewerkt. Overal staat nu deze versie." });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Uploaden mislukt." });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-sunken)] disabled:opacity-60"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
        {hasDoc ? `${label} vervangen` : `${label} uploaden`}
      </button>
      <input ref={inputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      {msg ? <span className={`text-xs ${msg.ok ? "text-[#1d6b4c]" : "text-[var(--color-bad)]"}`}>{msg.text}</span> : null}
    </span>
  );
}
