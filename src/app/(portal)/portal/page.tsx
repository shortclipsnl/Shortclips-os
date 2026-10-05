import type { Metadata } from "next";
import {
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  FileText,
  PlayCircle,
} from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { getPortalData } from "@/server/portal";
import {
  Card,
  CardHeader,
  EmptyState,
  Stat,
} from "@/components/ui";
import {
  compact,
  formatDate,
  formatDateFull,
  num,
  periodLabel,
  plural,
  relativeDays,
} from "@/lib/format";
import { PLATFORM } from "@/lib/statuses";
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
  const data = await getPortalData(viewer);

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

      {/* Planning */}
      <Card padded={false}>
        <div className="p-5 pb-3">
          <CardHeader
            title="Wanneer publiceren we"
            subtitle="De eerstvolgende geplande video's."
          />
        </div>
        {data.calendar.length === 0 ? (
          <EmptyState title="Nog niets ingepland" />
        ) : (
          <ul className="divide-y divide-[var(--color-line)]">
            {data.calendar.slice(0, 8).map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-5 py-3">
                <span className="w-28 shrink-0 text-sm text-[var(--color-ink-muted)]">
                  {formatDate(c.scheduledOn)}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.title}</span>
                <span className="flex gap-1.5">
                  {(c.platforms as string[]).map((p) => (
                    <span
                      key={p}
                      title={PLATFORM[p]?.label ?? p}
                      className="size-2.5 rounded-full"
                      style={{ background: PLATFORM[p]?.color ?? "#999" }}
                    />
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Gepubliceerd */}
      <Card padded={false}>
        <div className="p-5 pb-3">
          <CardHeader
            title="Gepubliceerde video's"
            subtitle={plural(data.published.length, "video", "video's")}
          />
        </div>
        {data.published.length === 0 ? (
          <EmptyState title="Nog niets gepubliceerd" />
        ) : (
          <ul className="divide-y divide-[var(--color-line)]">
            {data.published.slice(0, 12).map((v) => (
              <li key={v.id} className="flex items-center gap-3 px-5 py-3">
                <PlayCircle className="size-4 shrink-0 text-[var(--color-ink-faint)]" strokeWidth={1.75} />
                <span className="min-w-0 flex-1 truncate text-sm">{v.title}</span>
                <span className="shrink-0 text-sm text-[var(--color-ink-muted)]">
                  {formatDate(v.publishedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Rapportages */}
      {data.reports.length > 0 ? (
        <Card padded={false}>
          <div className="p-5 pb-3">
            <CardHeader title="Rapportages" />
          </div>
          <ul className="divide-y divide-[var(--color-line)]">
            {data.reports.map((r) => (
              <li key={r.id} className="px-5 py-4">
                <p className="font-medium">{r.title}</p>
                <p className="text-xs text-[var(--color-ink-muted)]">{periodLabel(r.period)}</p>
                {r.summary ? (
                  <p className="mt-2 text-sm text-[var(--color-ink-muted)]">{r.summary}</p>
                ) : null}
                {r.manualNote ? (
                  <p className="mt-2 rounded-[var(--radius-sm)] bg-[var(--color-info-soft)] px-3 py-2 text-sm">
                    {r.manualNote}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* Documenten */}
      {data.documents.length > 0 ? (
        <Card padded={false}>
          <div className="p-5 pb-3">
            <CardHeader title="Documenten" />
          </div>
          <ul className="divide-y divide-[var(--color-line)]">
            {data.documents.map((f) => (
              <li key={f.id}>
                <a
                  href={f.externalUrl ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="sc-row-link flex items-center gap-3 px-5 py-3"
                >
                  <FileText className="size-4 shrink-0 text-[var(--color-ink-faint)]" strokeWidth={1.75} />
                  <span className="min-w-0 flex-1 truncate text-sm">{f.name}</span>
                  <span className="shrink-0 text-xs text-[var(--color-ink-muted)]">{f.category}</span>
                  <ExternalLink className="size-3.5 shrink-0 text-[var(--color-ink-faint)]" />
                </a>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* Contact */}
      <Card>
        <CardHeader title="Je contactpersoon" />
        <p className="mt-3 text-sm">
          <strong className="font-medium">{data.client.coordinatorName ?? "ShortClips"}</strong>
          {data.client.coordinatorEmail ? (
            <>
              {" · "}
              <a href={`mailto:${data.client.coordinatorEmail}`} className="text-[var(--color-brand-600)] hover:underline">
                {data.client.coordinatorEmail}
              </a>
            </>
          ) : null}
        </p>
      </Card>
    </div>
  );
}
