import Link from "next/link";
import { ClientLogo } from "@/components/ui";

type Item = { id: string; clientName: string; clientSlug: string; logoUrl: string | null; color: string | null; headline: string; status: string; assigneeName: string | null };

/**
 * Compacte melding op het dashboard: klanten met een rode alert (direct
 * aandacht nodig). Blijft zichtbaar tot de alert is opgepakt én afgehandeld op
 * de Resultatenpagina; daar staan analyse, advies en acties.
 */
export function ResultAlertsBlock({ items, showOwner }: { items: Item[]; showOwner: boolean }) {
  if (!items.length) return null;
  const shown = items.slice(0, 4);
  return (
    <section className="sc-card border-l-[4px] p-4" style={{ borderLeftColor: "var(--color-bad)" }}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-[var(--color-ink)]">
          {items.length === 1 ? "1 klant heeft direct aandacht nodig" : `${items.length} klanten hebben direct aandacht nodig`}
        </h2>
        <Link href="/analytics#aandacht" className="text-xs text-[var(--color-ink-muted)] hover:underline">Bekijk analyse en advies →</Link>
      </div>
      <ul className="divide-y divide-[var(--color-line)]">
        {shown.map((a) => (
          <li key={a.id} className="flex items-center gap-2.5 py-1.5 text-sm">
            <ClientLogo name={a.clientName} logoUrl={a.logoUrl} color={a.color} size={22} />
            <Link href="/analytics#aandacht" className="min-w-0 flex-1 truncate">
              <span className="font-medium">{a.clientName}</span>
              <span className="text-[var(--color-ink-muted)]"> · {a.headline}</span>
            </Link>
            <span className="shrink-0 text-xs font-semibold" style={{ color: a.status === "open" ? "var(--color-bad)" : "var(--color-ink-muted)" }}>
              {a.status === "open" ? "Actie nodig" : "Opgepakt"}
              {showOwner && a.assigneeName ? <span className="font-normal text-[var(--color-ink-faint)]"> · {a.assigneeName.split(" ")[0]}</span> : null}
            </span>
          </li>
        ))}
      </ul>
      {items.length > shown.length ? <Link href="/analytics#aandacht" className="mt-1 block text-xs text-[var(--color-ink-muted)] hover:underline">+ {items.length - shown.length} meer</Link> : null}
    </section>
  );
}
