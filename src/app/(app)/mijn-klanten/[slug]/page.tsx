import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, BookOpen, Clapperboard, Download, ExternalLink, FileText, Film, Info, Scissors, Send } from "lucide-react";
import { Card, ClientLogo, EmptyState } from "@/components/ui";
import { requireInternal } from "@/server/auth/context";
import { CONTENT_FOCUS_LABEL, getClientLibraryDetail } from "@/server/client-library";
import { ClientDocUpload } from "@/components/client-docs/doc-upload";

export const metadata: Metadata = { title: "Klantinformatie" };
export const dynamic = "force-dynamic";

function fmtDate(d: Date | string | null) {
  if (!d) return null;
  try { return new Date(d).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" }); }
  catch { return null; }
}
function kb(n: number) { return n > 0 ? `${Math.max(1, Math.round(n / 1024))} KB` : ""; }

export default async function KlantInfoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const viewer = await requireInternal();
  const detail = await getClientLibraryDetail(viewer, slug);
  if (!detail) notFound();
  const { client, overDeKlant, richtlijnen, editingAandachtspunten, afspraken, guide, canManage } = detail;
  // Vaste link naar de centrale bron (zelfde PDF als op Klanten en in de Klantenbibliotheek).
  const guideUrl = `/api/klantdocumenten/${client.id}/editing_guide${guide?.variant ? `?v=${encodeURIComponent(guide.variant)}` : ""}`;
  const contentFocusLabel = client.contentFocus ? CONTENT_FOCUS_LABEL[client.contentFocus] ?? client.contentFocus : null;

  return (
    <div className="mx-auto max-w-[1000px]">
      <Link href="/mijn-klanten" className="mb-2 inline-flex items-center gap-1 text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
        <ArrowLeft className="size-4" /> Mijn klanten
      </Link>

      <div className="mb-5 flex items-center gap-3">
        <ClientLogo name={client.name} logoUrl={client.logoUrl} color={client.color} size={48} />
        <div>
          <h1 className="text-xl font-bold text-[var(--color-ink)]">{client.name}</h1>
          <p className="text-sm text-[var(--color-ink-muted)]">
            {[client.sector, client.website].filter(Boolean).join(" · ") || "Klantinformatie voor de montage"}
          </p>
        </div>
      </div>

      {/* A. Contract & afspraken — in één oogopslag wat er per maand speelt. */}
      <Card className="mb-4">
        <h2 className="mb-3 flex items-center gap-1.5 text-base font-bold text-[var(--color-ink)]"><FileText className="size-4" /> Contract &amp; afspraken</h2>
        <div className="grid gap-2.5 sm:grid-cols-3">
          <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-2)] p-3">
            <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]"><Film className="size-3.5" /> Shorts per maand</div>
            <div className="mt-1 text-lg font-bold text-[var(--color-ink)]">{client.monthlyVideoQuota > 0 ? client.monthlyVideoQuota : "—"}</div>
          </div>
          <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-2)] p-3">
            <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]"><Clapperboard className="size-3.5" /> Soort content</div>
            <div className="mt-1 text-sm font-semibold text-[var(--color-ink)]">{contentFocusLabel ?? <span className="font-normal text-[var(--color-ink-faint)]">Nog niet ingesteld</span>}</div>
          </div>
          <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-2)] p-3">
            <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]"><Send className="size-3.5" /> Plaatsen</div>
            <div className="mt-1 text-sm font-semibold text-[var(--color-ink)]">{client.weHandlePosting ? "Shortclips plaatst" : "Klant plaatst zelf"}</div>
          </div>
        </div>
        {client.sector ? (
          <div className="mt-3 text-sm text-[var(--color-ink-muted)]"><span className="font-semibold text-[var(--color-ink)]">Branche:</span> {client.sector}</div>
        ) : null}
        {afspraken.length ? (
          <div className="mt-3">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]"><Scissors className="size-3.5" /> Vaste montageafspraken</div>
            <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--color-ink-muted)]">
              {afspraken.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          </div>
        ) : null}
        <p className="mt-3 text-xs text-[var(--color-ink-faint)]">Deze gegevens komen rechtstreeks uit Klantenbeheer en blijven automatisch actueel.</p>
      </Card>

      {/* B. Over de klant */}
      <Card className="mb-4">
        <h2 className="mb-2 flex items-center gap-1.5 text-base font-bold text-[var(--color-ink)]"><Info className="size-4" /> Over de klant</h2>
        {client.description ? <p className="text-sm leading-relaxed text-[var(--color-ink-muted)]">{client.description}</p> : null}
        {client.attentionNotes ? (
          <div className="mt-3 rounded-[var(--radius-sm)] bg-[var(--color-warn-soft)] px-3 py-2 text-sm text-[#8a5300]">
            <strong>Let op:</strong> {client.attentionNotes}
          </div>
        ) : null}
        {overDeKlant.length ? (
          <div className="mt-3 space-y-2">
            {overDeKlant.map((k, i) => (
              <div key={i}>
                <div className="text-xs font-semibold text-[var(--color-ink)]">{k.title}</div>
                <p className="text-sm text-[var(--color-ink-muted)]">{k.body}</p>
              </div>
            ))}
          </div>
        ) : null}
        {!client.description && !client.attentionNotes && overDeKlant.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-faint)]">Nog geen beschrijving beschikbaar in de kennisbank.</p>
        ) : null}
      </Card>

      {/* B. Editing Guide */}
      <Card padded={false} className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-2 p-5 pb-3">
          <div>
            <h2 className="flex items-center gap-1.5 text-base font-bold text-[var(--color-ink)]"><BookOpen className="size-4" /> Editing Guide</h2>
            <p className="text-xs text-[var(--color-ink-muted)]">
              {guide ? `Meest recente versie · bijgewerkt ${fmtDate(guide.updatedAt)}${guide.sizeBytes ? ` · ${kb(guide.sizeBytes)}` : ""}` : "De belangrijkste informatiebron voor de montage."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {guide ? (
              <>
                <a href={guideUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"><ExternalLink className="size-4" /> Openen</a>
                <a href={`${guideUrl}${guideUrl.includes("?") ? "&" : "?"}download=1`} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-3 py-1.5 text-xs font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-sunken)]"><Download className="size-4" /> Downloaden</a>
              </>
            ) : null}
            {canManage ? <ClientDocUpload clientId={client.id} kind="editing_guide" variant={guide?.variant ?? ""} label="Editing Guide" hasDoc={Boolean(guide)} /> : null}
          </div>
        </div>
        {guide ? (
          <div className="border-t border-[var(--color-line)]">
            <iframe src={guideUrl} title={`Editing Guide ${client.name}`} className="h-[640px] w-full" />
          </div>
        ) : (
          <div className="px-5 pb-5">
            <EmptyState
              title="Nog geen Editing Guide"
              description={canManage ? "Upload de Editing Guide-PDF; editors zien daarna automatisch de meest recente versie." : "Er is nog geen Editing Guide geüpload voor deze klant. Houd voor nu de richtlijnen hieronder aan."}
            />
          </div>
        )}
      </Card>

      {/* C. Editingrichtlijnen */}
      <Card className="mb-4">
        <h2 className="mb-2 flex items-center gap-1.5 text-base font-bold text-[var(--color-ink)]"><Scissors className="size-4" /> Editingrichtlijnen</h2>
        {richtlijnen.length === 0 && editingAandachtspunten.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-faint)]">Nog geen richtlijnen in de kennisbank. De Editing Guide hierboven is leidend.</p>
        ) : (
          <div className="space-y-3">
            {editingAandachtspunten.length ? (
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Aandachtspunten</div>
                <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--color-ink-muted)]">
                  {editingAandachtspunten.map((a, i) => <li key={i}>{a}</li>)}
                </ul>
              </div>
            ) : null}
            {richtlijnen.map((k, i) => (
              <div key={i}>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-[var(--color-ink)]">{k.title}</span>
                  <span className="rounded-full bg-[var(--color-neutral-soft)] px-2 py-0.5 text-2xs font-medium text-[var(--color-ink-muted)]">{k.categoryLabel}</span>
                </div>
                <p className="text-sm text-[var(--color-ink-muted)]">{k.body}</p>
              </div>
            ))}
            <p className="pt-1 text-xs text-[var(--color-ink-faint)]">Deze richtlijnen komen uit de kennisbank. Bij twijfel is de originele Editing Guide leidend.</p>
          </div>
        )}
      </Card>
    </div>
  );
}
