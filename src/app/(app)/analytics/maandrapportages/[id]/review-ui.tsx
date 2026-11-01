"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Sparkles, FileDown, Check, RotateCcw, Save, Send, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Badge, buttonClass, type Tone } from "@/components/ui";
import {
  approveMonthlyReport, generatePersonalText, publishMonthlyReport, requestReportChanges,
  saveReportAnalysis, saveReportBeoordeling, startMonthlyReport, unpublishMonthlyReport,
} from "@/server/actions/monthly-reports";
import type { ReportDetail } from "@/server/reports/service";
import { STATUS_META } from "../report-list";

type Rec = { titel: string; waarom?: string; wat?: string; hoeMeten?: string; zekerheid?: string };
type Actie = { titel: string; waarom?: string };
type Punt = { type?: string; tekst: string };

const ZTONE: Record<string, Tone> = { bewezen: "good", waarschijnlijk: "info", hypothese: "warn" };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">{title}</p>
      {children}
    </div>
  );
}

export function ReviewUI({ report, canWrite, aiReady }: { report: ReportDetail; canWrite: boolean; aiReady: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const a = report.analysis;
  const [aandacht] = useState<Punt[]>((a?.aandachtspunten as Punt[]) ?? []);
  const [acties, setActies] = useState<Actie[]>((a?.strategischeActies as Actie[]) ?? []);
  const [verbeter, setVerbeter] = useState<Rec[]>((a?.verbeterpunten as Rec[]) ?? []);
  const [b, setB] = useState({
    positief: report.beoordeling.positief ?? "",
    verbeteren: report.beoordeling.verbeteren ?? "",
    volgendeMaand: report.beoordeling.volgendeMaand ?? "",
    klanttekst: report.beoordeling.klanttekst ?? "",
  });

  const busy = report.status === "analyse_bezig" || report.status === "gegevens_verzamelen";
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [busy, router]);

  const st = STATUS_META[report.status] ?? STATUS_META.gegevens_verzamelen;
  const blokken = report.quality.filter((q) => q.severity === "blok");
  const canApprove = blokken.length === 0 && (report.status === "klaar_voor_controle" || report.status === "aanpassing_nodig");

  const suggesties = [
    ...(a?.analysis?.watWerkt ?? []).map((f) => f.punt),
    ...(a?.besteFormats ?? []).map((f) => `Het format '${f.format}' presteert bovengemiddeld`),
    ...verbeter.map((r) => r.titel),
  ].filter(Boolean).slice(0, 6);

  function run(fn: () => Promise<{ ok: boolean; message?: string }>, after?: () => void) {
    setMsg(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setMsg(res.message ?? "Er ging iets mis.");
      else after?.();
      router.refresh();
    });
  }
  const saveAnalysis = () => run(() => saveReportAnalysis(report.id, { ...a, aandachtspunten: aandacht, strategischeActies: acties, verbeterpunten: verbeter }));
  const saveBeoordeling = () => run(() => saveReportBeoordeling(report.id, b));
  const makeText = () => start(async () => {
    const res = await generatePersonalText(report.id);
    if (res.ok && "text" in res && res.text) setB((p) => ({ ...p, klanttekst: res.text! }));
    else setMsg(res.message ?? "Tekst maken mislukt.");
  });
  const addSuggestie = (key: "positief" | "verbeteren" | "volgendeMaand", s: string) => setB((p) => ({ ...p, [key]: p[key] ? `${p[key]}\n- ${s}` : `- ${s}` }));

  if (busy) {
    return (
      <div className="sc-card flex items-center gap-3 p-6 text-sm text-[var(--color-ink-muted)]">
        <Loader2 className="size-5 animate-spin text-[var(--color-info)]" /> De AI-analyse wordt opgesteld uit de echte cijfers… dit ververst vanzelf.
      </div>
    );
  }

  if (report.status === "mislukt") {
    return (
      <div className="space-y-3">
        <div className="sc-card flex items-start gap-3 p-5 text-sm">
          <AlertTriangle className="mt-0.5 size-5 text-[var(--color-bad)]" />
          <div><p className="font-medium text-[var(--color-ink)]">Analyse mislukt</p><p className="text-[var(--color-ink-muted)]">{report.errorMessage ?? "Onbekende fout."}</p></div>
        </div>
        {canWrite ? <button type="button" disabled={pending || !aiReady} onClick={() => run(() => startMonthlyReport(report.clientId, report.period, "full"))} className={buttonClass({ variant: "primary", size: "md" })}>{pending ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />} Opnieuw proberen</button> : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Actiebalk */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={st.tone}>{st.label}</Badge>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Link href={`/api/reports/monthly/${report.id}/pdf`} target="_blank" className={buttonClass({ variant: "ghost", size: "sm" })}><FileDown className="size-3.5" /> PDF-voorbeeld</Link>
          {canWrite ? <>
            <button type="button" disabled={pending || !aiReady} onClick={() => run(() => startMonthlyReport(report.clientId, report.period, "ai_only"))} className={buttonClass({ variant: "ghost", size: "sm" })}><Sparkles className="size-3.5" /> AI opnieuw</button>
            {report.status === "goedgekeurd" || report.status === "gepubliceerd" ? (
              report.status === "gepubliceerd"
                ? <button type="button" disabled={pending} onClick={() => run(() => unpublishMonthlyReport(report.id))} className={buttonClass({ variant: "secondary", size: "sm" })}>Publicatie terugtrekken</button>
                : <button type="button" disabled={pending} onClick={() => run(() => publishMonthlyReport(report.id))} className={buttonClass({ variant: "primary", size: "sm" })}><Send className="size-3.5" /> Publiceren naar portaal</button>
            ) : (
              <button type="button" disabled={pending || !canApprove} title={canApprove ? "" : "Rond eerst de verplichte controlepunten af"} onClick={() => run(() => approveMonthlyReport(report.id))} className={buttonClass({ variant: "primary", size: "sm" })}><Check className="size-3.5" /> Goedkeuren</button>
            )}
          </> : null}
        </div>
      </div>
      {msg ? <p className="text-xs text-[var(--color-bad)]">{msg}</p> : null}

      {/* Kwaliteitscontrole (intern) */}
      {report.quality.length > 0 ? (
        <div className="sc-card space-y-1.5 p-4">
          <p className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Kwaliteitscontrole (alleen intern)</p>
          {report.quality.map((q) => (
            <div key={q.id} className="flex items-center gap-2 text-sm">
              {q.severity === "blok" ? <AlertTriangle className="size-3.5 shrink-0 text-[var(--color-bad)]" /> : <AlertTriangle className="size-3.5 shrink-0 text-[var(--color-warn)]" />}
              <span className={q.severity === "blok" ? "text-[var(--color-ink)]" : "text-[var(--color-ink-muted)]"}>{q.label}</span>
            </div>
          ))}
        </div>
      ) : <div className="sc-card flex items-center gap-2 p-4 text-sm text-[var(--color-good)]"><CheckCircle2 className="size-4" /> Geen controlepunten open.</div>}

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        {/* Links: AI-analyse */}
        <div className="sc-card space-y-5 p-5">
          {a?.aandachtspunten && aandacht.length > 0 ? (
            <Section title="Belangrijkste aandachtspunten">
              <ul className="space-y-1 text-sm">{aandacht.map((p, i) => <li key={i} className="flex items-start gap-2"><span className={`mt-1 size-2 shrink-0 rounded-full ${p.type === "positief" ? "bg-[var(--color-good)]" : p.type === "actie_nodig" ? "bg-[var(--color-bad)]" : "bg-[var(--color-warn)]"}`} />{p.tekst}</li>)}</ul>
            </Section>
          ) : null}

          {(a?.topVideos ?? []).length > 0 ? (
            <Section title="Best presterende video's">
              <div className="space-y-2">{(a!.topVideos ?? []).map((v, i) => (
                <div key={i} className="text-sm"><span className="font-medium">{v.titel}</span> {v.zekerheid ? <Badge tone={ZTONE[v.zekerheid] ?? "neutral"}>{v.zekerheid}</Badge> : null}<div className="text-[var(--color-ink-muted)]">{v.waarom}{v.cijfers ? ` — ${v.cijfers}` : ""}</div></div>
              ))}</div>
            </Section>
          ) : null}

          {(a?.analysis?.watWerkt ?? []).length > 0 || (a?.analysis?.watMinder ?? []).length > 0 ? (
            <Section title="Wat werkt / wat kan beter">
              <ul className="space-y-1 text-sm">
                {(a!.analysis.watWerkt ?? []).map((f, i) => <li key={`w${i}`} className="flex items-start gap-2 text-[var(--color-ink)]"><span className="mt-1 size-2 shrink-0 rounded-full bg-[var(--color-good)]" />{f.punt} {f.zekerheid ? <Badge tone={ZTONE[f.zekerheid] ?? "neutral"}>{f.zekerheid}</Badge> : null}</li>)}
                {(a!.analysis.watMinder ?? []).map((f, i) => <li key={`m${i}`} className="flex items-start gap-2 text-[var(--color-ink-muted)]"><span className="mt-1 size-2 shrink-0 rounded-full bg-[var(--color-warn)]" />{f.punt} {f.zekerheid ? <Badge tone={ZTONE[f.zekerheid] ?? "neutral"}>{f.zekerheid}</Badge> : null}</li>)}
              </ul>
            </Section>
          ) : null}

          {(a?.maandvergelijking ?? []).length > 0 ? (
            <Section title="Maandvergelijking"><ul className="list-disc space-y-0.5 pl-5 text-sm text-[var(--color-ink-muted)]">{(a!.maandvergelijking ?? []).map((m, i) => <li key={i}>{m}</li>)}</ul></Section>
          ) : null}

          {/* Verbeterpunten (bewerkbaar) */}
          <Section title="Verbeterpunten (volgende opnames)">
            <div className="space-y-2">{verbeter.map((r, i) => (
              <div key={i} className="rounded-[var(--radius-sm)] border border-[var(--color-line)] p-2">
                <input className="sc-input w-full text-sm font-medium" value={r.titel} disabled={!canWrite} onChange={(e) => setVerbeter((p) => p.map((x, j) => j === i ? { ...x, titel: e.target.value } : x))} />
                {r.waarom ? <p className="mt-1 text-xs text-[var(--color-ink-muted)]">{r.waarom}</p> : null}
                {r.wat ? <p className="mt-0.5 text-xs text-[var(--color-ink)]">Aanpak: {r.wat}</p> : null}
              </div>
            ))}</div>
          </Section>

          {/* Strategische acties (bewerkbaar) */}
          {acties.length > 0 ? (
            <Section title="Strategische actiepunten">
              <div className="space-y-1.5">{acties.map((act, i) => (
                <input key={i} className="sc-input w-full text-sm" value={act.titel} disabled={!canWrite} onChange={(e) => setActies((p) => p.map((x, j) => j === i ? { ...x, titel: e.target.value } : x))} />
              ))}</div>
            </Section>
          ) : null}

          {canWrite ? <button type="button" disabled={pending} onClick={saveAnalysis} className={buttonClass({ variant: "secondary", size: "sm" })}><Save className="size-3.5" /> Analyse opslaan</button> : null}
        </div>

        {/* Rechts: persoonlijke beoordeling */}
        <div className="sc-card space-y-4 p-5">
          <p className="text-sm font-semibold text-[var(--color-ink)]">Persoonlijke Shortclips-beoordeling</p>
          {([
            ["positief", "1. Wat viel ons deze maand positief op?"],
            ["verbeteren", "2. Wat willen we verbeteren?"],
            ["volgendeMaand", "3. Wat gaan we volgende maand concreet doen?"],
          ] as const).map(([key, label]) => (
            <div key={key}>
              <label className="mb-1 block text-xs font-medium text-[var(--color-ink)]">{label}</label>
              <textarea className="sc-input h-20 w-full text-sm" disabled={!canWrite} value={b[key]} onChange={(e) => setB((p) => ({ ...p, [key]: e.target.value }))} />
              {canWrite && suggesties.length > 0 ? (
                <div className="mt-1 flex flex-wrap gap-1">{suggesties.slice(0, 3).map((s, i) => <button key={i} type="button" onClick={() => addSuggestie(key, s)} className="rounded-full border border-[var(--color-line)] px-2 py-0.5 text-2xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">+ {s.slice(0, 40)}</button>)}</div>
              ) : null}
            </div>
          ))}
          {canWrite ? (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={pending} onClick={saveBeoordeling} className={buttonClass({ variant: "secondary", size: "sm" })}><Save className="size-3.5" /> Opslaan</button>
              <button type="button" disabled={pending || !aiReady} onClick={makeText} className={buttonClass({ variant: "ghost", size: "sm" })}>{pending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} Maak persoonlijke klanttekst</button>
            </div>
          ) : null}
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-ink)]">Persoonlijke klanttekst (komt in de PDF + portaal)</label>
            <textarea className="sc-input h-40 w-full text-sm" disabled={!canWrite} value={b.klanttekst} onChange={(e) => setB((p) => ({ ...p, klanttekst: e.target.value }))} />
          </div>
          {canWrite && (report.status === "goedgekeurd") ? (
            <button type="button" disabled={pending} onClick={() => run(() => requestReportChanges(report.id))} className={buttonClass({ variant: "ghost", size: "sm" })}>Terug naar aanpassen</button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
