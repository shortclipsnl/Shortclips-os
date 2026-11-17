import Link from "next/link";
import { ChevronDown, ExternalLink } from "lucide-react";
import { Badge, Card, EmptyState, type Tone } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  BASELINE_METRICS,
  BASELINE_ORIGIN_LABEL,
  CONFIDENCE_LABEL,
  FINDING_KIND_LABEL,
  RESEARCH_MODULES,
  RESEARCH_PHASES,
  RESEARCH_PHASE_LABEL,
  RESEARCH_STATUS_LABEL,
  applyCorrections,
  compareBaselines,
  platformLabel,
  type Addition,
  type BaselineOrigin,
  type BaselineRow,
  type Confidence,
  type FindingKind,
  type ModuleKey,
  type TextModuleKey,
} from "@/lib/client-research";
import { getClientResearchView, type ResearchRunView } from "@/server/client-research/view";
import {
  AddFindingForm,
  ApproveResearchButton,
  BaselineForm,
  FindingTools,
  RemoveAdditionButton,
  RemoveBaselineButton,
  ResearchAutoRefresh,
  RestoreFindingButton,
  StartResearchButton,
} from "./research-actions";

const nlDate = (d: Date | string | null | undefined) =>
  d ? new Date(typeof d === "string" ? `${d.slice(0, 10)}T12:00:00Z` : d).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" }) : "onbekend";
const fmt = (n: number) => n.toLocaleString("nl-NL");

const KIND_TONE: Record<FindingKind | "handmatig", Tone> = { feit: "ink", berekening: "info", aanname: "warn", aanbeveling: "violet", handmatig: "good" };
const CONF_DOT: Record<Confidence, string> = { hoog: "var(--color-good)", middel: "var(--color-warn)", laag: "var(--color-bad)" };
const ORIGIN_TONE: Record<BaselineOrigin, Tone> = { openbaar: "neutral", gekoppeld: "info", handmatig: "good" };
const STATUS_TONE: Record<string, Tone> = { bezig: "info", controle: "violet", goedgekeurd: "good", mislukt: "bad" };

const ADD_PLACEHOLDER: Partial<Record<ModuleKey, string>> = {
  marketing_software: "Bijv. bevestigd door de klant: ze werken met HubSpot als CRM",
  doelgroep: "Bijv. uit het kennismakingsgesprek: de beslisser is meestal de eigenaar zelf",
  nulmeting: "Toelichting bij de cijfers",
};

/**
 * Tabblad Klantonderzoek op de interne klantpagina. Uitsluitend intern: de
 * pagina zelf sluit editors en freelance videografen al uit, en het
 * klantportaal leest deze gegevens nergens.
 *
 * Opbouw: bovenaan in één oogopslag (status, datum, databronnen, wat ontbreekt,
 * inzichten en kansen), daaronder de tien modules als openklapbare kaarten.
 */
export async function ResearchTab({
  clientId,
  slug,
  selectedId,
  canStart,
  canManage,
}: {
  clientId: string;
  slug: string;
  selectedId?: string | null;
  canStart: boolean;
  canManage: boolean;
}) {
  const view = await getClientResearchView(clientId, selectedId);
  const run = view.shown;

  return (
    <div className="space-y-5">
      {view.running ? <RunningCard phase={view.running.phase} stale={view.running.stale} kind={view.running.kind} clientId={clientId} canStart={canStart} /> : null}

      {view.failed ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-[var(--color-bad)]/20 bg-[var(--color-bad-soft)] px-4 py-3 text-sm text-[#a3271c]">
          <p><strong className="font-semibold">Het laatste onderzoek is niet gelukt.</strong> {view.failed.message ?? "Er ging iets mis."}{run ? " Het eerdere dossier hieronder blijft gewoon geldig." : ""}</p>
          {canStart && view.aiAvailable ? <StartResearchButton clientId={clientId} label="Opnieuw proberen" variant="secondary" /> : null}
        </div>
      ) : null}

      {!run && !view.running ? (
        <Card>
          <EmptyState
            title="Nog geen klantonderzoek"
            description={
              view.aiAvailable
                ? "Het onderzoek leest de website, openbare socialkanalen, reviews en concurrenten en combineert dat met onze eigen klantgegevens. Bij nieuwe klanten start dit automatisch; voor deze klant start je het hier."
                : "Er is nog geen AI-sleutel ingesteld, dus het onderzoek kan niet draaien."
            }
          />
          {canStart && view.aiAvailable && !view.failed ? <div className="mt-4 flex justify-center"><StartResearchButton clientId={clientId} label="Onderzoek starten" /></div> : null}
        </Card>
      ) : null}

      {run ? (
        <>
          <Summary run={run} view={{ shownIsLatest: view.shownIsLatest, running: Boolean(view.running), aiAvailable: view.aiAvailable, history: view.history }} clientId={clientId} slug={slug} canStart={canStart} canManage={canManage} />
          {run.kind === "hercontrole" ? <ChangesCard run={run} /> : null}
          <div className="space-y-3">
            {RESEARCH_MODULES.map((m) => (
              <ModuleCard key={m.key} moduleKey={m.key} nr={m.nr} title={m.title} hint={m.hint} run={run} nulmeting={view.nulmetingId !== run.id ? view.nulmetingBaseline : null} canManage={canManage} />
            ))}
          </div>
          <Sources run={run} />
        </>
      ) : null}
    </div>
  );
}

