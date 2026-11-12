import Link from "next/link";
import { Check, ExternalLink } from "lucide-react";
import { Card, CardHeader } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/format";
import { FIRST_SHOOTS_REQUIRED, type StepView } from "@/lib/onboarding-plan";
import { PAKKET_LABEL, type OnboardingView } from "@/server/onboarding";
import {
  BriefingForm,
  ChecklistEditor,
  ConfirmStepButton,
  FindFrameButton,
  KickoffPanel,
  RetryButton,
  WelcomeMessageBox,
  WelcomeSentButton,
  WhatsappPanel,
} from "./onboarding-actions";

/** Groen = afgerond, oranje = actie nodig, rood = fout of blokkade, grijs = nog niet gestart. */
const STATUS_STYLE: Record<string, { text: string; dot: string; label: string }> = {
  klaar: { text: "text-[var(--color-good)]", dot: "bg-[var(--color-good)]", label: "Afgerond" },
  open: { text: "text-[var(--color-ink-muted)]", dot: "bg-[var(--color-line-strong)]", label: "Nog niet gestart" },
  wacht: { text: "text-[var(--color-warn)]", dot: "bg-[var(--color-warn)]", label: "Actie nodig" },
  bezig: { text: "text-[var(--color-warn)]", dot: "bg-[var(--color-warn)]", label: "Bezig" },
  mislukt: { text: "text-[var(--color-bad)]", dot: "bg-[var(--color-bad)]", label: "Fout" },
  uit: { text: "text-[var(--color-ink-faint)]", dot: "bg-[var(--color-surface-sunken)]", label: "Uit" },
};
const PHASE_STYLE: Record<string, { cls: string; label: string }> = {
  klaar: { cls: "bg-[var(--color-good-soft)] text-[var(--color-good)]", label: "Afgerond" },
  bezig: { cls: "bg-[var(--color-warn-soft)] text-[var(--color-warn)]", label: "Bezig" },
  wacht: { cls: "bg-[var(--color-warn-soft)] text-[var(--color-warn)]", label: "Actie nodig" },
  mislukt: { cls: "bg-[var(--color-bad-soft)] text-[var(--color-bad)]", label: "Fout of blokkade" },
  open: { cls: "bg-[var(--color-neutral-soft)] text-[var(--color-ink-muted)]", label: "Nog niet gestart" },
};

const linkCls = "inline-flex items-center gap-1 text-xs text-[var(--color-brand-700)] hover:underline";

function StepActions({ s, view, slug, canEdit }: { s: StepView; view: OnboardingView; slug: string; canEdit: boolean }) {
  const ref = { clientId: view.clientId, slug };
  if (s.status === "uit") return null;
  switch (s.key) {
    case "contract":
      return s.status === "klaar" ? null : (
        <div className="flex flex-wrap items-center gap-2">
          {canEdit ? <ConfirmStepButton {...ref} step="contract" label="Getekend buiten PandaDoc: bevestigen" /> : null}
        </div>
      );
    case "client_data":
      return s.status === "klaar" ? null : <a href={`/clients/${slug}?tab=contacten`} className={linkCls}>Gegevens aanvullen</a>;
    case "portal_invite":
      return s.status === "klaar" ? null : <a href={`/clients/${slug}?tab=overzicht`} className={linkCls}>Login aanmaken</a>;
    case "drive":
      if (s.status === "mislukt" && canEdit) return <RetryButton {...ref} />;
      return view.driveUrl ? (
        <a href={view.driveUrl} target="_blank" rel="noreferrer" className={linkCls}>Klantmap openen <ExternalLink className="size-3" /></a>
      ) : null;
    case "frame":
      if (s.status === "klaar") return view.frame?.name ? <span className="text-xs text-[var(--color-ink-muted)]">Project: {view.frame.name}</span> : null;
      return (
        <div className="space-y-2 text-xs">
          <p className="text-[var(--color-ink-muted)]">
            Maak in Frame.io een project met precies de naam <span className="font-semibold text-[var(--color-ink)]">{view.clientName}</span>. De Hub koppelt het binnen twee uur vanzelf.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <a href="https://next.frame.io" target="_blank" rel="noreferrer" className={linkCls}>Frame.io openen <ExternalLink className="size-3" /></a>
            {canEdit ? <FindFrameButton {...ref} /> : null}
            {canEdit ? <ConfirmStepButton {...ref} step="frame" label="Handmatig bevestigen" /> : null}
          </div>
        </div>
      );
    case "welcome_file":
      return view.welcomeFile ? (
        <a href={view.welcomeFile.url} target="_blank" rel="noreferrer" className={linkCls}>{view.welcomeFile.name} <ExternalLink className="size-3" /></a>
      ) : null;
    case "whatsapp":
      if (s.status === "klaar") {
        return view.whatsapp.link ? (
          <a href={view.whatsapp.link} target="_blank" rel="noreferrer" className={linkCls}>Groep openen <ExternalLink className="size-3" /></a>
        ) : null;
      }
      if (s.status === "wacht") return <a href={`/clients/${slug}?tab=contacten`} className={linkCls}>Telefoonnummer aanvullen</a>;
      return canEdit ? <WhatsappPanel {...ref} groupName={view.whatsapp.groupName} members={view.whatsapp.members} phone={view.whatsapp.phone} /> : null;
    case "welcome_sent":
      return s.status === "klaar" || !canEdit ? null : (
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-ink-muted)]">
          <span>Kopieer het welkomstbericht hiernaast, stuur het met het welkomstbestand in de groep en klik dan op</span>
          <WelcomeSentButton {...ref} />
        </div>
      );
    case "kickoff":
      return s.status === "klaar" || !canEdit ? null : (
        <div className="space-y-2 text-xs">
          <p className="text-[var(--color-ink-muted)]">
            Zet de kickoff in de agenda Team Shortclips met een titel als <span className="font-semibold text-[var(--color-ink)]">Kickoff | {view.clientName}</span>. Plan in de kickoff direct de eerste {FIRST_SHOOTS_REQUIRED} opnamedagen.
          </p>
          <KickoffPanel {...ref} />
        </div>
      );
    case "briefing":
      return <BriefingForm {...ref} initial={view.briefing} canEdit={canEdit} />;
    case "first_shoot":
      return s.status === "klaar" ? null : <Link href="/productions" className={linkCls}>Naar Opnames</Link>;
    default:
      return null;
  }
}

