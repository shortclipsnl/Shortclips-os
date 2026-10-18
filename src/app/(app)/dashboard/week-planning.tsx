import Link from "next/link";
import { Camera, Presentation } from "lucide-react";
import { Card, CardHeader, ClientLogo } from "@/components/ui";
import { formatDate } from "@/lib/format";
import type { UpcomingMeeting } from "@/server/meetings";

/** Opname-rij zoals die uit het dashboard komt (subset). */
export type WeekShoot = {
  id: string;
  scheduledOn: string | Date;
  startTime: string | null;
  locationName: string | null;
  clientName: string;
  clientSlug: string;
  clientColor: string | null;
  clientLogo: string | null;
  videographerName: string | null;
};

/** Korte dag-aanduiding, bijv. "wo 22 okt". */
function dayLabel(input: string | Date): string {
  const d = typeof input === "string" ? new Date(input) : input;
  return d.toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" });
}

function timeLabel(input: Date): string {
  return input.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Weekplanning op het dashboard: wat staat er deze week aan — opnames (uit de
 * agenda/opnameplanning) en teammeetings. Puur informatief en scanbaar.
 */
export function WeekPlanning({ shoots, meetings }: { shoots: WeekShoot[]; meetings: UpcomingMeeting[] }) {
  return (
    <Card padded={false} className="overflow-hidden">
      <CardHeader title="Deze week" subtitle="Opnames en meetings die eraan komen." className="px-5 py-3.5" />
      <div className="grid gap-px bg-[var(--color-line)] sm:grid-cols-2">
        {/* Opnames */}
        <div className="bg-[var(--color-surface)]">
          <div className="flex items-center gap-2 px-5 pt-4 pb-2 text-2xs font-bold uppercase tracking-[0.1em] text-[var(--color-brand-600)]">
            <Camera className="size-3.5" strokeWidth={2} />
            Opnames
          </div>
          {shoots.length === 0 ? (
            <p className="px-5 pb-4 text-sm text-[var(--color-ink-muted)]">Geen opnames deze week.</p>
          ) : (
            <ul className="divide-y divide-[var(--color-line)]">
              {shoots.map((s) => (
                <li key={s.id}>
                  <Link href={`/clients/${s.clientSlug}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-[var(--color-surface-sunken)]/60">
                    <ClientLogo name={s.clientName} logoUrl={s.clientLogo} color={s.clientColor} size={24} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{s.clientName}</span>
                      <span className="block truncate text-xs text-[var(--color-ink-muted)]">
                        {s.locationName ?? "Locatie n.t.b."}
                        {s.videographerName ? ` · ${s.videographerName}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-xs">
                      <span className="block font-semibold">{dayLabel(s.scheduledOn)}</span>
                      {s.startTime ? <span className="block text-[var(--color-ink-faint)]">{s.startTime.slice(0, 5)}</span> : null}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Meetings */}
        <div className="bg-[var(--color-surface)]">
          <div className="flex items-center gap-2 px-5 pt-4 pb-2 text-2xs font-bold uppercase tracking-[0.1em] text-[var(--color-warn)]">
            <Presentation className="size-3.5" strokeWidth={2} />
            Meetings
          </div>
          {meetings.length === 0 ? (
            <p className="px-5 pb-4 text-sm text-[var(--color-ink-muted)]">Geen meetings deze week.</p>
          ) : (
            <ul className="divide-y divide-[var(--color-line)]">
              {meetings.map((m) => (
                <li key={m.id}>
                  <Link href="/meetings" className="flex items-center gap-3 px-5 py-2.5 hover:bg-[var(--color-surface-sunken)]/60">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{m.title}</span>
                      {m.location ? <span className="block truncate text-xs text-[var(--color-ink-muted)]">{m.location}</span> : null}
                    </span>
                    <span className="shrink-0 text-right text-xs">
                      <span className="block font-semibold">{dayLabel(m.scheduledAt)}</span>
                      <span className="block text-[var(--color-ink-faint)]">{timeLabel(m.scheduledAt)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}
