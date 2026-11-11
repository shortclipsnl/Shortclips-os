import Link from "next/link";
import { ChevronLeft, Download, ExternalLink, FileText } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { euro } from "@/lib/quotes";
import { allowedManualStatuses, mapPandaDocStatus, pandadocDocumentUrl } from "@/lib/pandadoc";
import { StatusPill, followUpHint } from "../quote-status";
import { LeadPicker, RefreshButton, StatusActions } from "./pandadoc-actions";

type Quote = {
  id: string; number: string; title: string; status: string; externalId: string | null; pandadocStatus: string | null;
  recipientCompany: string | null; recipientContactName: string | null; recipientEmail: string | null;
  amount: string; amountInclVat: string | null; amountSource: string | null; serviceType: string | null;
  createdAt: Date; sentAt: Date | null; firstOpenedAt: Date | null; lastOpenedAt: Date | null; openCount: number;
  acceptedAt: Date | null; declinedAt: Date | null; expiresOn: Date | null; senderName: string | null;
  originalPdfPath: string | null; syncedAt: Date | null; syncError: string | null; leadMatch: string | null;
};
type Event = { id: string; type: string; actor: string | null; occurredAt: Date };
type Lead = { id: string; company: string; status: string; contactName: string | null; email: string | null; phone: string | null } | null;
type Client = { id: string; name: string; slug: string } | null;

const EVENT_LABEL: Record<string, string> = {
  created: "Offerte aangemaakt",
  sent: "Offerte verzonden",
  opened: "Klant heeft de offerte geopend",
  signature: "Klant heeft getekend",
  signed: "Offerte ondertekend",
  declined: "Offerte afgewezen",
  expired: "Offerte verlopen",
};

const dt = (d: Date | null, time = false) =>
  d ? new Date(d).toLocaleString("nl-NL", { day: "numeric", month: "long", year: "numeric", ...(time ? { hour: "2-digit", minute: "2-digit" } : {}) }) : null;

/** Opeenvolgende openingen samenvoegen tot één regel, zodat de tijdlijn compact blijft. */
function compactTimeline(events: Event[]) {
  const asc = [...events].sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
  const out: { key: string; type: string; at: Date; until?: Date; count: number; actor: string | null }[] = [];
  for (const e of asc) {
    const prev = out.at(-1);
    if (prev && prev.type === "opened" && e.type === "opened") { prev.count++; prev.until = e.occurredAt; continue; }
    out.push({ key: e.id, type: e.type, at: e.occurredAt, count: 1, actor: e.actor });
  }
  return out.reverse();
}