export function OnboardingTab({ view, slug, canEdit }: { view: OnboardingView; slug: string; canEdit: boolean }) {
  const active = view.steps.filter((s) => s.key !== "done" && s.status !== "uit");
  const count = (st: string[]) => active.filter((s) => st.includes(s.status)).length;
  const seg = [
    { n: count(["klaar"]), c: "var(--color-good)", l: "Afgerond" },
    { n: count(["wacht", "bezig"]), c: "var(--color-warn)", l: "Actie nodig" },
    { n: count(["mislukt"]), c: "var(--color-bad)", l: "Fout of blokkade" },
    { n: count(["open"]), c: "var(--color-line-strong)", l: "Nog niet gestart" },
  ];
  const d = view.details;
  const overall = view.completedAt
    ? { cls: "bg-[var(--color-good-soft)] text-[var(--color-good)]", label: "Onboarding afgerond" }
    : view.needsAction
      ? { cls: "bg-[var(--color-bad-soft)] text-[var(--color-bad)]", label: "Blokkade" }
      : view.requiredOpen.length === 0
        ? { cls: "bg-[var(--color-good-soft)] text-[var(--color-good)]", label: "Klaar om te starten" }
        : { cls: "bg-[var(--color-warn-soft)] text-[var(--color-warn)]", label: `${view.requiredOpen.length} verplicht open` };

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{view.completedAt ? `${view.clientName} is klaar voor de samenwerking` : `Onboarding ${view.clientName}`}</h2>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-ink-muted)]">
              <span>Pakket <b className="font-semibold text-[var(--color-ink)]">{PAKKET_LABEL[d.pakket] ?? `${d.shortsPerMonth} shorts`}</b></span>
              <span>Projectmanager <b className="font-semibold text-[var(--color-ink)]">{view.pmName ?? "nog niet gekozen"}</b></span>
              {view.teamNames.length ? <span>Team <b className="font-semibold text-[var(--color-ink)]">{view.teamNames.join(", ")}</b></span> : null}
              <span>Gestart {formatDate(view.startedAt)}{view.startedBy ? ` door ${view.startedBy}` : ""}</span>
            </div>
          </div>
          <div className="text-right">
            <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${overall.cls}`}>{overall.label}</span>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {view.done} <span className="text-sm font-medium text-[var(--color-ink-muted)]">van {view.total} afgerond</span>
            </p>
          </div>
        </div>
        <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-[var(--color-surface-sunken)]" role="img" aria-label={`Voortgang ${view.done} van ${view.total}`}>
          {seg.map((x) => (x.n ? <div key={x.l} style={{ width: `${(x.n / Math.max(1, view.total)) * 100}%`, background: x.c }} /> : null))}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-[var(--color-ink-muted)]">
          {seg.map((x) => (
            <span key={x.l} className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: x.c }} />{x.l} {x.n}</span>
          ))}
        </div>
      </Card>

      <div className="flex flex-wrap items-start gap-5">
        <div className="min-w-0 flex-[999_1_560px] space-y-4">
          {view.phases.map((p) => {
            const steps = view.steps.filter((s) => s.phase === p.key && s.key !== "done");
            const ps = PHASE_STYLE[p.status] ?? PHASE_STYLE.open!;
            return (
              <details key={p.key} open={p.status !== "klaar"} className="sc-card group overflow-hidden">
                <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 hover:bg-[var(--color-surface-sunken)]">
                  <span className="grid size-6 place-items-center rounded-[var(--radius-sm)] bg-[var(--color-surface-2)] text-2xs font-bold">{p.key}</span>
                  <span className="flex-1 text-sm font-semibold">{p.label}</span>
                  <span className="text-xs tabular-nums text-[var(--color-ink-muted)]">{p.done}/{p.total}</span>
                  <span className={`rounded-full px-2 py-0.5 text-2xs font-semibold ${ps.cls}`}>{ps.label}</span>
                </summary>
                <ol className="border-t border-[var(--color-line)]">
                  {steps.map((s) => {
                    const st = STATUS_STYLE[s.status] ?? STATUS_STYLE.open!;
                    return (
                      <li key={s.key} className={`border-b border-[var(--color-line)] px-4 py-3 last:border-b-0 ${s.status === "uit" ? "opacity-50" : ""}`}>
                        <div className="flex flex-wrap items-start gap-3">
                          <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-2xs font-bold text-white ${st.dot}`}>
                            {s.status === "klaar" ? <Check className="size-3" /> : s.status === "mislukt" ? "!" : ""}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-medium">{s.label}</p>
                              {s.required ? <span className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Verplicht</span> : null}
                            </div>
                            {s.detail ? <p className="text-xs text-[var(--color-ink-muted)]">{s.detail}</p> : null}
                            <div className="mt-2 empty:hidden">
                              <StepActions s={s} view={view} slug={slug} canEdit={canEdit} />
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <span className="hidden rounded-full border border-[var(--color-line)] px-2 py-0.5 text-2xs text-[var(--color-ink-muted)] sm:inline">{s.who}</span>
                            <span className={`text-xs font-semibold ${st.text}`}>{st.label}</span>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </details>
            );
          })}
          <p className="text-xs text-[var(--color-ink-muted)]">
            De taken voor de projectmanager staan op Vandaag en Taken. Wat in de Hub of de agenda gebeurt, zet de stap en de taak vanzelf op klaar, dus niets dubbel afvinken.
          </p>
        </div>

        <div className="min-w-0 flex-[1_1_320px] space-y-5">
          {!view.completedAt ? (
            <Card>
              <CardHeader title={view.requiredOpen.length ? "Nog nodig om af te ronden" : "Klaar om te starten"} />
              {view.requiredOpen.length ? (
                <ul className="mt-2 space-y-1.5 text-sm">
                  {view.requiredOpen.map((r) => (
                    <li key={r.key} className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-[var(--color-warn)]" />{r.label}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-[var(--color-ink-muted)]">Alle verplichte stappen zijn klaar. De onboarding rondt binnen het uur vanzelf af.</p>
              )}
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Afspraken" />
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-[var(--color-ink-muted)]">Pakket</dt>
              <dd>{PAKKET_LABEL[d.pakket] ?? `${d.shortsPerMonth} shorts`}</dd>
              <dt className="text-[var(--color-ink-muted)]">Contractduur</dt>
              <dd>{d.contractMonths ? `${d.contractMonths} maanden` : "Onbepaald"}</dd>
              <dt className="text-[var(--color-ink-muted)]">Publiceert</dt>
              <dd>{d.publisher === "klant" ? "De klant zelf" : "Shortclips"}</dd>
              <dt className="text-[var(--color-ink-muted)]">Kickoff</dt>
              <dd>{view.kickoff.at ?? "Nog niet gepland"}</dd>
              <dt className="text-[var(--color-ink-muted)]">Opnamedagen</dt>
              <dd>{view.shoots} van {FIRST_SHOOTS_REQUIRED} gepland</dd>
              {d.notes ? (
                <>
                  <dt className="text-[var(--color-ink-muted)]">Bijzonderheden</dt>
                  <dd className="whitespace-pre-line">{d.notes}</dd>
                </>
              ) : null}
            </dl>
          </Card>

          <WelcomeMessageBox clientId={view.clientId} slug={slug} initial={view.welcomeMessage ?? ""} canEdit={canEdit} />

          {canEdit && !view.completedAt ? (
            <ChecklistEditor
              clientId={view.clientId}
              slug={slug}
              steps={view.steps.filter((s) => s.key !== "done").map((s) => ({ key: s.key, label: s.label, required: s.required, off: s.status === "uit" }))}
              disableable={view.disableable}
            />
          ) : null}

          {view.followups.length ? (
            <Card>
              <CardHeader title="Vervolgmomenten" subtitle="Komen vanzelf als taak op Vandaag zodra ze in beeld moeten zijn." />
              <ul className="mt-2 space-y-2 text-sm">
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

          <Card>
            <CardHeader title="Logboek" />
            <ul className="mt-2 space-y-1.5 text-xs">
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
    </div>
  );
}
