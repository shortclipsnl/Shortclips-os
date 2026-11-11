"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Sparkles, Loader2, Check, CircleAlert, Download, Eye, Send, RotateCcw, Lock, Globe } from "lucide-react";
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

export function ReportList({
  overview, viewerId, canWrite, aiReady, vorigeMaand, huidigeMaand, initial,
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
  const monthOptions = useMemo(() => [...new Set([huidigeMaand, vorigeMaand, ...periods])].sort().reverse(), [periods, vorigeMaand, huidigeMaand]);
  const years = useMemo(() => [...new Set(monthOptions.map((p) => p.slice(0, 4)))], [monthOptions]);

  const [maand, setMaand] = useState(initial.maand && (/^\d{4}-\d{2}$/.test(initial.maand) || initial.maand === "alle") ? initial.maand : huidigeMaand);
  const [jaar, setJaar] = useState("alle");
  const [klantStatus, setKlantStatus] = useState(initial.klantstatus === "alle" || initial.klantstatus === "inactief" ? initial.klantstatus : "actief");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => {
    const s = initial.status ?? "alle";
    if (STATUS_FILTERS.some((f) => f.key === s)) return s as StatusFilter;
    return LEGACY_FILTER[s] ?? "alle";
  });
  const [weergave, setWeergave] = useState(initial.weergave === "te-lezen" || initial.weergave === "mijn-klanten" || initial.weergave === "mijn-controle" ? initial.weergave : "alles");
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

  const baseRows = rows.filter((r) => {
    if (klantStatus === "actief" && !r.active) return false;
    if (klantStatus === "inactief" && r.active) return false;
    if (weergave === "mijn-klanten" && r.pmId !== viewerId) return false;
    if (weergave === "te-lezen" && !(r.report?.assignedToMe && !r.report.readByMe)) return false;
    if (weergave === "mijn-controle" && r.report?.controllerId !== viewerId) return false;
    return true;
  });
  const counts = countStatuses(baseRows.map((r) => r.view));
  const shown = baseRows
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
      {/* Statistieken: compacte klikbare chips (filter). */}
      <div className="flex flex-wrap items-center gap-1.5">
        <StatTile label="Totaal klanten" value={counts.totaal} tone="neutral" active={statusFilter === "alle"} onClick={() => setStatusFilter("alle")} />
        <StatTile label="Nog genereren" value={counts.nogGenereren} tone="neutral" hint={counts.bezig ? `${counts.bezig} bezig` : undefined} active={statusFilter === "nog_genereren"} onClick={() => toggle("nog_genereren")} />
        <StatTile label="Te controleren" value={counts.teControleren} tone="violet" active={statusFilter === "actie"} onClick={() => toggle("actie")} />
        <StatTile label="Goedgekeurd" value={counts.goedgekeurd} tone="good" hint={counts.goedgekeurd ? "nog publiceren" : undefined} active={statusFilter === "goedgekeurd"} onClick={() => toggle("goedgekeurd")} />
        <StatTile label="Gepubliceerd" value={counts.gepubliceerd} tone="lime" active={statusFilter === "gepubliceerd"} onClick={() => toggle("gepubliceerd")} />
        <StatTile label="Mislukt" value={counts.mislukt} tone="bad" active={statusFilter === "mislukt"} onClick={() => toggle("mislukt")} />
      </div>

      {/* Filters */}
      <div className="sc-card flex flex-wrap items-end gap-3 p-3">
        <label>
          {label("Maand")}
          <select className="sc-input text-sm" value={maand} onChange={(e) => { setMaand(e.target.value); setRowMonth({}); }}>
            {monthOptions.map((p) => <option key={p} value={p}>{monthLabel(p)}{p === huidigeMaand ? " (deze maand)" : p === vorigeMaand ? " (vorige maand)" : ""}</option>)}
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
          {weergave === "te-lezen" ? "Je hebt alle maandrapportages doorgenomen." : weergave === "mijn-controle" ? "Er staan voor deze maand geen rapportages op jouw naam." : "Geen rapportages voor deze filters."}
        </div>
      ) : (
        <div className="sc-card overflow-x-auto">
          <table className="w-full min-w-[960px] text-sm [&_td]:!px-2.5 [&_th]:!px-2.5 [&_td:first-child]:!pl-4 [&_th:first-child]:!pl-4">
            <thead>
              <tr className="border-b border-[var(--color-line)] text-left text-2xs uppercase tracking-wide text-[var(--color-ink-faint)]">
                <th className="sc-th sticky left-0 z-10 min-w-[200px] bg-[var(--color-surface)]">Klant</th>
                <th className="sc-th">Maand</th>
                <th className="sc-th">Status</th>
                <th className="sc-th"><span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-warn-soft)] px-2 py-0.5 text-[var(--color-warn)]"><Lock className="size-3 shrink-0" /> Intern</span><span className="mt-0.5 block text-[9px] normal-case text-[var(--color-ink-faint)]">niet voor klant</span></th>
                <th className="sc-th"><span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-info-soft)] px-2 py-0.5 text-[var(--color-info)]"><Globe className="size-3 shrink-0" /> Klant</span><span className="mt-0.5 block text-[9px] normal-case text-[var(--color-ink-faint)]">na goedkeuring</span></th>
                <th className="sc-th">Actie</th>
                <th className="sc-th">Stuur naar<br />klantportaal</th>
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
                          const controle = canWrite ? (
                            r.openChecks > 0 ? (
                              <Link href={`/analytics/maandrapportages/${r.id}`} title="Vul eerst de beoordeling in en rond de verplichte controlepunten af" className={buttonClass({ variant: "secondary", size: "sm" })}>
                                <CircleAlert className="size-3.5" /> Controleren
                              </Link>
                            ) : (
                              <button type="button" disabled={pending || isBusy} onClick={() => approve(row)} className={buttonClass({ variant: "primary", size: "sm" })}><Check className="size-3.5" /> Goedkeuren</button>
                            )
                          ) : (
                            <div className="text-2xs text-[var(--color-ink-muted)]">
                              Wacht op goedkeuring
                              <div><Link href={`/analytics/maandrapportages/${r.id}`} className="text-[var(--color-info)] hover:underline">Controle openen</Link></div>
                            </div>
                          );
                          return (
                            <>
                              {controle}
                              {canWrite ? (
                                <button type="button" disabled={!aiReady || pending} onClick={() => generate(row)} className="mt-1 inline-flex items-center gap-1 text-2xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
                                  <RotateCcw className="size-3" /> Opnieuw genereren
                                </button>
                              ) : null}
                            </>
                          );
                        }
                        if (lopend) {
                          return <span className="text-2xs text-[var(--color-ink-faint)]" title="Een maandrapport kan pas gemaakt worden als de maand voorbij is.">Maand loopt nog</span>;
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

                    {/* Stuur naar klantportaal: pas beschikbaar na goedkeuring; nooit dubbel. */}
                    <td className="sc-td whitespace-nowrap">
                      {r && row.view === "gepubliceerd" ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-lime)]" title={r.publishedAt ? `Verzonden op ${fmtDate(r.publishedAt)}` : "Verzonden"}>
                          <Check className="size-3.5" /> Verzonden{r.publishedAt ? ` · ${fmtDate(r.publishedAt)}` : ""}
                        </span>
                      ) : r && row.view === "goedgekeurd" ? (
                        canWrite ? (
                          <button type="button" disabled={pending || isBusy} onClick={() => publish(row)} className={buttonClass({ variant: "primary", size: "sm" })}>
                            <Send className="size-3.5" /> Stuur naar klantportaal
                          </button>
                        ) : (
                          <span className="text-2xs text-[var(--color-ink-muted)]">Nog niet verzonden</span>
                        )
                      ) : (
                        <span className="text-2xs text-[var(--color-ink-faint)]" title="Beschikbaar zodra het rapport is goedgekeurd">Na goedkeuring</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-2xs text-[var(--color-ink-faint)]">
        De interne versie is alleen voor het Shortclips-team en nooit zichtbaar in het klantportaal. De klantversie komt pas in het klantportaal na goedkeuring én een bevestigde publicatie via &quot;Stuur naar klantportaal&quot;.
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

      {/* Archief: eerdere maanden, altijd terug te vinden en opnieuw te bekijken. */}
      <MaandArchief
        months={[...new Set(periods)].sort().reverse().filter((p) => p < huidigeMaand)}
        onOpen={(p) => { setMaand(p); setRowMonth({}); }}
      />
    </div>
  );
}

