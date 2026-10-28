import Link from "next/link";
import { Clock, FileText, Play, Sunrise } from "lucide-react";
import type { MorningOverview } from "@/server/morning-overview";
import { MorningTiles, type MorningTile } from "./morning-tiles";

/**
 * Het gebundelde ochtendoverzicht: in één blik wat er vandaag aandacht vraagt —
 * verlopen deadlines, wachten op de klant, je eigen openstaande acties en wie er
 * nu te laat is. Klik een tegel open om de onderliggende problemen te zien.
 */
export function MorningOverviewCard({ data }: { data: MorningOverview }) {
  const total = data.overdueVideos + data.atClient + data.myOpenTasks;
  const tiles: MorningTile[] = [
    { key: "overdue", label: "Video's over de interne deadline", value: data.overdueVideos, tone: "bad", rows: data.overdueList, allHref: "/videos?filter=te-laat", allLabel: "Alle te late video's" },
    { key: "atClient", label: "Wacht op klantfeedback", value: data.atClient, tone: "warn", rows: data.atClientList, allHref: "/videos?filter=bij-klant", allLabel: "Alles bij de klant" },
    { key: "myTasks", label: "Jouw acties (vandaag / te laat)", value: data.myOpenTasks, tone: "info", rows: data.myOpenTasksList, allHref: "/tasks", allLabel: "Naar mijn taken" },
    { key: "late", label: "Nu te laat (per persoon)", value: data.currentlyLate, tone: "bad", rows: data.currentlyLateList },
  ];
  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface-2)] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold tracking-tight text-[var(--color-ink)]">
          <Sunrise className="size-4 text-[var(--color-brand-600)]" /> Ochtendoverzicht
        </h2>
        <span className="text-2xs text-[var(--color-ink-faint)]">
          {total === 0 ? "Alles bij — niets staat over de deadline." : "Klik een tegel open voor de details."}
        </span>
      </div>

      <MorningTiles tiles={tiles} />

      {/* Klanten die nog moeten reageren (video's + scripts), met dagen-wachtend. */}
      {data.clientsWaiting.length > 0 ? (
        <div className="mt-3 border-t border-[var(--color-line)] pt-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
            <Clock className="size-3.5" /> Klanten die nog moeten reageren
          </p>
          <ul className="space-y-1">
            {data.clientsWaiting.map((w) => (
              <li key={`${w.kind}-${w.id}`}>
                <Link href={w.href} className="flex items-center gap-2 text-sm hover:underline">
                  {w.kind === "script" ? <FileText className="size-3.5 shrink-0 text-[var(--color-brand-600)]" /> : <Play className="size-3.5 shrink-0 text-[var(--color-brand-600)]" />}
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium text-[var(--color-ink)]">{w.clientName}</span>
                    <span className="text-[var(--color-ink-muted)]"> — {w.kind === "script" ? "script" : "video"}: {w.title}</span>
                  </span>
                  <span className="shrink-0 text-2xs font-semibold" style={{ color: w.days >= 3 ? "var(--color-bad)" : w.days >= 1 ? "var(--color-warn)" : "var(--color-ink-faint)" }}>
                    {w.days === 0 ? "vandaag" : `${w.days} d`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
