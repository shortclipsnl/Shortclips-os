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

      {hasData ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric label="Weergaven" value={nf.format(m.views)} />
          <Metric label="Bereik" value={nf.format(m.reach)} />
          <Metric label="Interacties" value={nf.format(m.engagements)} />
          <Metric label="Nieuwe volgers" value={`+${nf.format(m.followerGrowth)}`} />
        </div>
      ) : (
        <Card className="flex flex-col items-start gap-3 border-dashed p-6">
          <span className="grid size-10 place-items-center rounded-xl bg-[var(--color-surface-2)] text-[var(--color-brand-600)]">
            <BarChart3 className="size-5" strokeWidth={1.75} />
          </span>
          <div>
            <p className="text-sm font-semibold text-[var(--color-ink)]">Je resultaten worden gekoppeld</p>
            <p className="mt-1 max-w-xl text-sm text-[var(--color-ink-muted)]">
              Zodra je kanalen verbonden zijn, verschijnen hier automatisch je weergaven, bereik,
              interacties, volgersgroei en je best presterende video&apos;s — per platform en gecombineerd.
              Je hoeft nu niets te doen.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
