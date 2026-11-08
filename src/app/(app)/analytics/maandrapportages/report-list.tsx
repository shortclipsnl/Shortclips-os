"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Sparkles, Loader2, Check, CircleAlert, Download, Eye, Search, Send, RotateCcw, ShieldCheck, Lock, Globe } from "lucide-react";
import { Badge, ClientLogo, buttonClass, type Tone } from "@/components/ui";
import { approveMonthlyReport, publishMonthlyReport, queueMonthlyReports, setReportControleDag, startMonthlyReport } from "@/server/actions/monthly-reports";
import type { ReportOverview, ReportRow } from "@/server/reports/service";
import { VIEW_STATUS_META, compareRows, countStatuses, viewStatus, type ViewStatus } from "@/lib/maandrapport-status";
import { FASE_LABEL, FASE_STAPPEN, countFases, type ControleFase } from "@/lib/maandcontrole";
import { CalendarDays } from "lucide-react";

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
  periods: string[];
  report: ReportRow | null;
  view: ViewStatus;
};

function monthLabel(p: string): string {
  const [y, m] = p.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, 1).toLocaleDateString("nl-NL", { month: "long", year: "numeric" });
}
const shortMonth = (p: string) => {
  const [y, m] = p.split("-").map(Number);
  return `${new Date(y!, (m ?? 1) - 1, 1).toLocaleDateString("nl-NL", { month: "short" }).replace(".", "")} ${String(y).slice(2)}`;
};
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "short" }) : "");
const fmtDateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const minutesSince = (iso: string | null) => (iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)) : 0);

const STAT_TONE: Record<string, string> = {
  neutral: "text-[var(--color-ink)]",
  violet: "text-[var(--color-violet)]",
  good: "text-[var(--color-good)]",
  lime: "text-[var(--color-lime)]",
  bad: "text-[var(--color-bad)]",
  warn: "text-[var(--color-warn)]",
};

function StatTile({ label, value, tone, hint, active, onClick }: { label: string; value: number; tone: keyof typeof STAT_TONE; hint?: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`sc-card flex flex-col items-start px-3 py-2 text-left transition-colors ${active ? "ring-2 ring-[var(--color-indigo-ink)]" : "hover:brightness-[0.98]"}`}
    >
      <span className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">{label}</span>
      <span className={`text-xl font-semibold tabular-nums ${value > 0 ? STAT_TONE[tone] : "text-[var(--color-ink-faint)]"}`}>{value}</span>
      {hint ? <span className="text-2xs text-[var(--color-ink-muted)]">{hint}</span> : null}
    </button>
  );
}

/** Compacte PDF-knoppen: bekijken (nieuw tabblad) en downloaden. */
function PdfButtons({ reportId, versie, enabled }: { reportId: string | null; versie: "intern" | "klant"; enabled: boolean }) {
  const base = versie === "intern"
    ? "border-[var(--color-warn)]/50 bg-[var(--color-warn-soft)] text-[var(--color-warn)]"
    : "border-[var(--color-info)]/50 bg-[var(--color-info-soft)] text-[var(--color-info)]";
  if (!reportId || !enabled) {
    return <span className="inline-flex h-7 items-center rounded-[var(--radius-sm)] border border-dashed border-[var(--color-line)] px-2 text-2xs text-[var(--color-ink-faint)]">Geen PDF</span>;
  }
  const url = `/api/reports/monthly/${reportId}/pdf?versie=${versie}`;
  const naam = versie === "intern" ? "interne versie" : "klantversie";
  return (
    <span className={`inline-flex h-7 items-stretch overflow-hidden rounded-[var(--radius-sm)] border text-2xs font-medium ${base}`}>
      <a href={url} target="_blank" rel="noopener" title={`Bekijk de ${naam} als PDF`} className="inline-flex items-center gap-1 px-2 hover:brightness-95">
        <Eye className="size-3.5" /> PDF
      </a>
      <a href={`${url}&download=1`} title={`Download de ${naam}`} aria-label={`Download de ${naam}`} className="inline-flex items-center border-l border-current/30 px-1.5 hover:brightness-95">
        <Download className="size-3.5" />
      </a>
    </span>
  );
}

const FASE_TONE: Record<ControleFase, Tone> = {
  gegenereerd: "violet",
  wacht_op_controle: "violet",
  ingepland: "info",
  in_controle: "warn",
  klaar_voor_goedkeuring: "good",
  goedgekeurd: "good",
  beschikbaar: "lime",
};

const dagLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const todayIso = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });

/**
 * Maandcontrole bovenaan de pagina: wie controleert, op welke dag (met één
 * klik te wijzigen) en hoe ver het is. Daaronder de zes stappen met per stap
 * het aantal rapportages.
 */
function MaandControle({ maand, batches, rows, viewerId, owner, onFilter, actief }: {
  maand: string;
  batches: ReportOverview["batches"];
  rows: Row[];
  viewerId: string;
  owner: boolean;
  onFilter: (f: ControleFase | null) => void;
  actief: ControleFase | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [edit, setEdit] = useState<string | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const vandaag = todayIso();
  const fases = countFases(rows.map((r) => r.report?.fase ?? null));
  const mine = batches.filter((b) => b.period === maand && (owner || b.userId === viewerId));
  const totaalGegenereerd = Object.values(fases).reduce((a, b) => a + b, 0);
  if (totaalGegenereerd === 0 && mine.length === 0) return null;

  function save(taskId: string, value: string | null) {
    setFout(null);
    start(async () => {
      const res = await setReportControleDag(taskId, value);
      if (!res.ok) setFout(res.message ?? "Opslaan mislukt.");
      setEdit(null);
      router.refresh();
    });
  }

  return (
    <div className="sc-card space-y-3 p-3">
      {mine.length ? (
        <div className="space-y-2">
          {mine.map((b) => {
            const eigen = rows.filter((r) => r.report?.controllerId === b.userId && r.report?.fase);
            const klaar = eigen.filter((r) => ["klaar_voor_goedkeuring", "goedgekeurd", "beschikbaar"].includes(r.report!.fase!)).length;
            const open = eigen.length - klaar;
            const afgerond = b.status === "done";
            const teLaat = !afgerond && b.dueOn !== null && b.dueOn < vandaag;
            const magWijzigen = b.userId === viewerId || owner;
            return (
              <div key={b.taskId} className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="flex min-w-[220px] items-center gap-2">
                  <CalendarDays className="size-4 text-[var(--color-ink-faint)]" />
                  <div>
                    <div className="text-sm font-semibold text-[var(--color-ink)]">
                      Maandcontrole {monthLabel(maand)}{owner && b.userId !== viewerId ? ` · ${b.name}` : ""}
                    </div>
                    <div className="text-2xs text-[var(--color-ink-muted)]">
                      {klaar} van {eigen.length} gecontroleerd{open > 0 ? `, ${open} open` : ""}
                    </div>
                  </div>
                </div>
                <div className="h-1.5 min-w-[120px] flex-1 overflow-hidden rounded-full bg-[var(--color-line)]">
                  <div className="h-full bg-[var(--color-good)]" style={{ width: `${eigen.length ? Math.round((klaar / eigen.length) * 100) : 0}%` }} />
                </div>
                <div className="flex items-center gap-2 text-xs">
                  {afgerond ? (
                    <Badge tone="good"><Check className="mr-1 inline size-3" />Controle afgerond</Badge>
                  ) : edit === b.taskId ? (
                    <>
                      <input type="date" defaultValue={b.dueOn ?? ""} min={vandaag} className="sc-input !py-1 text-xs" id={`dag-${b.taskId}`} />
                      <button type="button" disabled={pending} className={buttonClass({ variant: "primary", size: "sm" })}
                        onClick={() => { const v = (document.getElementById(`dag-${b.taskId}`) as HTMLInputElement | null)?.value; save(b.taskId, v || null); }}>
                        {pending ? <Loader2 className="size-3.5 animate-spin" /> : null} Opslaan
                      </button>
                      <button type="button" className="text-[var(--color-ink-muted)] hover:underline" onClick={() => setEdit(null)}>Annuleren</button>
                    </>
                  ) : (
                    <>
                      <span className={teLaat ? "font-medium text-[var(--color-bad)]" : "text-[var(--color-ink)]"}>
                        {b.dueOn ? `Controledag: ${dagLabel(b.dueOn)}${teLaat ? " (verstreken)" : ""}` : "Nog geen controledag ingepland"}
                      </span>
                      {magWijzigen ? (
                        <button type="button" className="text-[var(--color-indigo-ink)] hover:underline" onClick={() => setEdit(b.taskId)}>
                          {b.dueOn ? "Wijzigen" : "Inplannen"}
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            );
          })}
          {fout ? <p className="text-xs text-[var(--color-bad)]">{fout}</p> : null}
        </div>
      ) : null}

      {/* De zes stappen: klik = filter op die stap. */}
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6">
        {FASE_STAPPEN.map((st) => {
          const n = fases[st.key];
          const on = actief === st.key;
          return (
            <button key={st.key} type="button" onClick={() => onFilter(on ? null : st.key)}
              className={`flex items-start gap-2 rounded-[var(--radius-sm)] border px-2.5 py-2 text-left transition-colors ${on ? "border-[var(--color-indigo-ink)] ring-1 ring-[var(--color-indigo-ink)]" : "border-[var(--color-line)] hover:brightness-[0.98]"}`}>
              <span className={`mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full text-2xs font-semibold ${n > 0 ? "bg-[var(--color-indigo-ink)] text-white" : "bg-[var(--color-line)] text-[var(--color-ink-faint)]"}`}>{st.nr}</span>
              <span className="min-w-0">
                <span className="block text-2xs leading-tight text-[var(--color-ink-muted)]">{st.label}</span>
                <span className={`text-base font-semibold tabular-nums ${n > 0 ? "text-[var(--color-ink)]" : "text-[var(--color-ink-faint)]"}`}>{n}</span>
                {st.key === "beschikbaar" && fases.goedgekeurd > 0 ? <span className="ml-1 text-2xs text-[var(--color-warn)]">+{fases.goedgekeurd} nog publiceren</span> : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ReportList({
  overview, viewerId, canWrite, owner, aiReady, vorigeMaand, huidigeMaand, initial,
}: {
  overview: ReportOverview;
  viewerId: string;
  canWrite: boolean;
  owner: boolean;
  aiReady: boolean;
  /** De actuele rapportagemaand (de afgelopen kalendermaand). */
  vorigeMaand: string;
  /** De lopende maand: daarvoor kan nog geen rapport gemaakt worden. */
  huidigeMaand: string;
  initial: { maand?: string; status?: string; weergave?: string; klantstatus?: string; klant?: string; zoek?: string };
}) {
  const router = useRouter();
  const { reports, clients, periods, team, teamOnly } = overview;
  const monthOptions = useMemo(() => [...new Set([vorigeMaand, ...periods])].sort().reverse(), [periods, vorigeMaand]);
  const years = useMemo(() => [...new Set(monthOptions.map((p) => p.slice(0, 4)))], [monthOptions]);

  const [maand, setMaand] = useState(initial.maand && (/^\d{4}-\d{2}$/.test(initial.maand) || initial.maand === "alle") ? initial.maand : vorigeMaand);
  const [jaar, setJaar] = useState("alle");
  const [klantStatus, setKlantStatus] = useState(initial.klantstatus === "alle" || initial.klantstatus === "inactief" ? initial.klantstatus : "actief");
  // ?klant=<id> (oude links) wordt een zoekopdracht op de klantnaam.
  const [zoek, setZoek] = useState(initial.zoek ?? clients.find((c) => c.id === initial.klant)?.name ?? "");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => {
    const s = initial.status ?? "alle";
    if (STATUS_FILTERS.some((f) => f.key === s)) return s as StatusFilter;
    return LEGACY_FILTER[s] ?? "alle";
  });
  const [weergave, setWeergave] = useState(initial.weergave === "te-lezen" || initial.weergave === "mijn-klanten" || initial.weergave === "mijn-controle" ? initial.weergave : "alles");
  const [faseFilter, setFaseFilter] = useState<ControleFase | null>(null);
  /** Per klant een andere maand bekijken dan het filter (eerdere maanden in de rij zelf). */
  const [rowMonth, setRowMonth] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [rowMsg, setRowMsg] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  // Snelle opzoektabellen.
  const byKey = useMemo(() => new Map(reports.map((r) => [`${r.clientId}|${r.period}`, r])), [reports]);
  const periodsByClient = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const r of reports) m.set(r.clientId, [...(m.get(r.clientId) ?? []), r.period]);
    return m;
  }, [reports]);

  const rows: Row[] = useMemo(() => {
    const make = (c: { id: string; name: string; logoUrl: string | null; color: string | null; active: boolean; pmId: string | null; pmName: string | null }, period: string): Row => {
      const r = byKey.get(`${c.id}|${period}`) ?? null;
      const periodsHere = [...new Set([period, ...(maand === "alle" ? [] : [maand]), ...(periodsByClient.get(c.id) ?? [])])].sort().reverse();
      return {
        key: maand === "alle" ? `${c.id}|${period}` : c.id,
        clientId: c.id, clientName: c.name, logoUrl: c.logoUrl, color: c.color, active: c.active, pmId: c.pmId, pmName: c.pmName,
        period, periods: periodsHere, report: r,
        view: viewStatus({ exists: Boolean(r), status: r?.status, beoordeeld: r?.beoordeeld, stale: r?.stale }),
      };
    };
    const meta = new Map<string, { id: string; name: string; logoUrl: string | null; color: string | null; active: boolean; pmId: string | null; pmName: string | null }>();
    for (const c of clients) meta.set(c.id, { id: c.id, name: c.name, logoUrl: null, color: null, active: c.active, pmId: c.pmId, pmName: c.pmName });
    for (const r of reports) {
      const cur = meta.get(r.clientId);
      meta.set(r.clientId, { id: r.clientId, name: r.clientName, logoUrl: r.logoUrl, color: r.color, active: r.clientActive, pmId: cur?.pmId ?? r.pmId, pmName: cur?.pmName ?? r.pmName });
    }

    if (maand === "alle") {
      return reports
        .filter((r) => jaar === "alle" || r.period.startsWith(jaar))
        .map((r) => make(meta.get(r.clientId)!, r.period));
    }
    const out: Row[] = [];
    for (const c of meta.values()) {
      const period = rowMonth[c.id] ?? maand;
      const hasReport = byKey.has(`${c.id}|${period}`);
      // Teamleden zonder controlerecht zien alleen goedgekeurde rapporten.
      if (teamOnly && !hasReport) continue;
      // Inactieve klanten zonder rapport alleen tonen als je daar expliciet op filtert.
      if (!c.active && !hasReport && klantStatus !== "inactief") continue;
      out.push(make(c, period));
    }
    return out;
  }, [byKey, clients, jaar, klantStatus, maand, periodsByClient, reports, rowMonth, teamOnly]);

  const q = zoek.trim().toLowerCase();
  const baseRows = rows.filter((r) => {
    if (klantStatus === "actief" && !r.active) return false;
    if (klantStatus === "inactief" && r.active) return false;
    if (q && !r.clientName.toLowerCase().includes(q)) return false;
    if (weergave === "mijn-klanten" && r.pmId !== viewerId) return false;
    if (weergave === "te-lezen" && !(r.report?.assignedToMe && !r.report.readByMe)) return false;
    if (weergave === "mijn-controle" && r.report?.controllerId !== viewerId) return false;
    return true;
  });
  const counts = countStatuses(baseRows.map((r) => r.view));
  const shown = baseRows
    .filter((r) => !faseFilter || r.report?.fase === faseFilter || (faseFilter === "beschikbaar" && r.report?.fase === "goedgekeurd"))
    .filter((r) => statusFilter === "alle" || (statusFilter === "actie" ? ["gegenereerd", "controleren", "goedgekeurd"].includes(r.view) : r.view === statusFilter))
    .sort(compareRows);

  // Ontbrekende rapporten van de gekozen maand (actieve klanten), voor de bulkknop.
  const missing = maand === "alle" ? [] : rows.filter((r) => r.active && r.period === maand && (r.view === "nog_genereren" || r.view === "mislukt"));
  const kanMaand = maand !== "alle" && maand < huidigeMaand;

  // Zolang er iets gegenereerd wordt, de tabel automatisch verversen.
  const anyBusy = rows.some((r) => r.view === "bezig") || Object.values(busy).some(Boolean);
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
    if (!window.confirm(`Klantversie van ${row.clientName} (${monthLabel(row.period)}) goedkeuren? Daarna kun je hem publiceren naar het klantportaal.`)) return;
    rowAction(row, () => approveMonthlyReport(row.report!.id), "Goedgekeurd. Publiceer hem nu naar het klantportaal.");
  }
  function publish(row: Row) {
    if (!row.report) return;
    if (!window.confirm(`De klantversie van ${monthLabel(row.period)} publiceren in het klantportaal van ${row.clientName}? De klant krijgt daarvan een melding.`)) return;
    rowAction(row, () => publishMonthlyReport(row.report!.id), "Gepubliceerd in het klantportaal.");
  }
  function queueMissing() {
    if (!window.confirm(`Voor ${missing.length} ${missing.length === 1 ? "klant" : "klanten"} de rapportage van ${monthLabel(maand)} genereren?`)) return;
    setMsg(null);
    start(async () => {
      const res = await queueMonthlyReports(maand);
      setMsg(res.ok ? { ok: true, text: `${(res as { queued?: number }).queued ?? missing.length} rapporten staan in de wachtrij en worden op de achtergrond gemaakt (een paar per kwartier). De status werkt vanzelf bij.` } : { ok: false, text: res.message ?? "Er ging iets mis." });
      router.refresh();
    });
  }

  const pill = (on: boolean) => `rounded-full px-3 py-1.5 text-xs font-medium ${on ? "bg-[var(--color-indigo-ink)] text-white" : "border border-[var(--color-line)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`;
  const toggle = (k: StatusFilter) => setStatusFilter((cur) => (cur === k ? "alle" : k));
  const teamStats = maand === "alle" ? [] : (team[maand] ?? []);
  const teLezenIk = reports.filter((r) => r.assignedToMe && !r.readByMe).length;
  const label = (t: string) => <span className="mb-1 block text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">{t}</span>;

  return (
    <div className="space-y-4">
      {/* Maandcontrole: controledag, voortgang en de zes stappen. */}
      {maand !== "alle" && !teamOnly ? (
        <MaandControle maand={maand} batches={overview.batches} rows={baseRows} viewerId={viewerId} owner={owner} actief={faseFilter} onFilter={setFaseFilter} />
      ) : null}

      {/* Statistieken: binnen een paar seconden zien waar actie nodig is. Klik = filter. */}
      <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
        <StatTile label="Totaal klanten" value={counts.totaal} tone="neutral" active={statusFilter === "alle"} onClick={() => setStatusFilter("alle")} />
        <StatTile label="Nog genereren" value={counts.nogGenereren} tone="neutral" hint={counts.bezig ? `${counts.bezig} bezig` : undefined} active={statusFilter === "nog_genereren"} onClick={() => toggle("nog_genereren")} />
        <StatTile label="Te controleren" value={counts.teControleren} tone="violet" active={statusFilter === "actie"} onClick={() => toggle("actie")} />
        <StatTile label="Goedgekeurd" value={counts.goedgekeurd} tone="good" hint={counts.goedgekeurd ? "nog publiceren" : undefined} active={statusFilter === "goedgekeurd"} onClick={() => toggle("goedgekeurd")} />
        <StatTile label="Gepubliceerd" value={counts.gepubliceerd} tone="lime" active={statusFilter === "gepubliceerd"} onClick={() => toggle("gepubliceerd")} />
        <StatTile label="Mislukt" value={counts.mislukt} tone="bad" active={statusFilter === "mislukt"} onClick={() => toggle("mislukt")} />
      </div>

      {/* Filters en zoeken */}
      <div className="sc-card flex flex-wrap items-end gap-3 p-3">
        <label className="min-w-[180px] flex-1 sm:max-w-[240px]">
          {label("Zoeken")}
          <span className="relative block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-ink-faint)]" />
            <input type="search" value={zoek} onChange={(e) => setZoek(e.target.value)} placeholder="Klantnaam" className="sc-input w-full pl-8 text-sm" />
          </span>
        </label>
        <label>
          {label("Maand")}
          <select className="sc-input text-sm" value={maand} onChange={(e) => { setMaand(e.target.value); setRowMonth({}); }}>
            {monthOptions.map((p) => <option key={p} value={p}>{monthLabel(p)}{p === vorigeMaand ? " (actueel)" : ""}</option>)}
            <option value="alle">Alle maanden</option>
          </select>
        </label>
        {maand === "alle" ? (
          <label>
            {label("Jaar")}
            <select className="sc-input text-sm" value={jaar} onChange={(e) => setJaar(e.target.value)}>
              <option value="alle">Alle jaren</option>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
        ) : null}
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

      {/* De tabel: één rij per klant, alle acties direct in de rij. */}
      {shown.length === 0 ? (
        <div className="sc-card p-6 text-sm text-[var(--color-ink-muted)]">
          {weergave === "te-lezen" ? "Je hebt alle maandrapportages doorgenomen." : weergave === "mijn-controle" ? "Er staan voor deze maand geen rapportages op jouw naam." : q ? `Geen klant gevonden met "${zoek}".` : "Geen rapportages voor deze filters."}
        </div>
      ) : (
        <div className="sc-card overflow-x-auto">
          <table className="w-full min-w-[1000px] text-sm [&_td]:!px-2.5 [&_th]:!px-2.5 [&_td:first-child]:!pl-4 [&_th:first-child]:!pl-4">
            <thead>
              <tr className="border-b border-[var(--color-line)] text-left text-2xs uppercase tracking-wide text-[var(--color-ink-faint)]">
                <th className="sc-th sticky left-0 z-10 min-w-[200px] bg-[var(--color-surface)]">Klant</th>
                <th className="sc-th">Maand</th>
                <th className="sc-th">Status</th>
                <th className="sc-th"><span className="inline-flex items-start gap-1"><Lock className="mt-px size-3 shrink-0" /> Interne<br />versie</span></th>
                <th className="sc-th"><span className="inline-flex items-start gap-1"><Globe className="mt-px size-3 shrink-0" /> Klant-<br />versie</span></th>
                {canWrite ? <th className="sc-th">Genereren</th> : null}
                <th className="sc-th">Goedkeuren</th>
                <th className="sc-th">Klant-<br />portaal</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => {
                const r = row.report;
                const meta = VIEW_STATUS_META[row.view];
                const isBusy = Boolean(busy[row.key]);
                const lopend = row.period >= huidigeMaand;
                const m = rowMsg[row.key];
                const pdfOk = Boolean(r?.hasAnalysis) && row.view !== "bezig";
                return (
                  <tr key={row.key} className="border-b border-[var(--color-line)] align-top last:border-0">
                    {/* Klant */}
                    <td className={`sc-td sticky left-0 z-10 min-w-[200px] bg-[var(--color-surface)]`}>
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
                        {r && r.ontbrekend > 0 && !teamOnly ? <span title="Opmerkingen over ontbrekende of onvolledige data" className="inline-flex items-center gap-0.5 text-[var(--color-warn)]"><CircleAlert className="size-3" />{r.ontbrekend} data</span> : null}
                      </div>
                    </td>

                    {/* Maand: per rij een eerdere maand kiezen */}
                    <td className="sc-td whitespace-nowrap">
                      {maand === "alle" || row.periods.length <= 1 ? (
                        <span>{shortMonth(row.period)}</span>
                      ) : (
                        <select
                          aria-label={`Maand voor ${row.clientName}`}
                          className="sc-input !w-[92px] !py-1 !pl-2 !pr-5 text-xs"
                          value={row.period}
                          onChange={(e) => setRowMonth((cur) => ({ ...cur, [row.clientId]: e.target.value }))}
                        >
                          {row.periods.map((p) => <option key={p} value={p}>{shortMonth(p)}</option>)}
                        </select>
                      )}
                    </td>

                    {/* Status */}
                    <td className="sc-td">
                      {r?.fase && !teamOnly ? (
                        <span title={meta.uitleg}><Badge tone={FASE_TONE[r.fase]}>{FASE_LABEL[r.fase]}</Badge></span>
                      ) : (
                        <span title={meta.uitleg}><Badge tone={meta.tone}>{row.view === "bezig" ? <><Loader2 className="mr-1 inline size-3 animate-spin" />{meta.label}</> : meta.label}</Badge></span>
                      )}
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
                    <td className="sc-td"><PdfButtons reportId={r?.id ?? null} versie="klant" enabled={pdfOk} /></td>

                    {/* Genereren */}
                    {canWrite ? (
                      <td className="sc-td whitespace-nowrap">
                        {row.view === "bezig" || isBusy ? (
                          <span className={buttonClass({ variant: "secondary", size: "sm" })} aria-disabled><Loader2 className="size-3.5 animate-spin" /> Bezig</span>
                        ) : row.view === "goedgekeurd" || row.view === "gepubliceerd" ? (
                          <span className="text-[var(--color-ink-faint)]" title="Goedgekeurd: zet het rapport eerst terug naar aanpassen (op de detailpagina) om opnieuw te genereren.">–</span>
                        ) : lopend ? (
                          <span className="text-2xs text-[var(--color-ink-faint)]" title="Een maandrapport kan pas gemaakt worden als de maand voorbij is.">Maand loopt nog</span>
                        ) : row.view === "nog_genereren" ? (
                          <button type="button" disabled={!aiReady || pending} onClick={() => generate(row)} className={buttonClass({ variant: "primary", size: "sm" })}><Sparkles className="size-3.5" /> Genereren</button>
                        ) : (
                          <button type="button" disabled={!aiReady || pending} onClick={() => generate(row)} className={buttonClass({ variant: row.view === "mislukt" ? "primary" : "ghost", size: "sm" })}><RotateCcw className="size-3.5" /> Opnieuw</button>
                        )}
                        {m ? <div className={`mt-1 max-w-[200px] whitespace-normal text-2xs ${m.ok ? "text-[var(--color-good)]" : "text-[var(--color-bad)]"}`}>{m.text}</div> : null}
                      </td>
                    ) : null}

                    {/* Goedkeuren */}
                    <td className="sc-td whitespace-nowrap">
                      {r && (row.view === "goedgekeurd" || row.view === "gepubliceerd") ? (
                        <div className="text-xs">
                          <span className="inline-flex items-center gap-1 font-medium text-[var(--color-good)]"><ShieldCheck className="size-3.5" /> {r.approvedByName ? r.approvedByName.split(" ")[0] : "Goedgekeurd"}</span>
                          <div className="text-2xs text-[var(--color-ink-faint)]">{fmtDateTime(r.approvedAt)}</div>
                        </div>
                      ) : r && (row.view === "gegenereerd" || row.view === "controleren") ? (
                        owner ? (
                          r.openChecks > 0 ? (
                            <Link href={`/analytics/maandrapportages/${r.id}`} title="Vul eerst de beoordeling in en rond de verplichte controlepunten af" className={buttonClass({ variant: "secondary", size: "sm" })}>
                              <CircleAlert className="size-3.5" /> Controleren
                            </Link>
                          ) : (
                            <button type="button" disabled={pending || isBusy} onClick={() => approve(row)} className={buttonClass({ variant: "primary", size: "sm" })}><Check className="size-3.5" /> Goedkeuren</button>
                          )
                        ) : (
                          <div className="text-2xs text-[var(--color-ink-muted)]">
                            Wacht op Jarno
                            <div><Link href={`/analytics/maandrapportages/${r.id}`} className="text-[var(--color-info)] hover:underline">Controle openen</Link></div>
                          </div>
                        )
                      ) : <span className="text-[var(--color-ink-faint)]">–</span>}
                      {!canWrite && m ? <div className={`mt-1 text-2xs ${m.ok ? "text-[var(--color-good)]" : "text-[var(--color-bad)]"}`}>{m.text}</div> : null}
                    </td>

                    {/* Klantportaal */}
                    <td className="sc-td whitespace-nowrap">
                      {r && row.view === "gepubliceerd" ? (
                        <div className="text-xs">
                          <span className="inline-flex items-center gap-1 font-medium text-[var(--color-lime)]"><Check className="size-3.5" /> Zichtbaar</span>
                          <div className="text-2xs text-[var(--color-ink-faint)]">sinds {fmtDate(r.publishedAt)}</div>
                        </div>
                      ) : r && row.view === "goedgekeurd" ? (
                        canWrite ? (
                          <button type="button" disabled={pending || isBusy} onClick={() => publish(row)} className={buttonClass({ variant: "primary", size: "sm" })}><Send className="size-3.5" /> Publiceren</button>
                        ) : <span className="text-2xs text-[var(--color-ink-muted)]">Nog niet gepubliceerd</span>
                      ) : <span className="text-2xs text-[var(--color-ink-faint)]" title="Niet zichtbaar in het klantportaal">Niet zichtbaar</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-2xs text-[var(--color-ink-faint)]">
        De interne versie is alleen voor het Shortclips-team en nooit zichtbaar in het klantportaal. De klantversie komt pas in het klantportaal na goedkeuring én een bevestigde publicatie.
        {canWrite && !owner ? " Goedkeuren doet Jarno." : ""}
      </p>

      {/* Teamvoortgang (doornemen van goedgekeurde rapporten), compact onder de tabel. */}
      {teamStats.length > 0 ? (
        <div className="sc-card p-4">
          <p className="mb-2 text-sm font-semibold text-[var(--color-ink)]">Team: doorgenomen <span className="font-normal capitalize text-[var(--color-ink-faint)]">· {monthLabel(maand)}</span></p>
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
    </div>
  );
}
