import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/server/auth/context";
import { getQualityOverview, type QualityItem, type QualitySeverity } from "@/server/quality";
import { Badge, Card, CardHeader, PageHeader, Stat, type Tone } from "@/components/ui";

export const metadata: Metadata = { title: "Kwaliteit & Aandachtspunten" };
export const dynamic = "force-dynamic";

/**
 * Secties per ernst, in vaste volgorde: eerst directe actie, dan extra
 * aandacht, en vooruitkijken als laatste. Elke sectie krijgt een eigen
 * kleuraccent (gekleurde linkerrand + getinte count-badge) zodat de pagina in
 * één oogopslag te scannen is.
 */
const SECTIONS: { severity: QualitySeverity; label: string; tone: Tone; bar: string }[] = [
  { severity: "rood", label: "Directe actie", tone: "bad", bar: "border-l-[var(--color-bad)]" },
  { severity: "oranje", label: "Extra aandachtspunten", tone: "warn", bar: "border-l-[var(--color-warn)]" },
  { severity: "blauw", label: "Vooruitkijken", tone: "info", bar: "border-l-[var(--color-info)]" },
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
            <Card key={s.severity} padded={false} className={`overflow-hidden border-l-[3px] ${s.bar}`}>
              <CardHeader
                title={s.label}
                action={<Badge tone={bucket.length > 0 ? s.tone : "good"}>{bucket.length}</Badge>}
                className="px-5 py-3.5"
              />
              {bucket.length === 0 ? (
                <p className="border-t border-[var(--color-line)] px-5 py-6 text-center text-sm text-[var(--color-ink-muted)]">
                  Niets — mooi!
                </p>
              ) : (
                <ul className="divide-y divide-[var(--color-line)] border-t border-[var(--color-line)]">
                  {bucket.map((i) => (
                    <QualityRow key={i.id} item={i} />
                  ))}
                </ul>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/** Eén aandachtspunt-rij: titel, detail en categorietag, als link naar `href`. */
function QualityRow({ item }: { item: QualityItem }) {
  return (
    <li>
      <Link href={item.href} className="flex items-center gap-3 px-5 py-3 hover:bg-[var(--color-surface-sunken)]/50">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{item.title}</span>
          <span className="block truncate text-xs text-[var(--color-ink-muted)]">{item.detail}</span>
        </span>
        <span className="shrink-0 text-2xs uppercase tracking-wide text-[var(--color-ink-faint)]">{item.category}</span>
      </Link>
    </li>
  );
}
