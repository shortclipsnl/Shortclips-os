import type { Metadata } from "next";
import { CalendarRange } from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { getPortalData } from "@/server/portal";
import { Badge, Card, EmptyState } from "@/components/ui";
import { formatDate, relativeDays } from "@/lib/format";
import { PLATFORM } from "@/lib/statuses";

export const metadata: Metadata = { title: "Contentplanning" };
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, { label: string; tone: "good" | "info" | "warn" | "neutral" }> = {
  published: { label: "Gepubliceerd", tone: "neutral" },
  scheduled: { label: "Ingepland", tone: "good" },
  ready: { label: "Klaar", tone: "info" },
  to_prepare: { label: "In voorbereiding", tone: "warn" },
};

export default async function PortalPlanningPage() {
  const viewer = await requirePortal();
  const data = await getPortalData(viewer);
  const items = data.calendar;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Contentplanning</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Wanneer welke video online komt en op welk platform.
        </p>
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="Je contentplanning wordt voorbereid"
          description="Zodra de publicatiedata voor je komende video's bekend zijn, verschijnen ze hier automatisch — met datum en platform. Je hoeft nu niets te doen."
          icon={<CalendarRange className="size-6" />}
        />
      ) : (
        <Card padded={false}>
          <ul className="divide-y divide-[var(--color-line)]">
            {items.map((c) => {
              const s = STATUS_LABEL[c.status] ?? { label: c.status, tone: "neutral" as const };
              return (
                <li key={c.id} className="flex items-center gap-4 px-5 py-4">
                  <div className="w-24 shrink-0">
                    <p className="text-sm font-semibold text-[var(--color-ink)]">{formatDate(c.scheduledOn)}</p>
                    <p className="text-xs text-[var(--color-ink-muted)]">{relativeDays(c.scheduledOn)}</p>
                  </div>
                  <p className="min-w-0 flex-1 truncate text-sm text-[var(--color-ink)]">{c.title}</p>
                  <span className="flex gap-1">
                    {((c.platforms as string[]) ?? []).slice(0, 4).map((pl) => (
                      <span
                        key={pl}
                        title={PLATFORM[pl]?.label ?? pl}
                        className="size-2.5 rounded-full"
                        style={{ background: PLATFORM[pl]?.color ?? "#999" }}
                      />
                    ))}
                  </span>
                  <Badge tone={s.tone}>{s.label}</Badge>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
