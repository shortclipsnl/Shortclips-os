"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload } from "lucide-react";
import { uploadEditingGuide } from "@/server/actions/client-library";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^;]+;base64,/, ""));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/** Upload/vervang de Editing Guide — alleen voor interne beheerders. */
export function EditingGuideUpload({ clientId, hasGuide }: { clientId: string; hasGuide: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function onFile(file?: File) {
    if (!file) return;
    setMsg(null);
    if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) { setMsg("Kies een PDF-bestand."); return; }
    start(async () => {
      const base64 = await fileToBase64(file);
      const res = await uploadEditingGuide(clientId, { fileName: file.name, base64, contentType: file.type || "application/pdf", sizeBytes: file.size });
      if (res.ok) router.refresh();
      else setMsg(res.message ?? "Uploaden mislukt.");
    });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-sunken)] disabled:opacity-60"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
        {hasGuide ? "Nieuwe versie uploaden" : "Editing Guide uploaden"}
      </button>
      <input ref={inputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      {msg ? <span className="text-xs text-[var(--color-bad)]">{msg}</span> : null}
    </div>
  );
}
