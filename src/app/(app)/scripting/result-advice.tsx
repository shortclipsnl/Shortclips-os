import Link from "next/link";
import type { Level } from "@/lib/result-alerts";

type Item = { clientId: string; clientName: string; clientSlug: string; level: Level; headline: string; advice: string; hooks: string[] };

/**
 * Advies uit "Klanten die aandacht nodig hebben" op de Scriptingpagina, zodat
 * het team het meeneemt bij de volgende scripts. Ingeklapt en compact: alleen
 * klanten met een lopende alert.
 */
export function ResultAdviceStrip({ items }: { items: Item[] }) {
  if (!items.length) return null;
  return (
    <details className="group mb-4 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 [&::-webkit-details-marker]:hidden">
        <span className="text-sm font-semibold">
          Neem mee in de volgende scripts
          <span className="ml-2 font-normal text-[var(--color-ink-muted)]">{items.length} {items.length === 1 ? "klant" : "klanten"} met een verbeteradvies uit de resultaten</span>
        </span>
        <span className="text-xs text-[var(--color-ink-muted)] group-open:hidden">Tonen</span>
        <span className="hidden text-xs text-[var(--color-ink-muted)] group-open:inline">Verbergen</span>
      </summary>
      <ul className="divide-y divide-[var(--color-line)] border-t border-[var(--color-line)]">
        {items.map((i) => (
          <li key={i.clientId} className="grid gap-1 px-4 py-2.5 text-[13px] leading-snug md:grid-cols-[200px_1fr]">
            <div className="flex items-start gap-2">
              <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: i.level === "rood" ? "var(--color-bad)" : "var(--color-warn)" }} />
              <span>
                <span className="block font-semibold">{i.clientName}</span>
                <span className="text-xs text-[var(--color-ink-muted)]">{i.headline}</span>
              </span>
            </div>
            <div>
              <p className="font-medium">{i.advice}</p>
              {i.hooks.length ? <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">Hooks die eerder werkten: {i.hooks.join(" · ")}</p> : null}
              <p className="mt-0.5 text-xs">
                <Link href={`/contentgeheugen?klant=${i.clientSlug}`} className="text-[var(--color-ink-muted)] hover:underline">Contentgeheugen</Link>
                <span className="text-[var(--color-ink-faint)]"> · </span>
                <Link href="/analytics#aandacht" className="text-[var(--color-ink-muted)] hover:underline">Volledige analyse</Link>
              </p>
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}
