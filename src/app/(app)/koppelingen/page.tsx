import type { Metadata } from "next";
import { Link2, CheckCircle2 } from "lucide-react";
import { requireOwner } from "@/server/auth/context";
import { listLinkSuggestions } from "@/server/link-review";
import { PageHeader, Stat } from "@/components/ui";
import { LinkReview } from "./koppelingen-ui";

export const metadata: Metadata = { title: "Koppelingen" };
export const dynamic = "force-dynamic";

export default async function KoppelingenPage() {
  await requireOwner();
  const { rows, summary } = await listLinkSuggestions();
  const nothingToDo = (summary.open ?? 0) === 0;

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        title="Koppelingen controleren"
        description="De enige plek waar je af en toe iets moet bevestigen: een opgeleverde video aan de juiste opnamedag koppelen als het systeem dat niet zeker wist."
      />

      {/* Duidelijke uitleg: waarom bestaat deze pagina en wat moet je doen. */}
      <div className="mb-5 rounded-[var(--radius-md)] border border-[var(--color-info)]/25 bg-[var(--color-info-soft)]/50 p-4">
        <div className="flex items-start gap-2.5">
          <Link2 className="mt-0.5 size-5 shrink-0 text-[var(--color-info)]" strokeWidth={1.75} />
          <div className="text-sm text-[var(--color-ink)]">
            <p className="font-semibold">Waarvoor is deze pagina?</p>
            <p className="mt-1 text-[var(--color-ink-muted)]">
              Elke video hoort bij een <strong>opnamedag</strong>. Dankzij die koppeling weet de Hub automatisch de
              <strong> deadline</strong> (14 werkdagen na de opname) en komen de video&apos;s op de juiste plek in de planning en bij de klant.
              Meestal koppelt het systeem dit <strong>vanzelf</strong>. Lukt dat niet zeker — bijvoorbeeld bij meerdere opnames vlak na elkaar —
              dan vraagt het hier even om bevestiging.
            </p>
            <p className="mt-2 font-semibold">Wat moet je doen?</p>
            <ul className="mt-1 space-y-0.5 text-[var(--color-ink-muted)]">
              <li className="flex gap-1.5"><span className="text-[var(--color-info)]">•</span><span>Staat er een suggestie? Controleer de voorgestelde opname en klik <strong>Bevestigen</strong> (of <strong>Afwijzen</strong> als het niet klopt).</span></li>
              <li className="flex gap-1.5"><span className="text-[var(--color-info)]">•</span><span>Suggesties met zekerheid <strong>Hoog</strong> kun je in één keer bevestigen met de knop bovenaan.</span></li>
              <li className="flex gap-1.5"><span className="text-[var(--color-info)]">•</span><span>Staat hier niets? Dan is alles gekoppeld en hoef je <strong>niets</strong> te doen.</span></li>
            </ul>
          </div>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-3 gap-3">
        <Stat label="Gekoppeld" value={String(summary.linked ?? 0)} tone="good" />
        <Stat label="Open suggesties" value={String(summary.open ?? 0)} hint={nothingToDo ? "niets te doen" : "wachten op controle"} tone={nothingToDo ? "good" : "warn"} />
        <Stat label="Totaal video's" value={String(summary.total ?? 0)} />
      </div>

      {nothingToDo ? (
        <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-good)]/30 bg-[var(--color-good-soft)]/40 px-5 py-6 text-sm">
          <CheckCircle2 className="size-6 shrink-0 text-[var(--color-good)]" />
          <div>
            <p className="font-semibold">Alles is gekoppeld — je hoeft nu niets te doen.</p>
            <p className="text-[var(--color-ink-muted)]">Zodra er een video opgeleverd wordt die het systeem niet zeker aan een opname kan koppelen, verschijnt hier automatisch een suggestie om te bevestigen.</p>
          </div>
        </div>
      ) : (
        <LinkReview rows={rows} />
      )}
    </div>
  );
}
