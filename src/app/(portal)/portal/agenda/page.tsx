import type { Metadata } from "next";
import { CalendarDays, MapPin, Users } from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { upcomingAppointmentsForClient } from "@/server/appointments";
import { Badge, Card, EmptyState } from "@/components/ui";
import { formatDateFull, relativeDays } from "@/lib/format";

export const metadata: Metadata = { title: "Agenda" };
export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  opname: "Opnamedag",
  scriptbespreking: "Scriptbespreking",
  evaluatie: "Evaluatiegesprek",
  publicatie: "Publicatie",
  overig: "Afspraak",
};

const INTERNAL_RE = /(shortclips\.nl|teamshortclips@gmail\.com|jarnoklijnsma9@gmail\.com)/i;

/** Namen van de Shortclips-mensen die bij de afspraak zitten (uit Google Agenda). */
function shortclipsPeople(attendees: unknown): string[] {
  if (!Array.isArray(attendees)) return [];
  const names = new Set<string>();
  for (const a of attendees as Array<{ email?: string | null; displayName?: string | null }>) {
    if (!a?.email || !INTERNAL_RE.test(a.email)) continue;
    const name = (a.displayName ?? a.email.split("@")[0] ?? "")
      .replace(/\s*-?\s*shortclips.*/i, "")
      .trim();
    if (name) names.add(name);
  }
  return [...names];
}

export default async function PortalAgendaPage() {
  const viewer = await requirePortal();
  const appointments = viewer.clientId
    ? await upcomingAppointmentsForClient(viewer.clientId, 50)
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Agenda</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Je opnamedagen, besprekingen en andere afspraken met Shortclips.
        </p>
      </div>

      {appointments.length === 0 ? (
        <EmptyState
          title="Geen afspraken gepland"
          description="Zodra er een opname of bespreking staat, zie je 'm hier."
          icon={<CalendarDays className="size-6" />}
        />
      ) : (
        <Card padded={false}>
          <ul className="divide-y divide-[var(--color-line)]">
            {appointments.map((a) => (
              <li key={a.id} className="flex items-start gap-4 px-5 py-4">
                <div className="flex size-11 shrink-0 flex-col items-center justify-center rounded-lg bg-[var(--color-surface-2)]">
                  <CalendarDays className="size-5 text-[var(--color-brand-600)]" strokeWidth={1.75} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-[var(--color-ink)]">
                      {KIND_LABEL[a.kind] ?? "Afspraak"}
                    </span>
                    <Badge tone={a.kind === "opname" ? "info" : "neutral"}>
                      {relativeDays(a.startsAt)}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-sm text-[var(--color-ink-muted)]">
                    {formatDateFull(a.startsAt)}
                    {!a.allDay
                      ? ` · ${a.startsAt.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" })}`
                      : ""}
                  </p>
                  {a.location ? (
                    <p className="mt-1 flex items-center gap-1 text-xs text-[var(--color-ink-muted)]">
                      <MapPin className="size-3.5" /> {a.location}
                    </p>
                  ) : null}
                  {shortclipsPeople(a.attendees).length > 0 ? (
                    <p className="mt-1 flex items-center gap-1 text-xs text-[var(--color-ink-muted)]">
                      <Users className="size-3.5" /> Vanuit Shortclips:{" "}
                      {shortclipsPeople(a.attendees).join(", ")}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
