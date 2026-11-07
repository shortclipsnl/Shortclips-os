"use client";

import { useState } from "react";
import { Loader2, MessageCircle } from "lucide-react";
import { buttonClass } from "@/components/ui";

/**
 * Deelt een PDF via WhatsApp. Op telefoons (en browsers die bestanden kunnen
 * delen) opent het deelmenu met de PDF erbij. Elders wordt de PDF gedownload en
 * opent WhatsApp met een kant-en-klaar bericht, waar de PDF in gesleept kan worden.
 */
export function SharePdfButton({ url, fileName, text, disabled, title }: { url: string; fileName: string; text: string; disabled?: boolean; title?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function share() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("De PDF kon niet worden gemaakt.");
      const blob = await res.blob();
      const file = new File([blob], fileName, { type: "application/pdf" });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.canShare?.({ files: [file] }) && nav.share) {
        try {
          await nav.share({ files: [file], title: fileName, text });
          return;
        } catch (e) {
          if ((e as Error)?.name === "AbortError") return; // zelf geannuleerd
        }
      }
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
    } catch (e) {
      setError((e as Error)?.message ?? "Delen mislukt.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col">
      <button type="button" onClick={share} disabled={disabled || busy} title={title} className={buttonClass({ variant: "secondary", size: "sm" })}>
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <MessageCircle className="size-3.5" />} Delen via WhatsApp
      </button>
      {error ? <span className="mt-1 text-2xs text-[var(--color-bad)]">{error}</span> : null}
    </span>
  );
}
