"use client";

import { useCallback, useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Sparkles, Loader2, Check, CircleAlert, Download, Eye, Send, RotateCcw, Lock, Globe, ChevronDown, CalendarClock, TriangleAlert } from "lucide-react";
import { Badge, ClientLogo, buttonClass, type Tone } from "@/components/ui";
import { approveMonthlyReport, publishMonthlyReport, queueMonthlyReports, startMonthlyReport } from "@/server/actions/monthly-reports";
import type { ReportOverview, ReportRow } from "@/server/reports/service";
import { VIEW_STATUS_META, compareRows, countStatuses, viewStatus, type ViewStatus } from "@/lib/maandrapport-status";
import { FASE_LABEL, type ControleFase } from "@/lib/maandcontrole";

/** Statuslabels van de onderliggende rapportstatus (ook gebruikt op de detailpagina). */
export const STATUS_META: Record<string, { label: string; tone: Tone }> = {
  gegevens_verzamelen: { label: "In de wachtrij", tone: "info" },
  analyse_bezig: { label: "Analyse bezig", tone: "info" },
  klaar_voor_controle: { label: "Wacht op controle", tone: "violet" },
  aanpassing_nodig: { label: "Aanpassing nodig", tone: "warn" },
  goedgekeurd: { label: "Goedgekeurd", tone: "good" },
  gepubliceerd: { label: "Gepubliceerd", tone: "lime" },
  mislukt: { label: "Mislukt", tone: "bad" },
};

type StatusFilter = "alle" | "actie" | ViewStatus;
const STATUS_FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: "alle", label: "Alle statussen" },
  { key: "actie", label: "Actie nodig" },
  { key: "nog_genereren", label: "Nog genereren" },
  { key: "bezig", label: "Bezig" },
  { key: "gegenereerd", label: "Gegenereerd" },
  { key: "controleren", label: "Controleren" },
  { key: "goedgekeurd", label: "Goedgekeurd" },
  { key: "gepubliceerd", label: "Gepubliceerd" },
  { key: "mislukt", label: "Mislukt" },
];
const LEGACY_FILTER: Record<string, StatusFilter> = { wacht: "actie", aanpassing: "controleren", goedgekeurd: "goedgekeurd", bezig: "bezig", mislukt: "mislukt" };

type Row = {
  key: string;
  clientId: string;
  clientName: string;
  logoUrl: string | null;
  color: string | null;
  active: boolean;
  pmId: string | null;
  pmName: string | null;
  period: string;
  report: ReportRow | null;
  view: ViewStatus;
};

function monthLabel(p: string): string {
  const [y, m] = p.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, 1).toLocaleDateString("nl-NL", { month: "long", year: "numeric" });
}
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "short" }) : "");
const minutesSince = (iso: string | null) => (iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)) : 0);

const STAT_TONE: Record<string, string> = {
  neutral: "text-[var(--color-ink)]",
  violet: "text-[var(--color-violet)]",
  good: "text-[var(--color-good)]",
  lime: "text-[var(--color-lime)]",
  bad: "text-[var(--color-bad)]",
  warn: "text-[var(--color-warn)]",
};

