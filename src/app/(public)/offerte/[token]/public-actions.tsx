"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, PenLine, X } from "lucide-react";
import { acceptQuote, declineQuote, startQuoteSigning } from "@/server/actions/quotes";

/**
 * Actiebalk op de publieke offertepagina: accepteren (+ gekwalificeerd
 * ondertekenen als dat is ingesteld), afwijzen en de PDF downloaden.
 */
export function PublicActions({ token, signingConfigured }: { token: string; signingConfigured: boolean }) {
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<null | "accept" | "decline">(null);
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<null | "accepted" | "declined">(null);

  function accept() {
    setErr(null);
    if (name.trim().length < 2) { setErr("Vul je naam in."); return; }
    start(async () => {
      const r = await acceptQuote({ token, name });
      if (!r.ok) { setErr(r.message ?? "Mislukt."); return; }
      // Als ondertekenen is ingesteld: direct door naar de QES-ondertekenpagina.
      if (r.signingAvailable) {
        const s = await startQuoteSigning(token);
        if (s.ok && s.signUrl) { window.location.href = s.signUrl; return; }
      }
      setDone("accepted");
    });
  }

  function decline() {
    setErr(null);
    start(async () => {
      const r = await declineQuote({ token, reason });
      if (!r.ok) { setErr(r.message ?? "Mislukt."); return; }
      setDone("declined");
    });
  }

  if (done === "accepted") {
    return <div className="rounded-xl bg-[#e7f6ee] px-4 py-3 text-sm font-semibold text-[#1d6b4c]">Bedankt! Je akkoord is geregistreerd. We nemen snel contact op.</div>;
  }
  if (done === "declined") {
    return <div className="rounded-xl bg-[#fdeceb] px-4 py-3 text-sm font-semibold text-[#a3271c]">Je hebt de offerte afgewezen. Bedankt voor je reactie.</div>;
  }

  return (
    <div className="no-print flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <a href={`/api/offertes/${token}/pdf`} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#cfd6e4] bg-white px-4 py-2.5 text-sm font-semibold text-[#1a1d29] hover:bg-[#f6f8fc]">
          PDF downloaden
        </a>
        <button type="button" onClick={() => { setMode("accept"); setErr(null); }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#00003b] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90">
          {signingConfigured ? <><PenLine className="size-4" /> Accepteren & ondertekenen</> : <><Check className="size-4" /> Offerte accepteren</>}
        </button>
        <button type="button" onClick={() => { setMode("decline"); setErr(null); }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#cfd6e4] bg-white px-4 py-2.5 text-sm font-medium text-[#51607a] hover:bg-[#f6f8fc]">
          <X className="size-4" /> Afwijzen
        </button>
      </div>

      {mode === "accept" ? (
        <div className="rounded-xl border border-[#cfd6e4] bg-white p-4">
          <label className="mb-1 block text-xs font-semibold text-[#51607a]">Je volledige naam (voor akkoord)</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Voor- en achternaam"
            className="mb-2 w-full rounded-lg border border-[#cfd6e4] px-3 py-2 text-sm outline-none focus:border-[#00003b]" />
          <p className="mb-3 text-xs text-[#8a94a6]">
            {signingConfigured
              ? "Na akkoord ga je door naar een beveiligde pagina om de offerte met een gekwalificeerde e-handtekening te ondertekenen."
              : "Door te accepteren ga je akkoord met deze offerte en de bijbehorende voorwaarden. We leggen je akkoord met datum en tijd vast."}
          </p>
          <div className="flex items-center gap-2">
            <button type="button" disabled={pending} onClick={accept}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#00003b] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Bevestigen
            </button>
            <button type="button" onClick={() => setMode(null)} className="px-3 py-2 text-sm text-[#51607a]">Annuleren</button>
          </div>
        </div>
      ) : null}

      {mode === "decline" ? (
        <div className="rounded-xl border border-[#cfd6e4] bg-white p-4">
          <label className="mb-1 block text-xs font-semibold text-[#51607a]">Reden (optioneel)</label>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
            className="mb-3 w-full resize-none rounded-lg border border-[#cfd6e4] px-3 py-2 text-sm outline-none focus:border-[#00003b]" />
          <div className="flex items-center gap-2">
            <button type="button" disabled={pending} onClick={decline}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#cfd6e4] px-4 py-2 text-sm font-semibold text-[#a3271c] disabled:opacity-50">
              {pending ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />} Offerte afwijzen
            </button>
            <button type="button" onClick={() => setMode(null)} className="px-3 py-2 text-sm text-[#51607a]">Annuleren</button>
          </div>
        </div>
      ) : null}

      {err ? <p className="text-sm font-medium text-[#a3271c]">{err}</p> : null}
    </div>
  );
}
