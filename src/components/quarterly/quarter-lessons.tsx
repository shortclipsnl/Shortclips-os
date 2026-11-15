import type { QuarterLesson } from "@/server/quarterly/service";

const KIND: Record<string, string> = { vaker: "Vaker maken", minder: "Minder vaak maken", onderwerp: "Onderwerp", hook: "Hook", format: "Format", lengte: "Videolengte", presentator: "Presentator", doelgroep: "Doelgroep" };
const ZEK: Record<string, string> = { bewezen: "Volgt uit de cijfers", waarschijnlijk: "Waarschijnlijk", hypothese: "Vermoeden" };

/**
 * "Inzichten uit de kwartaalrapportage" in het interne Contentgeheugen: de
 * lessen uit de laatste goedgekeurde kwartaalrapportages. Worden pas vastgelegd
 * nadat een medewerker de rapportage heeft goedgekeurd en gaan daarna
 * automatisch mee in de Script Engine.
 */
export function QuarterLessons({ lessons }: { lessons: QuarterLesson[] }) {
  if (!lessons.length) return null;
  const perioden = [...new Set(lessons.map((l) => l.periodLabel))].slice(0, 2);
  return (
    <section className="mt-6 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <h2 className="text-base font-semibold tracking-tight">Inzichten uit de kwartaalrapportage</h2>
      <p className="mb-3 text-xs text-[var(--color-ink-muted)]">Door het team goedgekeurde lessen per kwartaal. Gaan automatisch mee in de Script Engine. Een vermoeden is nog geen bewezen patroon.</p>
      <div className="grid gap-4 md:grid-cols-2">
        {perioden.map((p) => (
          <div key={p}>
            <p className="mb-1.5 text-xs font-semibold text-[var(--color-ink)]">{p}</p>
            <ul className="flex flex-col gap-1.5 text-[13px] leading-snug">
              {lessons.filter((l) => l.periodLabel === p).map((l) => (
                <li key={l.id}><span className="text-[var(--color-ink-faint)]">{KIND[l.kind] ?? "Les"}: </span>{l.text}{l.zekerheid !== "bewezen" ? <span className="ml-1 text-2xs text-[var(--color-ink-faint)]">({ZEK[l.zekerheid] ?? l.zekerheid})</span> : null}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
