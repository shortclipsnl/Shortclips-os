import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CalendarRange, Film, Scissors, TrendingDown } from "lucide-react";
import { Card, CardHeader, ClientLogo, EmptyState, PageHeader, Stat, TeamAvatar } from "@/components/ui";
import { requireInternal } from "@/server/auth/context";
import { getContentHealth, getOverloadedPeople, PILLAR_LABEL, type HealthLevel, type PillarKey } from "@/server/content-health";

export const metadata: Metadata = { title: "Contentgezondheid" };
export const dynamic = "force-dynamic";

const DOT: Record<HealthLevel, string> = { groen: "var(--color-good)", oranje: "var(--color-warn)", rood: "var(--color-bad)" };
const LABEL: Record<HealthLevel, string> = { groen: "Gezond", oranje: "Aandacht", rood: "Actie nodig" };
const PILLAR_ICON: Record<PillarKey, typeof CalendarRange> = {
  planning: CalendarRange,
  resultaten: TrendingDown,
  variatie: Film,
  productie: Scissors,
};

export default async function ContentgezondheidPage() {
  await requireInternal();
  const [overview, overloaded] = await Promise.all([getContentHealth(), getOverloadedPeople()]);
  const { rows, counts } = overview;
  const aandacht = rows.filter((r) => r.status !== "groen");

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="Contentgezondheid per klant"
        description="Automatische check die per klant proactief aangeeft of planning, resultaten, variatie en productie op orde zijn — vóórdat de klant een probleem merkt. Alle cijfers komen uit het portaal; waar data ontbreekt wordt die pijler niet beoordeeld."
      />

      {/* Statusverdeling */}
      <div className="mb-5 grid grid-cols-3 gap-3">
        <Stat label="Gezond" value={String(counts.groen)} tone="good" />
        <Stat label="Aandacht" value={String(counts.oranje)} tone="warn" />
        <Stat label="Actie nodig" value={String(counts.rood)} tone="bad" />
      </div>

      {/* Klanten die aandacht vragen (worst-first); gezonde klanten onderaan compact. */}
      <Card padded={false} className="mb-5">
        <CardHeader title="Klanten die aandacht vragen" subtitle="Gesorteerd op urgentie. Elk punt toont de oorzaak én een concreet voorstel." className="p-5 pb-2" />
        {aandacht.length === 0 ? (
          <EmptyState title="Alles op groen" description="Geen enkele actieve klant vraagt nu om aandacht. Netjes." />
        ) : (
          <ul className="divide-y divide-[var(--color-line)]">
            {aandacht.map((c) => (
              <li key={c.clientId} className="p-5" style={{ boxShadow: `inset 3px 0 0 ${DOT[c.status]}` }}>
                <div className="flex flex-wrap items-center gap-3">
                  <Link href={`/clients/${c.slug}`} className="flex items-center gap-2 font-semibold hover:underline">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: DOT[c.status] }} />
                    <ClientLogo name={c.name} logoUrl={c.logoUrl} color={c.color} size={24} />
                    {c.name}
                  </Link>
                  <span className="rounded-full px-2 py-0.5 text-2xs font-semibold" style={{ background: `color-mix(in srgb, ${DOT[c.status]} 14%, transparent)`, color: DOT[c.status] }}>
                    {LABEL[c.status]}
                  </span>
                  {c.coordinatorName ? (
                    <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-[var(--color-ink-muted)]">
                      <TeamAvatar name={c.coordinatorName} size={20} /> {c.coordinatorName}
                    </span>
                  ) : (
                    <span className="ml-auto text-xs text-[var(--color-bad)]">Geen verantwoordelijke</span>
                  )}
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {c.factors.map((f, i) => {
                    const Icon = PILLAR_ICON[f.pijler];
                    const col = f.level === "actie" ? "var(--color-bad)" : "var(--color-warn)";
                    return (
                      <div key={i} className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-sunken)] p-3 text-sm">
                        <div className="flex items-center gap-2 font-medium">
                          <Icon className="size-4 shrink-0" style={{ color: col }} />
                          <span>{f.titel}</span>
                          <span className="ml-auto text-2xs uppercase tracking-wide text-[var(--color-ink-faint)]">{PILLAR_LABEL[f.pijler]}</span>
                        </div>
                        <p className="mt-1 text-[var(--color-ink-muted)]">{f.oorzaak}</p>
                        <p className="mt-1 text-[var(--color-ink-muted)]"><strong className="font-semibold text-[var(--color-ink)]">Voorstel:</strong> {f.voorstel}</p>
                      </div>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Overbelaste medewerkers — hulp herverdelen vóór deadlines sneuvelen. */}
      {overloaded.length > 0 ? (
        <Card padded={false} className="mb-5">
          <CardHeader title="Medewerkers die hulp kunnen gebruiken" subtitle="Gecombineerd uit werklast (edits/opnames) en taken over de deadline. Overweeg werk te herverdelen." className="p-5 pb-2" />
          <ul className="divide-y divide-[var(--color-line)]">
            {overloaded.map((p) => (
              <li key={p.userId} className="flex flex-wrap items-center gap-3 p-5" style={{ boxShadow: `inset 3px 0 0 ${p.level === "kritiek" ? "var(--color-bad)" : "var(--color-warn)"}` }}>
                <TeamAvatar name={p.name} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{p.name}</span>
                    {p.role ? <span className="text-xs text-[var(--color-ink-faint)]">{p.role}</span> : null}
                    <span className="rounded-full px-2 py-0.5 text-2xs font-semibold" style={{ background: p.level === "kritiek" ? "var(--color-bad-soft)" : "var(--color-warn-soft)", color: p.level === "kritiek" ? "var(--color-bad)" : "var(--color-warn)" }}>
                      {p.level === "kritiek" ? "Kritiek" : "Hoog"}
                    </span>
                  </div>
                  <p className="mt-0.5 text-sm text-[var(--color-ink-muted)]">{p.reasons.join(" ")}</p>
                </div>
                {p.occupancy != null ? <span className="text-right text-sm font-semibold tabular-nums" style={{ color: p.level === "kritiek" ? "var(--color-bad)" : "var(--color-warn)" }}>{p.occupancy}%</span> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* Gezonde klanten — compact, zodat het overzicht compleet is. */}
      {rows.length > aandacht.length ? (
        <Card>
          <CardHeader title="Gezonde klanten" subtitle="Deze klanten vragen nu geen actie." />
          <div className="mt-3 flex flex-wrap gap-2">
            {rows.filter((r) => r.status === "groen").map((c) => (
              <Link key={c.clientId} href={`/clients/${c.slug}`} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-line)] bg-[var(--color-surface-sunken)] px-2.5 py-1 text-xs hover:border-[var(--color-good)]">
                <span className="size-1.5 rounded-full bg-[var(--color-good)]" />
                <ClientLogo name={c.name} logoUrl={c.logoUrl} color={c.color} size={16} />
                {c.name}
              </Link>
            ))}
          </div>
        </Card>
      ) : null}

      {aandacht.some((c) => c.factors.length === 0) ? null : (
        <p className="mt-4 flex items-center gap-1.5 text-xs text-[var(--color-ink-muted)]">
          <AlertTriangle className="size-3.5" /> Urgente punten (rood) worden automatisch omgezet in een taak voor de verantwoordelijke coördinator.
        </p>
      )}
    </div>
  );
}
