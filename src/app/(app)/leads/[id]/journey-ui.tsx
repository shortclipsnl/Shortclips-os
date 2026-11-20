"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, ChevronDown, ChevronRight, Copy, ExternalLink, Loader2, Lock, Zap } from "lucide-react";
import {
  completePhaseAction,
  saveCentralLinkAction,
  saveDefaultMessageAction,
  saveLeadLinkAction,
  saveLeadMessageAction,
  setAssigneeAction,
  setPhaseStatusAction,
  startJourneyAction,
  toggleCheckAction,
} from "@/server/actions/lead-journey";
import type { JourneyView, MessageView, PhaseView } from "@/server/lead-journey";
import { STATUS_LABEL, type JourneyStatus } from "@/lib/lead-journey";
import { ConvertButton } from "../convert-dialog";

const STATUS_STYLE: Record<JourneyStatus, string> = {
  nog_niet: "bg-[var(--color-neutral-soft)] text-[var(--color-ink-muted)]",
  bezig: "bg-[var(--color-info-soft)] text-[#0060a8]",
  wacht_klant: "bg-[var(--color-warn-soft)] text-[#8a5300]",
  klaar: "bg-[var(--color-good-soft)] text-[#1d6b4c]",
};

const smallBtn =
  "inline-flex items-center gap-1 rounded-full border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--color-surface-sunken)] disabled:opacity-50";
const primaryBtn =
  "inline-flex items-center gap-1 rounded-full bg-[var(--color-indigo-ink)] px-3.5 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50";

type Res = { ok: boolean; message?: string };

function useRun() {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  function run(fn: () => Promise<Res>, after?: () => void) {
    setErr(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setErr(r.message ?? "Mislukt");
      else after?.();
      router.refresh();
    });
  }
  return { pending, err, run };
}

export function JourneyBoard({ view }: { view: JourneyView }) {
  const [open, setOpen] = useState<string | null>(view.currentKey ?? view.phases[view.phases.length - 1]!.def.key);
  const { pending, err, run } = useRun();

  return (
    <div>
      {!view.started ? (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
          <div className="min-w-60 flex-1 text-sm text-[var(--color-ink-muted)]">
            Deze lead heeft nog geen actieve leadreis. Start de reis om de openstaande fase als taak in het takenoverzicht te krijgen.
          </div>
          <button type="button" className={primaryBtn} disabled={pending} onClick={() => run(() => startJourneyAction(view.leadId))}>
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />} Start leadreis
          </button>
        </div>
      ) : null}

      {/* Stappenbalk: waar staat deze lead nu? */}
      <ol className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        {view.phases.map((p) => {
          const klaar = p.status === "klaar";
          return (
            <li key={p.def.key}>
              <button
                type="button"
                onClick={() => setOpen(p.def.key)}
                className={`flex h-full w-full flex-col items-start gap-1 rounded-[var(--radius-md)] border p-2.5 text-left transition ${
                  open === p.def.key ? "border-[var(--color-indigo-ink)] shadow-sm" : "border-[var(--color-line)] hover:border-[var(--color-line-strong)]"
                } ${p.isCurrent ? "bg-[var(--color-info-soft)]" : "bg-[var(--color-surface)]"}`}
              >
                <span className={`inline-flex size-5 items-center justify-center rounded-full text-2xs font-bold ${klaar ? "bg-[var(--color-good)] text-white" : p.isCurrent ? "bg-[var(--color-indigo-ink)] text-white" : "bg-[var(--color-neutral-soft)] text-[var(--color-ink-muted)]"}`}>
                  {klaar ? <Check className="size-3" /> : p.def.nr}
                </span>
                <span className="text-xs font-semibold leading-tight text-[var(--color-ink)]">{p.def.title}</span>
                <span className="text-2xs text-[var(--color-ink-faint)]">{p.done}/{p.total} punten</span>
              </button>
            </li>
          );
        })}
      </ol>

      {err ? <div className="mb-3 text-xs text-[var(--color-bad)]">{err}</div> : null}

      <div className="space-y-3">
        {view.phases.map((p) => (
          <PhaseCard key={p.def.key} view={view} p={p} expanded={open === p.def.key} onToggle={() => setOpen(open === p.def.key ? null : p.def.key)} />
        ))}
      </div>

      <LinksCard view={view} />
    </div>
  );
}

