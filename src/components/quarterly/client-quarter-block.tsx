import Link from "next/link";
import { FileBarChart } from "lucide-react";
import { Badge } from "@/components/ui";
import { QUARTER_STATUS_META, kortDatum } from "@/lib/kwartaal";
import type { ClientQuarterSummary } from "@/server/quarterly/service";

/**
 * Blok op de klantpagina: het meest recente kwartaal, de rapportagestatus en de
 * eerstvolgende deadline. Alleen een weergave van de kwartaalrapportages; alle
 * handelingen gebeuren op de rapportagepagina.
 */
export function ClientQuarterBlock({ summary }: { summary: ClientQuarterSummary | null }) {
  if (!summary) return null;
  const meta = QUARTER_STATUS_META[summary.status];
  return (
    <div className="sc-card flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 place-items-center rounded-[10px] bg-[var(--color-surface-sunken)] text-[var(--color-ink-muted)]"><FileBarChart className="size-4" /></span>
        <div>
          <p className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Kwartaalrapportage</p>
          <p className="text-sm font-semibold text-[var(--color-ink)]">{summary.periodLabel}</p>
        </div>
      </div>
      <div>
        <p className="text-2xs text-[var(--color-ink-faint)]">Status</p>
        <span title={meta.uitleg}><Badge tone={meta.tone}>{meta.label}</Badge></span>
        {summary.voorlopig && summary.status === "concept_gegenereerd" ? <span className="ml-1.5 text-2xs text-[#8a5300]">voorlopige cijfers</span> : null}
      </div>
      <div>
        <p className="text-2xs text-[var(--color-ink-faint)]">Eerstvolgende deadline</p>
        {summary.deadline
          ? <p className={`text-sm ${summary.achterstallig ? "font-semibold text-[var(--color-bad)]" : "text-[var(--color-ink)]"}`}>{kortDatum(summary.deadline.datum)} <span className="text-2xs font-normal text-[var(--color-ink-muted)]">· {summary.achterstallig ? "achterstallig" : summary.deadline.label.toLowerCase()}</span></p>
          : <p className="text-sm text-[var(--color-ink-muted)]">Geen, gepubliceerd</p>}
      </div>
      <div>
        <p className="text-2xs text-[var(--color-ink-faint)]">Laatst in klantportaal</p>
        <p className="text-sm text-[var(--color-ink)]">{summary.laatstGepubliceerd ? summary.laatstGepubliceerd.periodLabel : "Nog geen"}</p>
      </div>
      <Link href={`/analytics/kwartaalrapportages/${summary.id}`} className="ml-auto text-sm font-medium text-[var(--color-info)] hover:underline">Rapportage openen</Link>
    </div>
  );
}