/* ------------------------------ Voortgang ------------------------------ */

function RunningCard({ phase, stale, kind, clientId, canStart }: { phase: string; stale: boolean; kind: string; clientId: string; canStart: boolean }) {
  const idx = RESEARCH_PHASES.indexOf(phase as (typeof RESEARCH_PHASES)[number]);
  return (
    <Card>
      <ResearchAutoRefresh />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">{kind === "hercontrole" ? "Hercontrole loopt" : "Onderzoek loopt"}</h2>
            <Badge tone={stale ? "warn" : "info"}>{stale ? "Staat stil" : "Bezig"}</Badge>
          </div>
          <p className="mt-0.5 text-sm text-[var(--color-ink-muted)]">
            {stale ? "Het onderzoek is stilgevallen. Het wordt binnen enkele minuten vanzelf hervat." : "Dit duurt ongeveer tien tot vijftien minuten. Je kunt de pagina gewoon verlaten; je krijgt een melding als het klaarstaat."}
          </p>
        </div>
        {stale && canStart ? <StartResearchButton clientId={clientId} label="Nu hervatten" variant="secondary" /> : null}
      </div>
      <ol className="mt-4 grid gap-2 sm:grid-cols-5">
        {RESEARCH_PHASES.map((p, i) => (
          <li key={p} className={cn("rounded-[var(--radius-sm)] border px-3 py-2 text-xs", i < idx ? "border-[var(--color-good)]/30 bg-[var(--color-good-soft)] text-[#1d6b4c]" : i === idx ? "border-[var(--color-indigo-ink)] bg-[var(--color-indigo-ink)] text-white" : "border-[var(--color-line)] text-[var(--color-ink-faint)]")}>
            <span className="block text-2xs font-semibold uppercase tracking-wide opacity-80">Stap {i + 1}</span>
            {RESEARCH_PHASE_LABEL[p]}
          </li>
        ))}
      </ol>
    </Card>
  );
}

/* ------------------------------ Samenvatting ---------------------------- */

