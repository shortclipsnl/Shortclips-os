import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { Badge, type Tone } from "@/components/ui";
import { shortDate, type DeadlineTone } from "@/lib/planning-deadline";
import type { TeamDeadlineRow } from "@/server/planning-deadlines";
import { DeadlineRowActions } from "./deadline-actions";

/**
 * Intern overzicht van de contentplanning-deadlines per klant. Standaard
 * gesorteerd op kortste resterende tijd, zodat in één oogopslag zichtbaar is
 * welke klanten aandacht nodig hebben.
 */
const TONE: Record<DeadlineTone, Tone> = { green: "good", orange: "warn", red: "bad", grey: "neutral" };

function openLabel(r: TeamDeadlineRow): string {
  const parts: string[] = [];
  if (r.actions.scriptsOpen) parts.push(`${r.actions.scriptsOpen} script${r.actions.scriptsOpen === 1 ? "" : "s"}`);
  if (r.actions.videosOpen) parts.push(`${r.actions.videosOpen} video${r.actions.videosOpen === 1 ? "" : "'s"}`);
  return parts.length ? `${parts.join(" + ")} bij klant` : "Niets open bij klant";
}

export function DeadlineOverview({
  rows,
  sort,
  sortHref,
  canWrite,
}: {
  rows: TeamDeadlineRow[];
  sort: "kortste" | "naam";
  sortHref: { kortste: string; naam: string };
  canWrite: boolean;
}) {
  const attention = rows.filter((r) => !r.view.done && r.view.daysLeft <= 10).length;
  return (
    <section className="sc-card mb-4 overflow-hidden" aria-labelledby="deadlines-klanten">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="size-4 text-[var(--color-ink-muted)]" />
          <h2 id="deadlines-klanten" className="text-sm font-semibold">Deadlines contentplanning</h2>
          <span className="text-xs text-[var(--color-ink-muted)]">
            {rows.length === 0 ? "geen lopende deadlines" : attention > 0 ? `${attention} klant${attention === 1 ? "" : "en"} vraag${attention === 1 ? "t" : "en"} aandacht` : "alles op schema"}
          </span>
        </div>
        {rows.length > 1 ? (
          <div className="flex items-center gap-1 text-xs">
            <span className="text-[var(--color-ink-muted)]">Sorteren:</span>
            <Link href={sortHref.kortste} className={`rounded-full px-2.5 py-1 ${sort === "kortste" ? "bg-[var(--color-indigo-ink)] font-medium text-white" : "hover:bg-[var(--color-surface-sunken)]"}`}>Kortste resterende tijd</Link>
            <Link href={sortHref.naam} className={`rounded-full px-2.5 py-1 ${sort === "naam" ? "bg-[var(--color-indigo-ink)] font-medium text-white" : "hover:bg-[var(--color-surface-sunken)]"}`}>Klantnaam</Link>
          </div>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <p className="border-t border-[var(--color-line)] px-4 py-3 text-xs text-[var(--color-ink-muted)]">
          Een deadline van 21 dagen start automatisch zodra je een planning goedkeurt en deelt met de klant.
        </p>
      ) : (
        <div className="max-h-[380px] overflow-auto border-t border-[var(--color-line)]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[var(--color-surface)] text-left text-xs text-[var(--color-ink-muted)]">
              <tr>
                <th className="px-4 py-2 font-medium">Klant</th>
                <th className="px-3 py-2 font-medium">Deadline</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">Resterende tijd</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="hidden px-3 py-2 font-medium lg:table-cell">Bij de klant</th>
                {canWrite ? <th className="px-4 py-2 text-right font-medium"><span className="sr-only">Acties</span></th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {rows.map((r) => (
                <tr key={r.id} className={r.view.done ? "opacity-70" : undefined}>
                  <td className="px-4 py-2">
                    <Link href={`/calendar?klant=${r.clientSlug}`} className="font-medium hover:underline">{r.clientName}</Link>
                    {r.lastChange && r.lastChange.action === "deadline aangepast" ? (
                      <div className="text-[11px] text-[var(--color-ink-muted)]" title={r.lastChange.reason}>
                        Aangepast door {r.lastChange.byName} ({shortDate(r.lastChange.from!)} naar {shortDate(r.lastChange.to!)})
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{shortDate(r.view.deadlineOn)}</td>
                  <td className="px-3 py-2 tabular-nums">{r.view.remainingLabel}</td>
                  <td className="px-3 py-2">
                    <Badge tone={TONE[r.view.tone]}>
                      {r.view.teamLabel}
                      {r.view.done && r.completedVia ? <span className="opacity-70">{r.completedVia === "auto" ? " (automatisch)" : " (handmatig)"}</span> : null}
                    </Badge>
                  </td>
                  <td className="hidden whitespace-nowrap px-3 py-2 text-xs text-[var(--color-ink-muted)] lg:table-cell">{r.view.done ? "" : openLabel(r)}</td>
                  {canWrite ? (
                    <td className="px-4 py-2 text-right">
                      {!r.view.done ? <DeadlineRowActions clientId={r.clientId} clientName={r.clientName} deadlineOn={r.view.deadlineOn} /> : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
