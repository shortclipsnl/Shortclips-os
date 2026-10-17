import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { requireInternal } from "@/server/auth/context";
import { getQualityOverview, type QualitySeverity } from "@/server/quality";
import { Card, EmptyState, PageHeader, Stat } from "@/components/ui";

export const metadata: Metadata = { title: "Kwaliteit & Aandachtspunten" };
export const dynamic = "force-dynamic";

const DOT: Record<QualitySeverity, string> = {
  rood: "bg-[var(--color-bad)]",
  oranje: "bg-[var(--color-warn)]",
  blauw: "bg-[var(--color-brand-500)]",
};
const META_TEXT: Record<QualitySeverity, string> = {
  rood: "text-[var(--color-bad)]",
  oranje: "text-[var(--color-warn)]",
  blauw: "text-[var(--color-brand-600)]",
};

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

      <Card padded={false}>
        {items.length === 0 ? (
          <EmptyState title="Niets vraagt nu aandacht" description="Er staan geen openstaande aandachtspunten voor jouw rol." icon={<ShieldCheck className="size-6" />} />
        ) : (
          <ul className="divide-y divide-[var(--color-line)]">
            {items.map((i) => (
              <li key={i.id}>
                <Link href={i.href} className="flex items-center gap-3 px-5 py-3 hover:bg-[var(--color-surface-sunken)]/50">
                  <span className={`size-2.5 shrink-0 rounded-full ${DOT[i.severity]}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{i.title}</span>
                    <span className="block truncate text-xs text-[var(--color-ink-muted)]">{i.detail}</span>
                  </span>
                  <span className="shrink-0 text-2xs uppercase tracking-wide text-[var(--color-ink-faint)]">{i.category}</span>
                  <span className={`w-2 shrink-0 ${META_TEXT[i.severity]}`} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