function Summary({
  run,
  view,
  clientId,
  slug,
  canStart,
  canManage,
}: {
  run: ResearchRunView;
  view: { shownIsLatest: boolean; running: boolean; aiAvailable: boolean; history: { id: string; kind: string; status: string; date: Date }[] };
  clientId: string;
  slug: string;
  canStart: boolean;
  canManage: boolean;
}) {
  const b = run.basis;
  const found = run.dossier.kanalen.filter((k) => k.gevonden).length;
  const sources: { label: string; ok: boolean }[] = [
    { label: "Website", ok: Boolean(b.website) },
    { label: `Socialkanalen${found ? ` (${found})` : ""}`, ok: found > 0 || b.kanalen.length > 0 },
    { label: "Klantbriefing", ok: b.briefingVelden > 0 },
    { label: "Gekoppelde cijfers", ok: b.gekoppeldeCijfers },
    { label: `Openbare bronnen${run.sources.length ? ` (${run.sources.length})` : ""}`, ok: run.sources.length > 0 },
  ];

  return (
    <Card padded={false}>
      <div className="flex flex-col gap-3 p-5 pb-4 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
        <div className="min-w-0 lg:max-w-[68%]">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">Klantonderzoek</h2>
            <Badge tone={STATUS_TONE[run.status] ?? "neutral"}>{RESEARCH_STATUS_LABEL[run.status] ?? run.status}</Badge>
            <Badge tone="neutral">{run.kind === "hercontrole" ? "Hercontrole" : "Nulmeting"}</Badge>
            {!view.shownIsLatest ? <Badge tone="warn">Eerdere versie</Badge> : null}
          </div>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            {run.status === "controle"
              ? "Controleer de bevindingen en corrigeer waar nodig. Na goedkeuring gebruikt het portaal dit dossier bij scripts, captions en het Contentgeheugen."
              : `Goedgekeurd${run.approvedBy ? ` door ${run.approvedBy}` : ""} op ${nlDate(run.approvedAt)}. De klantkennis is hieraan gekoppeld.`}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-start gap-2 lg:justify-end">
          {run.status === "controle" && canManage && view.shownIsLatest ? <ApproveResearchButton runId={run.id} /> : null}
          {canStart && view.aiAvailable && !view.running && view.shownIsLatest && run.status === "goedgekeurd" ? <StartResearchButton clientId={clientId} label="Nu opnieuw controleren" variant="secondary" /> : null}
        </div>
      </div>

      <dl className="grid gap-px border-y border-[var(--color-line)] bg-[var(--color-line)] sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Laatste onderzoek" value={nlDate(run.finishedAt)} />
        <Fact label="Volgende hercontrole" value={run.nextCheckOn ? nlDate(run.nextCheckOn) : run.status === "controle" ? "90 dagen na goedkeuring" : "onbekend"} />
        <Fact label="Bevindingen" value={`${Object.values(run.dossier.modules).reduce((n, m) => n + m.bevindingen.length, 0)} in 10 modules`} />
        <Fact label="Nulmeting" value={`${run.baseline.length} ${run.baseline.length === 1 ? "cijfer" : "cijfers"} vastgelegd`} />
      </dl>

      <div className="px-5 py-4">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-ink-faint)]">Beschikbare databronnen</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {sources.map((s) => (
            <Badge key={s.label} tone={s.ok ? "good" : "neutral"} dot={s.ok ? "var(--color-good)" : "var(--color-ink-faint)"}>{s.label}{s.ok ? "" : ": ontbreekt"}</Badge>
          ))}
        </div>
      </div>

      <div className="grid gap-px border-t border-[var(--color-line)] bg-[var(--color-line)] lg:grid-cols-2">
        <TopList title="Belangrijkste inzichten" items={run.dossier.topInzichten} empty="Het onderzoek leverde geen samenvattende inzichten op." />
        <TopList title="Belangrijkste kansen voor Shortclips" items={run.dossier.topKansen} empty="Het onderzoek leverde geen samenvattende kansen op." accent />
      </div>

      {run.missing.length ? (
        <details className="group border-t border-[var(--color-line)]" open={run.missing.length <= 4}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 text-sm">
            <span className="flex items-center gap-2 font-medium"><span className="size-2 rounded-full bg-[var(--color-warn)]" />Ontbrekende informatie <span className="text-[var(--color-ink-muted)]">({run.missing.length})</span></span>
            <ChevronDown className="size-4 text-[var(--color-ink-faint)] transition-transform group-open:rotate-180" />
          </summary>
          <ul className="grid gap-x-6 gap-y-1.5 px-5 pb-4 text-sm text-[var(--color-ink-muted)] md:grid-cols-2">
            {run.missing.map((m) => <li key={m} className="flex gap-2"><span className="mt-2 size-1 shrink-0 rounded-full bg-[var(--color-ink-faint)]" />{m}</li>)}
          </ul>
        </details>
      ) : null}

      {view.history.length > 1 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--color-line)] px-5 py-3 text-xs text-[var(--color-ink-muted)]">
          <span className="font-medium text-[var(--color-ink)]">Geschiedenis</span>
          {view.history.map((h) => (
            <Link key={h.id} href={`/clients/${slug}?tab=onderzoek&onderzoek=${h.id}`} scroll={false} className={cn("rounded-full px-2 py-0.5 hover:bg-[var(--color-surface-sunken)]", h.id === run.id && "bg-[var(--color-neutral-soft)] font-medium text-[var(--color-ink)]")}>
              {h.kind === "hercontrole" ? "Hercontrole" : "Nulmeting"} {nlDate(h.date)}
            </Link>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--color-surface)] px-5 py-3">
      <dt className="text-xs text-[var(--color-ink-faint)]">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{value}</dd>
    </div>
  );
}

