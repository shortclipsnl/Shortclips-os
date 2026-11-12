import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, ChevronRight, MapPin } from "lucide-react";
import { requireInternal } from "@/server/auth/context";
import { listVideographerSessions, type VideographerSession } from "@/server/draaiboek/service";
import { ClientLogo } from "@/components/ui";

export const metadata: Metadata = { title: "Draaiboek" };
export const dynamic = "force-dynamic";

const fmtDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" });
const time = (s: VideographerSession) => [s.startTime?.slice(0, 5), s.endTime?.slice(0, 5)].filter(Boolean).join(" tot ");

export default async function DraaiboekHomePage() {
  const viewer = await requireInternal();
  const { today, sessions } = await listVideographerSessions(viewer);
  const todays = sessions.filter((s) => s.scheduledOn === today);
  const later = sessions.filter((s) => s.scheduledOn !== today);
  const first = viewer.fullName?.split(" ")[0] ?? "";

  return (
    <div className="mx-auto max-w-[560px] pb-16">
      <p className="text-sm text-[var(--color-ink-muted)]">{new Date(`${today}T12:00:00`).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" })}</p>
      <h1 className="mb-5 text-2xl font-bold text-[var(--color-ink)]">{first ? `Hoi ${first}` : "Draaiboek"}</h1>

      {/* De opname van vandaag staat centraal. */}
      {todays.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6 text-center">
          <p className="text-base font-semibold text-[var(--color-ink)]">Vandaag geen opname</p>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">Je komende opnames staan hieronder.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="text-xs font-bold uppercase tracking-wide text-[var(--color-ink-muted)]">Opname vandaag</div>
          {todays.map((s) => (
            <Link key={s.productionDayId} href={`/draaiboek/${s.productionDayId}`} className="block rounded-[var(--radius-lg)] bg-[var(--color-ink)] p-5 text-white shadow-[var(--shadow-card)] active:opacity-95">
              <div className="flex items-center gap-3">
                <ClientLogo name={s.clientName} logoUrl={s.clientLogo} color={s.clientColor} size={44} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xl font-bold">{s.clientName}</div>
                  <div className="truncate text-sm text-white/75">{s.title}</div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm text-white/85">
                {time(s) ? <span>{time(s)}</span> : null}
                {s.locationName ? <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{s.locationName}</span> : null}
                <span>{s.videos} video&apos;s</span>
              </div>
              <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-white/20">
                <div className="h-full rounded-full bg-[var(--color-good)]" style={{ width: `${s.pct}%` }} />
              </div>
              <div className="mt-4 flex h-12 items-center justify-center gap-1 rounded-[var(--radius-md)] bg-white text-base font-semibold text-[var(--color-ink)]">
                {s.status === "verstuurd" ? (s.pct > 0 ? "Verder met opnemen" : "Open draaiboek") : "Bekijk draaiboek"} <ChevronRight className="size-5" />
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Andere opnames: klein en rustig, om vooruit te kijken. */}
      {later.length > 0 ? (
        <div className="mt-8">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-[var(--color-ink-faint)]"><CalendarDays className="size-3.5" /> Komende opnames</div>
          <ul className="divide-y divide-[var(--color-line)] rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]">
            {later.map((s) => (
              <li key={s.productionDayId}>
                <Link href={`/draaiboek/${s.productionDayId}`} className="flex items-center gap-3 px-3 py-2.5 text-sm text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)]">
                  <span className="w-[86px] shrink-0 tabular-nums">{fmtDay(s.scheduledOn)}</span>
                  <span className="min-w-0 flex-1 truncate">{s.clientName}</span>
                  <span className="shrink-0 text-xs text-[var(--color-ink-faint)]">{s.videos} video&apos;s</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {sessions.length === 0 ? <p className="mt-6 text-center text-sm text-[var(--color-ink-faint)]">Er zijn nog geen draaiboeken naar je verstuurd.</p> : null}
    </div>
  );
}
