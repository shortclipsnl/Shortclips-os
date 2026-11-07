"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Sparkles, Loader2, Check, Minus, CircleAlert } from "lucide-react";
import { Badge, ClientLogo, Stat, buttonClass, type Tone } from "@/components/ui";
import { queueMonthlyReports, startMonthlyReport } from "@/server/actions/monthly-reports";
import type { ReportOverview, ReportRow } from "@/server/reports/service";

export const STATUS_META: Record<string, { label: string; tone: Tone }> = {
  gegevens_verzamelen: { label: "In de wachtrij", tone: "info" },
  analyse_bezig: { label: "Analyse bezig", tone: "info" },
  klaar_voor_controle: { label: "Wacht op controle", tone: "violet" },
  aanpassing_nodig: { label: "Aanpassing nodig", tone: "warn" },
  goedgekeurd: { label: "Goedgekeurd", tone: "good" },
  gepubliceerd: { label: "Gedeeld met klant", tone: "lime" },
  mislukt: { label: "Mislukt", tone: "bad" },
};

const WORKFLOW: Array<{ key: string; label: string; match: (r: ReportRow) => boolean }> = [
  { key: "alle", label: "Alle statussen", match: () => true },
  { key: "wacht", label: "Wacht op controle", match: (r) => r.status === "klaar_voor_controle" },
  { key: "aanpassing", label: "Aanpassing nodig", match: (r) => r.status === "aanpassing_nodig" },
  { key: "goedgekeurd", label: "Goedgekeurd", match: (r) => r.status === "goedgekeurd" || r.status === "gepubliceerd" },
  { key: "bezig", label: "Bezig of in de wachtrij", match: (r) => r.status === "analyse_bezig" || r.status === "gegevens_verzamelen" },
  { key: "mislukt", label: "Mislukt", match: (r) => r.status === "mislukt" },
];

const APPROVED = new Set(["goedgekeurd", "gepubliceerd"]);

function monthLabel(p: string): string {
  const [y, m] = p.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, 1).toLocaleDateString("nl-NL", { month: "long", year: "numeric" });
}
function lastMonths(from: string, n: number): string[] {
  const [y, m] = from.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y!, (m ?? 1) - 1 - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "short" }) : null);

function Step({ on, label }: { on: boolean; label: string }) {
  return (
    <span title={label} aria-label={label} className={`inline-flex size-5 items-center justify-center rounded-full ${on ? "bg-[var(--color-good-soft)] text-[var(--color-good)]" : "border border-[var(--color-line)] text-[var(--color-ink-faint)]"}`}>
      {on ? <Check className="size-3" /> : <Minus className="size-3" />}
    </span>
  );
}