function TopList({ title, items, empty, accent }: { title: string; items: string[]; empty: string; accent?: boolean }) {
  return (
    <div className="bg-[var(--color-surface)] px-5 py-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      {items.length ? (
        <ol className="mt-2.5 space-y-2">
          {items.map((t, i) => (
            <li key={t} className="flex gap-2.5 text-sm">
              <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-2xs font-semibold", accent ? "bg-[var(--color-good)] text-white" : "bg-[var(--color-indigo-ink)] text-white")}>{i + 1}</span>
              <span>{t}</span>
            </li>
          ))}
        </ol>
      ) : <p className="mt-2 text-sm text-[var(--color-ink-muted)]">{empty}</p>}
      <p className="mt-3 text-2xs text-[var(--color-ink-faint)]">Samengevat door AI op basis van de bevindingen hieronder.</p>
    </div>
  );
}

/* ------------------------------ Hercontrole ----------------------------- */

function ChangesCard({ run }: { run: ResearchRunView }) {
  const { cijfers, inhoud } = run.changes;
  return (
    <Card>
      <h2 className="text-base font-semibold">Wat is veranderd sinds de nulmeting</h2>
      {cijfers.length === 0 && inhoud.length === 0 ? <p className="mt-1 text-sm text-[var(--color-ink-muted)]">Geen aantoonbare wijzigingen gevonden.</p> : null}
      {cijfers.length ? (
        <table className="mt-3 w-full text-left text-sm">
          <thead className="text-xs text-[var(--color-ink-faint)]"><tr><th className="py-1 font-medium">Platform</th><th className="font-medium">Cijfer</th><th className="text-right font-medium">Nulmeting</th><th className="text-right font-medium">Nu</th><th className="text-right font-medium">Verschil</th></tr></thead>
          <tbody>
            {cijfers.map((c) => (
              <tr key={`${c.platform}-${c.metric}-${c.herkomst}-${c.label}`} className="border-t border-[var(--color-line)]">
                <td className="py-1.5">{platformLabel(c.platform)}</td>
                <td>{c.label} <span className="text-xs text-[var(--color-ink-faint)]">({BASELINE_ORIGIN_LABEL[c.herkomst].toLowerCase()})</span></td>
                <td className="text-right tabular-nums">{fmt(c.was)}</td>
                <td className="text-right tabular-nums">{fmt(c.nu)}</td>
                <td className={cn("text-right font-medium tabular-nums", c.verschil > 0 ? "text-[#1d6b4c]" : c.verschil < 0 ? "text-[#a3271c]" : "")}>{c.verschil > 0 ? "+" : ""}{fmt(c.verschil)}{c.pct !== null ? ` (${c.pct > 0 ? "+" : ""}${c.pct.toLocaleString("nl-NL")}%)` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {inhoud.length ? (
        <ul className="mt-3 space-y-1.5 text-sm">
          {inhoud.map((t) => <li key={t} className="flex gap-2"><span className="mt-2 size-1 shrink-0 rounded-full bg-[var(--color-ink-faint)]" />{t}</li>)}
        </ul>
      ) : null}
      <p className="mt-3 text-2xs text-[var(--color-ink-faint)]">Cijfers worden alleen vergeleken met een cijfer van dezelfde herkomst. Een verschil zegt niets over de oorzaak.</p>
    </Card>
  );
}

/* --------------------------------- Modules ------------------------------ */

function ModuleCard({
  moduleKey,
  nr,
  title,
  hint,
  run,
  nulmeting,
  canManage,
}: {
  moduleKey: ModuleKey;
  nr: number;
  title: string;
  hint: string;
  run: ResearchRunView;
  nulmeting: BaselineRow[] | null;
  canManage: boolean;
}) {
  const mod = moduleKey === "nulmeting" ? null : run.dossier.modules[moduleKey as TextModuleKey];
  const findings = mod ? applyCorrections(mod.bevindingen, run.corrections) : [];
  const hidden = mod ? mod.bevindingen.filter((f) => run.corrections[f.id]?.verborgen) : [];
  const additions = run.additions.filter((a) => a.module === moduleKey);
  const count = moduleKey === "nulmeting" ? run.baseline.length : findings.length + additions.length;
  const conclusie = moduleKey === "nulmeting"
    ? run.baseline.length ? `${run.baseline.length} cijfers vastgelegd op ${nlDate(run.basis.onderzoeksdatum ?? run.finishedAt)}.` : "Nog geen cijfers beschikbaar. Voeg ze handmatig toe of koppel de accounts."
    : mod?.conclusie || "Geen aantoonbare informatie gevonden.";

  return (
    <details className="sc-card group" id={`module-${moduleKey}`}>
      <summary className="flex cursor-pointer list-none items-start gap-3.5 px-5 py-4">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-indigo-ink)] text-xs font-semibold text-white">{nr}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{title}</span>
            <span className="text-xs text-[var(--color-ink-faint)] group-open:hidden">{hint}</span>
          </span>
          <span className="mt-1 block text-sm text-[var(--color-ink-muted)]">{conclusie}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {count > 0 ? <span className="rounded-full bg-[var(--color-neutral-soft)] px-2 py-0.5 text-2xs font-semibold tabular-nums text-[var(--color-ink-muted)]">{count}</span> : <Badge tone="warn">Leeg</Badge>}
          <ChevronDown className="size-4 text-[var(--color-ink-faint)] transition-transform group-open:rotate-180" />
        </span>
      </summary>

      <div className="space-y-5 border-t border-[var(--color-line)] px-5 py-4">
        {moduleKey === "nulmeting" ? <BaselineBlock run={run} nulmeting={nulmeting} canManage={canManage} /> : null}
        {moduleKey === "social" ? <Channels run={run} /> : null}
        {moduleKey === "marketing_software" ? <Software run={run} /> : null}
        {moduleKey === "concurrenten" ? <Competitors run={run} /> : null}
        {moduleKey === "strategie" ? <Strategy run={run} /> : null}

        {findings.length ? (
          <ul className="divide-y divide-[var(--color-line)]">
            {findings.map((f) => (
              <li key={f.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-start gap-3">
                  <Badge tone={KIND_TONE[f.soort]} className="mt-0.5 shrink-0">{FINDING_KIND_LABEL[f.soort]}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{f.tekst}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--color-ink-faint)]">
                      <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full" style={{ background: CONF_DOT[f.betrouwbaarheid] }} />Betrouwbaarheid {CONFIDENCE_LABEL[f.betrouwbaarheid].toLowerCase()}</span>
                      {f.bronUrl ? (
                        <a href={f.bronUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[var(--color-brand-600)] hover:underline">{f.bron ?? "Bron"} <ExternalLink className="size-3" /></a>
                      ) : <span>{f.bron ?? "Geen bron vermeld"}</span>}
                      <span>{nlDate(run.finishedAt)}</span>
                      {f.gecorrigeerdDoor ? <span className="text-[#1d6b4c]">Gecorrigeerd door {f.gecorrigeerdDoor}</span> : null}
                    </p>
                    {f.origineel ? <p className="mt-1 text-xs text-[var(--color-ink-faint)]">Onderzoek schreef: {f.origineel}</p> : null}
                  </div>
                  {canManage ? <FindingTools runId={run.id} findingId={f.id} tekst={f.tekst} corrected={Boolean(f.origineel)} /> : null}
                </div>
              </li>
            ))}
          </ul>
        ) : moduleKey !== "nulmeting" ? <p className="text-sm text-[var(--color-ink-muted)]">Het onderzoek vond hier niets wat aantoonbaar is. Er is niets ingevuld om de module te vullen.</p> : null}

        {additions.length ? <Additions runId={run.id} items={additions} canManage={canManage} /> : null}

        {mod?.ontbreekt.length ? (
          <div className="rounded-[var(--radius-sm)] bg-[var(--color-warn-soft)] px-3.5 py-3">
            <p className="text-xs font-semibold text-[#8a5300]">Niet gevonden of niet openbaar</p>
            <ul className="mt-1.5 space-y-1 text-sm text-[#8a5300]">
              {mod.ontbreekt.map((o) => <li key={o}>{o}</li>)}
            </ul>
          </div>
        ) : null}

        {hidden.length && canManage ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-xs text-[var(--color-ink-faint)]">{hidden.length} {hidden.length === 1 ? "bevinding" : "bevindingen"} verborgen door het team</summary>
            <ul className="mt-2 space-y-2">
              {hidden.map((f) => (
                <li key={f.id} className="flex items-start justify-between gap-3 text-[var(--color-ink-muted)]">
                  <span className="line-through">{f.tekst}</span>
                  <RestoreFindingButton runId={run.id} findingId={f.id} />
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {canManage ? <AddFindingForm runId={run.id} module={moduleKey} placeholder={ADD_PLACEHOLDER[moduleKey] ?? "Wat weet jij dat het onderzoek niet kon vinden?"} /> : null}
      </div>
    </details>
  );
}

function Additions({ runId, items, canManage }: { runId: string; items: Addition[]; canManage: boolean }) {
  return (
    <ul className="space-y-2">
      {items.map((a) => (
        <li key={a.id} className="flex items-start gap-3 rounded-[var(--radius-sm)] bg-[var(--color-good-soft)] px-3.5 py-2.5">
          <Badge tone="good" className="mt-0.5 shrink-0 bg-white">{FINDING_KIND_LABEL.handmatig}</Badge>
          <div className="min-w-0 flex-1">
            <p className="text-sm">{a.tekst}</p>
            <p className="mt-0.5 text-xs text-[var(--color-ink-faint)]">{a.door}, {nlDate(a.op)}</p>
          </div>
          {canManage ? <RemoveAdditionButton runId={runId} additionId={a.id} /> : null}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------- Nulmeting ------------------------------ */

function BaselineBlock({ run, nulmeting, canManage }: { run: ResearchRunView; nulmeting: BaselineRow[] | null; canManage: boolean }) {
  const rows = [...run.baseline].sort((a, b) => a.platform.localeCompare(b.platform) || a.metric.localeCompare(b.metric));
  const followers = rows.filter((r) => r.metric === "volgers");
  const max = Math.max(1, ...followers.map((r) => r.value));
  const diff = nulmeting ? compareBaselines(nulmeting, run.baseline) : [];
  const diffOf = (r: BaselineRow) => diff.find((d) => d.platform === r.platform && d.metric === r.metric && d.herkomst === r.herkomst && (r.metric !== "anders" || d.label === r.label));

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--color-ink-faint)]">
        Elk cijfer heeft een herkomst. <strong className="font-medium text-[var(--color-ink-muted)]">Openbaar</strong>: zichtbaar op het profiel. <strong className="font-medium text-[var(--color-ink-muted)]">Gekoppeld account</strong>: uit Metricool. <strong className="font-medium text-[var(--color-ink-muted)]">Handmatig</strong>: door het team ingevoerd, met vermelding van de herkomst. Cijfers die nergens beschikbaar zijn, staan er niet.
      </p>

      {followers.length ? (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-ink-faint)]">Volgers per kanaal</p>
          {followers.map((r) => (
            <div key={r.id} className="grid grid-cols-[110px_1fr_auto] items-center gap-3 text-sm">
              <span>{platformLabel(r.platform)}</span>
              <span className="h-2.5 overflow-hidden rounded-full bg-[var(--color-neutral-soft)]"><span className="block h-full rounded-full bg-[var(--color-indigo-ink)]" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} /></span>
              <span className="w-28 text-right font-medium tabular-nums">{fmt(r.value)} <span className="text-2xs font-normal text-[var(--color-ink-faint)]">{BASELINE_ORIGIN_LABEL[r.herkomst].split(" ")[0]!.toLowerCase()}</span></span>
            </div>
          ))}
        </div>
      ) : null}

      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs text-[var(--color-ink-faint)]">
              <tr><th className="py-1 font-medium">Platform</th><th className="font-medium">Cijfer</th><th className="text-right font-medium">Waarde</th>{nulmeting ? <th className="text-right font-medium">Sinds nulmeting</th> : null}<th className="pl-4 font-medium">Herkomst</th><th className="font-medium">Bron</th><th className="font-medium">Gemeten op</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const d = diffOf(r);
                return (
                  <tr key={r.id} className="border-t border-[var(--color-line)]">
                    <td className="py-2">{platformLabel(r.platform)}</td>
                    <td>{r.metric === "anders" ? r.label || "Overig" : BASELINE_METRICS[r.metric]}</td>
                    <td className="text-right font-medium tabular-nums">{fmt(r.value)}</td>
                    {nulmeting ? <td className={cn("text-right tabular-nums", d && d.verschil > 0 ? "text-[#1d6b4c]" : d && d.verschil < 0 ? "text-[#a3271c]" : "text-[var(--color-ink-faint)]")}>{d ? `${d.verschil > 0 ? "+" : ""}${fmt(d.verschil)}` : "geen vergelijking"}</td> : null}
                    <td className="pl-4"><Badge tone={ORIGIN_TONE[r.herkomst]}>{BASELINE_ORIGIN_LABEL[r.herkomst]}</Badge></td>
                    <td className="max-w-[220px] truncate text-[var(--color-ink-muted)]" title={r.bron}>
                      {/^https?:\/\//.test(r.bron) ? <a href={r.bron} target="_blank" rel="noopener noreferrer" className="text-[var(--color-brand-600)] hover:underline">Profiel</a> : r.bron}{r.door ? `, ${r.door}` : ""}
                    </td>
                    <td className="whitespace-nowrap text-[var(--color-ink-muted)]">{nlDate(r.gemetenOp)}</td>
                    <td className="text-right">{r.herkomst === "handmatig" && canManage ? <RemoveBaselineButton runId={run.id} rowId={r.id} /> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <p className="text-sm text-[var(--color-ink-muted)]">Er zijn geen openbare cijfers gevonden en er zijn geen accounts gekoppeld. Views, bereik en engagement zijn alleen beschikbaar via een gekoppeld account of handmatige invoer.</p>}

      {canManage ? <BaselineForm runId={run.id} /> : null}
    </div>
  );
}

/* ---------------------------- Module-specifiek -------------------------- */

function Channels({ run }: { run: ResearchRunView }) {
  const list = run.dossier.kanalen;
  if (!list.length) return null;
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {list.map((k) => (
        <div key={k.platform} className="rounded-[var(--radius-sm)] border border-[var(--color-line)] px-3.5 py-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">{platformLabel(k.platform)}</span>
            <Badge tone={k.gevonden ? "good" : "neutral"}>{k.gevonden ? "Gevonden" : "Niet gevonden"}</Badge>
          </div>
          <p className="mt-1.5 text-lg font-semibold tabular-nums">{k.volgers !== null ? fmt(k.volgers) : <span className="text-sm font-normal text-[var(--color-ink-faint)]">Volgers niet openbaar</span>}{k.volgers !== null ? <span className="ml-1 text-xs font-normal text-[var(--color-ink-faint)]">volgers</span> : null}</p>
          {k.frequentie ? <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">{k.frequentie}</p> : null}
          {k.opmerking ? <p className="mt-1 text-xs text-[var(--color-ink-muted)]">{k.opmerking}</p> : null}
          {k.url ? <a href={k.url} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-xs text-[var(--color-brand-600)] hover:underline">Profiel openen <ExternalLink className="size-3" /></a> : null}
        </div>
      ))}
    </div>
  );
}

function Software({ run }: { run: ResearchRunView }) {
  const list = run.dossier.software;
  if (!list.length) return null;
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-xs text-[var(--color-ink-faint)]"><tr><th className="py-1 font-medium">Categorie</th><th className="font-medium">Systeem</th><th className="font-medium">Status</th><th className="font-medium">Waar zichtbaar</th></tr></thead>
      <tbody>
        {list.map((s) => (
          <tr key={`${s.categorie}-${s.naam}`} className="border-t border-[var(--color-line)]">
            <td className="py-2">{s.categorie}</td>
            <td className={s.status === "zichtbaar" ? "font-medium" : "text-[var(--color-ink-faint)]"}>{s.status === "zichtbaar" ? s.naam : "Onbekend"}</td>
            <td><Badge tone={s.status === "zichtbaar" ? "good" : "warn"}>{s.status === "zichtbaar" ? "Zichtbaar" : "Nog bevestigen"}</Badge></td>
            <td className="text-[var(--color-ink-muted)]">{s.bewijs ?? "Niet openbaar"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Competitors({ run }: { run: ResearchRunView }) {
  const list = run.dossier.concurrenten;
  if (!list.length) return null;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {list.map((c) => (
        <div key={c.naam} className="rounded-[var(--radius-sm)] border border-[var(--color-line)] px-4 py-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold">{c.naam}</span>
            <span className="flex flex-wrap gap-2 text-xs text-[var(--color-brand-600)]">
              {c.url ? <a href={c.url} target="_blank" rel="noopener noreferrer" className="hover:underline">Website</a> : null}
              {c.instagram ? <span className="text-[var(--color-ink-muted)]">IG {c.instagram}</span> : null}
              {c.tiktok ? <span className="text-[var(--color-ink-muted)]">TikTok {c.tiktok}</span> : null}
              {c.youtube ? <span className="text-[var(--color-ink-muted)]">YouTube {c.youtube}</span> : null}
            </span>
          </div>
          <dl className="mt-2 space-y-1.5 text-sm">
            {c.aanpak ? <div><dt className="text-xs text-[var(--color-ink-faint)]">Aanpak</dt><dd>{c.aanpak}</dd></div> : null}
            {c.watWerkt ? <div><dt className="text-xs text-[var(--color-ink-faint)]">Wat lijkt te werken</dt><dd>{c.watWerkt}</dd></div> : null}
            {c.kansVoorKlant ? <div><dt className="text-xs text-[var(--color-ink-faint)]">Kans voor deze klant</dt><dd>{c.kansVoorKlant}</dd></div> : null}
          </dl>
        </div>
      ))}
    </div>
  );
}

function Strategy({ run }: { run: ResearchRunView }) {
  const s = run.dossier.strategie;
  const empty = !s.pijlers.length && !s.formats.length && !s.hooks.length && !s.scriptideeen.length;
  if (empty) return null;
  return (
    <div className="space-y-5">
      <p className="rounded-[var(--radius-sm)] bg-[var(--color-violet-soft)] px-3.5 py-2.5 text-xs text-[#5636c4]">Dit is een eerste AI advies op basis van het onderzoek, geen bewezen aanpak. Zodra er eigen resultaten zijn, neemt het Contentgeheugen het over met wat aantoonbaar werkt.</p>
      <div className="grid gap-5 lg:grid-cols-2">
        {s.pijlers.length ? <StratBlock title="Contentpijlers"><StratPairs items={s.pijlers} /></StratBlock> : null}
        {s.formats.length ? <StratBlock title="Formats"><StratPairs items={s.formats} /></StratBlock> : null}
        {s.hooks.length ? <StratBlock title="Hooks om te testen"><ul className="space-y-1.5">{s.hooks.map((h) => <li key={h} className="rounded-[var(--radius-sm)] bg-[var(--color-surface-sunken)] px-3 py-2 text-sm">{h}</li>)}</ul></StratBlock> : null}
        {s.scriptideeen.length ? (
          <StratBlock title="Eerste scriptideeën">
            <ul className="space-y-2.5">{s.scriptideeen.map((i) => <li key={i.titel} className="text-sm"><span className="font-medium">{i.titel}</span>{i.hook ? <span className="block text-[var(--color-ink-muted)]">Hook: {i.hook}</span> : null}{i.kern ? <span className="block text-[var(--color-ink-muted)]">{i.kern}</span> : null}</li>)}</ul>
          </StratBlock>
        ) : null}
        {s.opnames.length ? <StratBlock title="Opnamemogelijkheden"><StratBullets items={s.opnames} /></StratBlock> : null}
        {s.verbeterpunten.length ? <StratBlock title="Verbeterpunten"><StratBullets items={s.verbeterpunten} /></StratBlock> : null}
      </div>
    </div>
  );
}

function StratBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return <div><p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--color-ink-faint)]">{title}</p>{children}</div>;
}

function StratPairs({ items }: { items: { naam: string; waarom: string }[] }) {
  return <ul className="space-y-2">{items.map((p) => <li key={p.naam} className="text-sm"><span className="font-medium">{p.naam}</span><span className="block text-[var(--color-ink-muted)]">{p.waarom}</span></li>)}</ul>;
}

function StratBullets({ items }: { items: string[] }) {
  return <ul className="space-y-1.5 text-sm">{items.map((t) => <li key={t} className="flex gap-2"><span className="mt-2 size-1 shrink-0 rounded-full bg-[var(--color-ink-faint)]" />{t}</li>)}</ul>;
}

function Sources({ run }: { run: ResearchRunView }) {
  if (!run.sources.length) return null;
  return (
    <details className="sc-card group">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3.5 text-sm font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
        Gebruikte bronnen ({run.sources.length})
        <ChevronDown className="size-4 text-[var(--color-ink-faint)] transition-transform group-open:rotate-180" />
      </summary>
      <ul className="grid gap-x-6 gap-y-1.5 border-t border-[var(--color-line)] px-5 py-4 text-sm md:grid-cols-2">
        {run.sources.map((s) => (
          <li key={s.url} className="truncate"><a href={s.url} target="_blank" rel="noopener noreferrer" className="text-[var(--color-brand-600)] hover:underline">{s.label}</a></li>
        ))}
      </ul>
    </details>
  );
}