/** Compacte, klikbare statchip (filter aan/uit) — één strakke balk i.p.v. grote tegels. */
function StatTile({ label, value, tone, hint, active, onClick }: { label: string; value: number; tone: keyof typeof STAT_TONE; hint?: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint ? `${label} · ${hint}` : label}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${active ? "border-[var(--color-indigo-ink)] bg-[var(--color-indigo-ink)] text-white" : "border-[var(--color-line)] hover:brightness-[0.98]"}`}
    >
      <span className={active ? "font-medium" : "text-[var(--color-ink-muted)]"}>{label}</span>
      <span className={`font-semibold tabular-nums ${active ? "" : value > 0 ? STAT_TONE[tone] : "text-[var(--color-ink-faint)]"}`}>{value}</span>
      {hint ? <span className={`text-2xs ${active ? "text-white/80" : "text-[var(--color-ink-faint)]"}`}>· {hint}</span> : null}
    </button>
  );
}

/**
 * Compacte PDF-knoppen: bekijken (nieuw tabblad) en downloaden.
 * Kleuren: interne versie blauw, klantversie groen, klantversie die nog niet
 * is goedgekeurd oranje (concept, niet versturen).
 */
function PdfButtons({ reportId, versie, enabled, goedgekeurd = false }: { reportId: string | null; versie: "intern" | "klant"; enabled: boolean; goedgekeurd?: boolean }) {
  const base = versie === "intern"
    ? "border-[var(--color-info)]/50 bg-[var(--color-info-soft)] text-[var(--color-info)]"
    : goedgekeurd
      ? "border-[var(--color-good)]/50 bg-[var(--color-good-soft)] text-[var(--color-good)]"
      : "border-[var(--color-warn)]/60 bg-[var(--color-warn-soft)] text-[#8a5300]";
  if (!reportId || !enabled) {
    return <span className="inline-flex h-7 items-center rounded-[var(--radius-sm)] border border-dashed border-[var(--color-line)] px-2 text-2xs text-[var(--color-ink-faint)]">Geen PDF</span>;
  }
  const url = `/api/reports/monthly/${reportId}/pdf?versie=${versie}`;
  const naam = versie === "intern" ? "interne versie (alleen voor het team)" : goedgekeurd ? "klantversie" : "klantversie (concept, nog niet goedgekeurd)";
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <span className={`inline-flex h-7 items-stretch overflow-hidden rounded-[var(--radius-sm)] border text-2xs font-medium ${base}`}>
        <a href={url} target="_blank" rel="noopener" title={`Bekijk de ${naam} als PDF`} className="inline-flex items-center gap-1 px-2 hover:brightness-95">
          <Eye className="size-3.5" /> PDF
        </a>
        <a href={`${url}&download=1`} title={`Download de ${naam}`} aria-label={`Download de ${naam}`} className="inline-flex items-center border-l border-current/30 px-1.5 hover:brightness-95">
          <Download className="size-3.5" />
        </a>
      </span>
      {versie === "klant" && !goedgekeurd ? <span className="text-[9px] font-medium uppercase tracking-wide text-[#8a5300]">Concept</span> : null}
      {versie === "intern" ? <span className="text-[9px] font-medium uppercase tracking-wide text-[var(--color-info)]">Niet delen</span> : null}
    </span>
  );
}

/** Uitleg bovenaan: verschil tussen interne versie en klantversie, met de kleuren. */
function VersieUitleg() {
  return (
    <div className="sc-card flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
      <p className="flex-1 text-sm leading-relaxed text-[var(--color-ink)]">
        Controleer eerst de interne maandrapportage. De klantversie bevat uitsluitend informatie die geschikt is om met de klant te delen. Verstuur de klantversie pas nadat beide versies intern zijn gecontroleerd en goedgekeurd.
      </p>
      <div className="flex flex-wrap gap-1.5 lg:max-w-[460px] lg:justify-end">
        <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-info)]/40 bg-[var(--color-info-soft)] px-2.5 py-1 text-2xs font-semibold text-[var(--color-info)]"><Lock className="size-3" /> Interne versie · alleen team</span>
        <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-good)]/40 bg-[var(--color-good-soft)] px-2.5 py-1 text-2xs font-semibold text-[var(--color-good)]"><Globe className="size-3" /> Klantversie · na goedkeuring</span>
        <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-warn)]/50 bg-[var(--color-warn-soft)] px-2.5 py-1 text-2xs font-semibold text-[#8a5300]"><TriangleAlert className="size-3" /> Nog niet goedgekeurd</span>
      </div>
    </div>
  );
}

const fmtLang = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const fmtKort = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("nl-NL", { day: "numeric", month: "long", timeZone: "UTC" });

const FASE_TONE: Record<ControleFase, Tone> = {
  gegenereerd: "violet",
  wacht_op_controle: "violet",
  ingepland: "info",
  in_controle: "warn",
  klaar_voor_goedkeuring: "good",
  goedgekeurd: "good",
  beschikbaar: "lime",
};

export function ReportList({
  overview, viewerId, canWrite, owner, aiReady, actueleMaand, huidigeMaand, huidigOpen, planning, initial,
}: {
  overview: ReportOverview;
  viewerId: string;
  canWrite: boolean;
  owner: boolean;
  aiReady: boolean;
  /** De maand die altijd bovenaan staat (vanaf de laatste werkdag de lopende maand, daarvoor de vorige). */
  actueleMaand: string;
  /** De lopende kalendermaand. */
  huidigeMaand: string;
  /** Of voor de lopende maand al een rapport gemaakt mag worden (vanaf de laatste werkdag). */
  huidigOpen: boolean;
  /** Controledag (laatste werkdag) en de dag waarop de cijfers definitief zijn, voor de actuele maand. */
  planning: { controleDag: string; definitiefVanaf: string; compleet: boolean };
  initial: { maand?: string; status?: string; weergave?: string; klantstatus?: string; klant?: string; zoek?: string };
}) {
  const router = useRouter();
  const { reports, clients, periods, team, teamOnly } = overview;

  const [klantStatus, setKlantStatus] = useState(initial.klantstatus === "alle" || initial.klantstatus === "inactief" ? initial.klantstatus : "actief");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => {
    const s = initial.status ?? "alle";
    if (STATUS_FILTERS.some((f) => f.key === s)) return s as StatusFilter;
    return LEGACY_FILTER[s] ?? "alle";
  });
  const [weergave, setWeergave] = useState(initial.weergave === "te-lezen" || initial.weergave === "mijn-klanten" || initial.weergave === "mijn-controle" ? initial.weergave : "alles");
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [rowMsg, setRowMsg] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  // Snelle opzoektabellen.
  const byKey = useMemo(() => new Map(reports.map((r) => [`${r.clientId}|${r.period}`, r])), [reports]);
  const meta = useMemo(() => {
    const m = new Map<string, { id: string; name: string; logoUrl: string | null; color: string | null; active: boolean; pmId: string | null; pmName: string | null }>();
    for (const c of clients) m.set(c.id, { id: c.id, name: c.name, logoUrl: null, color: null, active: c.active, pmId: c.pmId, pmName: c.pmName });
    for (const r of reports) {
      const cur = m.get(r.clientId);
      m.set(r.clientId, { id: r.clientId, name: r.clientName, logoUrl: r.logoUrl, color: r.color, active: r.clientActive, pmId: cur?.pmId ?? r.pmId, pmName: cur?.pmName ?? r.pmName });
    }
    return m;
  }, [clients, reports]);

  /** Eén rij per klant voor een maand. */
  const rowsFor = useCallback((period: string): Row[] => {
    const out: Row[] = [];
    for (const c of meta.values()) {
      const r = byKey.get(`${c.id}|${period}`) ?? null;
      // Teamleden zonder controlerecht zien alleen goedgekeurde rapporten.
      if (teamOnly && !r) continue;
      // Inactieve klanten zonder rapport alleen tonen als je daar expliciet op filtert.
      if (!c.active && !r && klantStatus !== "inactief") continue;
      out.push({
        key: `${c.id}|${period}`,
        clientId: c.id, clientName: c.name, logoUrl: c.logoUrl, color: c.color, active: c.active, pmId: c.pmId, pmName: c.pmName,
        period, report: r,
        view: viewStatus({ exists: Boolean(r), status: r?.status, beoordeeld: r?.beoordeeld, stale: r?.stale }),
      });
    }
    return out;
  }, [byKey, klantStatus, meta, teamOnly]);

  const passes = useCallback((r: Row) => {
    if (klantStatus === "actief" && !r.active) return false;
    if (klantStatus === "inactief" && r.active) return false;
    if (weergave === "mijn-klanten" && r.pmId !== viewerId) return false;
    if (weergave === "te-lezen" && !(r.report?.assignedToMe && !r.report.readByMe)) return false;
    if (weergave === "mijn-controle" && r.report?.controllerId !== viewerId) return false;
    return true;
  }, [klantStatus, viewerId, weergave]);

  const rows = useMemo(() => rowsFor(actueleMaand), [rowsFor, actueleMaand]);
  const baseRows = rows.filter(passes);
  const counts = countStatuses(baseRows.map((r) => r.view));
  const shown = baseRows
    .filter((r) => statusFilter === "alle" || (statusFilter === "actie" ? ["gegenereerd", "controleren", "goedgekeurd"].includes(r.view) : r.view === statusFilter))
    .sort(compareRows);

  const kanMaken = (period: string) => period < huidigeMaand || (period === huidigeMaand && huidigOpen);
  // Ontbrekende rapporten van de actuele maand (actieve klanten), voor de bulkknop.
  const missing = rows.filter((r) => r.active && (r.view === "nog_genereren" || r.view === "mislukt"));
  const kanMaand = kanMaken(actueleMaand);
  const voorlopig = rows.filter((r) => r.report?.hasAnalysis && !r.report.definitief).length;

  // Zolang er iets gegenereerd wordt, de tabel automatisch verversen.
  const anyBusy = reports.some((r) => r.status === "gegevens_verzamelen" || (r.status === "analyse_bezig" && !r.stale)) || Object.values(busy).some(Boolean);
  useEffect(() => {
    if (!anyBusy) return;
    const t = setInterval(() => router.refresh(), 6000);
    return () => clearInterval(t);
  }, [anyBusy, router]);

  function rowAction(row: Row, fn: () => Promise<{ ok: boolean; message?: string }>, okText: string) {
    setBusy((b) => ({ ...b, [row.key]: true }));
    setRowMsg((m) => { const n = { ...m }; delete n[row.key]; return n; });
    start(async () => {
      try {
        const res = await fn();
        setRowMsg((m) => ({ ...m, [row.key]: res.ok ? { ok: true, text: okText } : { ok: false, text: res.message ?? "Er ging iets mis." } }));
      } catch {
        setRowMsg((m) => ({ ...m, [row.key]: { ok: false, text: "Er ging iets mis. Probeer het opnieuw." } }));
      } finally {
        setBusy((b) => ({ ...b, [row.key]: false }));
        router.refresh();
      }
    });
  }

  function generate(row: Row) {
    const r = row.report;
    if (r && (row.view === "gegenereerd" || row.view === "controleren")) {
      if (!window.confirm(`De analyse van ${row.clientName} (${monthLabel(row.period)}) opnieuw genereren? De beoordeling en eerdere versies blijven bewaard.`)) return;
    }
    // Nieuw rapport: volledig opstellen. Bestaand rapport: alleen de AI-analyse vernieuwen (beoordeling blijft).
    const mode = r && r.hasAnalysis ? "ai_only" : "full";
    rowAction(row, () => startMonthlyReport(row.clientId, row.period, mode), "Genereren gestart. Dit duurt meestal een paar minuten.");
  }
  function approve(row: Row) {
    if (!row.report) return;
    if (!window.confirm(`Interne en klantversie van ${row.clientName} (${monthLabel(row.period)}) goedkeuren? Daarna kan de klantversie naar het klantportaal.`)) return;
    rowAction(row, () => approveMonthlyReport(row.report!.id), "Goedgekeurd. De klantversie kan nu verstuurd worden.");
  }
  function publish(row: Row) {
    if (!row.report) return;
    if (!window.confirm(`De KLANTVERSIE van ${monthLabel(row.period)} versturen naar het klantportaal van ${row.clientName}? De interne versie gaat nooit mee. De klant krijgt een melding.`)) return;
    rowAction(row, () => publishMonthlyReport(row.report!.id), "Klantversie verstuurd naar het klantportaal.");
  }
  function queueMissing() {
    if (!window.confirm(`Voor ${missing.length} ${missing.length === 1 ? "klant" : "klanten"} de rapportage van ${monthLabel(actueleMaand)} genereren?`)) return;
    setMsg(null);
    start(async () => {
      const res = await queueMonthlyReports(actueleMaand);
      setMsg(res.ok ? { ok: true, text: `${(res as { queued?: number }).queued ?? missing.length} rapporten staan in de wachtrij en worden op de achtergrond gemaakt (een paar per kwartier). De status werkt vanzelf bij.` } : { ok: false, text: res.message ?? "Er ging iets mis." });
      router.refresh();
    });
  }

  const pill = (on: boolean) => `rounded-full px-3 py-1.5 text-xs font-medium ${on ? "bg-[var(--color-indigo-ink)] text-white" : "border border-[var(--color-line)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`;
  const toggle = (k: StatusFilter) => setStatusFilter((cur) => (cur === k ? "alle" : k));
  const teamStats = team[actueleMaand] ?? [];
  const teLezenIk = reports.filter((r) => r.assignedToMe && !r.readByMe).length;
  const label = (t: string) => <span className="mb-1 block text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">{t}</span>;

  /** De tabel van één maand: één rij per klant, alle acties direct in de rij. */
  function renderTable(list: Row[], leeg: string) {
    if (list.length === 0) return <div className="sc-card p-6 text-sm text-[var(--color-ink-muted)]">{leeg}</div>;
    return (
      <div className="sc-card overflow-x-auto">
        <table className="w-full min-w-[960px] text-sm [&_td]:!px-2.5 [&_th]:!px-2.5 [&_td:first-child]:!pl-4 [&_th:first-child]:!pl-4">
          <thead>
            <tr className="border-b border-[var(--color-line)] text-left text-2xs uppercase tracking-wide text-[var(--color-ink-faint)]">
              <th className="sc-th sticky left-0 z-10 min-w-[200px] bg-[var(--color-surface)]">Klant</th>
              <th className="sc-th">Status</th>
              <th className="sc-th"><span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-info-soft)] px-2 py-0.5 text-[var(--color-info)]"><Lock className="size-3 shrink-0" /> Intern</span><span className="mt-0.5 block text-[9px] normal-case text-[var(--color-ink-faint)]">alleen team</span></th>
              <th className="sc-th"><span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-good-soft)] px-2 py-0.5 text-[var(--color-good)]"><Globe className="size-3 shrink-0" /> Klant</span><span className="mt-0.5 block text-[9px] normal-case text-[var(--color-ink-faint)]">na goedkeuring</span></th>
              <th className="sc-th">Actie</th>
              <th className="sc-th">Klantversie naar<br />klantportaal</th>
            </tr>
          </thead>
          <tbody>
            {list.map((row) => {
              const r = row.report;
              const meta = VIEW_STATUS_META[row.view];
              const isBusy = Boolean(busy[row.key]);
              const lopend = !kanMaken(row.period);
              const m = rowMsg[row.key];
              const pdfOk = Boolean(r?.hasAnalysis) && row.view !== "bezig";
              const goedgekeurd = row.view === "goedgekeurd" || row.view === "gepubliceerd";
              const isVoorlopig = Boolean(r?.hasAnalysis && !r.definitief && !goedgekeurd);
              return (
                <tr key={row.key} className="border-b border-[var(--color-line)] align-top last:border-0">
                  {/* Klant */}
                  <td className="sc-td sticky left-0 z-10 min-w-[200px] bg-[var(--color-surface)]">
                    <div className="flex items-center gap-2 whitespace-nowrap">
                      <ClientLogo name={row.clientName} logoUrl={row.logoUrl} color={row.color} size={22} />
                      {r ? (
                        <Link href={`/analytics/maandrapportages/${r.id}`} className="font-medium text-[var(--color-ink)] hover:underline">{row.clientName}</Link>
                      ) : <span className="font-medium text-[var(--color-ink)]">{row.clientName}</span>}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 whitespace-nowrap text-2xs text-[var(--color-ink-faint)]">
                      <Badge tone={row.active ? "good" : "neutral"}>{row.active ? "Actief" : "Niet actief"}</Badge>
                      <span>{row.pmName ?? "Geen PM"}</span>
                      {r?.assignedToMe && !r.readByMe ? <Badge tone="violet">Te lezen</Badge> : null}
                      {r && r.readsTotal > 0 ? <span title="Door het team doorgenomen" className={r.readsDone === r.readsTotal ? "text-[var(--color-good)]" : ""}>team {r.readsDone}/{r.readsTotal}</span> : null}
                    </div>
                  </td>

                  {/* Status */}
                  <td className="sc-td">
                    {r?.fase && !teamOnly ? (
                      <span title={meta.uitleg}><Badge tone={FASE_TONE[r.fase]}>{FASE_LABEL[r.fase]}</Badge></span>
                    ) : (
                      <span title={meta.uitleg}><Badge tone={meta.tone}>{row.view === "bezig" ? <><Loader2 className="mr-1 inline size-3 animate-spin" />{meta.label}</> : meta.label}</Badge></span>
                    )}
                    {isVoorlopig && !teamOnly ? (
                      <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-[var(--color-warn-soft)] px-2 py-0.5 text-2xs font-medium text-[#8a5300]" title={`Gegenereerd op ${fmtDate(r!.generatedAt)}, vóór het einde van de maand. De definitieve cijfers volgen automatisch.`}>
                        <TriangleAlert className="size-3" /> Voorlopige cijfers
                      </div>
                    ) : null}
                    {r && r.ontbrekend > 0 && !teamOnly ? (
                      <div className="mt-1 inline-flex items-center gap-1 text-2xs font-medium text-[var(--color-warn)]" title="Opmerkingen over ontbrekende of onvolledige gegevens; zie het rapport">
                        <CircleAlert className="size-3" /> {r.ontbrekend} {r.ontbrekend === 1 ? "gegeven ontbreekt" : "gegevens ontbreken"}
                      </div>
                    ) : null}
                    {row.view === "bezig" && r ? (
                      <div className="mt-1 text-2xs text-[var(--color-ink-muted)]">
                        {r.status === "gegevens_verzamelen" ? "In de wachtrij" : `Analyse loopt${r.startedAt ? ` · ${minutesSince(r.startedAt)} min` : ""}`}
                      </div>
                    ) : null}
                    {row.view === "mislukt" && r ? (
                      <div className="mt-1 max-w-[160px] text-2xs text-[var(--color-bad)]">{r.stale ? "Vastgelopen tijdens het genereren." : r.errorMessage ?? "Onbekende fout."}</div>
                    ) : null}
                    {row.view === "controleren" && r?.status === "aanpassing_nodig" ? <div className="mt-1 text-2xs text-[var(--color-warn)]">Aanpassing gevraagd{r.feedbackOpen ? ` · ${r.feedbackOpen} feedback open` : ""}</div> : null}
                    {(row.view === "gegenereerd" || row.view === "controleren") && r?.generatedAt ? <div className="mt-1 text-2xs text-[var(--color-ink-faint)]">gemaakt {fmtDate(r.generatedAt)}</div> : null}
                  </td>

                  {/* PDF's direct in de tabel */}
                  <td className="sc-td"><PdfButtons reportId={r?.id ?? null} versie="intern" enabled={pdfOk} /></td>
                  <td className="sc-td"><PdfButtons reportId={r?.id ?? null} versie="klant" enabled={pdfOk} goedgekeurd={goedgekeurd} /></td>

                  {/* Actie: alleen de nu relevante stap in de gecontroleerde stroom. */}
                  <td className="sc-td whitespace-nowrap">
                    {(() => {
                      if (row.view === "bezig" || isBusy) {
                        return <span className={buttonClass({ variant: "secondary", size: "sm" })} aria-disabled><Loader2 className="size-3.5 animate-spin" /> Bezig</span>;
                      }
                      if (row.view === "gepubliceerd") {
                        return <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-good)]"><Check className="size-3.5" /> Afgerond</span>;
                      }
                      if (row.view === "goedgekeurd" && r) {
                        return <span className="text-xs font-medium text-[var(--color-good)]"><Check className="mr-1 inline size-3.5" />Goedgekeurd{r.approvedByName ? ` · ${r.approvedByName.split(" ")[0]}` : ""}</span>;
                      }
                      if ((row.view === "gegenereerd" || row.view === "controleren") && r) {
                        let controle: ReactNode;
                        if (canWrite && r.openChecks > 0) {
                          controle = (
                            <Link href={`/analytics/maandrapportages/${r.id}`} title="Vul de beoordeling in en rond de verplichte controlepunten af" className={buttonClass({ variant: "secondary", size: "sm" })}>
                              <CircleAlert className="size-3.5" /> Controleren
                            </Link>
                          );
                        } else if (owner && !r.definitief) {
                          controle = <span className="inline-flex items-center gap-1 text-2xs font-medium text-[#8a5300]" title="Goedkeuren kan zodra de cijfers van de volledige maand er zijn"><CalendarClock className="size-3.5" /> Goedkeuren vanaf {fmtKort(maandCompleetVanafClient(row.period))}</span>;
                        } else if (owner) {
                          controle = <button type="button" disabled={pending || isBusy} onClick={() => approve(row)} className={buttonClass({ variant: "primary", size: "sm" })}><Check className="size-3.5" /> Goedkeuren</button>;
                        } else {
                          controle = (
                            <div className="text-2xs text-[var(--color-ink-muted)]">
                              {r.openChecks === 0 ? "Gecontroleerd · goedkeuren doet Jarno" : "Wacht op controle"}
                              <div><Link href={`/analytics/maandrapportages/${r.id}`} className="text-[var(--color-info)] hover:underline">Rapportage openen</Link></div>
                            </div>
                          );
                        }
                        return (
                          <>
                            {controle}
                            {canWrite ? (
                              <button type="button" disabled={!aiReady || pending} onClick={() => generate(row)} className="mt-1 flex items-center gap-1 text-2xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
                                <RotateCcw className="size-3" /> Opnieuw genereren
                              </button>
                            ) : null}
                          </>
                        );
                      }
                      if (lopend) {
                        return <span className="text-2xs text-[var(--color-ink-faint)]" title="Een maandrapport kan gemaakt worden vanaf de laatste werkdag van de maand.">Maand loopt nog</span>;
                      }
                      if (row.view === "nog_genereren") {
                        return canWrite
                          ? <button type="button" disabled={!aiReady || pending} onClick={() => generate(row)} className={buttonClass({ variant: "primary", size: "sm" })}><Sparkles className="size-3.5" /> Genereren</button>
                          : <span className="text-[var(--color-ink-faint)]">–</span>;
                      }
                      if (row.view === "mislukt") {
                        return canWrite
                          ? <button type="button" disabled={!aiReady || pending} onClick={() => generate(row)} className={buttonClass({ variant: "primary", size: "sm" })}><RotateCcw className="size-3.5" /> Opnieuw</button>
                          : <span className="text-[var(--color-ink-faint)]">–</span>;
                      }
                      return <span className="text-[var(--color-ink-faint)]">–</span>;
                    })()}
                    {m ? <div className={`mt-1 max-w-[220px] whitespace-normal text-2xs ${m.ok ? "text-[var(--color-good)]" : "text-[var(--color-bad)]"}`}>{m.text}</div> : null}
                  </td>

                  {/* Versturen: alleen de klantversie, pas na goedkeuring; nooit dubbel. */}
                  <td className="sc-td whitespace-nowrap">
                    {r && row.view === "gepubliceerd" ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-good)]" title={r.publishedAt ? `Verstuurd op ${fmtDate(r.publishedAt)}` : "Verstuurd"}>
                        <Check className="size-3.5" /> Verstuurd{r.publishedAt ? ` · ${fmtDate(r.publishedAt)}` : ""}
                      </span>
                    ) : r && row.view === "goedgekeurd" ? (
                      canWrite ? (
                        <button type="button" disabled={pending || isBusy} onClick={() => publish(row)} className={`${buttonClass({ variant: "primary", size: "sm" })} !bg-[var(--color-good)] !border-[var(--color-good)]`}>
                          <Send className="size-3.5" /> Klantversie versturen
                        </button>
                      ) : (
                        <span className="text-2xs text-[var(--color-ink-muted)]">Nog niet verstuurd</span>
                      )
                    ) : (
                      <span className="inline-flex items-center gap-1 text-2xs text-[#8a5300]" title="De klantversie kan pas verstuurd worden als beide versies zijn gecontroleerd en goedgekeurd">
                        <Lock className="size-3" /> Na goedkeuring
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  const leegTekst = weergave === "te-lezen" ? "Je hebt alle maandrapportages doorgenomen." : weergave === "mijn-controle" ? "Er staan voor deze maand geen rapportages op jouw naam." : "Geen rapportages voor deze filters.";

  return (
    <div className="space-y-4">
      {!teamOnly ? <VersieUitleg /> : null}

      {/* Planning van de actuele maand. */}
      {!teamOnly ? (
        <div className={`flex flex-wrap items-start gap-2.5 rounded-[var(--radius-md)] border px-4 py-3 text-sm ${planning.compleet ? "border-[var(--color-line)] bg-[var(--color-surface)]" : "border-[var(--color-warn)]/50 bg-[var(--color-warn-soft)]"}`}>
          <CalendarClock className={`mt-0.5 size-4 shrink-0 ${planning.compleet ? "text-[var(--color-ink-muted)]" : "text-[#8a5300]"}`} />
          <div className="min-w-0 flex-1">
            <p className="font-semibold capitalize text-[var(--color-ink)]">Maandrapportage {monthLabel(actueleMaand)}</p>
            <p className="mt-0.5 text-[var(--color-ink-muted)]">
              Controledag: <b className="text-[var(--color-ink)]">{fmtLang(planning.controleDag)}</b> (laatste werkdag van de maand). Dan staan de rapportages klaar om voor te bereiden en te controleren.{" "}
              {planning.compleet
                ? "De maand is compleet: de cijfers worden automatisch definitief gemaakt en daarna kan Jarno goedkeuren."
                : <>De cijfers zijn tot en met de laatste dag nog voorlopig. Vanaf <b className="text-[var(--color-ink)]">{fmtKort(planning.definitiefVanaf)}</b> worden ze automatisch ververst met de volledige maand; pas daarna kan de klantversie worden goedgekeurd en verstuurd.</>}
              {voorlopig > 0 ? <> Nu {voorlopig} {voorlopig === 1 ? "rapportage" : "rapportages"} met voorlopige cijfers.</> : null}
            </p>
          </div>
        </div>
      ) : null}

      {/* Statistieken: compacte klikbare chips (filter). */}
      <div className="flex flex-wrap items-center gap-1.5">
        <StatTile label="Totaal klanten" value={counts.totaal} tone="neutral" active={statusFilter === "alle"} onClick={() => setStatusFilter("alle")} />
        <StatTile label="Nog genereren" value={counts.nogGenereren} tone="neutral" hint={counts.bezig ? `${counts.bezig} bezig` : undefined} active={statusFilter === "nog_genereren"} onClick={() => toggle("nog_genereren")} />
        <StatTile label="Te controleren" value={counts.teControleren} tone="violet" active={statusFilter === "actie"} onClick={() => toggle("actie")} />
        <StatTile label="Goedgekeurd" value={counts.goedgekeurd} tone="good" hint={counts.goedgekeurd ? "nog versturen" : undefined} active={statusFilter === "goedgekeurd"} onClick={() => toggle("goedgekeurd")} />
        <StatTile label="Verstuurd" value={counts.gepubliceerd} tone="lime" active={statusFilter === "gepubliceerd"} onClick={() => toggle("gepubliceerd")} />
        <StatTile label="Mislukt" value={counts.mislukt} tone="bad" active={statusFilter === "mislukt"} onClick={() => toggle("mislukt")} />
      </div>

      {/* Filters */}
      <div className="sc-card flex flex-wrap items-end gap-3 p-3">
        <label>
          {label("Status")}
          <select className="sc-input text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
            {STATUS_FILTERS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </label>
        <div>
          {label("Klanten")}
          <div className="flex gap-1">
            {(["actief", "inactief", "alle"] as const).map((k) => (
              <button key={k} type="button" className={pill(klantStatus === k)} onClick={() => setKlantStatus(k)}>
                {k === "alle" ? "Alle" : k === "actief" ? "Actief" : "Niet actief"}
              </button>
            ))}
          </div>
        </div>
        <div>
          {label("Weergave")}
          <div className="flex gap-1">
            <button type="button" className={pill(weergave === "alles")} onClick={() => setWeergave("alles")}>Alles</button>
            <button type="button" className={pill(weergave === "mijn-klanten")} onClick={() => setWeergave("mijn-klanten")}>Mijn klanten</button>
            <button type="button" className={pill(weergave === "mijn-controle")} onClick={() => setWeergave("mijn-controle")}>Mijn controle</button>
            <button type="button" className={pill(weergave === "te-lezen")} onClick={() => setWeergave("te-lezen")}>Door mij te lezen{teLezenIk ? ` (${teLezenIk})` : ""}</button>
          </div>
        </div>
        {canWrite && kanMaand && missing.length > 0 ? (
          <button type="button" disabled={pending || !aiReady} onClick={queueMissing} className={buttonClass({ variant: "primary", size: "sm", className: "ml-auto" })} title={aiReady ? "" : "AI-sleutel ontbreekt"}>
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} Alle ontbrekende genereren ({missing.length})
          </button>
        ) : null}
      </div>

      {msg ? <p className={`text-sm ${msg.ok ? "text-[var(--color-good)]" : "text-[var(--color-bad)]"}`}>{msg.text}</p> : null}

      {/* De actuele maand: staat altijd bovenaan en verandert niet door het archief. */}
      {renderTable(shown, leegTekst)}

      <p className="text-2xs text-[var(--color-ink-faint)]">
        De interne versie is alleen voor het Shortclips-team en gaat nooit naar de klant of het klantportaal. Alleen de klantversie kan worden verstuurd, en pas na goedkeuring én een bevestiging via &quot;Klantversie versturen&quot;.
      </p>

      {/* Teamvoortgang (doornemen van goedgekeurde rapporten), compact onder de tabel. */}
      {teamStats.length > 0 ? (
        <div className="sc-card p-4">
          <p className="mb-2 text-sm font-semibold text-[var(--color-ink)]">Team: doorgenomen <span className="font-normal capitalize text-[var(--color-ink-faint)]">· {monthLabel(actueleMaand)}</span></p>
          <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
            {teamStats.map((t) => {
              const pct = t.assigned ? Math.round((t.read / t.assigned) * 100) : 0;
              return (
                <li key={t.userId}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-[var(--color-ink)]">{t.name}</span>
                    <span className={`tabular-nums text-xs ${t.read === t.assigned ? "text-[var(--color-good)]" : "text-[var(--color-ink-muted)]"}`}>{t.read}/{t.assigned}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-sunken)]">
                    <div className="h-full rounded-full bg-[var(--color-indigo-ink)]" style={{ width: `${pct}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {/* Archief: eerdere maanden klappen hier open, de actuele maand bovenaan blijft staan. */}
      <MaandArchief
        months={[...new Set(periods)].sort().reverse().filter((p) => p < actueleMaand)}
        initialOpen={initial.maand && initial.maand < actueleMaand ? [initial.maand] : []}
        render={(p) => renderTable(rowsFor(p).filter(passes).sort(compareRows), leegTekst)}
      />
    </div>
  );
}

/** 1e van de maand na een rapportperiode (client-side, zonder serverimport). */
function maandCompleetVanafClient(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m!, 1));
  return d.toISOString().slice(0, 10);
}

/**
 * Archief van eerdere maanden onderaan de pagina. Een maand openen klapt de
 * rapportages van die maand direct hieronder open; meerdere maanden kunnen
 * los van elkaar open en dicht. De actuele maand bovenaan verandert niet.
 * Een maand aanvinken archiveert 'm (per medewerker, in de browser bewaard);
 * gearchiveerde maanden blijven terug te vinden onder "Gearchiveerd".
 */
function MaandArchief({ months, initialOpen, render }: { months: string[]; initialOpen: string[]; render: (p: string) => ReactNode }) {
  const [archived, setArchived] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(() => new Set(initialOpen));
  useEffect(() => {
    try {
      const raw = localStorage.getItem("maandrapport-archief");
      if (raw) setArchived(new Set(JSON.parse(raw) as string[]));
    } catch { /* geen opgeslagen archief */ }
  }, []);
  const toggleArchief = (p: string) =>
    setArchived((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p); else n.add(p);
      try { localStorage.setItem("maandrapport-archief", JSON.stringify([...n])); } catch { /* opslaan mislukt */ }
      return n;
    });
  const toggleOpen = (p: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p); else n.add(p);
      return n;
    });

  if (months.length === 0) return null;
  const actief = months.filter((p) => !archived.has(p));
  const gearchiveerd = months.filter((p) => archived.has(p));

  const Regel = ({ p }: { p: string }) => {
    const isOpen = open.has(p);
    return (
      <li className="py-1.5">
        <div className="flex items-center justify-between gap-3">
          <button type="button" onClick={() => toggleOpen(p)} aria-expanded={isOpen} className="inline-flex items-center gap-1.5 py-1 text-sm font-medium capitalize text-[var(--color-ink)] hover:text-[var(--color-brand-700)]">
            <ChevronDown className={`size-4 text-[var(--color-ink-faint)] transition-transform ${isOpen ? "rotate-180" : "-rotate-90"}`} />
            {monthLabel(p)}
          </button>
          <label className="inline-flex items-center gap-1.5 text-2xs text-[var(--color-ink-muted)]">
            <input type="checkbox" checked={archived.has(p)} onChange={() => toggleArchief(p)} /> Archiveren
          </label>
        </div>
        {isOpen ? <div className="mt-2 pb-2">{render(p)}</div> : null}
      </li>
    );
  };

  return (
    <div className="sc-card p-4">
      <h2 className="text-sm font-semibold text-[var(--color-ink)]">Archief eerdere maanden</h2>
      <p className="mb-2 mt-0.5 text-2xs text-[var(--color-ink-muted)]">Klik op een maand om de rapportages hieronder te openen. Je kunt meerdere maanden tegelijk openen; de actuele maand bovenaan blijft staan.</p>
      {actief.length > 0 ? (
        <ul className="divide-y divide-[var(--color-line)]">{actief.map((p) => <Regel key={p} p={p} />)}</ul>
      ) : (
        <p className="text-xs text-[var(--color-ink-faint)]">Alle eerdere maanden zijn gearchiveerd.</p>
      )}
      {gearchiveerd.length > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-semibold text-[var(--color-ink-muted)]">Gearchiveerd ({gearchiveerd.length})</summary>
          <ul className="mt-1 divide-y divide-[var(--color-line)]">{gearchiveerd.map((p) => <Regel key={p} p={p} />)}</ul>
        </details>
      ) : null}
    </div>
  );
}
