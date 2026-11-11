import { Badge, type Tone } from "@/components/ui";

export type AdviceItem = {
  kleur: "doorgaan" | "verbeteren" | "vermijden";
  punt: string;
  bewijs: string;
  zekerheid: "bewezen" | "waarschijnlijk" | "hypothese";
};

const GROUPS: Array<{ kleur: AdviceItem["kleur"]; emoji: string; label: string; cls: string }> = [
  { kleur: "doorgaan", emoji: "🟢", label: "Doorgaan", cls: "border-[var(--color-good)] bg-[var(--color-good-soft)]" },
  { kleur: "verbeteren", emoji: "🟠", label: "Verbeteren", cls: "border-[var(--color-warn)] bg-[var(--color-warn-soft)]" },
  { kleur: "vermijden", emoji: "🔴", label: "Vermijden", cls: "border-[var(--color-bad)] bg-[var(--color-bad-soft)]" },
];

const ZEKERHEID_TONE: Record<AdviceItem["zekerheid"], Tone> = {
  bewezen: "good",
  waarschijnlijk: "info",
  hypothese: "neutral",
};

/**
 * Strategisch advies op basis van de echte resultaten/maandrapportages:
 * 🟢 doorgaan, 🟠 verbeteren, 🔴 vermijden — elk met bewijs en zekerheid.
 */
export function StrategicAdvice({ items }: { items: AdviceItem[] }) {
  if (!items || items.length === 0) return null;

  return (
    <section className="mb-5 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-[var(--color-ink)]">Strategisch advies</h2>
        <p className="text-2xs text-[var(--color-ink-faint)]">Op basis van de echte resultaten en goedgekeurde maandrapportages — met bewijs en zekerheid.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {GROUPS.map((g) => {
          const groepItems = items.filter((i) => i.kleur === g.kleur);
          if (groepItems.length === 0) return null;
          return (
            <div key={g.kleur} className={`rounded-lg border p-3 ${g.cls}`}>
              <p className="mb-2 text-xs font-semibold text-[var(--color-ink)]">
                <span aria-hidden>{g.emoji}</span> {g.label}
              </p>
              <ul className="space-y-2">
                {groepItems.map((i, idx) => (
                  <li key={idx} className="text-xs text-[var(--color-ink)]">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium">{i.punt}</span>
                      <Badge tone={ZEKERHEID_TONE[i.zekerheid]}>{i.zekerheid}</Badge>
                    </div>
                    {i.bewijs ? <p className="mt-0.5 text-[var(--color-ink-muted)]">{i.bewijs}</p> : null}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
