"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Sparkles, FileDown, FileText, Check, RotateCcw, Save, Send, AlertTriangle, CheckCircle2, MessageSquare, ListPlus, Eye } from "lucide-react";
import { Badge, buttonClass, type Tone } from "@/components/ui";
import {
  approveMonthlyReport, createReportActionTask, generatePersonalText, publishMonthlyReport, requestReportChanges,
  saveReportAnalysis, saveReportBeoordeling, setReportRead, startMonthlyReport, unpublishMonthlyReport,
} from "@/server/actions/monthly-reports";
import type { ReportDetail } from "@/server/reports/service";
import type { InternInzicht } from "@/server/reports/analysis";
import { STATUS_META } from "../report-list";

type Rec = { titel: string; waarom?: string; wat?: string; hoeMeten?: string; zekerheid?: string };
type Actie = { titel: string; waarom?: string };
type Punt = { type?: string; tekst: string };

const ZTONE: Record<string, Tone> = { bewezen: "good", waarschijnlijk: "info", hypothese: "warn" };
const ROL: Record<string, string> = { script: "Script", opname: "Opname", montage: "Montage", pm: "Projectmanager" };
const APPROVED = new Set(["goedgekeurd", "gepubliceerd"]);

const nf = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n).toLocaleString("nl-NL") : "–");
const pct = (n: number | null | undefined) => (typeof n === "number" ? `${n > 0 ? "+" : ""}${(Math.round(n * 10) / 10).toLocaleString("nl-NL")}%` : "–");
const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

function Section({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">{title}</p>
      {hint ? <p className="mb-1.5 text-2xs text-[var(--color-ink-faint)]">{hint}</p> : null}
      {children}
    </div>
  );
}

