import type { Lesson } from "@/server/result-alert-lessons";

/**
 * "Lessen uit verbeteracties" in het interne Contentgeheugen: wat we bij deze
 * klant hebben aangepast na een alert en of dat aantoonbaar hielp. Alleen
 * gemeten uitkomsten; acties waarvan het effect nog loopt staan erbij met de
 * stand van de meting.
 */
export function MemoryLessons({ lessons }: { lessons: Lesson[] }) {
  if (!lessons.length) return null;
  const fmt = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", year: "numeric" });
  return (
    <section className="mt-6 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <h2 className="text-base font-semibold tracking-tight">Lessen uit verbeteracties</h2>
      <p className="mb-3 text-xs text-[var(--color-ink-muted)]">Wat we na een alert hebben aangepast en wat het opleverde op de video&apos;s daarna. Gaat automatisch mee in de Script Engine.</p>
      <ul className="divide-y divide-[var(--color-line)]">
        {lessons.map((l) => {
          const color = l.verdict === "verbeterd" ? "var(--color-good)" : l.verdict === "verslechterd" ? "var(--color-bad)" : "var(--color-ink-muted)";
          return (
            <li key={l.id} className="grid gap-1 py-2 text-[13px] leading-snug md:grid-cols-[1fr_1fr_220px]">
              <div><span className="text-[var(--color-ink-faint)]">Probleem: </span>{l.problem}{l.platforms.length ? <span className="text-[var(--color-ink-faint)]"> ({l.platforms.join(", ")})</span> : null}</div>
              <div><span className="text-[var(--color-ink-faint)]">Actie: </span>{l.action}</div>
              <div>
                <span className="font-semibold" style={{ color }}>{l.verdictLabel}</span>
                {l.changePct != null ? <span className="text-[var(--color-ink-muted)]"> ({l.changePct > 0 ? "+" : ""}{l.changePct}%)</span> : null}
                {!l.verdict ? <span className="text-[var(--color-ink-faint)]"> · {l.videosAfter} van {l.needed} video&apos;s</span> : null}
                <span className="block text-2xs text-[var(--color-ink-faint)]">afgehandeld {fmt.format(new Date(l.resolvedAt))}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
