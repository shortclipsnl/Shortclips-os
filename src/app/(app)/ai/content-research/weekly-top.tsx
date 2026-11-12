import Link from "next/link";
import { Badge } from "@/components/ui";
import type { WeeklyIdea } from "@/server/content-research/service";

/** De sterkste nieuwe ideeën van deze week over alle eigen klanten. */
export function WeeklyTop({ ideas }: { ideas: WeeklyIdea[] }) {
  if (ideas.length === 0) return null;
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-[var(--color-ink)]">Beste nieuwe ideeën deze week</h2>
        <span className="text-2xs text-[var(--color-ink-faint)]">Op Opportunity Score, gespreid over klanten</span>
      </div>
      <div className="sc-card divide-y divide-[var(--color-line)]">
        {ideas.map((i) => (
          <Link
            key={i.id}
            href={`/ai/content-research/${i.clientId}?tab=ideeen`}
            className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--color-surface-sunken)]"
          >
            <span className="w-9 shrink-0 text-right text-lg font-semibold tabular-nums text-[var(--color-ink)]">{i.opportunityScore || "–"}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-[var(--color-ink)]">{i.titel}</span>
              {i.hook ? <span className="block truncate text-xs text-[var(--color-ink-muted)]">{i.hook}</span> : null}
            </span>
            <Badge tone="neutral" className="hidden sm:inline-flex">{i.categorie}</Badge>
            <span className="w-36 shrink-0 truncate text-right text-xs text-[var(--color-ink-muted)]">{i.clientName}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
