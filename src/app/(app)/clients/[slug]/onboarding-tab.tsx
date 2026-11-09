import { Check, ExternalLink } from "lucide-react";
import { Card, CardHeader } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/format";
import { PAKKET_LABEL, type OnboardingView } from "@/server/onboarding";
import { RetryButton, WelcomeMessageBox } from "./onboarding-actions";

const STATUS_STYLE: Record<string, { text: string; dot: string; label: string }> = {
  klaar: { text: "text-[var(--color-good)]", dot: "bg-[var(--color-good)]", label: "Klaar" },
  open: { text: "text-[var(--color-ink-muted)]", dot: "bg-[var(--color-line-strong)]", label: "Open" },
  wacht: { text: "text-[var(--color-warn)]", dot: "bg-[var(--color-warn)]", label: "Wacht" },
  bezig: { text: "text-[var(--color-brand-700)]", dot: "bg-[var(--color-brand-500)]", label: "Bezig" },
  mislukt: { text: "text-[var(--color-bad)]", dot: "bg-[var(--color-bad)]", label: "Mislukt" },
};

export function OnboardingTab({ view, slug, canEdit }: { view: OnboardingView; slug: string; canEdit: boolean }) {
  const pct = Math.round((view.done / view.total) * 100);
  const d = view.details;
  return (
    <div className="flex flex-wrap items-start gap-5">
      <div className="min-w-0 flex-[999_1_560px] space-y-5">
        <Card>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold">
              {view.completedAt ? "Onboarding afgerond" : `Onboarding ${view.done} van ${view.total} stappen afgerond`}
            </h2>
            <span className="text-xs text-[var(--color-ink-muted)]">
              Gestart {formatDate(view.startedAt)}{view.startedBy ? ` door ${view.startedBy}` : ""}
            </span>
          </div>
          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-[var(--color-surface-sunken)]" role="img" aria-label={`Voortgang ${view.done} van ${view.total}`}>
            <div className={`h-full rounded-full ${view.needsAction ? "bg-[var(--color-warn)]" : "bg-[var(--color-brand-500)]"}`} style={{ width: `${pct}%` }} />
          </div>

          <ol className="mt-4 space-y-2">
            {view.steps.map((s, i) => {
              const st = STATUS_STYLE[s.status] ?? STATUS_STYLE.open!;
              return (
                <li key={s.key} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-line)] px-3.5 py-2.5">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={`grid size-6 shrink-0 place-items-center rounded-full text-2xs font-bold text-white ${st.dot}`}>
                      {s.status === "klaar" ? <Check className="size-3.5" /> : i + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{s.label}</p>
                      {s.detail ? <p className="text-xs text-[var(--color-ink-muted)]">{s.detail}</p> : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-[var(--color-line)] px-2 py-0.5 text-2xs text-[var(--color-ink-muted)]">{s.who}</span>
                    <span className={`text-xs font-semibold ${st.text}`}>{st.label}</span>
                    {s.key === "drive" && s.status === "mislukt" && canEdit ? <RetryButton clientId={view.clientId} slug={slug} /> : null}
                    {s.key === "drive" && s.status === "klaar" && view.driveUrl ? (
                      <a href={view.driveUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-[var(--color-brand-700)] hover:underline">
                        Openen <ExternalLink className="size-3" />
                      </a>
                    ) : null}
                    {s.key === "welcome_file" && view.welcomeFile ? (
                      <a href={view.welcomeFile.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-[var(--color-brand-700)] hover:underline">
                        {view.welcomeFile.name} <ExternalLink className="size-3" />
                      </a>
                    ) : null}
                    {s.key === "portal_invite" && s.status !== "klaar" ? (
                      <a href={`/clients/${slug}?tab=overzicht`} className="text-xs text-[var(--color-brand-700)] hover:underline">Login aanmaken</a>
                    ) : null}
                    {s.key === "whatsapp" && s.status === "wacht" ? (
                      <a href={`/clients/${slug}?tab=contacten`} className="text-xs text-[var(--color-brand-700)] hover:underline">Nummer aanvullen</a>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
          <p className="mt-3 text-xs text-[var(--color-ink-muted)]">
            De taken voor de projectmanager staan op Vandaag en Taken. Stappen gaan vanzelf op klaar: de opnamedag zodra de opname in Google Agenda staat, het portaal zodra de login bestaat.
          </p>
        </Card>
      </div>

      <div className="min-w-0 flex-[1_1_320px] space-y-5">
        <Card>
          <CardHeader title="Afspraken" />
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-[var(--color-ink-muted)]">Pakket</dt>
            <dd>{PAKKET_LABEL[d.pakket] ?? `${d.shortsPerMonth} shorts`}</dd>
            <dt className="text-[var(--color-ink-muted)]">Contractduur</dt>
            <dd>{d.contractMonths ? `${d.contractMonths} maanden` : "Onbepaald"}</dd>
            <dt className="text-[var(--color-ink-muted)]">Publiceert</dt>
            <dd>{d.publisher === "klant" ? "De klant zelf" : "Shortclips"}</dd>
            {d.notes ? (
              <>
                <dt className="text-[var(--color-ink-muted)]">Bijzonderheden</dt>
                <dd className="whitespace-pre-line">{d.notes}</dd>
              </>
            ) : null}
          </dl>
        </Card>

        {view.followups.length ? (
          <Card>
            <CardHeader title="Vervolgmomenten" subtitle="Komen vanzelf als taak op Vandaag zodra ze in beeld moeten zijn." />
            <ul className="space-y-2 text-sm">
              {view.followups.map((f) => (
                <li key={f.key} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{f.label}</p>
                    <p className="text-xs text-[var(--color-ink-muted)]">
                      {formatDate(f.dueOn)}{f.assignee ? ` · ${f.assignee}` : f.owner === "facturatie" ? " · facturatie" : " · projectmanager"}
                    </p>
                  </div>
                  <span className={`shrink-0 text-xs font-semibold ${f.state === "afgerond" ? "text-[var(--color-good)]" : f.state === "open" ? "text-[var(--color-brand-700)]" : "text-[var(--color-ink-muted)]"}`}>
                    {f.state === "afgerond" ? "Afgerond" : f.state === "open" ? "Taak staat klaar" : "Gepland"}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <WelcomeMessageBox clientId={view.clientId} slug={slug} initial={view.welcomeMessage ?? ""} canEdit={canEdit} />

        <Card>
          <CardHeader title="Logboek" />
          <ul className="space-y-1.5 text-xs">
            {view.log.map((l, i) => (
              <li key={i} className="flex gap-2">
                <span className="shrink-0 text-[var(--color-ink-faint)]">{formatDateTime(l.at)}</span>
                <span className={l.event === "mislukt" ? "text-[var(--color-bad)]" : ""}>{l.detail ?? l.event}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
