"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, CircleAlert, Download, Eye, Globe, History, Loader2, Lock, Pencil, RotateCcw, Send, ShieldCheck, Sparkles, TriangleAlert, Undo2 } from "lucide-react";
import { Badge, ClientLogo, buttonClass } from "@/components/ui";
import { KlantReportView } from "@/components/quarterly/klant-report";
import {
  approveQuarter, confirmQuarterCheck, createImprovementTask, finishWithIncompleteData, generateQuarter, markQuarterReviewed, publishQuarter, requestQuarterChanges,
  resolveQuarterFeedback, saveQuarterContent, saveQuarterGoals, saveQuarterSettings, setImprovementStatus, unpublishQuarter,
} from "@/server/actions/quarterly-reports";
import type { QuarterDetail } from "@/server/quarterly/service";
import { EDITABLE_STATUSES, PAKKET_LABEL, QUARTER_STATUS_META, kortDatum, langDatum, type HealthLevel, type QuarterMode } from "@/lib/kwartaal";
import type { QuarterKlant, Zekerheid } from "@/lib/kwartaal-inhoud";
import type { KlantRapport } from "@/lib/kwartaal-klant";

type Tab = "intern" | "klant" | "aanpassen" | "geschiedenis";
type Res = { ok: boolean; message?: string };

const EVENT_LABEL: Record<string, string> = {
  gepland: "Ingepland", voorbereiding_gestart: "Voorbereiding gestart", concept_gegenereerd: "Voorlopig concept gegenereerd", definitief_gegenereerd: "Definitieve rapportage gegenereerd",
  wachten_op_data: "Wacht op volledige data", generatie_mislukt: "Genereren mislukt", onvolledige_data_geaccepteerd: "Bewust afgerond met onvolledige data", aangepast: "Inhoud aangepast",
  controlepunt_bevestigd: "Controlepunt bevestigd", controle_afgerond: "Controle afgerond", aanpassingen_gevraagd: "Aanpassingen gevraagd", heropend: "Heropend na goedkeuring",
  opmerkingen_verwerkt: "Opmerkingen verwerkt", goedgekeurd: "Goedgekeurd", gepubliceerd: "Gepubliceerd in klantportaal", publicatie_ingetrokken: "Publicatie ingetrokken", verbeterpunt_bijgewerkt: "Verbeterpunt bijgewerkt",
};
const VERSIE_LABEL: Record<string, string> = { generatie: "Generatie", goedkeuring: "Goedkeuring", publicatie: "Publicatie", herpublicatie: "Herpublicatie" };
const LVL: Record<HealthLevel, { label: string; cls: string }> = {
  goed: { label: "Goed", cls: "bg-[#e6f6ec] text-[#12703c]" }, aandacht: { label: "Aandacht", cls: "bg-[#fff3d6] text-[#8a5300]" },
  zorg: { label: "Zorg", cls: "bg-[#fde8e8] text-[#b42318]" }, onbekend: { label: "Onbekend", cls: "bg-[var(--color-surface-sunken)] text-[var(--color-ink-muted)]" },
};
const DOEL_METRICS: Array<{ value: string; label: string }> = [
  { value: "views", label: "Weergaven" }, { value: "reach", label: "Bereik" }, { value: "engagements", label: "Interacties" }, { value: "followerGrowth", label: "Groei in volgers" },
  { value: "videos", label: "Gepubliceerde video's" }, { value: "gemViewsPerVideo", label: "Weergaven per video" }, { value: "websiteKlikken", label: "Websiteklikken" }, { value: "conversies", label: "Conversies" },
];
const tijd = (iso: string) => new Date(iso).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const nf = (n: number | null | undefined) => (typeof n === "number" ? Math.round(n).toLocaleString("nl-NL") : "–");

function Card({ title, children, tone }: { title?: ReactNode; children: ReactNode; tone?: "warn" | "bad" }) {
  return (
    <section className={`sc-card p-4 sm:p-5 ${tone === "warn" ? "border-[var(--color-warn)]/50 bg-[var(--color-warn-soft)]" : tone === "bad" ? "border-[var(--color-bad)]/50" : ""}`}>
      {title ? <h2 className="mb-3 text-sm font-semibold text-[var(--color-ink)]">{title}</h2> : null}
      {children}
    </section>
  );
}
const Lijst = ({ items }: { items: string[] }) => <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>;

/* ---------------------------- Bewerken ---------------------------- */

const lines = (v: string) => v.split("\n").map((x) => x.trim()).filter(Boolean);
function Tekst({ label, value, onChange, rows = 3 }: { label: string; value: string; onChange: (v: string) => void; rows?: number }) {
  return <label className="block"><span className="mb-1 block text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">{label}</span><textarea className="sc-input w-full text-sm" rows={rows} value={value} onChange={(e) => onChange(e.target.value)} /></label>;
}
function Regels({ label, value, onChange }: { label: string; value: string[]; onChange: (v: string[]) => void }) {
  return <Tekst label={`${label} (één per regel)`} value={value.join("\n")} onChange={(v) => onChange(lines(v))} rows={Math.max(2, value.length + 1)} />;
}
function Objecten<T extends Record<string, string>>({ label, items, fields, onChange, leeg, max }: { label: string; items: T[]; fields: Array<{ key: keyof T & string; label: string; zekerheid?: boolean }>; onChange: (v: T[]) => void; leeg: T; max: number }) {
  return (
    <div>
      <span className="mb-1 block text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">{label}</span>
      <div className="flex flex-col gap-2">
        {items.map((it, i) => (
          <div key={i} className="rounded-[var(--radius-sm)] border border-[var(--color-line)] p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              {fields.map((f) => f.zekerheid ? (
                <label key={f.key} className="block"><span className="mb-0.5 block text-2xs text-[var(--color-ink-faint)]">{f.label}</span>
                  <select className="sc-input w-full text-sm" value={it[f.key]} onChange={(e) => onChange(items.map((x, n) => (n === i ? { ...x, [f.key]: e.target.value } : x)))}>
                    <option value="bewezen">Volgt uit de cijfers</option><option value="waarschijnlijk">Waarschijnlijk</option><option value="hypothese">Vermoeden</option>
                  </select></label>
              ) : (
                <label key={f.key} className="block"><span className="mb-0.5 block text-2xs text-[var(--color-ink-faint)]">{f.label}</span>
                  <textarea className="sc-input w-full text-sm" rows={2} value={it[f.key]} onChange={(e) => onChange(items.map((x, n) => (n === i ? { ...x, [f.key]: e.target.value } : x)))} /></label>
              ))}
            </div>
            <button type="button" onClick={() => onChange(items.filter((_, n) => n !== i))} className="mt-1.5 text-2xs text-[var(--color-bad)] hover:underline">Verwijderen</button>
          </div>
        ))}
      </div>
      {items.length < max ? <button type="button" onClick={() => onChange([...items, leeg])} className="mt-1.5 text-xs text-[var(--color-info)] hover:underline">Toevoegen</button> : null}
    </div>
  );
}

