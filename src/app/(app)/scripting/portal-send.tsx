"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, RefreshCw, Send } from "lucide-react";
import { createScriptPdfUploadUrl, sendScriptForReview } from "@/server/actions/script-review";
import { Badge } from "@/components/ui";
import type { ScriptingRow } from "@/server/scripting";

const STATUS: Record<string, { label: string; tone: "warn" | "info" | "good" | "neutral" }> = {
  klaar_controle: { label: "Bij klant", tone: "warn" },
  feedback_gegeven: { label: "Feedback", tone: "info" },
  wordt_aangepast: { label: "Aanpassen", tone: "info" },
  opnieuw_controle: { label: "Opnieuw bij klant", tone: "warn" },
  goedgekeurd: { label: "Goedgekeurd", tone: "good" },
};

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

/**
 * Per opname in de scriptingtabel: het script-PDF in het klantportaal zetten.
 * Nog niets verstuurd → "Stuur op in klantportaal"; al wel → de status (klikbaar
 * naar de controle van die scripts) plus "nieuwe versie". Vervangt de losse
 * Scriptcontrole-pagina.
 */
export function PortalSendCell({ row, canWrite }: { row: ScriptingRow; canWrite: boolean }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function pick() {
    setErr(null);
    inputRef.current?.click();
  }

  function onFile(file: File | undefined) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      setErr("Alleen een PDF.");
      return;
    }
    start(async () => {
      try {
        // Grote PDF's: direct naar opslag (langs de 4,5MB-limiet van Vercel).
        const up = await createScriptPdfUploadUrl({ clientId: row.clientId, productionDayId: row.id });
        if (!up.ok) { setErr(up.message ?? "Versturen mislukt."); return; }

        let res;
        if (up.uploadUrl && up.key) {
          const put = await fetch(up.uploadUrl, { method: "PUT", headers: up.headers, body: file });
          if (!put.ok) { setErr("Uploaden mislukt."); return; }
          res = await sendScriptForReview({ clientId: row.clientId, productionDayId: row.id, fileName: file.name, contentType: file.type || "application/pdf", storagePath: up.key, sizeBytes: file.size });
        } else {
          // Geen opslag ingesteld (lokaal) → base64-terugval.
          const base64 = await fileToBase64(file);
          res = await sendScriptForReview({ clientId: row.clientId, productionDayId: row.id, fileName: file.name, contentType: file.type || "application/pdf", base64 });
        }
        if (res.ok) router.refresh();
        else setErr(res.message ?? "Versturen mislukt.");
      } catch {
        setErr("Versturen mislukt.");
      } finally {
        if (inputRef.current) inputRef.current.value = "";
      }
    });
  }

  const meta = row.reviewStatus ? STATUS[row.reviewStatus] ?? { label: row.reviewStatus, tone: "neutral" as const } : null;

  return (
    <div className="flex flex-col items-start gap-1.5">
      <input ref={inputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />

      {row.reviewId && meta ? (
        <>
          <Link href={`/scriptcontrole/${row.reviewId}`} className="inline-flex items-center gap-1.5 hover:underline">
            <Badge tone={meta.tone}>{meta.label}</Badge>
          </Link>
          {canWrite ? (
            <button type="button" onClick={pick} disabled={pending} className="inline-flex items-center gap-1 text-2xs font-semibold text-[var(--color-ink-muted)] hover:text-[var(--color-brand-600)]">
              {pending ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />} Nieuwe versie
            </button>
          ) : null}
        </>
      ) : canWrite ? (
        <button
          type="button"
          onClick={pick}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-brand-600)]/40 bg-[var(--color-brand-50)] px-2.5 py-1 text-xs font-semibold text-[var(--color-brand-600)] hover:bg-[var(--color-brand-100)] disabled:opacity-50"
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />} Stuur op in klantportaal
        </button>
      ) : (
        <span className="text-2xs text-[var(--color-ink-faint)]">—</span>
      )}
      {err ? <span className="text-2xs text-[var(--color-bad)]">{err}</span> : null}
    </div>
  );
}
