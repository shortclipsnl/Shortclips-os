import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { AdviceItem, ContentAdvice } from "@/server/content-memory/advice";

/**
 * Compacte samenvatting van het Contentadvies, voor plekken waar het team aan
 * het werk is (bijv. de Scriptgenerator). Het volledige advies staat in het
 * Contentgeheugen.
 */
export function AdviceBrief({ clientName, clientSlug, advice }: { clientName: string; clientSlug: string; advice: ContentAdvice }) {
  const doen = [...advice.sections.meer, ...advice.sections.blijven].sort((a, b) => b.impact - a.impact).slice(0, 3);
  const laten = advice.sections.minder.slice(0, 2);
  const testen = advice.sections.testen.slice(0, 2);
  if (!doen.length && !laten.length && !testen.length) return null;
  const col = (label: string, tone: string, items: AdviceItem[]) =>
    items.length ? (
      <div className="min-w-0">
        <span className={`inline-flex rounded px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide ${tone}`}>{label}</span>
        <ul className="mt-1.5 flex flex-col gap-1 text-[13px] leading-snug">
          {items.map((i) => <li key={i.key} title={i.application || i.advice}>{i.title}{i.proof === "hypothese" && i.section !== "testen" ? <span className="text-[var(--color-ink-muted)]"> (hypothese)</span> : null}</li>)}
        </ul>
      </div>
    ) : null;
  return (
    <section aria-label="Contentadvies" className="mb-4 rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[14px] font-semibold">Contentadvies {clientName}: neem dit mee in de scripts</h2>
        <Link href={`/contentgeheugen?klant=${clientSlug}&tab=advies`} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-[var(--color-ink-muted)] underline-offset-2 hover:text-[var(--color-ink)] hover:underline">Volledig advies<ArrowRight className="size-3.5" /></Link>
      </div>
      <div className="mt-3 grid gap-4 sm:grid-cols-3">
        {col("Doen", "bg-[var(--color-good-soft)] text-[#1d6b4c]", doen)}
        {col("Laten", "bg-[var(--color-bad-soft)] text-[#a3271c]", laten)}
        {col("Testen", "bg-[var(--color-warn-soft)] text-[#8a5a00]", testen)}
      </div>
      <p className="mt-2.5 text-[11.5px] text-[var(--color-ink-muted)]">De Scriptgenerator past dit advies automatisch toe. Testen gebeurt in hooguit één of twee scripts per sessie.</p>
    </section>
  );
}
