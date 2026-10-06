import type { Metadata } from "next";
import Link from "next/link";
import {
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  FileText,
  PlayCircle,
} from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { getPortalData, getPortalFrameUrl } from "@/server/portal";
import { buttonClass, Card, CardHeader, Stat } from "@/components/ui";
import { compact, formatDateFull, num, plural, relativeDays } from "@/lib/format";
import { ScriptDecision, VideoDecision } from "./actions-ui";

export const metadata: Metadata = { title: "Jouw omgeving" };
export const dynamic = "force-dynamic";

/** Interne afspraaktypes vertaald naar klanttaal. */
const APPOINTMENT_LABEL: Record<string, string> = {
  opname: "Opnamedag",
  scriptbespreking: "Scriptbespreking",
  evaluatie: "Evaluatiegesprek",
  publicatie: "Publicatie",
  overig: "Afspraak",
};

export default async function PortalPage() {
  const viewer = await requirePortal();
  const [data, frameUrl] = await Promise.all([
    getPortalData(viewer),
    getPortalFrameUrl(viewer),
  ]);

  const openActions = data.awaitingApproval.length + data.scriptsToReview.length;
  const firstName = viewer.fullName.split(" ")[0];

  return (
    <div className="space-y-7">
      {/* Welkom */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Welkom, {firstName}
        </h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Alles rond de video&apos;s van {data.client.name} op één plek.
        </p>
      </div>

      {/* Wat hebben we van je nodig */}
      <Card
        className={
          openActions > 0
            ? "border-[var(--color-brand-500)]/30 bg-[var(--color-info-soft)]/40"
            : undefined
        }
      >
        <CardHeader
          title={openActions > 0 ? "We wachten op jou" : "Niets openstaand"}
          subtitle={
            openActions > 0
              ? `${plural(openActions, "item vraagt", "items vragen")} om je reactie.`
              : "Je hoeft op dit moment niets te doen. Wij zijn aan zet."
          }
          action={
            openActions === 0 ? (
              <CheckCircle2 className="size-6 text-[var(--color-good)]" strokeWidth={1.75} />
            ) : frameUrl ? (
              <a href={frameUrl} target="_blank" rel="noreferrer" className={buttonClass({ variant: "primary", size: "sm" })}>
                <ExternalLink className="size-4" /> Beoordeel in Frame
              </a>
            ) : null
          }
        />

        {data.awaitingApproval.length > 0 ? (
          <div className="mt-5 space-y-4">
            {data.awaitingApproval.map((v) => (
              <div key={v.id} className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{v.title}</p>
                    <p className="text-sm text-[var(--color-ink-muted)]">
                      Klaar om te bekijken sinds {relativeDays(v.statusChangedAt)}
                    </p>
                  </div>
                  {v.frameUrl ? (
                    <a
                      href={v.frameUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-brand-600)] hover:underline"
                    >
                      <PlayCircle className="size-4" /> Video bekijken
                    </a>
                  ) : null}
                </div>
                <div className="mt-3">
                  <VideoDecision videoId={v.id} />
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {data.scriptsToReview.length > 0 ? (
          <div className="mt-4 space-y-4">
            {data.scriptsToReview.map((s) => (
              <div key={s.id} className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
                <div className="flex items-start gap-2.5">
                  <FileText className="mt-0.5 size-4 shrink-0 text-[var(--color-ink-faint)]" strokeWidth={1.75} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{s.title}</p>
                    {s.hook ? (
                      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
                        <strong className="font-medium text-[var(--color-ink)]">Opening:</strong>{" "}
                        {s.hook}
                      </p>
                    ) : null}
                    {s.body ? (
                      <p className="mt-2 text-sm whitespace-pre-line text-[var(--color-ink-muted)]">
                        {s.body.slice(0, 400)}
                        {s.body.length > 400 ? "…" : ""}
                      </p>
                    ) : null}
                    <div className="mt-3">
                      <ScriptDecision scriptId={s.id} />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </Card>

      {/* Aankomende afspraken uit Google Agenda (verschijnt zodra er gekoppelde afspraken zijn) */}
      {data.appointments.length > 0 ? (
        <Card>
          <CardHeader title="Aankomende afspraken" />
          <ul className="mt-4 space-y-3">
            {data.appointments.map((a) => (
              <li key={a.id} className="flex items-start gap-3">
                <CalendarClock
                  className="mt-0.5 size-5 shrink-0 text-[var(--color-brand-600)]"
                  strokeWidth={1.75}
                />
                <div className="min-w-0">
                  <p className="font-medium">{APPOINTMENT_LABEL[a.kind] ?? "Afspraak"}</p>
                  <p className="text-sm text-[var(--color-ink-muted)]">
                    {formatDateFull(a.startsAt)} · {relativeDays(a.startsAt)}
                    {a.location ? ` · ${a.location}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* Wat is de volgende stap */}
      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <CardHeader title="Volgende opname" />
          {data.upcomingShoot ? (
            <div className="mt-4 flex items-start gap-3">
              <CalendarClock className="mt-0.5 size-5 shrink-0 text-[var(--color-brand-600)]" strokeWidth={1.75} />
              <div>
                <p className="font-medium">{formatDateFull(data.upcomingShoot.scheduledOn)}</p>
                <p className="text-sm text-[var(--color-ink-muted)]">
                  {relativeDays(data.upcomingShoot.scheduledOn)}
                  {data.upcomingShoot.startTime ? ` · vanaf ${data.upcomingShoot.startTime.slice(0, 5)}` : ""}
                </p>
                <p className="text-sm text-[var(--color-ink-muted)]">
                  {data.upcomingShoot.locationName ?? "Locatie volgt"}
                </p>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-[var(--color-ink-muted)]">
              Er staat nog geen opname gepland. Je contactpersoon neemt hierover
              contact met je op.
            </p>
          )}
        </Card>

        <Card>
          <CardHeader title="Waar we mee bezig zijn" />
          {data.inProgress.length === 0 ? (
            <p className="mt-4 text-sm text-[var(--color-ink-muted)]">
              Op dit moment staat er niets in productie.
            </p>
          ) : (
            <ul className="mt-4 space-y-2.5">
              {data.inProgress.slice(0, 5).map((v) => (
                <li key={v.id} className="flex items-start justify-between gap-3 text-sm">
                  <span className="min-w-0 flex-1 truncate">{v.title}</span>
                  <span className="shrink-0 text-[var(--color-ink-muted)]">
                    {v.status === "editing"
                      ? "in bewerking"
                      : v.status === "scheduled"
                        ? "ingepland"
                        : "klaar voor publicatie"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Resultaten */}
      <div>
        <h2 className="mb-3 text-base font-semibold">Resultaten van de afgelopen 30 dagen</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Weergaven" value={compact(data.metrics.views)} />
          <Stat label="Bereik" value={compact(data.metrics.reach)} />
          <Stat label="Interacties" value={compact(data.metrics.engagements)} />
          <Stat label="Nieuwe volgers" value={`+${num(data.metrics.followerGrowth)}`} />
        </div>
        <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
          Weergaven en interacties zijn vrijwel actueel. Bereik en kijktijd lopen
          bij de meeste platforms één tot drie dagen achter.
        </p>
      </div>

      {/* Snel naar je onderdelen */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <QuickLink href="/portal/videos" icon={<PlayCircle className="size-5" />} label="Video's" count={data.published.length} />
        <QuickLink href="/portal/agenda" icon={<CalendarClock className="size-5" />} label="Agenda" count={data.appointments.length} />
        <QuickLink href="/portal/planning" icon={<FileText className="size-5" />} label="Contentplanning" count={data.calendar.length} />
        <QuickLink href="/portal/resultaten" icon={<ExternalLink className="size-5" />} label="Resultaten" />
      </div>
    </div>
  );
}

function QuickLink({
  href,
  icon,
  label,
  count,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  count?: number;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col gap-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4 transition-shadow hover:shadow-md"
    >
      <span className="text-[var(--color-brand-600)]">{icon}</span>
      <span className="text-sm font-medium text-[var(--color-ink)]">{label}</span>
      {typeof count === "number" && count > 0 ? (
        <span className="text-xs text-[var(--color-ink-muted)]">{count}</span>
      ) : null}
    </Link>
  );
}
