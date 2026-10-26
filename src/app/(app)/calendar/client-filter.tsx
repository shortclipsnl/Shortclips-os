"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, Users } from "lucide-react";
import { ClientLogo } from "@/components/ui";

export type ClientChip = { slug: string; name: string; logoUrl: string | null; color: string | null; href: string; active: boolean };

function chipClass(active: boolean): string {
  const base = "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium";
  return active
    ? `${base} bg-[var(--color-indigo-ink)] text-white`
    : `${base} border border-[var(--color-line-strong)] bg-[var(--color-surface)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]`;
}

/**
 * Klantfilter voor de contentplanning. Standaard ingeklapt — zo blijft de pagina
 * overzichtelijk en zie je niet meteen álle klanten. Eén knop ("Toon alle
 * klanten") klapt de volledige lijst open. De actieve klant (als er één gekozen
 * is) blijft altijd zichtbaar, ook ingeklapt, zodat duidelijk is waarop gefilterd
 * wordt.
 */
export function CalendarClientFilter({
  allHref,
  allActive,
  clients,
  selected,
}: {
  allHref: string;
  allActive: boolean;
  clients: ClientChip[];
  selected: ClientChip | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span className="mr-1 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Klant</span>

      <Link href={allHref} className={chipClass(allActive)}>Alle klanten</Link>

      {/* Gekozen klant blijft zichtbaar, ook als de lijst ingeklapt is. */}
      {selected && !open ? (
        <Link href={selected.href} className={chipClass(true)}>
          <ClientLogo name={selected.name} logoUrl={selected.logoUrl} color={selected.color} size={18} />
          {selected.name}
        </Link>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
        aria-expanded={open}
      >
        <Users className="size-3.5" />
        {open ? "Verberg klanten" : `Toon alle klanten (${clients.length})`}
        <ChevronDown className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <div className="flex w-full flex-wrap items-center gap-2">
          {clients.map((c) => (
            <Link key={c.slug} href={c.href} className={chipClass(c.active)}>
              <ClientLogo name={c.name} logoUrl={c.logoUrl} color={c.color} size={18} />
              {c.name}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
