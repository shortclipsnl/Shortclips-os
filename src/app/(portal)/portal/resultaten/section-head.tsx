import type { LucideIcon } from "lucide-react";

const TONES = {
  green: { bg: "var(--st-green-bg)", fg: "var(--st-green)" },
  blue: { bg: "var(--st-blue-bg)", fg: "var(--st-blue)" },
  accent: { bg: "var(--st-blue-bg)", fg: "var(--sc-accent)" },
  orange: { bg: "var(--st-orange-bg)", fg: "var(--st-orange)" },
} as const;

/**
 * Vaste sectiekop van de resultatenpagina: gekleurd icoon, klein label en titel.
 * Zo herkent de klant in één oogopslag welk onderdeel hij bekijkt.
 */
export function SectionHead({
  icon: Icon,
  eyebrow,
  title,
  sub,
  tone = "accent",
  children,
}: {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  sub?: React.ReactNode;
  tone?: keyof typeof TONES;
  children?: React.ReactNode;
}) {
  const t = TONES[tone];
  return (
    <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-[10px]" style={{ background: t.bg, color: t.fg }}>
            <Icon className="size-[18px]" />
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: t.fg }}>{eyebrow}</span>
        </div>
        <h2 className="mt-2 text-[22px] font-bold tracking-tight">{title}</h2>
        {sub ? <p className="mt-1 max-w-2xl text-[13px] text-[var(--color-ink-muted)]">{sub}</p> : null}
      </div>
      {children}
    </div>
  );
}