function Editor({ klant, onSave, saving }: { klant: QuarterKlant; onSave: (k: QuarterKlant) => void; saving: boolean }) {
  const [k, setK] = useState<QuarterKlant>(klant);
  const set = <S extends keyof QuarterKlant>(sec: S, patch: Partial<QuarterKlant[S]>) => setK((cur) => ({ ...cur, [sec]: { ...(cur[sec] as object), ...patch } }));
  const inz = { punt: "", onderbouwing: "", zekerheid: "hypothese" as Zekerheid };
  const inzFields = [{ key: "punt" as const, label: "Inzicht" }, { key: "onderbouwing" as const, label: "Onderbouwing uit de cijfers" }, { key: "zekerheid" as const, label: "Zekerheid", zekerheid: true }];
  return (
    <div className="flex flex-col gap-4">
      <Card title="Directieoverzicht">
        <div className="grid gap-3 sm:grid-cols-2">
          <Tekst label="Wat hebben we bereikt?" value={k.directie.bereikt} onChange={(v) => set("directie", { bereikt: v })} />
          <Tekst label="Wat heeft het opgeleverd?" value={k.directie.opgeleverd} onChange={(v) => set("directie", { opgeleverd: v })} />
          <Tekst label="Wat hebben we geleerd?" value={k.directie.geleerd} onChange={(v) => set("directie", { geleerd: v })} />
          <Tekst label="Wat doen we volgend kwartaal?" value={k.directie.volgend} onChange={(v) => set("directie", { volgend: v })} />
        </div>
      </Card>
      <Card title="A. Managementsamenvatting">
        <div className="flex flex-col gap-3">
          <Tekst label="Kern" value={k.samenvatting.kern} onChange={(v) => set("samenvatting", { kern: v })} rows={4} />
          <Regels label="Belangrijkste resultaten" value={k.samenvatting.resultaten} onChange={(v) => set("samenvatting", { resultaten: v })} />
          <Tekst label="Grootste positieve ontwikkeling" value={k.samenvatting.positief} onChange={(v) => set("samenvatting", { positief: v })} rows={2} />
          <Regels label="Inzichten uit de content" value={k.samenvatting.inzichten} onChange={(v) => set("samenvatting", { inzichten: v })} />
          <Objecten label="Tegenvallers en oorzaken" items={k.samenvatting.tegenvallers} max={3} leeg={{ wat: "", oorzaak: "", zekerheid: "hypothese" as Zekerheid }} fields={[{ key: "wat", label: "Wat viel tegen" }, { key: "oorzaak", label: "Oorzaak" }, { key: "zekerheid", label: "Zekerheid", zekerheid: true }]} onChange={(v) => set("samenvatting", { tegenvallers: v })} />
          <Regels label="Wat Shortclips heeft verbeterd" value={k.samenvatting.verbeterd} onChange={(v) => set("samenvatting", { verbeterd: v })} />
          <Tekst label="Belangrijkste kans volgend kwartaal" value={k.samenvatting.kans} onChange={(v) => set("samenvatting", { kans: v })} rows={2} />
          <Tekst label="Advies voor de komende drie maanden" value={k.samenvatting.advies} onChange={(v) => set("samenvatting", { advies: v })} rows={2} />
        </div>
      </Card>
      <Card title="C. Wat heeft Shortclips opgeleverd">
        <div className="flex flex-col gap-3">
          <Tekst label="Toelichting" value={k.opgeleverd.tekst} onChange={(v) => set("opgeleverd", { tekst: v })} />
          <Regels label="Verzorgde diensten" value={k.opgeleverd.diensten} onChange={(v) => set("opgeleverd", { diensten: v })} />
        </div>
      </Card>
      <Card title="D en E. Trends en best presterende content">
        <div className="flex flex-col gap-3">
          <Objecten label="Opvallende trends" items={k.trends} max={5} leeg={{ titel: "", beschrijving: "", verklaring: "", zekerheid: "hypothese" as Zekerheid }} fields={[{ key: "titel", label: "Trend" }, { key: "beschrijving", label: "Beschrijving" }, { key: "verklaring", label: "Verklaring" }, { key: "zekerheid", label: "Zekerheid", zekerheid: true }]} onChange={(v) => setK((c) => ({ ...c, trends: v }))} />
          <Objecten label="Uitgelichte video's (sleutel verwijst naar de videolijst, bijvoorbeeld v1)" items={k.topVideos} max={5} leeg={{ key: "v1", waarom: "", meenemen: "", zekerheid: "hypothese" as Zekerheid }} fields={[{ key: "key", label: "Video (sleutel)" }, { key: "waarom", label: "Waarom dit werkte" }, { key: "meenemen", label: "Wat we meenemen" }, { key: "zekerheid", label: "Zekerheid", zekerheid: true }]} onChange={(v) => setK((c) => ({ ...c, topVideos: v }))} />
        </div>
      </Card>
      <Card title="F. Wat hebben we geleerd">
        <div className="flex flex-col gap-3">
          {([["onderwerpen", "Onderwerpen"], ["hooks", "Openingszinnen"], ["formats", "Formats"], ["lengtes", "Videolengte"], ["presentatoren", "Presentatoren"], ["doelgroep", "Vragen en reacties van de doelgroep"]] as const).map(([key, lab]) => (
            <Objecten key={key} label={lab} items={k.geleerd[key]} max={4} leeg={inz} fields={inzFields} onChange={(v) => set("geleerd", { [key]: v } as Partial<QuarterKlant["geleerd"]>)} />
          ))}
          <div className="grid gap-3 sm:grid-cols-2">
            <Regels label="Dit maken we vaker" value={k.geleerd.vaker} onChange={(v) => set("geleerd", { vaker: v })} />
            <Regels label="Dit maken we minder vaak" value={k.geleerd.minder} onChange={(v) => set("geleerd", { minder: v })} />
          </div>
        </div>
      </Card>
      <Card title="G. Zakelijke impact">
        <div className="flex flex-col gap-3">
          <Regels label="Direct meetbaar (alleen met een gemeten bron)" value={k.impact.direct} onChange={(v) => set("impact", { direct: v })} />
          <Regels label="Indirecte indicatoren" value={k.impact.indirect} onChange={(v) => set("impact", { indirect: v })} />
          <Regels label="Kwalitatieve inzichten" value={k.impact.kwalitatief} onChange={(v) => set("impact", { kwalitatief: v })} />
          <Tekst label="Wat we niet kunnen meten" value={k.impact.nietMeetbaar} onChange={(v) => set("impact", { nietMeetbaar: v })} rows={2} />
        </div>
      </Card>
      <Card title="H en I. Verbeterpunten en plan">
        <div className="flex flex-col gap-3">
          <Objecten label="Verbeterpunten (maximaal vijf)" items={k.verbeterpunten} max={5} leeg={{ constatering: "", belang: "", actie: "", verwachtResultaat: "", verantwoordelijke: "" }} fields={[{ key: "constatering", label: "Wat hebben we geconstateerd" }, { key: "belang", label: "Waarom is dit belangrijk" }, { key: "actie", label: "Actie van Shortclips" }, { key: "verwachtResultaat", label: "Verwacht resultaat" }, { key: "verantwoordelijke", label: "Verantwoordelijke" }]} onChange={(v) => setK((c) => ({ ...c, verbeterpunten: v }))} />
          <Objecten label="Acties binnen het bestaande pakket" items={k.plan.binnenPakket} max={7} leeg={{ titel: "", toelichting: "" }} fields={[{ key: "titel", label: "Actie" }, { key: "toelichting", label: "Toelichting" }]} onChange={(v) => set("plan", { binnenPakket: v })} />
          <Objecten label="Aanvullende voorstellen (buiten het pakket)" items={k.plan.aanvullend} max={3} leeg={{ titel: "", toelichting: "" }} fields={[{ key: "titel", label: "Voorstel" }, { key: "toelichting", label: "Toelichting" }]} onChange={(v) => set("plan", { aanvullend: v })} />
        </div>
      </Card>
      <Card title="J. Conclusie en vervolg">
        <div className="flex flex-col gap-3">
          <Tekst label="Belangrijkste conclusie" value={k.conclusie.kern} onChange={(v) => set("conclusie", { kern: v })} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Tekst label="Wat is er bereikt" value={k.conclusie.bereikt} onChange={(v) => set("conclusie", { bereikt: v })} />
            <Tekst label="Grootste kansen" value={k.conclusie.kansen} onChange={(v) => set("conclusie", { kansen: v })} />
            <Tekst label="Wat Shortclips verbetert" value={k.conclusie.verbeteringen} onChange={(v) => set("conclusie", { verbeteringen: v })} />
          </div>
          <Regels label="Prioriteiten komende drie maanden" value={k.conclusie.prioriteiten} onChange={(v) => set("conclusie", { prioriteiten: v })} />
        </div>
      </Card>
      <div className="sticky bottom-3 z-10 flex items-center justify-end gap-2 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3 shadow-[var(--shadow-card)]">
        <span className="mr-auto text-2xs text-[var(--color-ink-muted)]">Na opslaan moet de controle opnieuw worden afgerond.</span>
        <button type="button" disabled={saving} onClick={() => onSave(k)} className={buttonClass({ variant: "primary", size: "md" })}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Klantversie opslaan</button>
      </div>
    </div>
  );
}

