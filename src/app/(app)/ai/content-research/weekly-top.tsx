import Link from "next/link";
import type { WeeklyIdea } from "@/server/content-research/service";
import { ClientBand } from "./idea-card";

/**
 * De sterkste nieuwe ideeën van deze week, per klant gegroepeerd met het
 * klantlogo en de klantkleur bovenaan: in één oogopslag zie je voor wie wat klaarstaat.
 */
export function WeeklyTop({ ideas }: { ideas: WeeklyIdea[] }) {
  if (ideas.length === 0) return null;
  const groups = new Map<string, { client: WeeklyIdea; items: WeeklyIdea[] }>();
  for (const i of ideas) {
    const g = groups.get(i.clientId) ?? { client: i, items: [] };
    g.items.push(i);
    groups.set(i.clientId, g);
  }
  return (
    <section className="mb-6">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-[var(--color-ink)]">Beste nieuwe ideeën deze week</h2>
        <span className="text-2xs text-[var(--color-ink-faint)]">Op Opportunity Score, per klant</span>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {[...groups.values()].map(({ client, items }) => (
          <div key={client.clientId} className="sc-card overflow-hidden">
            <ClientBand client={{ name: client.clientName, logoUrl: client.logoUrl, color: client.color }} />
            <ul className="divide-y divide-[var(--color-line)]">
              {items.map((i) => (
                <li key={i.id}>
                  <Link href={`/ai/content-research/${i.clientId}?tab=ideeen`} className="flex items-start gap-3 px-4 py-2.5 hover:bg-[var(--color-surface-sunken)]">
                    <span className="w-8 shrink-0 text-right text-lg font-semibold tabular-nums text-[var(--color-ink)]">{i.opportunityScore || "–"}</span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-[var(--color-ink)]">{i.titel}</span>
                      {i.hook ? <span className="block text-xs text-[var(--color-ink-muted)]">{i.hook}</span> : null}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