/**
 * Archief van eerdere maanden onderaan de pagina. Een maand aanvinken archiveert
 * 'm (per medewerker, in de browser bewaard); gearchiveerde maanden blijven altijd
 * terug te vinden en opnieuw te bekijken onder "Gearchiveerd".
 */
function MaandArchief({ months, onOpen }: { months: string[]; onOpen: (p: string) => void }) {
  const [archived, setArchived] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const raw = localStorage.getItem("maandrapport-archief");
      if (raw) setArchived(new Set(JSON.parse(raw) as string[]));
    } catch { /* geen opgeslagen archief */ }
  }, []);
  const toggle = (p: string) =>
    setArchived((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p); else n.add(p);
      try { localStorage.setItem("maandrapport-archief", JSON.stringify([...n])); } catch { /* opslaan mislukt */ }
      return n;
    });

  if (months.length === 0) return null;
  const actief = months.filter((p) => !archived.has(p));
  const gearchiveerd = months.filter((p) => archived.has(p));

  const Regel = ({ p }: { p: string }) => (
    <li className="flex items-center justify-between gap-3 py-2">
      <button type="button" onClick={() => onOpen(p)} className="text-sm font-medium capitalize text-[var(--color-ink)] hover:text-[var(--color-brand-700)] hover:underline">{monthLabel(p)}</button>
      <label className="inline-flex items-center gap-1.5 text-2xs text-[var(--color-ink-muted)]">
        <input type="checkbox" checked={archived.has(p)} onChange={() => toggle(p)} /> Archiveren
      </label>
    </li>
  );

  return (
    <div className="sc-card p-4">
      <h2 className="text-sm font-semibold text-[var(--color-ink)]">Archief — eerdere maanden</h2>
      <p className="mb-2 mt-0.5 text-2xs text-[var(--color-ink-muted)]">Vink een maand aan om te archiveren. Gearchiveerde maanden blijven altijd terug te vinden en opnieuw te bekijken.</p>
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
