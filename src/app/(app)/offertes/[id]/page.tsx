import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Download, FileCheck2 } from "lucide-react";
import { requireOwner } from "@/server/auth/context";
import { getQuoteDetail } from "@/server/quotes";
import { publicQuoteLink } from "@/server/quotes/token";
import { getCompanyInfo } from "@/server/quotes/company";
import { signhostConfigured } from "@/server/quotes/signhost";
import { PageHeader } from "@/components/ui";
import { QuoteDocument, QUOTE_DOCUMENT_CSS, type QuoteDocData } from "@/components/quotes/quote-document";
import { QuoteEditor } from "./quote-editor";
import type { QuoteContent } from "@/lib/quotes";

export const metadata: Metadata = { title: "Offerte" };
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  concept: { label: "Concept", color: "var(--color-ink-muted)" },
  verzonden: { label: "Verzonden", color: "var(--color-info)" },
  bekeken: { label: "Bekeken", color: "var(--color-violet)" },
  geaccepteerd: { label: "Geaccepteerd", color: "var(--color-good)" },
  ondertekend: { label: "Ondertekend", color: "var(--color-good)" },
  afgewezen: { label: "Afgewezen", color: "var(--color-bad)" },
  verlopen: { label: "Verlopen", color: "var(--color-warn)" },
};

const EVENT_LABEL: Record<string, string> = {
  created: "Aangemaakt", sent: "Verzonden / link gedeeld", opened: "Geopend door klant",
  accepted: "Geaccepteerd", declined: "Afgewezen", signature_started: "Ondertekenen gestart", signed: "Ondertekend",
};