export function ReportList({
  overview, viewerId, canWrite, owner, aiReady, vorigeMaand, initial,
}: {
  overview: ReportOverview;
  viewerId: string;
  canWrite: boolean;
  owner: boolean;
  aiReady: boolean;
  vorigeMaand: string;
  initial: { maand?: string; status?: string; weergave?: string; klantstatus?: string; klant?: string };
}) {
  const router = useRouter();
  const { reports, clients, periods, team, teamOnly } = overview;
  const monthOptions = useMemo(() => [...new Set([vorigeMaand, ...periods])].sort().reverse(), [periods, vorigeMaand]);
  const years = useMemo(() => [...new Set(monthOptions.map((p) => p.slice(0, 4)))], [monthOptions]);

  const [maand, setMaand] = useState(initial.maand && /^\d{4}-\d{2}$/.test(initial.maand) ? initial.maand : (periods[0] ?? vorigeMaand));
  const [jaar, setJaar] = useState("alle");
  const [klantStatus, setKlantStatus] = useState(initial.klantstatus === "actief" || initial.klantstatus === "inactief" ? initial.klantstatus : "alle");
  const [klant, setKlant] = useState(initial.klant ?? "");
  const [workflow, setWorkflow] = useState(WORKFLOW.some((w) => w.key === initial.status) ? initial.status! : "alle");
  const [weergave, setWeergave] = useState(initial.weergave === "te-lezen" || initial.weergave === "mijn-klanten" ? initial.weergave : "alles");

  const [genClient, setGenClient] = useState("");
  const [genMonth, setGenMonth] = useState(vorigeMaand);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const shown = reports.filter((r) => {
    if (maand !== "alle" && r.period !== maand) return false;
    if (maand === "alle" && jaar !== "alle" && !r.period.startsWith(jaar)) return false;
    if (klantStatus === "actief" && !r.clientActive) return false;
    if (klantStatus === "inactief" && r.clientActive) return false;
    if (klant && r.clientId !== klant) return false;
    if (!WORKFLOW.find((w) => w.key === workflow)!.match(r)) return false;
    if (weergave === "mijn-klanten" && r.pmId !== viewerId) return false;
    if (weergave === "te-lezen" && !(r.assignedToMe && !r.readByMe)) return false;
    return true;
  });

  // Dashboard voor de gekozen maand.
  const monthReports = maand === "alle" ? [] : reports.filter((r) => r.period === maand);
  const byClient = new Map(monthReports.map((r) => [r.clientId, r]));
  const activeClients = clients.filter((c) => c.active);
  const missing = maand === "alle" ? [] : activeClients.filter((c) => {
    const r = byClient.get(c.id);
    return !r || r.status === "mislukt";
  });
  const stats = {
    gereed: monthReports.filter((r) => APPROVED.has(r.status)).length,
    wacht: monthReports.filter((r) => r.status === "klaar_voor_controle").length,
    aanpassing: monthReports.filter((r) => r.status === "aanpassing_nodig").length,
    bezig: monthReports.filter((r) => r.status === "analyse_bezig" || r.status === "gegevens_verzamelen").length,
    reads: monthReports.reduce((s, r) => s + r.readsDone, 0),
    readsTotal: monthReports.reduce((s, r) => s + r.readsTotal, 0),
    teLezenIk: reports.filter((r) => r.assignedToMe && !r.readByMe).length,
  };
  const teamStats = maand === "alle" ? [] : (team[maand] ?? []);

  function run(fn: () => Promise<{ ok: boolean; message?: string }>, okText: string, after?: (res: unknown) => void) {
    setMsg(null);
    start(async () => {
      const res = await fn();
      if (res.ok) { setMsg({ ok: true, text: okText }); after?.(res); }
      else setMsg({ ok: false, text: res.message ?? "Er ging iets mis." });
      router.refresh();
    });
  }
  const generateOne = () => run(() => startMonthlyReport(genClient, genMonth, "full"), "De analyse is gestart.", (res) => {
    const id = (res as { reportId?: string }).reportId;
    if (id) router.push(`/analytics/maandrapportages/${id}`);
  });
  const queueMissing = () => run(() => queueMonthlyReports(maand), "De ontbrekende rapporten staan in de wachtrij en worden op de achtergrond opgesteld (een paar per kwartier).");

  const pill = (on: boolean) => `rounded-full px-3 py-1.5 text-xs font-medium ${on ? "bg-[var(--color-indigo-ink)] text-white" : "border border-[var(--color-line)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`;

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="sc-card flex flex-wrap items-end gap-3 p-4">
        <div>
          <span className="mb-1 block text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Klantstatus</span>
          <div className="flex gap-1">
            {(["alle", "actief", "inactief"] as const).map((k) => (
              <button key={k} type="button" className={pill(klantStatus === k)} onClick={() => setKlantStatus(k)}>
                {k === "alle" ? "Alle klanten" : k === "actief" ? "Actieve klanten" : "Inactieve klanten"}
              </button>
            ))}
          </div>
        </div>
        <label>
          <span className="mb-1 block text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Maand</span>
          <select className="sc-input text-sm" value={maand} onChange={(e) => setMaand(e.target.value)}>
            <option value="alle">Alle maanden</option>
            {monthOptions.map((p) => <option key={p} value={p}>{monthLabel(p)}</option>)}
          </select>
        </label>
        {maand === "alle" ? (
          <label>
            <span className="mb-1 block text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Jaar</span>
            <select className="sc-input text-sm" value={jaar} onChange={(e) => setJaar(e.target.value)}>
              <option value="alle">Alle jaren</option>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
        ) : null}
        <label>
          <span className="mb-1 block text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Klant</span>
          <select className="sc-input text-sm" value={klant} onChange={(e) => setKlant(e.target.value)}>
            <option value="">Alle klanten</option>
            {clients.filter((c) => klantStatus === "alle" || (klantStatus === "actief") === c.active).map((c) => <option key={c.id} value={c.id}>{c.name}{c.active ? "" : " (inactief)"}</option>)}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Status</span>
          <select className="sc-input text-sm" value={workflow} onChange={(e) => setWorkflow(e.target.value)}>
            {WORKFLOW.map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}
          </select>
        </label>
        <div className="ml-auto flex gap-1">
          <button type="button" className={pill(weergave === "alles")} onClick={() => setWeergave("alles")}>Alles</button>
          <button type="button" className={pill(weergave === "mijn-klanten")} onClick={() => setWeergave("mijn-klanten")}>Mijn klanten</button>
          <button type="button" className={pill(weergave === "te-lezen")} onClick={() => setWeergave("te-lezen")}>Door mij te lezen{stats.teLezenIk ? ` (${stats.teLezenIk})` : ""}</button>
        </div>
      </div>

      {/* Dashboard voor de gekozen maand */}
      {maand !== "alle" ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="Gereed (goedgekeurd)" value={stats.gereed} tone="good" onClick={() => setWorkflow("goedgekeurd")} active={workflow === "goedgekeurd"} />
          {!teamOnly ? <Stat label="Wacht op controle" value={stats.wacht} tone={stats.wacht > 0 ? "violet" : "neutral"} onClick={() => setWorkflow("wacht")} active={workflow === "wacht"} /> : null}
          {!teamOnly ? <Stat label="Aanpassing nodig" value={stats.aanpassing + stats.bezig} hint={stats.bezig ? `${stats.bezig} bezig/wachtrij` : undefined} tone={stats.aanpassing > 0 ? "warn" : "neutral"} onClick={() => setWorkflow("aanpassing")} active={workflow === "aanpassing"} /> : null}
          {!teamOnly ? <Stat label="Actieve klanten zonder rapport" value={missing.length} tone={missing.length > 0 ? "bad" : "neutral"} /> : null}
          <Stat label="Doorgenomen door team" value={stats.readsTotal ? `${stats.reads}/${stats.readsTotal}` : "–"} tone={stats.readsTotal && stats.reads === stats.readsTotal ? "good" : "neutral"} />
        </div>
      ) : null}

      {msg ? <p className={`text-sm ${msg.ok ? "text-[var(--color-good)]" : "text-[var(--color-bad)]"}`}>{msg.text}</p> : null}

      <div className="grid gap-5 2xl:grid-cols-[1fr_300px]">
        <div className="space-y-5 min-w-0">
          {/* Workflow per klant */}
          {shown.length === 0 ? (
            <div className="sc-card p-6 text-sm text-[var(--color-ink-muted)]">
              {weergave === "te-lezen" ? "Je hebt alle maandrapportages doorgenomen." : "Geen maandrapporten gevonden voor deze filters."}
            </div>
          ) : (
            <div className="sc-card overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-line)] text-left text-2xs uppercase tracking-wide text-[var(--color-ink-faint)]">
                    <th className="sc-th">Klant</th><th className="sc-th">Maand</th><th className="sc-th">Status</th>
                    <th className="sc-th" title="Gegenereerd · Gecontroleerd (beoordeling) · Goedgekeurd">Voortgang</th>
                    <th className="sc-th text-center">Doorgenomen</th><th className="sc-th text-center">Verbeterp.</th><th className="sc-th text-center">Open acties</th>
                    <th className="sc-th text-right">{`Video's`}</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => {
                    const st = STATUS_META[r.status] ?? STATUS_META.gegevens_verzamelen!;
                    const generated = Boolean(r.generatedAt) && r.status !== "mislukt";
                    return (
                      <tr key={r.id} className="border-b border-[var(--color-line)] last:border-0">
                        <td className="sc-td">
                          <Link href={`/analytics/maandrapportages/${r.id}`} className="inline-flex items-center gap-2 font-medium text-[var(--color-ink)] hover:underline">
                            <ClientLogo name={r.clientName} logoUrl={r.logoUrl} color={r.color} size={22} /> {r.clientName}
                          </Link>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-2xs text-[var(--color-ink-faint)]">
                            {r.pmName ? <span>{r.pmName}</span> : <span>Geen PM</span>}
                            {!r.clientActive ? <Badge tone="neutral">Inactief</Badge> : null}
                            {r.assignedToMe && !r.readByMe ? <Badge tone="violet">Te lezen</Badge> : null}
                            {r.ontbrekend > 0 && !teamOnly ? <span title="Opmerkingen over ontbrekende of onvolledige data" className="inline-flex items-center gap-0.5 whitespace-nowrap text-[var(--color-warn)]"><CircleAlert className="size-3" />{r.ontbrekend} data</span> : null}
                          </div>
                        </td>
                        <td className="sc-td whitespace-nowrap capitalize">{r.periodLabel}</td>
                        <td className="sc-td"><Badge tone={st.tone}>{st.label}</Badge>{r.feedbackOpen > 0 ? <div className="mt-1 text-2xs text-[var(--color-warn)]">{r.feedbackOpen} feedback open</div> : null}</td>
                        <td className="sc-td">
                          <div className="flex items-center gap-1">
                            <Step on={generated} label={generated ? `Gegenereerd ${fmt(r.generatedAt) ?? ""}` : "Nog niet gegenereerd"} />
                            <span className="h-px w-3 bg-[var(--color-line)]" />
                            <Step on={r.beoordeeld} label={r.beoordeeld ? "Beoordeling ingevuld" : "Beoordeling nog niet ingevuld"} />
                            <span className="h-px w-3 bg-[var(--color-line)]" />
                            <Step on={APPROVED.has(r.status)} label={APPROVED.has(r.status) ? `Goedgekeurd ${fmt(r.approvedAt) ?? ""}` : "Nog niet goedgekeurd"} />
                          </div>
                          <div className="mt-0.5 text-2xs text-[var(--color-ink-faint)]">{APPROVED.has(r.status) ? `goedgekeurd ${fmt(r.approvedAt) ?? ""}` : generated ? `gegenereerd ${fmt(r.generatedAt) ?? ""}` : ""}</div>
                        </td>
                        <td className="sc-td text-center tabular-nums">{r.readsTotal ? <span className={r.readsDone === r.readsTotal ? "text-[var(--color-good)]" : ""}>{r.readsDone}/{r.readsTotal}</span> : <span className="text-[var(--color-ink-faint)]">–</span>}</td>
                        <td className="sc-td text-center tabular-nums">{r.verbeterpunten || "–"}</td>
                        <td className="sc-td text-center tabular-nums">{r.actiesTotaal ? <span className={r.openActies ? "font-medium text-[var(--color-warn)]" : "text-[var(--color-good)]"}>{r.openActies}/{r.actiesTotaal}</span> : <span className="text-[var(--color-ink-faint)]">–</span>}</td>
                        <td className="sc-td text-right tabular-nums">{r.aantalVideos}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Ontbrekende klanten */}
          {canWrite && maand !== "alle" && missing.length > 0 && (klantStatus !== "inactief") ? (
            <div className="sc-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-[var(--color-ink)]">Nog geen (gelukt) rapport voor {monthLabel(maand)}</p>
                {maand < vorigeMaand || maand === vorigeMaand ? (
                  <button type="button" disabled={pending || !aiReady} onClick={queueMissing} className={buttonClass({ variant: "secondary", size: "sm", className: "ml-auto" })}>
                    {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} Alle {missing.length} in de wachtrij zetten
                  </button>
                ) : null}
              </div>
              <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
                {missing.map((c) => {
                  const r = byClient.get(c.id);
                  return (
                    <li key={c.id} className="flex items-center gap-2 text-[var(--color-ink-muted)]">
                      <span className="size-1.5 rounded-full bg-[var(--color-bad)]" />
                      {r ? <Link href={`/analytics/maandrapportages/${r.id}`} className="hover:underline">{c.name}</Link> : c.name}
                      {r ? <span className="text-2xs text-[var(--color-bad)]">mislukt</span> : null}
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-2xs text-[var(--color-ink-faint)]">Een rapport mislukt wanneer er voor die maand geen cijfers zijn (bijvoorbeeld omdat de klant nog niet aan Metricool is gekoppeld). Er wordt dan niets verzonnen.</p>
            </div>
          ) : null}
        </div>

        {/* Zijkolom */}
        <div className="grid content-start gap-5 md:grid-cols-2 2xl:grid-cols-1">
          {maand !== "alle" ? (
            <div className="sc-card p-4">
              <p className="text-sm font-semibold text-[var(--color-ink)]">Team: doorgenomen</p>
              <p className="mb-3 text-2xs text-[var(--color-ink-faint)] capitalize">{monthLabel(maand)}</p>
              {teamStats.length === 0 ? (
                <p className="text-xs text-[var(--color-ink-muted)]">Zodra rapporten zijn goedgekeurd, zie je hier per medewerker wat er is doorgenomen.</p>
              ) : (
                <ul className="space-y-2.5">
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
              )}
            </div>
          ) : null}

          {canWrite ? (
            <div className="sc-card space-y-2 p-4">
              <p className="text-sm font-semibold text-[var(--color-ink)]">Rapport genereren</p>
              <select className="sc-input w-full text-sm" value={genClient} onChange={(e) => setGenClient(e.target.value)}>
                <option value="">Kies een klant…</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.active ? "" : " (inactief)"}</option>)}
              </select>
              <select className="sc-input w-full text-sm" value={genMonth} onChange={(e) => setGenMonth(e.target.value)}>
                {lastMonths(vorigeMaand, 12).map((p) => <option key={p} value={p}>{monthLabel(p)}</option>)}
              </select>
              <button type="button" onClick={generateOne} disabled={!genClient || pending || !aiReady} className={buttonClass({ variant: "primary", size: "sm", className: "w-full" })}>
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} Genereren
              </button>
              {!aiReady ? <p className="text-2xs text-[var(--color-ink-faint)]">AI-sleutel ontbreekt.</p> : null}
              <p className="text-2xs text-[var(--color-ink-faint)]">Bestaat het rapport al, dan wordt de analyse vernieuwd. Eerdere versies en feedback blijven bewaard. Goedgekeurde rapporten eerst terugzetten naar aanpassen.</p>
              {!owner ? <p className="text-2xs text-[var(--color-ink-faint)]">Goedkeuren doet Jarno.</p> : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
