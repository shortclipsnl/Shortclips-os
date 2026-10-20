import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/server/auth/context";
import { getQualityOverview, type QualityItem, type QualitySeverity } from "@/server/quality";
import { Badge, PageHeader, Stat, type Tone } from "@/components/ui";

export const metadata: Metadata = { title: "Kwaliteit & Aandachtspunten" };
export const dynamic = "force-dynamic";

/**
 * Secties per ernst, in vaste volgorde: eerst directe actie, dan extra
 * aandacht, en vooruitkijken als laatste. Elke sectie krijgt een VOLLE
 * gekleurde balk bovenaan (rood/oranje/blauw) zodat je in één oogopslag de
 * ernst ziet. De punten eronder staan bewust in zwart (geen kleur) om snel te
 * kunnen scannen; alleen het categorie-label (bijv. "koppeling", "te laat bij
 * klant") houdt zijn kleur, zodat het soort probleem wél opvalt.
 */
const SECTIONS: {
  severity: QualitySeverity;
  label: string;
  tone: Tone;
  color: string;
}[] = [
  { severity: "rood", label: "Directe actie", tone: "bad", color: "var(--color-bad)" },
  { severity: "oranje", label: "Extra aandachtspunten", tone: "warn", color: "var(--color-warn)" },
  { severity: "blauw", label: "Vooruitkijken", tone: "info", color: "var(--color-info)" },
];

export default async function QualityPage() {
  const viewer = await requireInternal();
  const { items, counts } = await getQualityOverview(viewer);

  return (
    <div className="mx-auto max-w-[1000px]">
      <PageHeader
        title="Kwaliteit & Aandachtspunten"
        description="Automatisch gesignaleerde punten die aandacht vragen, afgestemd op jouw rol. Rood vraagt directe actie, oranje extra aandacht, blauw is vooruitkijken."
      />

      <div className="mb-5 grid grid-cols-3 gap-3">
        <Stat label="Directe actie" value={String(counts.rood)} tone={counts.rood > 0 ? "bad" : "good"} />
        <Stat label="Extra aandacht" value={String(counts.oranje)} tone={counts.oranje > 0 ? "warn" : "good"} />
        <Stat label="Vooruitkijken" value={String(counts.blauw)} />
      </div>

      {/* Drie gescheiden secties, één per ernst — de structuur blijft altijd
          gelijk (ook lege secties tonen we met een korte lege toestand). */}
      <div className="space-y-4">
        {SECTIONS.map((s) => {
          const bucket = items.filter((i) => i.severity === s.severity);
          return (
            <div
              key={s.severity}
              className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)]"
            >
              {/* Volle gekleurde balk per sectie: rood (directe actie), oranje
                  (extra aandacht), blauw (vooruitkijken). */}
              <div className="flex items-center justify-between gap-2 px-5 py-2.5 text-white" style={{ background: s.color }}>
                <h2 className="text-sm font-bold tracking-tight">{s.label}</h2>
                <span className="shrink-0 rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-bold tabular-nums">
                  {counts[s.severity]}
                </span>
              </div>
              {bucket.length === 0 ? (
                <p className="px-5 py-5 text-center text-sm text-[var(--color-ink-muted)]">Niets — mooi!</p>
              ) : (
                <ul className="divide-y divide-[var(--color-line)]">
                  {bucket.map((i) => (
                    <QualityRow key={i.id} item={i} tone={s.tone} />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Eén aandachtspunt-rij: titel en detail in zwart (geen kleur, goed scanbaar),
 *  met alleen het categorie-label in kleur (bijv. "koppeling", "te laat bij
 *  klant"), als link naar `href`. */
function QualityRow({ item, tone }: { item: QualityItem; tone: Tone }) {
  return (
    <li>
      <Link
        href={item.href}
        className="flex items-center gap-3 px-5 py-3 hover:bg-[var(--color-surface-sunken)]/50"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-[var(--color-ink)]">{item.title}</span>
          <span className="block truncate text-xs text-[var(--color-ink-muted)]">{item.detail}</span>
        </span>
        <Badge tone={tone} className="shrink-0">{item.category}</Badge>
      </Link>
    </li>
  );
}