function dt(d: Date) {
  return new Date(d).toLocaleString("nl-NL", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default async function QuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOwner();
  const { id } = await params;
  const detail = await getQuoteDetail(id);
  if (!detail) notFound();
  const { quote, lines, events } = detail;
  const link = quote.publicToken ? publicQuoteLink(quote.publicToken) : null;
  const company = await getCompanyInfo();
  const status = STATUS_LABEL[quote.status] ?? STATUS_LABEL.concept!;

  const doc: QuoteDocData = {
    number: quote.number, title: quote.title, status: quote.status,
    recipientCompany: quote.recipientCompany, recipientContactName: quote.recipientContactName,
    createdAt: quote.createdAt, content: (quote.content ?? { blocks: [] }) as QuoteContent,
    lines: lines.map((l) => ({ description: l.description, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) })),
    amount: Number(quote.amount), acceptedByName: quote.acceptedByName, acceptedAt: quote.acceptedAt,
  };

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title={<span className="flex items-center gap-2">{quote.title}<span className="rounded-full px-2.5 py-1 text-2xs font-semibold" style={{ background: `color-mix(in srgb, ${status.color} 14%, var(--color-surface))`, color: status.color }}>{status.label}</span></span>}
        breadcrumb={<Link href="/offertes" className="inline-flex items-center gap-1 text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"><ChevronLeft className="size-3.5" /> Terug naar offertes</Link>}
        description={`Offerte ${quote.number}`}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* Editor + preview, of — bij een uit PandaDoc gemigreerde offerte — het
            originele document (alleen-lezen). */}
        <div className="space-y-5">
          {quote.source === "pandadoc" ? (
            <div className="sc-card p-5">
              <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-[var(--color-neutral-soft)] px-2.5 py-1 text-2xs font-semibold text-[var(--color-ink-muted)]">Historische offerte · uit PandaDoc</div>
              <h2 className="text-base font-bold">{quote.title}</h2>
              <p className="mt-1 text-sm text-[var(--color-ink-muted)]">Deze offerte is overgenomen uit PandaDoc en wordt in de originele vorm bewaard (alleen-lezen). Status en document blijven zoals ze waren.</p>
              {quote.originalPdfPath ? (
                <a href={`/api/offertes/file/${quote.id}/original`} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-3.5 py-2 text-sm font-semibold text-white hover:opacity-90"><Download className="size-4" /> Origineel PandaDoc-document (PDF)</a>
              ) : (
                <p className="mt-3 text-sm text-[var(--color-ink-faint)]">Geen origineel PDF beschikbaar voor deze offerte.</p>
              )}
            </div>
          ) : (
            <>
              <QuoteEditor quote={{
                id: quote.id, title: quote.title, status: quote.status, isReadOnly: quote.isReadOnly,
                recipientCompany: quote.recipientCompany, recipientContactName: quote.recipientContactName, recipientEmail: quote.recipientEmail,
                content: (quote.content ?? { blocks: [] }) as QuoteContent,
                lines: doc.lines, notes: quote.notes, link,
              }} />

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-sm font-bold">Voorbeeld</h2>
                  {link ? <a href={`/api/offertes/${quote.publicToken}/pdf`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--color-brand-700)] hover:underline"><Download className="size-3.5" /> PDF</a> : null}
                </div>
                <style dangerouslySetInnerHTML={{ __html: QUOTE_DOCUMENT_CSS }} />
                <div className="max-h-[640px] overflow-auto rounded-xl border border-[var(--color-line)] bg-white">
                  <QuoteDocument company={company} quote={doc} />
                </div>
              </div>
            </>
          )}
        </div>

        {/* Zijkolom: tracking + ondertekening */}
        <aside className="space-y-4">
          <div className="sc-card p-4">
            <h3 className="mb-2 text-sm font-bold">Volgen</h3>
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-[var(--color-ink-muted)]">Eerste opening</dt><dd className="tabular-nums">{quote.firstOpenedAt ? dt(quote.firstOpenedAt) : "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-[var(--color-ink-muted)]">Laatste opening</dt><dd className="tabular-nums">{quote.lastOpenedAt ? dt(quote.lastOpenedAt) : "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-[var(--color-ink-muted)]">Aantal keer bekeken</dt><dd className="tabular-nums">{quote.openCount}×</dd></div>
            </dl>
            <p className="mt-2 text-2xs text-[var(--color-ink-faint)]">Een opening betekent dat de link is geopend — niet per se dat de contactpersoon de offerte zelf heeft gelezen. Onze eigen voorbeeldweergaven tellen niet mee.</p>
          </div>

          {quote.acceptedByName ? (
            <div className="sc-card p-4">
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-[var(--color-good)]"><FileCheck2 className="size-4" /> {quote.status === "ondertekend" ? "Ondertekend" : "Geaccepteerd"}</h3>
              <p className="text-sm">Door <strong>{quote.acceptedByName}</strong>{quote.acceptedAt ? ` op ${dt(quote.acceptedAt)}` : ""}.</p>
              {quote.status === "geaccepteerd" ? (
                <p className="mt-1 text-2xs text-[var(--color-ink-faint)]">Digitale acceptatie met bewijsrecord (naam, tijdstip, inhoud-hash, IP).{signhostConfigured() ? "" : " Gekwalificeerde e-handtekening is nog niet ingesteld."}</p>
              ) : null}
              {quote.signedPdfPath ? <a href={`/api/offertes/file/${quote.id}/signed`} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-brand-700)] hover:underline"><Download className="size-3.5" /> Ondertekend document</a> : null}
              {quote.signingReceiptPath ? <a href={`/api/offertes/file/${quote.id}/receipt`} className="mt-1 block text-xs text-[var(--color-ink-muted)] hover:underline">Ontvangstbewijs</a> : null}
            </div>
          ) : null}

          <div className="sc-card p-4">
            <h3 className="mb-2 text-sm font-bold">Tijdlijn</h3>
            {events.length === 0 ? <p className="text-sm text-[var(--color-ink-muted)]">Nog geen gebeurtenissen.</p> : (
              <ul className="space-y-2">
                {events.map((e) => (
                  <li key={e.id} className="flex items-start gap-2 text-sm">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--color-ink-faint)]" />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{EVENT_LABEL[e.type] ?? e.type}</span>
                      <span className="block text-2xs text-[var(--color-ink-faint)]">{dt(e.occurredAt)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
