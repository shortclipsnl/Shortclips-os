"use client";

import Link from "next/link";
import type { WeeklyGroup } from "@/server/content-research/service";
import { ClientBand, IdeaRow } from "./idea-card";

/**
 * "Nieuwe ideeën deze week": per klant een duidelijke kop met logo en naam en
 * daaronder vijf genummerde, ingeklapte ideeën.
 */
export function WeeklyTop({ groups }: { groups: WeeklyGroup[] }) {
  if (groups.length === 0) {
    return (
      <div className="sc-card mb-6 p-5 text-sm text-[var(--color-ink-muted)]">
        Er staan deze week nog geen nieuwe ideeën klaar. Het onderzoek draait elke maandagochtend automatisch.
      </div>
    );
  }
  return (
    <section className="mb-8 space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-[var(--color-ink)]">Nieuwe ideeën deze week</h2>
        <span className="text-xs text-[var(--color-ink-faint)]">Klik een idee open voor de uitwerking</span>
      </div>
      {groups.map((g) => (
        <div key={g.client.id} id={`klant-${g.client.id}`} className="sc-card scroll-mt-4 overflow-hidden">
          <ClientBand
            client={g.client}
            size="lg"
            action={
              <Link href={`/ai/content-research/${g.client.id}?tab=ideeen`} className="rounded-md border border-white/60 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/10">
                Alle ideeën
              </Link>
            }
          />
          <ol className="divide-y divide-[var(--color-line)]">
            {g.ideas.map((idea, n) => (
              <IdeaRow key={idea.id} idea={idea} n={n + 1} clientName={g.client.name} detailsHref={`/ai/content-research/${g.client.id}?tab=ideeen`} />
            ))}
          </ol>
        </div>
      ))}
    </section>
  );
}
