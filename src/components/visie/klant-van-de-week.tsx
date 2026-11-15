import Link from "next/link";
import { Star } from "lucide-react";
import type { Visie } from "@/lib/visie/data";

export type KlantVanDeWeekData = { clientName: string; title: string; views: number } | null;

const kort = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(".0", "")} mln` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n));

/**
 * Vast eerste onderdeel van de teammeeting: Klant van de week. De klant wordt
 * automatisch gekozen uit Resultaten (de best presterende recente video); de
 * vragen komen uit Onze visie. Niemand hoeft iets in te voeren.
 */
export function KlantVanDeWeek({ visie, data }: { visie: Visie; data: KlantVanDeWeekData }) {
  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Star className="size-5 shrink-0 text-[var(--color-warn)]" />
        <h2 className="text-base font-semibold text-[var(--color-ink)]">Klant van de week</h2>
        <span className="text-xs text-[var(--color-ink-faint)]">Vast eerste punt · tien minuten</span>
      </div>
      {data ? (
        <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink)]">
          <strong className="font-semibold">{data.clientName}</strong> · {kort(data.views)} weergaven op &ldquo;{data.title}&rdquo;.{" "}
          <span className="text-[var(--color-ink-muted)]">Automatisch gekozen uit Resultaten.</span>
        </p>
      ) : (
        <p className="mt-2 text-sm text-[var(--color-ink-muted)]">Er zijn deze week nog geen cijfers binnen. Kies samen een klant uit Resultaten.</p>
      )}
      <ol className="mt-3 grid gap-x-6 gap-y-1.5 text-sm leading-snug text-[var(--color-ink)] sm:grid-cols-2">
        {visie.klantVanDeWeek.map((q, i) => (
          <li key={q} className="flex items-start gap-2">
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[var(--color-indigo-ink)] text-[11px] font-bold text-white">{i + 1}</span>
            <span>{q}</span>
          </li>
        ))}
      </ol>
      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold text-[var(--color-ink-muted)]">
        <Link href="/analytics" className="hover:underline">Resultaten</Link>
        <Link href="/contentgeheugen" className="hover:underline">Contentgeheugen</Link>
        <Link href="/analytics/maandrapportages" className="hover:underline">Maandrapportages</Link>
        <Link href="/visie" className="hover:underline">De vijf kernprincipes</Link>
      </p>
    </section>
  );
}