export function PandaDocQuoteDetail({ quote, events, lead, client, leads }: { quote: Quote; events: Event[]; lead: Lead; client: Client; leads: { id: string; company: string; status: string }[] }) {
  const status = quote.status === "geaccepteerd" ? "ondertekend" : quote.status;
  const amount = quote.amountSource ? Number(quote.amount) : null;
  const manual = allowedManualStatuses(mapPandaDocStatus(quote.pandadocStatus));
  const hint = followUpHint({ status: status as never, sentAt: quote.sentAt, lastOpenedAt: quote.lastOpenedAt });
  const pdfUrl = `/api/offertes/file/${quote.id}/original`;
  const company = client?.name ?? lead?.company ?? quote.recipientCompany ?? "Onbekende klant";

  return (
    <div className="mx-auto max-w-[1300px]">
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2">{company}<StatusPill status={status} /></span>}
        breadcrumb={<Link href="/offertes" className="inline-flex items-center gap-1 text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"><ChevronLeft className="size-3.5" /> Terug naar offertes</Link>}
        description={`${quote.title} · Nr. ${quote.number}`}
        actions={quote.externalId ? (
          <a href={pandadocDocumentUrl(quote.externalId)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">
            <ExternalLink className="size-4" /> Openen in PandaDoc
          </a>
        ) : null}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* PDF-voorbeeld */}
        <div className="order-2 lg:order-1">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-bold">Offerte</h2>
            {quote.originalPdfPath ? (
              <a href={`${pdfUrl}?download=1`} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--color-brand-700)] hover:underline"><Download className="size-3.5" /> PDF downloaden</a>
            ) : null}
          </div>
          {quote.originalPdfPath ? (
            <iframe src={`${pdfUrl}#view=FitH`} title={`Offerte ${quote.number}`} className="h-[70vh] min-h-[480px] w-full rounded-xl border border-[var(--color-line)] bg-white" />
          ) : (
            <div className="grid h-60 place-items-center rounded-xl border border-dashed border-[var(--color-line-strong)] text-center text-sm text-[var(--color-ink-faint)]">
              <div><FileText className="mx-auto mb-2 size-6" />De PDF is nog niet opgehaald uit PandaDoc.<br />Gebruik &ldquo;Vernieuwen&rdquo; of open de offerte in PandaDoc.</div>
            </div>
          )}
        </div>

        <aside className="order-1 space-y-4 lg:order-2">
          {/* Kerncijfers */}
          <div className="sc-card p-4">
            <div className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Totaalbedrag</div>
            <div className="mt-0.5 text-2xl font-bold tabular-nums">{amount != null ? euro(amount) : <span className="text-base font-semibold text-[var(--color-ink-faint)]">Onbekend</span>}</div>
            <div className="text-2xs text-[var(--color-ink-faint)]">
              {amount != null ? <>excl. btw{quote.amountInclVat ? ` · ${euro(Number(quote.amountInclVat))} incl. btw` : ""}{quote.amountSource === "pdf" ? " · gelezen uit de PDF" : ""}</> : "Niet uit PandaDoc of de PDF te bevestigen; zie de PDF."}
            </div>
            <dl className="mt-3 space-y-1.5 text-sm">
              <Row label="Type" value={quote.serviceType} />
              <Row label="Aangemaakt" value={dt(quote.createdAt)} />
              <Row label="Verzonden" value={dt(quote.sentAt)} />
              <Row label="Geopend" value={quote.firstOpenedAt ? `${dt(quote.firstOpenedAt)} · ${quote.openCount}× bekeken` : quote.sentAt ? "Nog niet" : null} />
              <Row label="Ondertekend" value={dt(quote.acceptedAt)} />
              {status === "afgewezen" ? <Row label="Afgewezen" value={dt(quote.declinedAt)} /> : null}
              <Row label="Vervaldatum" value={dt(quote.expiresOn)} />
              <Row label="Verantwoordelijke" value={quote.senderName} />
            </dl>
            {hint ? <p className="mt-3 rounded-[var(--radius-sm)] bg-[var(--color-warn-soft)] px-2.5 py-1.5 text-xs font-medium text-[#8a5300]">{hint === "Nog niet geopend" ? "Verzonden, maar na 3 dagen nog niet geopend. Even opvolgen." : "Bekeken maar nog niet getekend. Goed moment om op te volgen."}</p> : null}
            {manual.length ? <StatusActions quoteId={quote.id} options={manual} /> : null}
          </div>

          {/* Klant + lead */}
          <div className="sc-card p-4" id="koppelen">
            <h3 className="mb-2 text-sm font-bold">Klant</h3>
            <dl className="space-y-1.5 text-sm">
              <Row label="Bedrijf" value={quote.recipientCompany ?? lead?.company ?? client?.name ?? null} />
              <Row label="Contactpersoon" value={quote.recipientContactName ?? lead?.contactName ?? null} />
              <Row label="E-mail" value={quote.recipientEmail} link={quote.recipientEmail ? `mailto:${quote.recipientEmail}` : undefined} />
              {lead?.phone ? <Row label="Telefoon" value={lead.phone} link={`tel:${lead.phone}`} /> : null}
              {client ? <Row label="Klantdossier" value={client.name} link={`/clients/${client.slug}`} /> : null}
            </dl>
            <div className="mt-3 border-t border-[var(--color-line)] pt-3">
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-semibold">Gekoppelde lead</span>
                {lead ? <Link href={`/leads?lead=${lead.id}`} className="font-semibold text-[var(--color-brand-700)] hover:underline">Naar lead</Link> : null}
              </div>
              <LeadPicker quoteId={quote.id} current={lead?.id ?? null} leads={leads} />
              <p className="mt-1 text-2xs text-[var(--color-ink-faint)]">
                {lead ? (quote.leadMatch === "handmatig" ? "Handmatig gekoppeld." : `Automatisch gekoppeld op ${quote.leadMatch === "email" ? "e-mailadres" : quote.leadMatch === "domein" ? "e-maildomein" : "bedrijfsnaam"}.`) : "Geen zekere match gevonden. Kies de lead hierboven."}
              </p>
            </div>
          </div>

          {/* Tijdlijn */}
          <div className="sc-card p-4">
            <h3 className="mb-2 text-sm font-bold">Klantactiviteit</h3>
            {events.length === 0 ? <p className="text-sm text-[var(--color-ink-muted)]">Nog geen activiteit.</p> : (
              <ol className="relative space-y-2.5 border-l border-[var(--color-line)] pl-3">
                {compactTimeline(events).map((e) => (
                  <li key={e.key} className="text-sm">
                    <span className={`absolute -left-[4.5px] mt-1.5 size-2 rounded-full ${e.type === "signed" || e.type === "signature" ? "bg-[var(--color-good)]" : e.type === "declined" ? "bg-[var(--color-bad)]" : e.type === "opened" ? "bg-[var(--color-violet)]" : "bg-[var(--color-ink-faint)]"}`} />
                    <span className="font-medium">{EVENT_LABEL[e.type] ?? e.type}{e.count > 1 ? ` (${e.count}×)` : ""}</span>
                    <span className="block text-2xs text-[var(--color-ink-faint)]">{dt(e.at, true)}{e.until ? ` t/m ${dt(e.until, true)}` : ""}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 px-1 text-2xs text-[var(--color-ink-faint)]">
            <span>{quote.syncedAt ? `Bijgewerkt uit PandaDoc: ${dt(quote.syncedAt, true)}` : "Nog niet gesynchroniseerd"}</span>
            <RefreshButton quoteId={quote.id} />
          </div>
          {quote.syncError ? <p className="rounded-[var(--radius-sm)] bg-[var(--color-warn-soft)] px-2.5 py-1.5 text-2xs text-[#8a5300]">{quote.syncError}</p> : null}
        </aside>
      </div>
    </div>
  );
}

function Row({ label, value, link }: { label: string; value: string | null | undefined; link?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-[var(--color-ink-muted)]">{label}</dt>
      <dd className="min-w-0 truncate text-right">
        {value ? (link ? <a href={link} className="text-[var(--color-brand-700)] hover:underline">{value}</a> : value) : <span className="text-[var(--color-ink-faint)]">–</span>}
      </dd>
    </div>
  );
}