function PhaseCard({ view, p, expanded, onToggle }: { view: JourneyView; p: PhaseView; expanded: boolean; onToggle: () => void }) {
  const { pending, err, run } = useRun();
  const def = p.def;
  const locked = def.clientPhase && !view.clientSlug;
  const allChecked = p.checks.every((c) => c.checked);

  return (
    <section className={`rounded-[var(--radius-md)] border bg-[var(--color-surface)] ${p.isCurrent ? "border-[var(--color-indigo-ink)]" : "border-[var(--color-line)]"}`}>
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        {expanded ? <ChevronDown className="size-4 text-[var(--color-ink-faint)]" /> : <ChevronRight className="size-4 text-[var(--color-ink-faint)]" />}
        <span className="text-xs font-bold text-[var(--color-ink-faint)]">Fase {def.nr}</span>
        <span className="flex-1 text-sm font-semibold text-[var(--color-ink)]">{def.title}</span>
        {p.assigneeName ? <span className="hidden text-xs text-[var(--color-ink-muted)] sm:inline">{p.assigneeName}</span> : null}
        <span className={`rounded-full px-2.5 py-1 text-2xs font-semibold ${STATUS_STYLE[p.status]}`}>{STATUS_LABEL[p.status]}</span>
      </button>

      {expanded ? (
        <div className="border-t border-[var(--color-line)] px-4 pb-4 pt-3">
          <p className="mb-3 text-sm text-[var(--color-ink-muted)]">{def.explain}</p>

          {locked ? (
            <div className="mb-3 flex items-start gap-2 rounded-[var(--radius-sm)] bg-[var(--color-neutral-soft)] p-3 text-xs text-[var(--color-ink-muted)]">
              <Lock className="mt-0.5 size-3.5 shrink-0" />
              <span>Deze fase start zodra de lead een klant is (fase 4). Zet de lead om na ondertekening. De onboarding start dan automatisch.</span>
            </div>
          ) : null}

          <div className="mb-3 flex flex-wrap items-center gap-3 text-xs">
            <label className="flex items-center gap-1.5 text-[var(--color-ink-muted)]">
              Status
              <select className="sc-input h-8 w-auto py-0 text-xs" value={p.status} disabled={pending}
                onChange={(e) => run(() => setPhaseStatusAction({ leadId: view.leadId, phaseKey: def.key, status: e.target.value as JourneyStatus }))}>
                {(Object.keys(STATUS_LABEL) as JourneyStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </label>
            {def.role !== "team" ? (
              <label className="flex items-center gap-1.5 text-[var(--color-ink-muted)]">
                Verantwoordelijk
                <select className="sc-input h-8 w-auto py-0 text-xs" value={p.assigneeId ?? ""} disabled={pending}
                  onChange={(e) => run(() => setAssigneeAction({ leadId: view.leadId, phaseKey: def.key, assigneeId: e.target.value || null }))}>
                  <option value="">Nog niemand</option>
                  {view.pms.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </label>
            ) : (
              <span className="text-[var(--color-ink-muted)]">Verantwoordelijk: productieteam</span>
            )}
            {pending ? <Loader2 className="size-3.5 animate-spin text-[var(--color-ink-faint)]" /> : null}
          </div>

          <ul className="mb-3 space-y-1.5">
            {p.checks.map((c) => (
              <li key={c.key}>
                <label className={`flex items-start gap-2 text-sm ${c.auto ? "text-[var(--color-ink-muted)]" : "cursor-pointer text-[var(--color-ink)]"}`}>
                  <input type="checkbox" className="mt-0.5 size-4" checked={c.checked} disabled={pending || c.auto}
                    onChange={(e) => run(() => toggleCheckAction({ leadId: view.leadId, phaseKey: def.key, itemKey: c.key, value: e.target.checked }))} />
                  <span>
                    {c.label}
                    {c.auto ? <span className="ml-1.5 text-2xs text-[var(--color-good)]">automatisch bijgewerkt</span> : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>

          {def.key === "ondertekend" && !view.clientSlug ? (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--color-surface-sunken)] p-3 text-xs text-[var(--color-ink-muted)]">
              <span className="flex-1">Na ondertekening zet je de lead om naar een klant. De Drive-map, taken en het welkomstbericht worden dan klaargezet.</span>
              <ConvertButton leadId={view.leadId} />
            </div>
          ) : null}

          {def.clientPhase && view.clientSlug ? (
            <Link href={`/clients/${view.clientSlug}?tab=onboarding`} className={`${smallBtn} mb-3`}>
              <ExternalLink className="size-3.5" /> Open de klantonboarding voor details
            </Link>
          ) : null}

          {def.messages.map((k) => {
            const m = view.messages.find((x) => x.key === k);
            return m ? <MessageBox key={k} leadId={view.leadId} m={m} /> : null;
          })}

          {err ? <div className="mb-2 text-xs text-[var(--color-bad)]">{err}</div> : null}

          <div className="flex flex-wrap items-center gap-2">
            {p.status !== "klaar" ? (
              <button type="button" disabled={pending || Boolean(locked)} className={primaryBtn} onClick={() => run(() => completePhaseAction({ leadId: view.leadId, phaseKey: def.key }))}>
                <Check className="size-3.5" /> Fase afronden
              </button>
            ) : (
              <button type="button" disabled={pending} className={smallBtn} onClick={() => run(() => setPhaseStatusAction({ leadId: view.leadId, phaseKey: def.key, status: "bezig" }))}>
                Fase heropenen
              </button>
            )}
            {p.status !== "klaar" && !allChecked && !locked ? <span className="text-2xs text-[var(--color-ink-faint)]">Nog niet alle punten zijn afgevinkt.</span> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function MessageBox({ leadId, m }: { leadId: string; m: MessageView }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(m.text);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const { pending, err, run } = useRun();
  const dirty = val !== m.text;
  const missing = [...val.matchAll(/\[nog koppelen: ([^\]]+)\]/g)].map((x) => x[1]!);

  return (
    <div className="mb-3 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface-sunken)]/50">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-[var(--color-ink)]">
        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        {open ? m.title : <>Klik hier voor het bericht <span className="font-normal text-[var(--color-ink-muted)]">· {m.title}</span></>}
        {m.source === "lead" ? <span className="ml-auto rounded-full bg-[var(--color-info-soft)] px-2 py-0.5 text-2xs text-[#0060a8]">Aangepast voor deze lead</span> : null}
      </button>
      {open ? (
        <div className="px-3 pb-3">
          <p className="mb-2 text-2xs text-[var(--color-ink-faint)]">{m.hint} Klik in de tekst om aan te passen.</p>
          <textarea value={val} onChange={(e) => { setVal(e.target.value); setNote(null); }} rows={13} className="sc-input w-full resize-y py-2 text-sm leading-relaxed" aria-label={m.title} />
          {missing.length ? (
            <p className="mt-1 text-2xs text-[var(--color-warn)]">
              Nog te koppelen: {missing.join(", ")}. Vul de link hieronder in bij Links, of pas de tekst aan voordat je kopieert.
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" className={primaryBtn} onClick={async () => {
              try { await navigator.clipboard.writeText(val); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setNote("Kopiëren lukt niet, selecteer de tekst handmatig."); }
            }}>
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? "Gekopieerd" : "Kopieer bericht"}
            </button>
            <button type="button" className={smallBtn} disabled={pending || !dirty} onClick={() => run(() => saveLeadMessageAction({ leadId, key: m.key, text: val }), () => setNote("Opgeslagen voor deze lead."))}>
              Opslaan voor deze lead
            </button>
            <button type="button" className={smallBtn} disabled={pending} title="Gebruikt deze tekst voor alle leads. Gebruik {voornaam} en {bedrijf} voor gegevens die per lead wisselen."
              onClick={() => { if (window.confirm("Deze tekst wordt de nieuwe standaard voor alle leads. Doorgaan?")) run(() => saveDefaultMessageAction({ key: m.key, text: val }), () => setNote("Opgeslagen als standaard.")); }}>
              Opslaan als standaard
            </button>
            {m.source === "lead" ? (
              <button type="button" className={smallBtn} disabled={pending} onClick={() => run(() => saveLeadMessageAction({ leadId, key: m.key, text: null }), () => { setVal(m.defaultBody); setNote("Terug naar de standaard."); })}>
                Terug naar standaard
              </button>
            ) : null}
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {note ? <span className="text-2xs text-[var(--color-good)]">{note}</span> : null}
            {err ? <span className="text-2xs text-[var(--color-bad)]">{err}</span> : null}
          </div>
          <p className="mt-2 text-2xs text-[var(--color-ink-faint)]">Dit bericht wordt nooit automatisch verstuurd. Kopieer het en verstuur het zelf.</p>
        </div>
      ) : null}
    </div>
  );
}

function LinkField({ label, value, onSave, hint }: { label: string; value: string; onSave: (v: string) => Promise<Res>; hint?: string }) {
  const [val, setVal] = useState(value);
  const [note, setNote] = useState<string | null>(null);
  const { pending, err, run } = useRun();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="w-56 text-xs text-[var(--color-ink-muted)]">{label}{hint ? <span className="block text-2xs text-[var(--color-ink-faint)]">{hint}</span> : null}</label>
      <input className="sc-input h-8 min-w-60 flex-1 py-0 text-xs" placeholder="https://…" value={val} onChange={(e) => { setVal(e.target.value); setNote(null); }} />
      <button type="button" className={smallBtn} disabled={pending || val === value} onClick={() => run(() => onSave(val), () => setNote("Opgeslagen"))}>
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : null} Opslaan
      </button>
      {note ? <span className="text-2xs text-[var(--color-good)]">{note}</span> : null}
      {err ? <span className="text-2xs text-[var(--color-bad)]">{err}</span> : null}
    </div>
  );
}

function LinksCard({ view }: { view: JourneyView }) {
  return (
    <section className="mt-5 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <h3 className="text-sm font-semibold text-[var(--color-ink)]">Links in de berichten</h3>
      <p className="mb-3 text-xs text-[var(--color-ink-muted)]">Een link die hier leeg is, blijft in het bericht zichtbaar als nog koppelen. Er wordt nooit een link verzonnen.</p>
      <div className="space-y-2.5">
        <LinkField label="PandaDoc-link van het voorstel" hint="Alleen voor deze lead" value={view.pandadocLink}
          onSave={(v) => saveLeadLinkAction({ leadId: view.leadId, key: "pandadoc_link", url: v || null })} />
        {view.links.map((l) => (
          <LinkField key={l.key} label={l.label} hint="Voor alle leads" value={l.central} onSave={(v) => saveCentralLinkAction({ key: l.key, url: v || null })} />
        ))}
      </div>
    </section>
  );
}
