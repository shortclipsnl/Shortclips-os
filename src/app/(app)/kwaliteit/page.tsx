import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/server/auth/context";
import { getQualityOverview, type QualityItem, type QualitySeverity } from "@/server/quality";
import { Badge, PageHeader, Stat, type Tone } from "@/components/ui";

export const metadata: Metadata = { title: "Kwaliteit & Aandachtspunten" };
export const dynamic = "force-dynamic";

/**
 * Secties per ernst, in vaste volgorde: eerst directe actie, dan extra
 * aandacht, en vooruitkijken als laatste. Elke sectie krijgt alleen een
 * gekleurd bovenrandje + gekleurde kop-tekst (geen volle kleurbalk), een
 * subtiele gekleurde linkerrand per regel en een in kleur uitgelichte
 * detail-/deadlinetekst. Zo valt het urgente op zonder dat alles rood kleurt
 * en blijft de pagina goed te scannen.
 */
const SECTIONS: {
  severity: QualitySeverity;
  label: string;
  tone: Tone;
  color: string;
  detailClass: string;
}[] = [
  { severity: "rood", label: "Directe actie", tone: "bad", color: "var(--color-bad)", detailClass: "text-[#a3271c] font-medium" },
  { severity: "oranje", label: "Extra aandachtspunten", tone: "warn", color: "var(--color-warn)", detailClass: "text-[#8a5300]" },
  { severity: "blauw", label: "Vooruitkijken", tone: "info", color: "var(--color-info)", detailClass: "text-[var(--color-ink-muted)]" },
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
              className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] border-t-[3px]"
              style={{ borderTopColor: s.color }}
            >
              {/* Alleen een gekleurd bovenrandje + gekleurde kop-tekst — geen volle kleurbalk. */}
              <div className="flex items-center justify-between gap-2 border-b border-[var(--color-line)] bg-[var(--color-surface-sunken)] px-5 py-2.5">
                <h2 className="text-sm font-bold tracking-tight" style={{ color: s.color }}>{s.label}</h2>
                <span
                  className="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums"
                  style={{ background: `color-mix(in srgb, ${s.color} 15%, var(--color-surface))`, color: s.color }}
                >
                  {bucket.length}
                </span>
              </div>
              {bucket.length === 0 ? (
                <p className="px-5 py-5 text-center text-sm text-[var(--color-ink-muted)]">Niets — mooi!</p>
              ) : (
                <ul className="divide-y divide-[var(--color-line)]">
                  {bucket.map((i) => (
                    <QualityRow key={i.id} item={i} tone={s.tone} color={s.color} detailClass={s.detailClass} />
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

/** Eén aandachtspunt-rij: titel, in kleur uitgelichte detail-/deadlinetekst en
 *  een getinte categorie-badge, als link naar `href`. Een gekleurde linkerrand
 *  maakt de ernst per regel zichtbaar. */
function QualityRow({ item, tone, color, detailClass }: { item: QualityItem; tone: Tone; color: string; detailClass: string }) {
  return (
    <li>
      <Link
        href={item.href}
        className="flex items-center gap-3 border-l-[3px] px-5 py-3 hover:bg-[var(--color-surface-sunken)]/50"
        style={{ borderLeftColor: color }}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{item.title}</span>
          <span className={`block truncate text-xs ${detailClass}`}>{item.detail}</span>
        </span>
        <Badge tone={tone} className="shrink-0">{item.category}</Badge>
      </Link>
    </li>
  );
}
