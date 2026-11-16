"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightCircle, Loader2 } from "lucide-react";
import { prepareQuoteConversion } from "@/server/actions/pandadoc";
import { ConvertDialog } from "../../leads/convert-dialog";

/**
 * Groene knop "Omzetten naar klant" bij een ondertekende offerte. Gebruikt het
 * bestaande omzetvenster van de Leadspagina (controle, klant, Drive, taken,
 * onboarding), zodat er geen tweede proces naast bestaat. Heeft de offerte nog
 * geen lead, dan wordt die eerst uit de PandaDoc-gegevens gemaakt.
 */
export function QuoteConvertButton({ quoteId, autoOpen = false, compact = false }: { quoteId: string; autoOpen?: boolean; compact?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [leadId, setLeadId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const opened = useRef(false);

  const go = () => {
    setErr(null);
    start(async () => {
      const res = await prepareQuoteConversion(quoteId);
      if (!res.ok) return setErr(res.message);
      if ("clientSlug" in res) return router.push(`/clients/${res.clientSlug}?tab=onboarding`);
      setLeadId(res.leadId);
    });
  };

  useEffect(() => {
    if (autoOpen && !opened.current) {
      opened.current = true;
      go();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen]);

  return (
    <>
      <button
        type="button"
        onClick={go}
        disabled={pending}
        className={`inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-good)] font-semibold text-white hover:opacity-90 disabled:opacity-60 ${compact ? "px-2 py-1 text-2xs" : "w-full px-3.5 py-2.5 text-sm"}`}
      >
        {pending ? <Loader2 className={compact ? "size-3.5 animate-spin" : "size-4 animate-spin"} /> : <ArrowRightCircle className={compact ? "size-3.5" : "size-4"} />}
        Omzetten naar klant
      </button>
      {err ? <p className="mt-2 text-xs font-medium text-[var(--color-bad)]">{err}</p> : null}
      {leadId ? <ConvertDialog leadId={leadId} onClose={() => { setLeadId(null); router.refresh(); }} /> : null}
    </>
  );
}
