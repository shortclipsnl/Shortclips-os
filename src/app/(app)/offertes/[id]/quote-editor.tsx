"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Link2, Loader2, Plus, Save, Send, Trash2 } from "lucide-react";
import { euro, lineTotal, sumLines, type QuoteContent, type QuoteLineInput } from "@/lib/quotes";
import { markQuoteSent, regenerateQuoteLink, updateQuoteDraft } from "@/server/actions/quotes";

type EditorQuote = {
  id: string;
  title: string;
  status: string;
  isReadOnly: boolean;
  recipientCompany: string | null;
  recipientContactName: string | null;
  recipientEmail: string | null;
  content: QuoteContent;
  lines: QuoteLineInput[];
  notes: string | null;
  link: string | null;
};

/** Haalt de voorwaarden-tekst uit het inhoudsmodel (eerste terms-blok). */
function termsOf(content: QuoteContent): string {
  const t = content.blocks?.find((b) => b.type === "terms");
  return t && t.type === "terms" ? t.text : "";
}

export function QuoteEditor({ quote }: { quote: EditorQuote }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [title, setTitle] = useState(quote.title);
  const [company, setCompany] = useState(quote.recipientCompany ?? "");
  const [contact, setContact] = useState(quote.recipientContactName ?? "");
  const [email, setEmail] = useState(quote.recipientEmail ?? "");
  const [intro, setIntro] = useState(quote.content.intro ?? "");
  const [terms, setTerms] = useState(termsOf(quote.content));
  const [notes, setNotes] = useState(quote.notes ?? "");
  const [lines, setLines] = useState<QuoteLineInput[]>(quote.lines.length ? quote.lines : [{ description: "", quantity: 1, unitPrice: 0 }]);

  const readOnly = quote.isReadOnly || ["geaccepteerd", "ondertekend"].includes(quote.status);
  const total = sumLines(lines.filter((l) => l.description.trim()));

  function buildContent(): QuoteContent {
    // Behoud de sjabloonstructuur; vervang alleen intro + de eerste voorwaarden.
    let termsReplaced = false;
    const blocks = (quote.content.blocks ?? []).map((b) => {
      if (b.type === "terms" && !termsReplaced) { termsReplaced = true; return { ...b, text: terms }; }
      return b;
    });
    if (!termsReplaced && terms.trim()) blocks.push({ type: "terms", title: "Voorwaarden", text: terms });
    return { ...quote.content, intro, blocks };
  }

  function save(after?: () => void) {
    setMsg(null);
    start(async () => {
      const res = await updateQuoteDraft({
        id: quote.id, title, recipientCompany: company, recipientContactName: contact, recipientEmail: email,
        content: buildContent(), lines: lines.filter((l) => l.description.trim()), notes,
      });
      if (!res.ok) { setMsg(res.message ?? "Opslaan mislukt."); return; }
      setMsg("Opgeslagen.");
      router.refresh();
      after?.();
    });
  }

  function sendAndLink() {
    // Eerst opslaan, dan link genereren + status verzonden.
    save(() => {
      start(async () => {
        const res = await markQuoteSent(quote.id);
        if (res.ok && res.link) {
          navigator.clipboard?.writeText(res.link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
          setMsg("Link gegenereerd en gekopieerd. De offerte staat op 'verzonden'.");
          router.refresh();
        } else setMsg(res.message ?? "Mislukt.");
      });
    });
  }

  function copyExisting() {
    if (!quote.link) return;
    navigator.clipboard?.writeText(quote.link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
  }

  const setLine = (i: number, patch: Partial<QuoteLineInput>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <div className="space-y-4">
      {/* Actiebalk */}
      <div className="sc-card flex flex-wrap items-center gap-2 p-3">
        {!readOnly ? (
          <button type="button" disabled={pending} onClick={() => save()} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-3 py-1.5 text-sm font-semibold hover:bg-[var(--color-surface-sunken)] disabled:opacity-50">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Opslaan
          </button>
        ) : null}
        {!readOnly ? (
          <button type="button" disabled={pending} onClick={sendAndLink} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
            <Send className="size-4" /> {quote.link ? "Opslaan & link bijwerken" : "Genereer link & markeer verzonden"}
          </button>
        ) : null}
        {quote.link ? (
          <>
            <button type="button" onClick={copyExisting} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--color-surface-sunken)]">
              {copied ? <span className="text-[var(--color-good)]">✓ Gekopieerd</span> : <><Copy className="size-4" /> Link kopiëren</>}
            </button>
            <a href={quote.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--color-surface-sunken)]"><Link2 className="size-4" /> Bekijk als klant</a>
            <button type="button" disabled={pending} onClick={() => start(async () => { const r = await regenerateQuoteLink(quote.id); if (r.ok) { setMsg("Nieuwe link gemaakt (de oude werkt niet meer)."); router.refresh(); } })} className="text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">Nieuwe link</button>
          </>
        ) : null}
        {msg ? <span className="ml-auto text-xs text-[var(--color-ink-muted)]">{msg}</span> : null}
      </div>

      {readOnly ? (
        <div className="sc-card p-4 text-sm text-[var(--color-ink-muted)]">
          Deze offerte is {quote.status === "ondertekend" ? "ondertekend" : "geaccepteerd"} en daarom vergrendeld. De inhoud blijft ongewijzigd als bewijs.
        </div>
      ) : (
        <>
          <div className="sc-card space-y-3 p-4">
            <div>
              <label className="sc-label">Offertenaam</label>
              <input className="sc-input" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div><label className="sc-label">Bedrijf</label><input className="sc-input" value={company} onChange={(e) => setCompany(e.target.value)} /></div>
              <div><label className="sc-label">Contactpersoon</label><input className="sc-input" value={contact} onChange={(e) => setContact(e.target.value)} /></div>
              <div><label className="sc-label">E-mail (voor ondertekenen)</label><input className="sc-input" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            </div>
            <div><label className="sc-label">Introtekst</label><textarea className="sc-input min-h-[90px]" value={intro} onChange={(e) => setIntro(e.target.value)} /></div>
          </div>

          <div className="sc-card p-4">
            <div className="mb-2 flex items-center justify-between">
              <label className="sc-label mb-0">Regels (diensten & prijzen)</label>
              <span className="text-sm font-semibold tabular-nums">Totaal: {euro(total)}</span>
            </div>
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input className="sc-input flex-1" placeholder="Omschrijving" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} />
                  <input className="sc-input w-16 text-right" type="number" min={0} value={l.quantity} onChange={(e) => setLine(i, { quantity: Number(e.target.value) })} title="Aantal" />
                  <input className="sc-input w-24 text-right" type="number" min={0} step="0.01" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: Number(e.target.value) })} title="Prijs per stuk" />
                  <span className="w-24 text-right text-sm tabular-nums text-[var(--color-ink-muted)]">{euro(lineTotal(l))}</span>
                  <button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="grid size-7 place-items-center rounded text-[var(--color-ink-faint)] hover:text-[var(--color-bad)]"><Trash2 className="size-3.5" /></button>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setLines((ls) => [...ls, { description: "", quantity: 1, unitPrice: 0 }])} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-brand-700)] hover:underline"><Plus className="size-3.5" /> Regel toevoegen</button>
          </div>

          <div className="sc-card space-y-3 p-4">
            <div><label className="sc-label">Voorwaarden</label><textarea className="sc-input min-h-[80px]" value={terms} onChange={(e) => setTerms(e.target.value)} /></div>
            <div><label className="sc-label">Interne notitie (niet zichtbaar voor de klant)</label><textarea className="sc-input min-h-[60px]" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          </div>
        </>
      )}
    </div>
  );
}
