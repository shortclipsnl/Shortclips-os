import Link from "next/link";
import { AlertTriangle, Clock, ListChecks, Sunrise, Users } from "lucide-react";
import type { MorningOverview } from "@/server/morning-overview";

function Tile({ href, label, value, tone, icon }: { href: string; label: string; value: number; tone: "bad" | "warn" | "info" | "neutral"; icon: React.ReactNode }) {
  const color = value > 0
    ? (tone === "bad" ? "var(--color-bad)" : tone === "warn" ? "var(--color-warn)" : tone === "info" ? "var(--color-info)" : "var(--color-ink)")
    : "var(--color-ink-muted)";
  return (
    <Link href={href} className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3.5 py-3 transition hover:border-[var(--color-brand-500)]" style={value > 0 ? { boxShadow: `inset 3px 0 0 ${color}` } : undefined}>
      <span className="grid size-9 shrink-0 place-items-center rounded-full" style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-2xl font-bold tabular-nums leading-none" style={{ color }}>{value}</span>
        <span className="mt-0.5 block text-2xs text-[var(--color-ink-muted)]">{label}</span>
      </span>
    </Link>
  );
}

/**
 * Het gebundelde ochtendoverzicht: in één blik wat er vandaag aandacht vraagt —
 * verlopen deadlines, wachten op de klant, je eigen openstaande acties en wie er
 * nu te laat is. Alles doorklikbaar.
 */
export function MorningOverviewCard({ data }: { data: MorningOverview }) {
  const total = data.overdueVideos + data.atClient + data.myOpenTasks;
  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface-2)] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold tracking-tight text-[var(--color-ink)]">
          <Sunrise className="size-4 text-[var(--color-brand-600)]" /> Ochtendoverzicht
        </h2>
        <span className="text-2xs text-[var(--color-ink-faint)]">
          {total === 0 ? "Alles bij — niets staat over de deadline." : "Verlopen deadlines, openstaande acties en aandachtspunten."}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Tile href="/videos?filter=te-laat" label="Video's over de interne deadline" value={data.overdueVideos} tone="bad" icon={<AlertTriangle className="size-4" />} />
        <Tile href="/videos?filter=bij-klant" label="Wacht op klantfeedback" value={data.atClient} tone="warn" icon={<Clock className="size-4" />} />
        <Tile href="/tasks" label="Jouw acties (vandaag / te laat)" value={data.myOpenTasks} tone="info" icon={<ListChecks className="size-4" />} />
        <Tile href="/prestaties" label="Nu te laat (per persoon)" value={data.currentlyLate} tone="bad" icon={<Users className="size-4" />} />
      </div>

      {data.topOverdue.length > 0 ? (
        <ul className="mt-3 space-y-1 border-t border-[var(--color-line)] pt-3">
          {data.topOverdue.map((o) => (
            <li key={o.id}>
              <Link href={`/videos/${o.id}`} className="flex items-center justify-between gap-2 text-sm hover:underline">
                <span className="min-w-0 flex-1 truncate text-[var(--color-ink)]">{o.label}</span>
                <span className="shrink-0 text-2xs font-semibold text-[var(--color-bad)]">{o.daysLate} d te laat</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