/* ------------------------------ Pagina ------------------------------ */

export function QuarterDetailView({ d, werkversie, inPortaal, team, canWrite, canApprove, teamOnly, aiReady }: {
  d: QuarterDetail; werkversie: KlantRapport | null; inPortaal: KlantRapport | null; team: Array<{ id: string; name: string }>;
  canWrite: boolean; canApprove: boolean; teamOnly: boolean; aiReady: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [tab, setTab] = useState<Tab>("intern");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [feedback, setFeedback] = useState("");
  const [reden, setReden] = useState("");
  const [toonPortaal, setToonPortaal] = useState(false);
  const [toelichting, setToelichting] = useState(d.intern.toelichting ?? "");
  const [doelen, setDoelen] = useState(d.settings.doelen.map((x) => ({ label: x.label, metric: x.metric, target: String(x.target) })));
  const meta = QUARTER_STATUS_META[d.status];
  const editable = canWrite && EDITABLE_STATUSES.includes(d.status);
  const approved = d.status === "goedgekeurd" || d.status === "gepubliceerd";
  const hasContent = Boolean(werkversie && (d.klant.samenvatting.kern || d.klant.conclusie.kern));
  const m = d.metrics;
  const blok = d.checks.filter((c) => c.severity === "blok");

  useEffect(() => {
    if (!d.bezig && !d.inWachtrij) return;
    const t = setInterval(() => router.refresh(), 15000);
    return () => clearInterval(t);
  }, [d.bezig, d.inWachtrij, router]);

  const run = (fn: () => Promise<Res>, okText: string, after?: () => void) =>
    start(async () => {
      const res = await fn();
      setMsg({ ok: res.ok, text: res.ok ? okText : res.message ?? "Mislukt." });
      if (res.ok) after?.();
      router.refresh();
    });

  const pdf = (versie: string, extra = "") => `/api/reports/quarterly/${d.id}/pdf?versie=${versie}${extra}`;
  const tabBtn = (t: Tab, label: string, icon: ReactNode) => (
    <button type="button" onClick={() => setTab(t)} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium ${tab === t ? "bg-[var(--color-indigo-ink)] text-white" : "text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)]"}`}>{icon}{label}</button>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Kop */}
      <div className="sc-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <ClientLogo name={d.clientName} logoUrl={d.logoUrl} size={40} />
            <div className="min-w-0">
              <h1 className="text-lg font-semibold tracking-tight text-[var(--color-ink)]">{d.clientName} · {d.quarter.mode === "kalender" ? d.quarter.label : `Contractkwartaal ${d.quarter.index || ""}`}</h1>
              <p className="text-xs text-[var(--color-ink-muted)]">{kortDatum(d.quarter.from)} t/m {langDatum(d.quarter.to)} · {PAKKET_LABEL[d.pakketType]} · {d.quarter.mode === "contract" ? "contractkwartaal" : "kalenderkwartaal"} · verantwoordelijke: {d.verantwoordelijke ?? "niet toegewezen"}</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span title={meta.uitleg}><Badge tone={meta.tone}>{d.bezig ? <><Loader2 className="mr-1 inline size-3 animate-spin" />Wordt gegenereerd</> : meta.label}</Badge></span>
            {d.voorlopig && hasContent ? <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-warn-soft)] px-2 py-0.5 text-2xs font-medium text-[#8a5300]"><TriangleAlert className="size-3" /> Voorlopig concept</span> : null}
            {d.deadline ? <span className={`text-2xs ${d.achterstallig ? "font-semibold text-[var(--color-bad)]" : "text-[var(--color-ink-faint)]"}`}>{d.achterstallig ? "Achterstallig · " : ""}{d.deadline.label}: {kortDatum(d.deadline.datum)}</span> : null}
            <span className="text-2xs text-[var(--color-ink-faint)]">Versie {d.versie}{d.publishedVersion ? ` · in klantportaal: versie ${d.publishedVersion}` : ""}</span>
          </div>
        </div>

        {/* Acties */}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--color-line)] pt-4">
          {hasContent ? (
            <>
              <a href={pdf("intern")} target="_blank" rel="noreferrer" className={buttonClass({ variant: "secondary", size: "sm" })}><Lock className="size-3.5" /> Interne versie</a>
              <a href={pdf("intern", "&download=1")} className={buttonClass({ variant: "ghost", size: "sm", className: "!px-2" })} aria-label="Interne versie downloaden"><Download className="size-3.5" /></a>
              <a href={pdf("klant")} target="_blank" rel="noreferrer" className={buttonClass({ variant: "secondary", size: "sm" })}><Globe className="size-3.5" /> Klantversie</a>
              <a href={pdf("klant", "&download=1")} className={buttonClass({ variant: "ghost", size: "sm", className: "!px-2" })} aria-label="Klantversie downloaden"><Download className="size-3.5" /></a>
              <a href={pdf("directie")} target="_blank" rel="noreferrer" className={buttonClass({ variant: "ghost", size: "sm" })}>Directieoverzicht</a>
            </>
          ) : null}
          <span className="flex-1" />
          {canWrite && !approved && !d.bezig ? (
            <button type="button" disabled={pending || !aiReady} title={aiReady ? "" : "AI-sleutel ontbreekt"} onClick={() => { if (!hasContent || confirm("De rapportage opnieuw genereren? Handmatige aanpassingen in de klantversie gaan verloren; eerdere versies blijven bewaard.")) run(() => generateQuarter(d.id), "Genereren gestart. De pagina werkt vanzelf bij."); }} className={buttonClass({ variant: hasContent ? "secondary" : "primary", size: "sm" })}>
              {hasContent ? <RotateCcw className="size-3.5" /> : <Sparkles className="size-3.5" />} {hasContent ? "Opnieuw genereren" : "Rapportage genereren"}
            </button>
          ) : null}
          {canWrite && (d.status === "klaar_voor_controle" || d.status === "aanpassingen_nodig") && !d.reviewedAt ? (
            <button type="button" disabled={pending || Boolean(d.approveBlocker)} title={d.approveBlocker ?? ""} onClick={() => run(() => markQuarterReviewed(d.id), canApprove ? "Controle afgerond." : `Controle afgerond. ${d.approverName ?? "De goedkeurder"} krijgt een taak om goed te keuren.`)} className={buttonClass({ variant: canApprove ? "secondary" : "primary", size: "sm" })}><ShieldCheck className="size-3.5" /> Controle afronden</button>
          ) : null}
          {canApprove && canWrite && (d.status === "klaar_voor_controle" || d.status === "aanpassingen_nodig") ? (
            <button type="button" disabled={pending || Boolean(d.approveBlocker)} title={d.approveBlocker ?? ""} onClick={() => run(() => approveQuarter(d.id), "Goedgekeurd. De lessen zijn vastgelegd in het Contentgeheugen.")} className={buttonClass({ variant: "primary", size: "sm" })}><Check className="size-3.5" /> Goedkeuren</button>
          ) : null}
          {canWrite && d.status === "goedgekeurd" ? (
            <button type="button" disabled={pending} onClick={() => { if (confirm(d.publishedVersion ? `De nieuwe versie publiceren? Deze vervangt versie ${d.publishedVersion} in het klantportaal.` : "De klantversie publiceren naar het klantportaal? De klant krijgt een melding.")) run(() => publishQuarter(d.id), "Gepubliceerd in het klantportaal."); }} className={`${buttonClass({ variant: "primary", size: "sm" })} !border-[var(--color-good)] !bg-[var(--color-good)]`}><Send className="size-3.5" /> {d.publishedVersion ? "Nieuwe versie publiceren" : "Publiceren naar klantportaal"}</button>
          ) : null}
          {canWrite && d.publishedVersion ? (
            <button type="button" disabled={pending} onClick={() => { if (confirm("De rapportage uit het klantportaal halen? De versies blijven bewaard.")) run(() => unpublishQuarter(d.id), "Publicatie ingetrokken."); }} className={buttonClass({ variant: "ghost", size: "sm" })}><Undo2 className="size-3.5" /> Publicatie intrekken</button>
          ) : null}
        </div>
        {d.approveBlocker && (d.status === "klaar_voor_controle" || d.status === "aanpassingen_nodig") && canWrite ? <p className="mt-2 text-2xs text-[#8a5300]">Goedkeuren kan nog niet: {d.approveBlocker}</p> : null}
        {d.status === "klaar_voor_controle" && d.reviewedAt ? <p className="mt-2 text-2xs text-[var(--color-good)]">Gecontroleerd door {d.reviewedByName ?? "de verantwoordelijke"} op {tijd(d.reviewedAt)}. {canApprove ? "Je kunt nu goedkeuren." : `Wacht op goedkeuring door ${d.approverName ?? "de goedkeurder"}.`}</p> : null}
        {approved ? <p className="mt-2 text-2xs text-[var(--color-ink-muted)]">Goedgekeurd door {d.approvedByName ?? "–"}{d.approvedAt ? ` op ${tijd(d.approvedAt)}` : ""} (versie {d.approvedVersion ?? d.versie}){d.publishedAt ? ` · gepubliceerd door ${d.publishedByName ?? "–"} op ${tijd(d.publishedAt)}` : ""}.</p> : null}
        {msg ? <p className={`mt-2 text-sm ${msg.ok ? "text-[var(--color-good)]" : "text-[var(--color-bad)]"}`}>{msg.text}</p> : null}
      </div>

      {/* Waarom nog niet gereed */}
      {d.errorMessage ? <Card tone="bad"><p className="text-sm text-[var(--color-bad)]"><b>Genereren mislukt.</b> {d.errorMessage}</p></Card> : null}
      {d.status === "wachten_op_data" ? (
        <Card tone="warn" title="Waarom deze rapportage nog niet gereed is">
          <p className="text-sm">{d.wachtReden ?? "Nog niet alle cijfers van het kwartaal zijn binnen."} Het systeem kijkt elke dag opnieuw en maakt de definitieve rapportage zodra de cijfers compleet zijn.</p>
          {d.ontbrekend.length ? <div className="mt-2"><Lijst items={d.ontbrekend} /></div> : null}
          {canWrite ? (
            <div className="mt-3 flex flex-col gap-2 border-t border-[var(--color-warn)]/30 pt-3">
              <p className="text-xs text-[var(--color-ink-muted)]">Komen de cijfers niet meer? Dan kun je bewust afronden met wat er is. Dat wordt vastgelegd en staat bovenaan de ontbrekende gegevens.</p>
              <textarea className="sc-input w-full text-sm" rows={2} placeholder="Waarom rond je af zonder de volledige cijfers?" value={reden} onChange={(e) => setReden(e.target.value)} />
              <button type="button" disabled={pending || !aiReady || reden.trim().length < 10} onClick={() => run(() => finishWithIncompleteData(d.id, reden), "Genereren gestart met de beschikbare cijfers.")} className={buttonClass({ variant: "secondary", size: "sm", className: "self-start" })}>Afronden met onvolledige data</button>
            </div>
          ) : null}
        </Card>
      ) : null}
      {d.portaalLooptAchter ? <Card tone="warn"><p className="text-sm">In het klantportaal staat nog <b>versie {d.publishedVersion}</b>. De klant ziet de aanpassingen pas nadat de nieuwe versie is goedgekeurd en gepubliceerd. <a className="text-[var(--color-info)] hover:underline" href={pdf("klant", "&bron=portaal")} target="_blank" rel="noreferrer">Bekijk de versie in het portaal</a></p></Card> : null}
      {d.openFeedback.length ? (
        <Card tone="warn" title={`Openstaande opmerkingen (${d.openFeedback.length})`}>
          <ul className="flex flex-col gap-2 text-sm">{d.openFeedback.map((f) => <li key={f.id}><span className="whitespace-pre-line">{f.body}</span><span className="block text-2xs text-[var(--color-ink-faint)]">{f.byName ?? "Onbekend"} · {tijd(f.at)}</span></li>)}</ul>
          {canWrite ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" disabled={pending || !aiReady || d.bezig} onClick={() => run(() => generateQuarter(d.id), "Genereren gestart; de opmerkingen worden verwerkt.")} className={buttonClass({ variant: "secondary", size: "sm" })}><Sparkles className="size-3.5" /> Laat AI de opmerkingen verwerken</button>
              <button type="button" disabled={pending} onClick={() => run(() => resolveQuarterFeedback(d.id), "Opmerkingen afgehandeld.")} className={buttonClass({ variant: "ghost", size: "sm" })}><Check className="size-3.5" /> Zelf verwerkt, afhandelen</button>
            </div>
          ) : null}
        </Card>
      ) : null}

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-1">
        {tabBtn("intern", "Interne versie", <Lock className="size-3.5" />)}
        {tabBtn("klant", "Klantversie", <Eye className="size-3.5" />)}
        {editable && hasContent ? tabBtn("aanpassen", "Aanpassen", <Pencil className="size-3.5" />) : null}
        {!teamOnly ? tabBtn("geschiedenis", "Geschiedenis", <History className="size-3.5" />) : null}
      </div>

      {tab === "klant" ? (
        werkversie && hasContent
          ? (
            <>
              {inPortaal ? (
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => setToonPortaal(false)} className={`rounded-full border px-3 py-1 text-xs ${!toonPortaal ? "border-[var(--color-indigo-ink)] bg-[var(--color-indigo-ink)] text-white" : "border-[var(--color-line)] text-[var(--color-ink-muted)]"}`}>Werkversie (versie {d.versie})</button>
                  <button type="button" onClick={() => setToonPortaal(true)} className={`rounded-full border px-3 py-1 text-xs ${toonPortaal ? "border-[var(--color-indigo-ink)] bg-[var(--color-indigo-ink)] text-white" : "border-[var(--color-line)] text-[var(--color-ink-muted)]"}`}>Nu in het klantportaal (versie {inPortaal.versie})</button>
                </div>
              ) : null}
              <p className="text-xs text-[var(--color-ink-muted)]">{toonPortaal && inPortaal ? "Dit is de versie die de klant nu ziet." : `Zo ziet de klant de rapportage${approved ? "" : " na goedkeuring en publicatie"}.`} Interne opmerkingen staan hier niet in.</p>
              <KlantReportView rapport={toonPortaal && inPortaal ? inPortaal : werkversie} />
            </>
          )
          : <Card><p className="text-sm text-[var(--color-ink-muted)]">Er is nog geen rapportage gegenereerd.</p></Card>
      ) : null}

      {tab === "aanpassen" && editable && hasContent ? (
        <Editor klant={d.klant} saving={pending} onSave={(k) => run(() => saveQuarterContent(d.id, { klant: k }), "Klantversie opgeslagen.")} />
      ) : null}

      {tab === "geschiedenis" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Auditgeschiedenis">
            <ol className="flex flex-col gap-2.5 text-sm">
              {d.events.map((e) => (
                <li key={e.id} className="border-l-2 border-[var(--color-line)] pl-3">
                  <span className="font-medium">{EVENT_LABEL[e.type] ?? e.type}</span>
                  <span className="block text-2xs text-[var(--color-ink-faint)]">{tijd(e.createdAt)} · {e.byName ?? "Automatisch"}{e.toStatus && e.fromStatus !== e.toStatus ? ` · status: ${QUARTER_STATUS_META[e.toStatus as keyof typeof QUARTER_STATUS_META]?.label ?? e.toStatus}` : ""}</span>
                  {e.note ? <span className="block whitespace-pre-line text-xs text-[var(--color-ink-muted)]">{e.note}</span> : null}
                </li>
              ))}
            </ol>
          </Card>
          <Card title="Versies">
            <p className="mb-2 text-2xs text-[var(--color-ink-muted)]">Elke generatie, goedkeuring en publicatie is een vastgelegde versie. Een gepubliceerde versie verandert niet meer.</p>
            <ul className="flex flex-col divide-y divide-[var(--color-line)] text-sm">
              {d.versions.map((v) => (
                <li key={v.versionNumber} className="flex items-center justify-between gap-3 py-2">
                  <span><b>Versie {v.versionNumber}</b> · {VERSIE_LABEL[v.kind] ?? v.kind}{v.note ? <span className="text-[var(--color-ink-muted)]"> · {v.note}</span> : null}<span className="block text-2xs text-[var(--color-ink-faint)]">{tijd(v.createdAt)} · {v.byName ?? "Automatisch"}</span></span>
                  {v.gepubliceerd ? <Badge tone="lime">In klantportaal</Badge> : null}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}

      {tab === "intern" ? (
        <div className="flex flex-col gap-4">
          {/* Planning */}
          <Card title="Planning van dit kwartaal">
            <ol className="grid gap-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
              {([["Voorbereiding start", d.schedule.voorbereiden], ["Voorlopig concept", d.schedule.concept], ["Laatste week: controle", d.schedule.laatsteWeek], ["Volledige cijfers ophalen", d.schedule.naAfloop], ["Klaar voor controle", d.schedule.controleDeadline], ["Gepubliceerd", d.schedule.publicatieDeadline]] as const).map(([lab, dag]) => (
                <li key={lab} className={`rounded-[var(--radius-sm)] border px-3 py-2 ${d.today >= dag ? "border-[var(--color-good)]/40 bg-[var(--color-good-soft)]" : "border-[var(--color-line)]"}`}>
                  <span className="block text-2xs text-[var(--color-ink-faint)]">{lab}</span><span className="font-medium">{kortDatum(dag)}</span>
                </li>
              ))}
            </ol>
          </Card>

          {!hasContent ? <Card><p className="text-sm text-[var(--color-ink-muted)]">Er is nog geen rapportage gegenereerd. Het voorlopige concept volgt automatisch op {kortDatum(d.schedule.concept)}{canWrite ? ", of genereer het nu met de knop hierboven." : "."}</p></Card> : null}

          {/* Controlepunten */}
          {hasContent && !teamOnly && d.checks.length ? (
            <Card title={`Controlepunten${blok.length ? ` (${blok.length} verplicht)` : ""}`} tone={blok.length ? "warn" : undefined}>
              <ul className="flex flex-col gap-2 text-sm">
                {d.checks.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-start justify-between gap-2">
                    <span className="flex min-w-0 flex-1 gap-2"><CircleAlert className={`mt-0.5 size-4 shrink-0 ${c.severity === "blok" ? "text-[var(--color-bad)]" : "text-[var(--color-warn)]"}`} />{c.label}</span>
                    {c.bevestigbaar && editable ? <button type="button" disabled={pending} onClick={() => run(() => confirmQuarterCheck(d.id, c.id), "Bevestigd.")} className={buttonClass({ variant: "secondary", size: "sm" })}>Gecontroleerd, klopt</button> : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {hasContent && m ? (
            <>
              {/* Interne kern en gezondheid */}
              <div className="grid gap-4 lg:grid-cols-2">
                <Card title="Hoe staat deze samenwerking ervoor">
                  <p className="text-sm leading-relaxed">{d.intern.kern || "De interne verdieping is niet opgesteld. Genereer opnieuw om het nogmaals te proberen."}</p>
                  {d.intern.risicos.length ? <div className="mt-3 flex flex-col gap-2">{d.intern.risicos.map((r, i) => <div key={i} className="rounded-[var(--radius-sm)] border-l-4 border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-3 py-2 text-sm"><b>{r.titel}</b><span className="block text-[var(--color-ink-muted)]">{r.toelichting}</span></div>)}</div> : null}
                </Card>
                <Card title="Kwartaalgezondheid">
                  <p className="mb-2 text-2xs text-[var(--color-ink-muted)]">Per criterium beoordeeld, met de onderbouwing erbij. Er is bewust geen opgetelde score.</p>
                  <ul className="flex flex-col divide-y divide-[var(--color-line)] text-sm">
                    {d.health.map((h) => (
                      <li key={h.key} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 py-2">
                        <span className="font-medium">{h.label}</span><span className={`rounded-full px-2 py-0.5 text-center text-2xs font-semibold ${LVL[h.niveau].cls}`}>{LVL[h.niveau].label}</span>
                        <span className="col-span-2 text-xs text-[var(--color-ink-muted)]">{h.toelichting}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>

              {/* Ontbrekend en datakwaliteit */}
              {(d.ontbrekend.length || m.dataKwaliteit.length || (m.vorig && !m.vorig.vergelijkbaar)) ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  <Card title={`Ontbrekende gegevens (${d.ontbrekend.length})`}>{d.ontbrekend.length ? <Lijst items={d.ontbrekend} /> : <p className="text-sm text-[var(--color-ink-muted)]">Alle benodigde gegevens zijn beschikbaar.</p>}</Card>
                  <Card title="Datakwaliteit en vergelijkbaarheid">
                    {m.dataKwaliteit.length ? <Lijst items={m.dataKwaliteit} /> : <p className="text-sm text-[var(--color-ink-muted)]">Geen waarschuwingen.</p>}
                    {m.vorig && !m.vorig.vergelijkbaar ? <div className="mt-3"><p className="mb-1 text-xs font-semibold">Geen vergelijking met {m.vorig.label}:</p><Lijst items={m.vorig.redenen} /></div> : null}
                  </Card>
                </div>
              ) : null}

              {/* Kritisch, gesprek, commercieel */}
              <div className="grid gap-4 lg:grid-cols-3">
                <Card title="Kritische verbeterpunten voor Shortclips">{d.intern.kritisch.length ? <Lijst items={d.intern.kritisch} /> : <p className="text-sm text-[var(--color-ink-muted)]">Geen.</p>}</Card>
                <Card title="Adviezen voor het klantgesprek">{d.intern.gesprek.length ? <Lijst items={d.intern.gesprek} /> : <p className="text-sm text-[var(--color-ink-muted)]">Geen.</p>}</Card>
                <Card title="Commerciële kansen">{d.intern.commercieel.length ? <ul className="flex flex-col gap-2 text-sm">{d.intern.commercieel.map((c, i) => <li key={i}><b>{c.kans}</b><span className="block text-[var(--color-ink-muted)]">{c.onderbouwing}</span></li>)}</ul> : <p className="text-sm text-[var(--color-ink-muted)]">Geen kansen die uit de data volgen.</p>}</Card>
              </div>

              {d.intern.acties.length ? (
                <Card title="Nog uit te voeren acties">
                  <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-sm"><thead><tr className="text-left text-2xs uppercase text-[var(--color-ink-faint)]"><th className="py-1">Actie</th><th className="py-1">Wie</th><th className="py-1">Waarom</th></tr></thead><tbody>{d.intern.acties.map((a, i) => <tr key={i} className="border-t border-[var(--color-line)] align-top"><td className="py-2 pr-3">{a.actie}</td><td className="py-2 pr-3 capitalize">{a.rol}</td><td className="py-2 text-[var(--color-ink-muted)]">{a.waarom}</td></tr>)}</tbody></table></div>
                </Card>
              ) : null}

              {/* Verbetermonitor */}
              <Card title="Interne verbetermonitor">
                {m.verbetermonitor ? (
                  <>
                    <p className="mb-2 text-xs text-[var(--color-ink-muted)]">Verbeterpunten uit {m.verbetermonitor.periodLabel} en wat ermee is gedaan (stand bij het genereren).</p>
                    <ul className="flex flex-col divide-y divide-[var(--color-line)] text-sm">{m.verbetermonitor.items.map((x) => <li key={x.id} className="flex items-start justify-between gap-3 py-2"><span>{x.titel}{x.note ? <span className="block text-xs text-[var(--color-ink-muted)]">{x.note}</span> : null}</span><Badge tone={x.status === "uitgevoerd" ? "good" : x.status === "vervallen" ? "neutral" : "warn"}>{x.status === "open" ? "Niet uitgevoerd" : x.status === "uitgevoerd" ? "Uitgevoerd" : "Vervallen"}</Badge></li>)}</ul>
                    {d.intern.opvolging ? <p className="mt-2 rounded-[var(--radius-sm)] bg-[var(--color-surface-sunken)] px-3 py-2 text-sm">{d.intern.opvolging}</p> : null}
                  </>
                ) : <p className="text-sm text-[var(--color-ink-muted)]">Er is geen vorige kwartaalrapportage met verbeterpunten om op te volgen.</p>}
                {d.improvements.length ? (
                  <div className="mt-4 border-t border-[var(--color-line)] pt-3">
                    <p className="mb-2 text-xs font-semibold">Verbeterpunten uit deze rapportage: opvolging</p>
                    <ul className="flex flex-col gap-2 text-sm">
                      {d.improvements.map((i) => (
                        <li key={i.id} className="rounded-[var(--radius-sm)] border border-[var(--color-line)] p-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <span className="min-w-0 flex-1"><b>{i.titel}</b><span className="block text-xs text-[var(--color-ink-muted)]">{i.actie}{i.verantwoordelijke ? ` · ${i.verantwoordelijke}` : ""}</span></span>
                            <div className="flex gap-1">
                              {(["open", "uitgevoerd", "vervallen"] as const).map((st) => <button key={st} type="button" disabled={pending} onClick={() => run(() => setImprovementStatus(i.id, st), "Bijgewerkt.")} className={`rounded-full border px-2.5 py-0.5 text-2xs ${i.status === st ? "border-[var(--color-indigo-ink)] bg-[var(--color-indigo-ink)] text-white" : "border-[var(--color-line)] text-[var(--color-ink-muted)]"}`}>{st === "open" ? "Open" : st === "uitgevoerd" ? "Uitgevoerd" : "Vervallen"}</button>)}
                            </div>
                          </div>
                          {i.status === "open" && team.length ? (
                            <form className="mt-2 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); run(() => createImprovementTask(i.id, String(fd.get("wie") || "") || null, String(fd.get("datum") || "") || null), "Taak aangemaakt op de takenpagina."); }}>
                              <select name="wie" className="sc-input text-xs" defaultValue={d.verantwoordelijkeId ?? ""}><option value="">Niemand</option>{team.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
                              <input type="date" name="datum" className="sc-input text-xs" />
                              <button type="submit" disabled={pending} className="text-xs text-[var(--color-info)] hover:underline">Maak er een taak van</button>
                            </form>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : approved ? null : <p className="mt-3 text-2xs text-[var(--color-ink-faint)]">Na goedkeuring worden de verbeterpunten uit deze rapportage hier vastgelegd, zodat ze volgend kwartaal worden opgevolgd.</p>}
              </Card>

              {/* Cijfers en bronnen */}
              <Card title="Alle resultaten">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead><tr className="text-left text-2xs uppercase text-[var(--color-ink-faint)]"><th className="py-1">Periode</th><th className="py-1 text-right">Weergaven</th><th className="py-1 text-right">Bereik</th><th className="py-1 text-right">Interacties</th><th className="py-1 text-right">Volgers</th><th className="py-1 text-right">Video&apos;s</th><th className="py-1 text-right">Per video</th><th className="py-1 text-right">Gemeten dagen</th></tr></thead>
                    <tbody>
                      {m.segmenten.map((s) => <tr key={s.from} className="border-t border-[var(--color-line)]"><td className="py-2 capitalize">{s.label}</td><td className="py-2 text-right tabular-nums">{s.meetdagen ? nf(s.views) : "–"}</td><td className="py-2 text-right tabular-nums">{s.meetdagen ? nf(s.reach) : "–"}</td><td className="py-2 text-right tabular-nums">{s.meetdagen ? nf(s.engagements) : "–"}</td><td className="py-2 text-right tabular-nums">{s.meetdagen ? nf(s.followerGrowth) : "–"}</td><td className="py-2 text-right tabular-nums">{nf(s.videos)}</td><td className="py-2 text-right tabular-nums">{nf(s.gemViewsPerVideo)}</td><td className="py-2 text-right tabular-nums">{s.meetdagen}/{s.dagen}</td></tr>)}
                      <tr className="border-t-2 border-[var(--color-ink)] font-semibold"><td className="py-2">Totaal</td><td className="py-2 text-right tabular-nums">{nf(m.totaal.views)}</td><td className="py-2 text-right tabular-nums">{nf(m.totaal.reach)}</td><td className="py-2 text-right tabular-nums">{nf(m.totaal.engagements)}</td><td className="py-2 text-right tabular-nums">{nf(m.totaal.followerGrowth)}</td><td className="py-2 text-right tabular-nums">{nf(m.totaal.videos)}</td><td className="py-2 text-right tabular-nums">{nf(m.totaal.gemViewsPerVideo)}</td><td className="py-2 text-right tabular-nums">{m.totaal.meetdagen}/{m.totaal.dagen}</td></tr>
                    </tbody>
                  </table>
                </div>
                <p className="mt-3 text-xs text-[var(--color-ink-muted)]">Pakket: {m.pakket.label}{m.pakket.naam ? ` (${m.pakket.naam})` : ""}{m.pakket.videosPerMaand !== null ? ` · ${m.pakket.videosPerMaand} video's per maand` : ""}{m.pakket.verwachtInKwartaal !== null ? ` · ${m.pakket.verwachtInKwartaal} afgesproken voor dit kwartaal` : ""} · bron: {m.pakket.bron}.</p>
                {m.pakket.bijzonderheden.map((b) => <p key={b} className="mt-1 text-xs text-[#8a5300]">{b}</p>)}
                {(m.pakket.type === "advertentie" || m.pakket.type === "beide") ? <p className="mt-1 text-xs text-[#8a5300]">{m.advertenties.toelichting}</p> : null}
                <details className="mt-3"><summary className="cursor-pointer text-xs font-semibold text-[var(--color-ink-muted)]">Bronnen en meetperiodes</summary>
                  <ul className="mt-2 flex flex-col gap-1 text-xs">{m.bronnen.map((b) => <li key={b.naam}><b>{b.naam}</b> · {b.periode}{b.opmerking ? ` · ${b.opmerking}` : ""}</li>)}</ul>
                </details>
              </Card>
            </>
          ) : null}

          {/* Interne toelichting */}
          {!teamOnly ? (
            <Card title="Interne toelichting">
              <textarea className="sc-input w-full text-sm" rows={4} placeholder="Context voor collega's: afspraken met de klant, bijzonderheden, wat je in het gesprek wilt benoemen. Komt nooit in de klantversie." value={toelichting} disabled={!editable} onChange={(e) => setToelichting(e.target.value)} />
              {editable ? <button type="button" disabled={pending || toelichting === (d.intern.toelichting ?? "")} onClick={() => run(() => saveQuarterContent(d.id, { toelichting }), "Toelichting opgeslagen.")} className={buttonClass({ variant: "secondary", size: "sm", className: "mt-2" })}>Toelichting opslaan</button> : null}
            </Card>
          ) : null}

          {/* Afkeuren / heropenen */}
          {canWrite && hasContent && !d.bezig ? (
            <Card title={approved ? "Heropenen na goedkeuring" : "Aanpassingen vragen"}>
              <p className="mb-2 text-xs text-[var(--color-ink-muted)]">{approved ? "Wijzigen na goedkeuring kan alleen door de rapportage te heropenen. Daarna is opnieuw controle en goedkeuring nodig. De gepubliceerde versie blijft in het klantportaal staan tot de nieuwe versie is gepubliceerd." : "De rapportage gaat terug naar de verantwoordelijke. De opmerking blijft bewaard in de geschiedenis."}</p>
              <textarea className="sc-input w-full text-sm" rows={3} placeholder="Wat moet er anders?" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" disabled={pending || (approved && !feedback.trim())} onClick={() => run(() => requestQuarterChanges(d.id, feedback, false), approved ? "Heropend." : "Teruggezet voor aanpassing.", () => setFeedback(""))} className={buttonClass({ variant: "secondary", size: "sm" })}><Undo2 className="size-3.5" /> {approved ? "Heropenen" : "Terugzetten voor aanpassing"}</button>
                <button type="button" disabled={pending || !aiReady || !feedback.trim()} onClick={() => run(() => requestQuarterChanges(d.id, feedback, true), "Genereren gestart; de opmerking wordt verwerkt.", () => setFeedback(""))} className={buttonClass({ variant: "ghost", size: "sm" })}><Sparkles className="size-3.5" /> {approved ? "Heropenen en opnieuw genereren" : "Opnieuw genereren met deze opmerking"}</button>
              </div>
            </Card>
          ) : null}

          {/* Instellingen per klant */}
          {canWrite ? (
            <Card title="Instellingen voor deze klant">
              <div className="grid gap-5 lg:grid-cols-2">
                <div>
                  <p className="mb-1 text-xs font-semibold">Kwartaalindeling</p>
                  <p className="mb-2 text-2xs text-[var(--color-ink-muted)]">Kalenderkwartalen (januari tot en met maart, enzovoort) of contractkwartalen vanaf de startdatum van de samenwerking. Geldt vanaf het volgende kwartaal dat wordt ingepland.</p>
                  <div className="flex gap-1">
                    {(["kalender", "contract"] as QuarterMode[]).map((mode) => (
                      <button key={mode} type="button" disabled={pending} onClick={() => run(() => saveQuarterSettings(d.clientId, { mode, enabled: true }), "Kwartaalindeling opgeslagen.")} className={`rounded-full border px-3 py-1 text-xs ${d.settings.mode === mode ? "border-[var(--color-indigo-ink)] bg-[var(--color-indigo-ink)] text-white" : "border-[var(--color-line)] text-[var(--color-ink-muted)]"}`}>{mode === "kalender" ? "Kalenderkwartalen" : "Contractkwartalen"}</button>
                    ))}
                  </div>
                  <button type="button" disabled={pending} onClick={() => { if (confirm("Kwartaalrapportages voor deze klant uitzetten? Er worden dan geen nieuwe kwartalen meer ingepland.")) run(() => saveQuarterSettings(d.clientId, { mode: d.settings.mode, enabled: false }), "Kwartaalrapportages staan uit voor deze klant."); }} className="mt-2 block text-2xs text-[var(--color-ink-muted)] hover:underline">Kwartaalrapportages uitzetten voor deze klant</button>
                </div>
                <div>
                  <p className="mb-1 text-xs font-semibold">Doelen voor {d.quarter.label}</p>
                  <p className="mb-2 text-2xs text-[var(--color-ink-muted)]">{d.settings.doelen.length === 0 ? "Er zijn geen doelen vastgelegd. De rapportage vermeldt dat en toont geen realisatie. Leg ze hier vast als ze met de klant zijn afgesproken." : "De rapportage toont per doel de realisatie. Wijzigingen gelden bij de volgende generatie."} Doelen voor het volgende kwartaal leg je vast op de rapportage van dat kwartaal; die staat klaar zodra het kwartaal begint.</p>
                  <div className="flex flex-col gap-1.5">
                    {doelen.map((x, i) => (
                      <div key={i} className="flex flex-wrap gap-1.5">
                        <input className="sc-input min-w-0 flex-1 text-xs" placeholder="Omschrijving" value={x.label} onChange={(e) => setDoelen(doelen.map((y, n) => (n === i ? { ...y, label: e.target.value } : y)))} />
                        <select className="sc-input text-xs" value={x.metric} onChange={(e) => setDoelen(doelen.map((y, n) => (n === i ? { ...y, metric: e.target.value } : y)))}>{DOEL_METRICS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
                        <input className="sc-input w-24 text-xs" inputMode="numeric" placeholder="Doel" value={x.target} onChange={(e) => setDoelen(doelen.map((y, n) => (n === i ? { ...y, target: e.target.value.replace(/[^\d]/g, "") } : y)))} />
                        <button type="button" onClick={() => setDoelen(doelen.filter((_, n) => n !== i))} className="text-2xs text-[var(--color-bad)]">Verwijderen</button>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex gap-3">
                    {doelen.length < 6 ? <button type="button" onClick={() => setDoelen([...doelen, { label: "", metric: "views", target: "" }])} className="text-xs text-[var(--color-info)] hover:underline">Doel toevoegen</button> : null}
                    <button type="button" disabled={pending} onClick={() => run(() => saveQuarterGoals(d.clientId, d.quarter.key, doelen.map((x) => ({ label: x.label, metric: x.metric, target: Number(x.target) }))), "Doelen opgeslagen.")} className="text-xs font-semibold text-[var(--color-info)] hover:underline">Doelen opslaan</button>
                  </div>
                </div>
              </div>
            </Card>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
