import { AlertTriangle, CheckCircle2, Info, Lightbulb } from "lucide-react";
import type { Highlight } from "./highlights";
import { SectionHead } from "./section-head";

const STYLE: Record<Highlight["tone"], { bg: string; fg: string; icon: typeof CheckCircle2 }> = {
  positief: { bg: "var(--st-green-bg)", fg: "var(--st-green)", icon: CheckCircle2 },
  aandacht: { bg: "var(--st-orange-bg)", fg: "var(--st-orange)", icon: AlertTriangle },
  neutraal: { bg: "var(--st-blue-bg)", fg: "var(--st-blue)", icon: Info },
};

function Item({ h }: { h: Highlight }) {
  const s = STYLE[h.tone];
  const Icon = s.icon;
  return (
    <li className="flex gap-3 rounded-[14px] border-l-[3px] p-3.5" style={{ background: s.bg, borderLeftColor: s.fg }}>
      <Icon className="mt-0.5 size-5 shrink-0" style={{ color: s.fg }} />
      <div className="min-w-0">
        <div className="text-[15px] font-bold leading-snug">{h.figure}</div>
        <div className="mt-0.5 text-[13px] text-[var(--color-ink-muted)]">{h.text}</div>
      </div>
    </li>
  );
}

/**
 * "Wat valt op?" in één oogopslag: groen met vinkje voor successen, blauw voor
 * feiten, oranje voor aandachtspunten. Alleen punten uit de echte cijfers.
 */
export function WatValtOp({ items }: { items: Highlight[] }) {
  if (!items.length) return null;
  const good = items.filter((i) => i.tone !== "aandacht");
  const attention = items.filter((i) => i.tone === "aandacht");
  return (
    <section className="sc-glass p-5 sm:p-6">
      <SectionHead icon={Lightbulb} eyebrow="In één oogopslag" title="Wat valt op?" tone="green" sub="De opvallendste punten uit jullie cijfers van deze periode." />
      <div className={`grid gap-5 ${attention.length ? "lg:grid-cols-[3fr_2fr]" : ""}`}>
        {good.length ? (
          <div>
            <h3 className="mb-2.5 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-[var(--st-green)]"><CheckCircle2 className="size-4" /> Wat goed gaat</h3>
            <ul className={`grid gap-2.5 ${attention.length ? "" : "sm:grid-cols-2"}`}>{good.map((h, i) => <Item key={i} h={h} />)}</ul>
          </div>
        ) : null}
        {attention.length ? (
          <div>
            <h3 className="mb-2.5 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-[var(--st-orange)]"><AlertTriangle className="size-4" /> Aandachtspunten</h3>
            <ul className="grid gap-2.5">{attention.map((h, i) => <Item key={i} h={h} />)}</ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
