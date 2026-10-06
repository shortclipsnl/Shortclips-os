import type { Metadata } from "next";
import { BarChart3 } from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { getPortalData } from "@/server/portal";
import { Card } from "@/components/ui";

export const metadata: Metadata = { title: "Resultaten" };
export const dynamic = "force-dynamic";

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-ink-muted)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-[var(--color-ink)]">{value}</p>
    </Card>
  );
}

const nf = new Intl.NumberFormat("nl-NL");

export default async function PortalResultatenPage() {
  const viewer = await requirePortal();
  const data = await getPortalData(viewer);
  const m = data.metrics;
  const hasData = m.views + m.reach + m.engagements + m.followerGrowth > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Resultaten</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Hoe je video&apos;s presteren — afgelopen 30 dagen.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Weergaven" value={nf.format(m.views)} />
        <Metric label="Bereik" value={nf.format(m.reach)} />
        <Metric label="Interacties" value={nf.format(m.engagements)} />
        <Metric label="Nieuwe volgers" value={`+${nf.format(m.followerGrowth)}`} />
      </div>

      {!hasData ? (
        <Card className="flex items-center gap-3 border-dashed">
          <BarChart3 className="size-5 shrink-0 text-[var(--color-ink-muted)]" strokeWidth={1.75} />
          <p className="text-sm text-[var(--color-ink-muted)]">
            De statistieken van Instagram, TikTok, YouTube en Facebook worden binnenkort automatisch
            gekoppeld. Dan zie je hier per platform en gecombineerd je views, bereik, interacties,
            volgersgroei en je best presterende video&apos;s.
          </p>
        </Card>
      ) : null}
    </div>
  );
}