function Insights({ title, list }: { title: string; list?: InternInzicht[] }) {
  if (!list || list.length === 0) return null;
  return (
    <Section title={title}>
      <div className="space-y-2">
        {list.map((i, k) => (
          <div key={k} className="rounded-[var(--radius-sm)] border border-[var(--color-line)] p-2.5 text-sm">
            <div className="flex flex-wrap items-center gap-2 font-medium text-[var(--color-ink)]">{i.titel} <Badge tone={ZTONE[i.zekerheid] ?? "neutral"}>{i.zekerheid}</Badge></div>
            <div className="mt-1 grid gap-2 sm:grid-cols-2">
              <div><span className="text-2xs font-semibold uppercase text-[var(--color-ink-faint)]">Gemeten</span><p className="text-[var(--color-ink)]">{i.gemeten || "–"}</p></div>
              <div><span className="text-2xs font-semibold uppercase text-[var(--color-ink-faint)]">Mogelijke verklaring</span><p className="text-[var(--color-ink-muted)]">{i.verklaring || "–"}</p></div>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

export function ReviewUI({
  report, canWrite, owner, canTask, viewerId, team, aiReady,
}: {
  report: ReportDetail;
  canWrite: boolean;
  owner: boolean;
  canTask: boolean;
  viewerId: string;
  team: Array<{ id: string; name: string }>;
  aiReady: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [tab, setTab] = useState<"klant" | "intern" | "historie">("intern");

  const a = report.analysis;
  const approved = APPROVED.has(report.status);
  const editable = canWrite && !approved;
  const [aandacht] = useState<Punt[]>((a?.aandachtspunten as Punt[]) ?? []);
  const [acties, setActies] = useState<Actie[]>((a?.strategischeActies as Actie[]) ?? []);
  const [verbeter, setVerbeter] = useState<Rec[]>((a?.verbeterpunten as Rec[]) ?? []);
  const [b, setB] = useState({
    positief: report.beoordeling.positief ?? "",
    verbeteren: report.beoordeling.verbeteren ?? "",
    volgendeMaand: report.beoordeling.volgendeMaand ?? "",
    klanttekst: report.beoordeling.klanttekst ?? "",
  });
  const [feedback, setFeedback] = useState("");
  const [taskFor, setTaskFor] = useState<string | null>(null);
  const [taskAssignee, setTaskAssignee] = useState<string>(report.pmId ?? "");
  const [taskDue, setTaskDue] = useState<string>("");

  const busy = report.status === "analyse_bezig" || report.status === "gegevens_verzamelen";
  const stale = report.stale;
  useEffect(() => {
    if (!busy || stale) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [busy, stale, router]);

  const st = STATUS_META[report.status] ?? STATUS_META.gegevens_verzamelen!;
  const blokken = report.quality.filter((q) => q.severity === "blok");
  const canApprove = owner && blokken.length === 0 && (report.status === "klaar_voor_controle" || report.status === "aanpassing_nodig");
  const myRead = report.reads.find((r) => r.userId === viewerId);
  const m = report.metrics as Record<string, number | null | undefined>;
  const v = report.vergelijking;

  function run(fn: () => Promise<{ ok: boolean; message?: string }>, okText?: string, after?: () => void) {
    setMsg(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setMsg({ ok: false, text: res.message ?? "Er ging iets mis." });
      else { if (okText) setMsg({ ok: true, text: okText }); after?.(); }
      router.refresh();
    });
  }
  const saveAnalysis = () => run(() => saveReportAnalysis(report.id, { ...a, aandachtspunten: aandacht, strategischeActies: acties, verbeterpunten: verbeter }), "Analyse opgeslagen.");
  const saveBeoordeling = () => run(() => saveReportBeoordeling(report.id, b), "Beoordeling opgeslagen.");
  const makeText = () => start(async () => {
    const res = await generatePersonalText(report.id);
    if (res.ok && "text" in res && res.text) setB((p) => ({ ...p, klanttekst: res.text! }));
    else setMsg({ ok: false, text: res.message ?? "Tekst maken mislukt." });
  });

  // Actiepunten: interne acties (met rol) + strategische acties uit de klantversie.
  const actionItems = [
    ...(a?.intern?.acties ?? []).map((x, i) => ({ key: `intern-${i}`, title: x.actie, rol: x.rol, waarom: x.waarom })),
    ...(a?.strategischeActies ?? []).map((x, i) => ({ key: `strategie-${i}`, title: x.titel, rol: "pm", waarom: x.waarom ?? "" })),
  ];
  const taskByKey = new Map(report.actionTasks.map((t) => [t.dedupeKey.split(":").pop() ?? "", t]));

  const pdf = (versie: "klant" | "intern", download = false) => `/api/reports/monthly/${report.id}/pdf?versie=${versie}${download ? "&download=1" : ""}`;

  if (busy && !stale) {
    return (
      <div className="sc-card flex items-center gap-3 p-6 text-sm text-[var(--color-ink-muted)]">
        <Loader2 className="size-5 animate-spin text-[var(--color-info)]" />
        {report.status === "gegevens_verzamelen" ? "Dit rapport staat in de wachtrij en wordt op de achtergrond opgesteld. Dit ververst vanzelf." : "De AI-analyse wordt opgesteld uit de gemeten cijfers… dit ververst vanzelf."}
      </div>
    );
  }

  if (report.status === "mislukt" || stale) {
    return (
      <div className="space-y-3">
        <div className="sc-card flex items-start gap-3 p-5 text-sm">
          <AlertTriangle className="mt-0.5 size-5 text-[var(--color-bad)]" />
          <div>
            <p className="font-medium text-[var(--color-ink)]">{stale ? "De analyse lijkt vast te lopen" : "Analyse mislukt"}</p>
            <p className="text-[var(--color-ink-muted)]">{stale ? "De analyse is al langer dan 20 minuten bezig. De achtergrondtaak probeert het automatisch opnieuw; je kunt het ook direct opnieuw starten." : report.errorMessage ?? "Onbekende fout."}</p>
          </div>
        </div>
        {canWrite ? <button type="button" disabled={pending || !aiReady} onClick={() => run(() => startMonthlyReport(report.clientId, report.period, "ai_only"))} className={buttonClass({ variant: "primary", size: "md" })}>{pending ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />} Opnieuw proberen</button> : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Actiebalk */}
      <div className="sc-card flex flex-wrap items-center gap-2 p-3">
        <Badge tone={st.tone}>{st.label}</Badge>
        {report.approvedAt ? <span className="text-xs text-[var(--color-ink-muted)]">Goedgekeurd {dt(report.approvedAt)}{report.approvedByName ? ` door ${report.approvedByName}` : ""}</span> : null}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <span className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Klantversie</span>
          <Link href={pdf("klant")} target="_blank" className={buttonClass({ variant: "ghost", size: "sm" })}><FileText className="size-3.5" /> Bekijken</Link>
          <a href={pdf("klant", true)} className={buttonClass({ variant: "ghost", size: "sm" })}><FileDown className="size-3.5" /> Download</a>
          <span className="ml-2 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Intern</span>
          <Link href={pdf("intern")} target="_blank" className={buttonClass({ variant: "ghost", size: "sm" })}><FileText className="size-3.5" /> Bekijken</Link>
          <a href={pdf("intern", true)} className={buttonClass({ variant: "ghost", size: "sm" })}><FileDown className="size-3.5" /> Download</a>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {canWrite && !approved ? <button type="button" disabled={pending || !aiReady} onClick={() => run(() => startMonthlyReport(report.clientId, report.period, "ai_only"), "Nieuwe analyse gestart.")} className={buttonClass({ variant: "ghost", size: "sm" })}><Sparkles className="size-3.5" /> AI opnieuw</button> : null}
        {owner && !approved ? <button type="button" disabled={pending || !canApprove} title={canApprove ? "" : "Rond eerst de verplichte controlepunten af"} onClick={() => run(() => approveMonthlyReport(report.id), "Goedgekeurd en gedeeld met de klant. Het team krijgt een melding om dit door te nemen.")} className={buttonClass({ variant: "primary", size: "sm" })}><Check className="size-3.5" /> Goedkeuren en delen met klant</button> : null}
        {!owner && canWrite && !approved ? <span className="text-xs text-[var(--color-ink-muted)]">Goedkeuren doet Jarno.</span> : null}
        {canWrite && report.status === "goedgekeurd" ? <>
          <button type="button" disabled={pending} onClick={() => run(() => publishMonthlyReport(report.id), "De klantversie staat nu in het klantportaal.")} className={buttonClass({ variant: "primary", size: "sm" })}><Send className="size-3.5" /> Opnieuw delen in portaal</button>
          <button type="button" disabled={pending} onClick={() => run(() => requestReportChanges(report.id))} className={buttonClass({ variant: "ghost", size: "sm" })}>Terug naar aanpassen</button>
        </> : null}
        {canWrite && report.status === "gepubliceerd" ? <button type="button" disabled={pending} onClick={() => run(() => unpublishMonthlyReport(report.id))} className={buttonClass({ variant: "secondary", size: "sm" })}>Delen met klant intrekken</button> : null}
        {approved ? (
          myRead?.readAt
            ? <button type="button" disabled={pending} onClick={() => run(() => setReportRead(report.id, false))} className={buttonClass({ variant: "ghost", size: "sm", className: "ml-auto" })}><CheckCircle2 className="size-3.5 text-[var(--color-good)]" /> Doorgenomen op {dt(myRead.readAt)} · ongedaan maken</button>
            : <button type="button" disabled={pending} onClick={() => run(() => setReportRead(report.id, true), "Gemarkeerd als doorgenomen.")} className={buttonClass({ variant: "primary", size: "sm", className: "ml-auto" })}><Eye className="size-3.5" /> Markeer als doorgenomen</button>
        ) : null}
      </div>
      {msg ? <p className={`text-sm ${msg.ok ? "text-[var(--color-good)]" : "text-[var(--color-bad)]"}`}>{msg.text}</p> : null}

      {/* Kwaliteitscontrole (intern) */}
      {canWrite ? (report.quality.length > 0 ? (
        <div className="sc-card space-y-1.5 p-4">
          <p className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Controlepunten (alleen intern)</p>
          {report.quality.map((q) => (
            <div key={q.id} className="flex items-start gap-2 text-sm">
              <AlertTriangle className={`mt-0.5 size-3.5 shrink-0 ${q.severity === "blok" ? "text-[var(--color-bad)]" : "text-[var(--color-warn)]"}`} />
              <span className={q.severity === "blok" ? "text-[var(--color-ink)]" : "text-[var(--color-ink-muted)]"}>{q.label}{q.severity === "blok" ? " (verplicht)" : ""}</span>
            </div>
          ))}
        </div>
      ) : <div className="sc-card flex items-center gap-2 p-4 text-sm text-[var(--color-good)]"><CheckCircle2 className="size-4" /> Geen controlepunten open.</div>) : null}

      {/* Kerncijfers */}
      <div className="sc-card grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-6">
        {([
          ["Weergaven", nf(m.views), v?.vsVorigeMaand.views],
          ["Bereik", nf(m.reach), v?.vsVorigeMaand.reach],
          ["Interacties", nf(m.engagements), v?.vsVorigeMaand.engagements],
          ["Volgersgroei", typeof m.followerGrowth === "number" ? `${m.followerGrowth >= 0 ? "+" : ""}${nf(m.followerGrowth)}` : "–", undefined],
          ["Video's", nf(m.posts), v?.vsVorigeMaand.videos],
          ["Weergaven per video", nf(m.avgPerPost), v?.vsVorigeMaand.viewsPerVideo],
        ] as Array<[string, string, number | null | undefined]>).map(([l, val, d]) => (
          <div key={l}>
            <p className="text-2xs uppercase tracking-wide text-[var(--color-ink-faint)]">{l}</p>
            <p className="text-lg font-semibold tabular-nums text-[var(--color-ink)]">{val}</p>
            {d !== undefined ? <p className="text-2xs text-[var(--color-ink-muted)]">{d === null ? "geen vergelijking" : `${pct(d)} vs vorige maand`}</p> : null}
          </div>
        ))}
      </div>

      <div className="flex gap-1 border-b border-[var(--color-line)]">
        {([["intern", "Interne teamanalyse"], ["klant", "Klantversie"], ["historie", "Ontwikkeling en historie"]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === k ? "border-[var(--color-ink)] text-[var(--color-ink)]" : "border-transparent text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}>{l}</button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4 min-w-0">
          {tab === "intern" ? (
            <div className="sc-card space-y-5 p-5">
              {a?.intern?.kern ? <p className="rounded-[var(--radius-sm)] bg-[var(--color-surface-sunken)] p-3 text-sm text-[var(--color-ink)]">{a.intern.kern}</p> : null}
              {a?.intern && ((a.intern.doorgaan ?? []).length || (a.intern.stoppen ?? []).length || (a.intern.testen ?? []).length) ? (
                <div className="grid gap-3 sm:grid-cols-3">
                  {([["Doorgaan", a.intern.doorgaan, "bg-[var(--color-good-soft)]"], ["Stoppen of minder", a.intern.stoppen, "bg-[var(--color-surface-sunken)]"], ["Testen", a.intern.testen, "bg-[var(--color-indigo-ink)] text-white"]] as const).map(([t, list, cls]) => (
                    <div key={t} className={`rounded-[var(--radius-sm)] p-3 ${cls}`}>
                      <p className="mb-1 text-2xs font-semibold uppercase tracking-wide">{t}</p>
                      {(list ?? []).length ? <ul className="list-disc space-y-0.5 pl-4 text-sm">{(list ?? []).map((x, k) => <li key={k}>{x}</li>)}</ul> : <p className="text-xs opacity-70">Geen punten.</p>}
                    </div>
                  ))}
                </div>
              ) : null}
              {!a?.intern ? <p className="text-sm text-[var(--color-ink-muted)]">Dit rapport is gemaakt voordat de interne teamanalyse bestond. Genereer de AI-analyse opnieuw om die toe te voegen.</p> : null}
              <Insights title="Best presterende video's en waarom" list={a?.intern?.besteVideos} />
              <Insights title="Hooks die werkten" list={a?.intern?.hooks} />
              <Insights title="Onderwerpen met de meeste betrokkenheid" list={a?.intern?.onderwerpen} />
              <Insights title="Video's die tegenvielen" list={a?.intern?.tegenvallers} />
              <Insights title="Lessen over de videostructuur" list={a?.intern?.videostructuur} />
              <Insights title="Formats om vaker te gebruiken" list={a?.intern?.formatsVaker} />
              <Insights title="Onderwerpen om te vermijden of aan te passen" list={a?.intern?.vermijdenOfAanpassen} />
              {a?.intern ? (
                <div className="grid gap-4 sm:grid-cols-3">
                  {([["Scripts", a.intern.scripts], ["Opnames", a.intern.opnames], ["Montage", a.intern.montage]] as const).map(([t, list]) => (
                    <Section key={t} title={t}>{list.length ? <ul className="list-disc space-y-0.5 pl-4 text-sm">{list.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="text-sm text-[var(--color-ink-faint)]">Geen punten.</p>}</Section>
                  ))}
                </div>
              ) : null}
              {(a?.intern?.dataBeperkingen ?? []).length || report.ontbrekend.length ? (
                <Section title="Wat we niet konden meten">
                  <ul className="list-disc space-y-0.5 pl-4 text-sm text-[var(--color-ink-muted)]">{[...new Set([...(a?.intern?.dataBeperkingen ?? []), ...report.ontbrekend])].map((x, i) => <li key={i}>{x}</li>)}</ul>
                </Section>
              ) : null}
            </div>
          ) : null}

          {tab === "klant" ? (
            <div className="sc-card space-y-5 p-5">
              {aandacht.length > 0 ? (
                <Section title="Belangrijkste aandachtspunten">
                  <ul className="space-y-1 text-sm">{aandacht.map((p, i) => <li key={i} className="flex items-start gap-2"><span className={`mt-1.5 size-2 shrink-0 rounded-full ${p.type === "positief" ? "bg-[var(--color-good)]" : p.type === "actie_nodig" ? "bg-[var(--color-bad)]" : "bg-[var(--color-warn)]"}`} />{p.tekst}</li>)}</ul>
                </Section>
              ) : null}
              {(a?.topVideos ?? []).length > 0 ? (
                <Section title="Best presterende video's">
                  <div className="space-y-2">{(a!.topVideos ?? []).map((x, i) => (
                    <div key={i} className="text-sm"><span className="font-medium">{x.titel}</span> {x.zekerheid ? <Badge tone={ZTONE[x.zekerheid] ?? "neutral"}>{x.zekerheid}</Badge> : null}<div className="text-[var(--color-ink-muted)]">{x.waarom}{x.cijfers ? ` (${x.cijfers})` : ""}</div></div>
                  ))}</div>
                </Section>
              ) : null}
              {(a?.analysis?.watWerkt ?? []).length > 0 || (a?.analysis?.watMinder ?? []).length > 0 ? (
                <Section title="Wat werkt / wat kan beter">
                  <ul className="space-y-1 text-sm">
                    {(a!.analysis.watWerkt ?? []).map((f, i) => <li key={`w${i}`} className="flex items-start gap-2"><span className="mt-1.5 size-2 shrink-0 rounded-full bg-[var(--color-good)]" />{f.punt} {f.zekerheid ? <Badge tone={ZTONE[f.zekerheid] ?? "neutral"}>{f.zekerheid}</Badge> : null}</li>)}
                    {(a!.analysis.watMinder ?? []).map((f, i) => <li key={`m${i}`} className="flex items-start gap-2 text-[var(--color-ink-muted)]"><span className="mt-1.5 size-2 shrink-0 rounded-full bg-[var(--color-warn)]" />{f.punt} {f.zekerheid ? <Badge tone={ZTONE[f.zekerheid] ?? "neutral"}>{f.zekerheid}</Badge> : null}</li>)}
                  </ul>
                </Section>
              ) : null}
              {(a?.maandvergelijking ?? []).length > 0 ? <Section title="Maandvergelijking"><ul className="list-disc space-y-0.5 pl-5 text-sm text-[var(--color-ink-muted)]">{(a!.maandvergelijking ?? []).map((x, i) => <li key={i}>{x}</li>)}</ul></Section> : null}
              {(a?.conclusies ?? []).length > 0 ? <Section title="Conclusies"><ul className="list-disc space-y-0.5 pl-5 text-sm">{(a!.conclusies ?? []).map((x, i) => <li key={i}>{x}</li>)}</ul></Section> : null}
              {(a?.kansen ?? []).length > 0 ? <Section title="Kansen en aanbevelingen"><div className="space-y-1.5 text-sm">{(a!.kansen ?? []).map((k, i) => <div key={i}><span className="font-medium">{k.titel}</span><span className="text-[var(--color-ink-muted)]"> · {k.toelichting}</span></div>)}</div></Section> : null}

              <Section title="Verbeterpunten (volgende opnames)">
                <div className="space-y-2">{verbeter.map((r, i) => (
                  <div key={i} className="rounded-[var(--radius-sm)] border border-[var(--color-line)] p-2">
                    <input className="sc-input w-full text-sm font-medium" value={r.titel} disabled={!editable} onChange={(e) => setVerbeter((p) => p.map((x, j) => j === i ? { ...x, titel: e.target.value } : x))} />
                    {r.waarom ? <p className="mt-1 text-xs text-[var(--color-ink-muted)]">{r.waarom}</p> : null}
                    {r.wat ? <p className="mt-0.5 text-xs text-[var(--color-ink)]">Aanpak: {r.wat}</p> : null}
                  </div>
                ))}</div>
              </Section>
              {acties.length > 0 ? (
                <Section title="Strategische acties (staan in de klantversie)">
                  <div className="space-y-1.5">{acties.map((act, i) => (
                    <input key={i} className="sc-input w-full text-sm" value={act.titel} disabled={!editable} onChange={(e) => setActies((p) => p.map((x, j) => j === i ? { ...x, titel: e.target.value } : x))} />
                  ))}</div>
                </Section>
              ) : null}
              {editable ? <button type="button" disabled={pending} onClick={saveAnalysis} className={buttonClass({ variant: "secondary", size: "sm" })}><Save className="size-3.5" /> Analyse opslaan</button> : null}
            </div>
          ) : null}

          {tab === "historie" ? (
            <div className="sc-card space-y-3 p-5">
              <Section title="Cijfers per maand" hint="Berekend uit de opgeslagen dagcijfers. Een streepje betekent dat er voor die maand geen meting is.">
                {report.history.length === 0 ? <p className="text-sm text-[var(--color-ink-muted)]">Nog geen historie opgeslagen. Genereer de AI-analyse opnieuw om de historie toe te voegen.</p> : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[620px] text-sm">
                      <thead><tr className="border-b border-[var(--color-line)] text-left text-2xs uppercase tracking-wide text-[var(--color-ink-faint)]"><th className="sc-th">Maand</th><th className="sc-th text-right">Weergaven</th><th className="sc-th text-right">Interacties</th><th className="sc-th text-right">Volgers</th><th className="sc-th text-right">{`Video's`}</th><th className="sc-th text-right">Per video</th><th className="sc-th">Rapport</th></tr></thead>
                      <tbody>{[...report.history].reverse().map((h) => (
                        <tr key={h.period} className={`border-b border-[var(--color-line)] ${h.period === report.period ? "font-semibold" : ""}`}>
                          <td className="sc-td capitalize">{h.periodLabel}</td>
                          <td className="sc-td text-right tabular-nums">{h.cijfers.meetdagen ? nf(h.cijfers.views) : "–"}</td>
                          <td className="sc-td text-right tabular-nums">{h.cijfers.meetdagen ? nf(h.cijfers.engagements) : "–"}</td>
                          <td className="sc-td text-right tabular-nums">{h.cijfers.meetdagen ? `${h.cijfers.followerGrowth >= 0 ? "+" : ""}${nf(h.cijfers.followerGrowth)}` : "–"}</td>
                          <td className="sc-td text-right tabular-nums">{nf(h.cijfers.videos)}</td>
                          <td className="sc-td text-right tabular-nums">{h.cijfers.meetdagen && h.cijfers.videos ? nf(h.cijfers.views / h.cijfers.videos) : "–"}</td>
                          <td className="sc-td">{h.id && h.period !== report.period ? <Link href={`/analytics/maandrapportages/${h.id}`} className="text-[var(--color-ink)] hover:underline">{STATUS_META[h.status ?? ""]?.label ?? "Openen"}</Link> : h.period === report.period ? <span className="text-[var(--color-ink-faint)]">dit rapport</span> : <span className="text-[var(--color-ink-faint)]">geen</span>}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
              </Section>
              {v ? (
                <Section title="Vergelijking">
                  <ul className="list-disc space-y-0.5 pl-5 text-sm text-[var(--color-ink-muted)]">
                    <li>Weergaven t.o.v. vorige maand: {pct(v.vsVorigeMaand.views)}</li>
                    <li>Weergaven t.o.v. gemiddelde 3 maanden: {v.vsGem3.views === null ? "nog te weinig historie" : pct(v.vsGem3.views)}</li>
                    <li>Weergaven t.o.v. gemiddelde 6 maanden: {v.vsGem6.views === null ? "nog te weinig historie" : pct(v.vsGem6.views)}</li>
                    <li>Interacties t.o.v. gemiddelde 3 maanden: {v.vsGem3.engagements === null ? "nog te weinig historie" : pct(v.vsGem3.engagements)}</li>
                  </ul>
                </Section>
              ) : null}
              <Link href={`/analytics/maandrapportages?maand=alle&klant=${report.clientId}`} className="text-sm text-[var(--color-ink)] hover:underline">Alle rapporten van {report.clientName} →</Link>
            </div>
          ) : null}

          {/* Actiepunten → taken */}
          {actionItems.length > 0 ? (
            <div className="sc-card space-y-2 p-5">
              <p className="text-sm font-semibold text-[var(--color-ink)]">Actiepunten voor komende maand</p>
              <p className="text-2xs text-[var(--color-ink-faint)]">Zet een actiepunt om naar een taak, zodat duidelijk is wie het toepast bij de volgende scripts, opnames en montages.</p>
              <ul className="space-y-2">
                {actionItems.map((it) => {
                  const t = taskByKey.get(it.key);
                  return (
                    <li key={it.key} className="rounded-[var(--radius-sm)] border border-[var(--color-line)] p-2.5 text-sm">
                      <div className="flex flex-wrap items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <span className="font-medium text-[var(--color-ink)]">{it.title}</span> <Badge tone="neutral">{ROL[it.rol] ?? it.rol}</Badge>
                          {it.waarom ? <p className="text-xs text-[var(--color-ink-muted)]">{it.waarom}</p> : null}
                        </div>
                        {t ? (
                          <Link href="/tasks" className="text-xs text-[var(--color-ink-muted)] hover:underline">
                            Taak: {t.status === "done" ? "afgerond" : t.status === "cancelled" ? "geannuleerd" : "open"}{t.assigneeName ? ` · ${t.assigneeName}` : ""}{t.dueOn ? ` · ${t.dueOn}` : ""}
                          </Link>
                        ) : canTask && (approved || canWrite) ? (
                          <button type="button" onClick={() => setTaskFor(taskFor === it.key ? null : it.key)} className={buttonClass({ variant: "ghost", size: "sm" })}><ListPlus className="size-3.5" /> Maak taak</button>
                        ) : null}
                      </div>
                      {taskFor === it.key && !t ? (
                        <div className="mt-2 flex flex-wrap items-end gap-2">
                          <select className="sc-input text-sm" value={taskAssignee} onChange={(e) => setTaskAssignee(e.target.value)}>
                            <option value="">Niemand toegewezen</option>
                            {team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                          </select>
                          <input type="date" className="sc-input text-sm" value={taskDue} onChange={(e) => setTaskDue(e.target.value)} />
                          <button type="button" disabled={pending} onClick={() => run(() => createReportActionTask({ reportId: report.id, key: it.key, title: it.title, description: it.waarom, rol: it.rol, assigneeId: taskAssignee || null, dueOn: taskDue || null }), "Taak aangemaakt.", () => setTaskFor(null))} className={buttonClass({ variant: "primary", size: "sm" })}>Taak aanmaken</button>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>

        {/* Rechterkolom */}
        <div className="space-y-4">
          {/* Feedback + opnieuw genereren */}
          {canWrite ? (
            <div className="sc-card space-y-3 p-5">
              <p className="flex items-center gap-2 text-sm font-semibold text-[var(--color-ink)]"><MessageSquare className="size-4" /> Feedback en aanpassingen</p>
              {!approved ? (
                <>
                  <textarea className="sc-input h-24 w-full text-sm" placeholder="Wat moet er aangepast worden? Bijvoorbeeld: meer nadruk op de groei in sollicitaties, toon minder stellig over de hooks." value={feedback} onChange={(e) => setFeedback(e.target.value)} />
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={pending || !feedback.trim() || !aiReady} onClick={() => run(() => requestReportChanges(report.id, feedback, true), "Feedback opgeslagen; de analyse wordt opnieuw opgesteld.", () => setFeedback(""))} className={buttonClass({ variant: "primary", size: "sm" })}><RotateCcw className="size-3.5" /> Opslaan en opnieuw genereren</button>
                    <button type="button" disabled={pending || !feedback.trim()} onClick={() => run(() => requestReportChanges(report.id, feedback, false), "Feedback opgeslagen.", () => setFeedback(""))} className={buttonClass({ variant: "ghost", size: "sm" })}>Alleen opslaan</button>
                  </div>
                </>
              ) : <p className="text-xs text-[var(--color-ink-muted)]">Goedgekeurd. Zet het rapport terug naar aanpassen om nieuwe feedback te geven.</p>}
              {report.feedback.length > 0 ? (
                <ul className="space-y-2 border-t border-[var(--color-line)] pt-2">
                  {report.feedback.map((f) => (
                    <li key={f.id} className="text-sm">
                      <p className="whitespace-pre-line text-[var(--color-ink)]">{f.body}</p>
                      <p className="text-2xs text-[var(--color-ink-faint)]">{f.authorName ?? "Onbekend"} · {dt(f.createdAt)}{f.versionNumber ? ` · op versie ${f.versionNumber}` : ""} · {f.resolvedInVersion ? `verwerkt in versie ${f.resolvedInVersion}` : "nog niet verwerkt"}</p>
                    </li>
                  ))}
                </ul>
              ) : null}
              {report.versions.length > 0 ? (
                <details className="border-t border-[var(--color-line)] pt-2 text-xs text-[var(--color-ink-muted)]">
                  <summary className="cursor-pointer">Versiegeschiedenis ({report.versions.length})</summary>
                  <ul className="mt-1 space-y-0.5">{report.versions.map((x) => <li key={x.versionNumber}>Versie {x.versionNumber} · {x.kind} · {dt(x.createdAt)}{x.byName ? ` · ${x.byName}` : ""}</li>)}</ul>
                </details>
              ) : null}
            </div>
          ) : null}

          {/* Doorgenomen door */}
          <div className="sc-card space-y-2 p-5">
            <p className="text-sm font-semibold text-[var(--color-ink)]">Doorgenomen door het team</p>
            {report.reads.length === 0 ? <p className="text-xs text-[var(--color-ink-muted)]">{approved ? "Nog niemand ingedeeld." : "Na goedkeuring krijgt het team een melding om dit rapport door te nemen."}</p> : (
              <ul className="space-y-1 text-sm">
                {report.reads.map((r) => (
                  <li key={r.userId} className="flex items-center justify-between gap-2">
                    <span className="text-[var(--color-ink)]">{r.name} <span className="text-2xs text-[var(--color-ink-faint)]">{r.reason}</span></span>
                    {r.readAt ? <span className="text-2xs text-[var(--color-good)]">{dt(r.readAt)}</span> : <span className="text-2xs text-[var(--color-warn)]">nog niet</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Persoonlijke beoordeling */}
          <div className="sc-card space-y-4 p-5">
            <p className="text-sm font-semibold text-[var(--color-ink)]">Persoonlijke Shortclips-beoordeling</p>
            {([
              ["positief", "1. Wat viel ons deze maand positief op?"],
              ["verbeteren", "2. Wat willen we verbeteren?"],
              ["volgendeMaand", "3. Wat gaan we volgende maand concreet doen?"],
            ] as const).map(([key, label]) => (
              <div key={key}>
                <label className="mb-1 block text-xs font-medium text-[var(--color-ink)]">{label}</label>
                {editable
                  ? <textarea className="sc-input h-20 w-full text-sm" value={b[key]} onChange={(e) => setB((p) => ({ ...p, [key]: e.target.value }))} />
                  : <p className="whitespace-pre-line text-sm text-[var(--color-ink-muted)]">{b[key] || "–"}</p>}
              </div>
            ))}
            {editable ? (
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" disabled={pending} onClick={saveBeoordeling} className={buttonClass({ variant: "secondary", size: "sm" })}><Save className="size-3.5" /> Opslaan</button>
                <button type="button" disabled={pending || !aiReady} onClick={makeText} className={buttonClass({ variant: "ghost", size: "sm" })}>{pending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} Maak klanttekst</button>
              </div>
            ) : null}
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-ink)]">Klanttekst (samenvatting in de klantversie)</label>
              {editable
                ? <textarea className="sc-input h-40 w-full text-sm" value={b.klanttekst} onChange={(e) => setB((p) => ({ ...p, klanttekst: e.target.value }))} />
                : <p className="whitespace-pre-line text-sm text-[var(--color-ink-muted)]">{b.klanttekst || "–"}</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
