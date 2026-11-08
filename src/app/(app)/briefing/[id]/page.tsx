import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, FileText } from "lucide-react";
import { requireInternal } from "@/server/auth/context";
import { briefingHtml, loadBriefingFor } from "@/server/briefing/access";
import { Badge, PageHeader, buttonClass } from "@/components/ui";
import { BRIEFING_STATUS } from "@/components/briefing-view";
import { formatDateTime } from "@/lib/format";
import type { BriefingStatus } from "@/server/briefing/service";
import { BriefingTeamPanel } from "./team-panel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Editor briefing" };

/**
 * De editor-briefing van één opnamesessie. Dezelfde opmaak als de PDF.
 * Editors: alleen lezen en downloaden. Team Shortclips: ook bijwerken en
 * highlights/omslag corrigeren (blijft staan bij automatische updates).
 */
export default async function BriefingPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireInternal();
  const { id } = await params;
  const loaded = await loadBriefingFor(viewer, id);
  if (!loaded) notFound();
  const { doc, canEdit } = loaded;
  const html = doc.scripts.length ? await briefingHtml(doc, "screen") : null;
  const st = BRIEFING_STATUS[(doc.status as BriefingStatus) ?? "geen"] ?? BRIEFING_STATUS.geen;
  const pdf = `/api/briefing/${id}/pdf`;

  return (
    <div className="mx-auto max-w-[960px]">
      <PageHeader
        breadcrumb={
          <Link href="/videos" className="text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
            ← Editing
          </Link>
        }
        title={`Editor briefing · ${doc.client.name}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={st.tone}>{st.label}</Badge>
            {doc.updatedAt ? <span>Laatst bijgewerkt {formatDateTime(doc.updatedAt)}</span> : null}
          </span>
        }
        actions={
          html ? (
            <>
              <a href={pdf} target="_blank" rel="noreferrer" className={buttonClass({ variant: "secondary", size: "sm" })}>
                <FileText className="size-4" /> PDF bekijken
              </a>
              <a href={`${pdf}?download=1`} className={buttonClass({ variant: "primary", size: "sm" })}>
                <Download className="size-4" /> Downloaden
              </a>
            </>
          ) : null
        }
      />

      {canEdit ? (
        <BriefingTeamPanel
          productionDayId={id}
          highlights={doc.highlights}
          corrected={doc.highlightsCorrected}
          stills={doc.stills.map((s) => ({ id: s.assetId, name: s.name }))}
          coverAssetId={doc.coverAssetId}
          hasBriefing={doc.scripts.length > 0}
        />
      ) : null}

      {html ? (
        <div
          className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-white p-4 text-[#00003b] [color-scheme:light] sm:p-6"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--color-line-strong)] p-6 text-sm text-[var(--color-ink-muted)]">
          <p className="font-medium text-[var(--color-ink)]">Er is nog geen briefing voor deze opname.</p>
          <ul className="mt-2 list-disc pl-5">
            {doc.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          <p className="mt-2">De briefing wordt automatisch gemaakt zodra de script-PDF van deze sessie gekoppeld is.</p>
        </div>
      )}
    </div>
  );
}
