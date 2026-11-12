"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { downloadFrom } from "@/lib/save-file";

/** Downloadknop die ook in de geïnstalleerde app werkt (zie save-file.ts). */
export function PortalDownloadButton({
  href,
  filename,
  label,
  busyLabel = "Bezig…",
  className = "",
}: {
  href: string;
  filename: string;
  label: string;
  busyLabel?: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            await downloadFrom(href, filename);
          } catch (e) {
            setErr(e instanceof Error ? e.message : "Downloaden is niet gelukt.");
          } finally {
            setBusy(false);
          }
        }}
        className={className}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
        {busy ? busyLabel : label}
      </button>
      {err ? <span className="text-[12px] text-[var(--st-red,var(--color-bad))]">{err}</span> : null}
    </span>
  );
}
