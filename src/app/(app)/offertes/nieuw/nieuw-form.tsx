"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { createQuote } from "@/server/actions/quotes";

type Opt = { id: string; name?: string; company?: string };

export function NieuwOfferteForm({ templates, clients, leads }: { templates: { id: string; name: string }[]; clients: Opt[]; leads: Opt[] }) {
  const [templateId, setTemplateId] = useState("");
  const [recipientKind, setRecipientKind] = useState<"client" | "lead" | "none">(clients.length ? "client" : "none");
  const [clientId, setClientId] = useState("");
  const [leadId, setLeadId] = useState("");
  const [title, setTitle] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function submit() {
    setErr(null);
    if (!title.trim()) { setErr("Geef de offerte een naam."); return; }
    start(async () => {
      const res = await createQuote({
        title,
        templateId: templateId || undefined,
        clientId: recipientKind === "client" && clientId ? clientId : undefined,
        leadId: recipientKind === "lead" && leadId ? leadId : undefined,
      });
      if (res.ok && res.id) router.push(`/offertes/${res.id}`);
      else setErr(res.message ?? "Mislukt.");
    });
  }

  return (
    <div className="sc-card space-y-4 p-5">
      <div>
        <label className="sc-label">Offertenaam</label>
        <input className="sc-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="bijv. Maandelijkse samenwerking — social video" autoFocus />
      </div>

      <div>
        <label className="sc-label">Sjabloon</label>
        {templates.length ? (
          <select className="sc-input" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">Leeg (zonder sjabloon)</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        ) : (
          <p className="text-sm text-[var(--color-ink-muted)]">Nog geen sjablonen. <Link href="/offertes/sjablonen" className="text-[var(--color-brand-700)] hover:underline">Maak er eerst één</Link>, of ga verder zonder.</p>
        )}
      </div>

      <div>
        <label className="sc-label">Voor wie</label>
        <div className="mb-2 flex flex-wrap gap-1">
          {(["client", "lead", "none"] as const).map((k) => (
            <button key={k} type="button" onClick={() => setRecipientKind(k)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${recipientKind === k ? "bg-[var(--color-indigo-ink)] text-white" : "bg-[var(--color-neutral-soft)] text-[var(--color-ink-muted)]"}`}>
              {k === "client" ? "Bestaande klant" : k === "lead" ? "Lead" : "Handmatig invullen"}
            </button>
          ))}
        </div>
        {recipientKind === "client" ? (
          <select className="sc-input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Kies een klant…</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        ) : recipientKind === "lead" ? (
          <select className="sc-input" value={leadId} onChange={(e) => setLeadId(e.target.value)}>
            <option value="">Kies een lead (offertefase)…</option>
            {leads.map((l) => <option key={l.id} value={l.id}>{l.company}</option>)}
          </select>
        ) : (
          <p className="text-xs text-[var(--color-ink-muted)]">De ontvangergegevens vul je zo op de offerte zelf in.</p>
        )}
      </div>

      {err ? <p className="text-sm font-medium text-[var(--color-bad)]">{err}</p> : null}

      <div className="flex items-center gap-2">
        <button type="button" disabled={pending} onClick={submit}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {pending ? <Loader2 className="size-4 animate-spin" /> : null} Offerte aanmaken
        </button>
        <Link href="/offertes" className="px-3 py-2 text-sm text-[var(--color-ink-muted)]">Annuleren</Link>
      </div>
    </div>
  );
}
