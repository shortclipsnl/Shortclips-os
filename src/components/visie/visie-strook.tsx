import Link from "next/link";
import { ArrowRight, Play } from "lucide-react";
import { kaal, principeVanDeWeek, type Visie } from "@/lib/visie/data";

export type VisieBewijs = { clientName: string; title: string; views: number; href: string };

const kort = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(".0", "")} mln` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n));

/**
 * Compacte herinnering onder de begroeting op Vandaag: het kernprincipe van
 * deze week met één praktijkvoorbeeld, en één echt resultaat uit het portaal.
 * Wisselt automatisch op maandag. Eén regel hoog, klikbaar naar Onze visie.
 */
export function VisieStrook({ visie, bewijs, compact = false }: { visie: Visie; bewijs?: VisieBewijs | null; compact?: boolean }) {
  const p = principeVanDeWeek(visie);
  if (!p) return null;
  return (
    <div className="sc-card flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5">
      <Link href={`/visie#principe-${p.nr}`} className="group flex min-w-0 flex-1 items-center gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--color-indigo-ink)] text-sm font-bold text-white">{p.nr}</span>
        <span className="min-w-0">
          <span className="block text-sm text-[var(--color-ink)]">
            <span className="text-[var(--color-ink-muted)]">Deze week werken we volgens: </span>
            <strong className="font-semibold group-hover:underline">{p.titel}</strong>
          </span>
          <span className="block truncate text-xs text-[var(--color-ink-muted)]">{kaal(p.praktijk)}</span>
        </span>
      </Link>
      {!compact && bewijs ? (
        <Link href={bewijs.href} className="flex min-w-0 items-center gap-2.5 border-l border-[var(--color-line)] pl-5 max-sm:border-l-0 max-sm:pl-0">
          <span className="grid size-7 shrink-0 place-items-center rounded-md bg-[var(--color-good-soft)] text-[#1d6b4c]"><Play className="size-3.5" /></span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-[var(--color-ink)]">{bewijs.clientName} · {kort(bewijs.views)} weergaven</span>
            <span className="block max-w-[260px] truncate text-xs text-[var(--color-ink-muted)]">{bewijs.title}</span>
          </span>
        </Link>
      ) : null}
      <Link href="/visie" className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
        Onze visie <ArrowRight className="size-3.5" />
      </Link>
    </div>
  );
}
