"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownRight, ArrowRight, ArrowUpRight, CheckCircle2, ChevronDown, ClipboardList, RefreshCw } from "lucide-react";
import { ClientLogo } from "@/components/ui";
import type { AlertCard, LastRun, StaffOption } from "@/server/result-alerts";
import { formatKpiValue, KPI_LABEL, type Signal, type TrendRow } from "@/lib/groei-daling";
import { pickUpDecline, rerunResultAlerts } from "@/server/actions/result-alerts";
import { ClosedList, Detail } from "./attention-alerts";

/* ------------------------------------------------------------------ *
 * Klanten met daling (links) en klanten met groei (rechts).
 * Zelfde periode als de rest van de pagina; status en taken lopen via de
 * bestaande alerts en de takenpagina, er is geen aparte status.
 * ------------------------------------------------------------------ */

const LIMIT = 6;
const firstName = (n: string | null | undefined) => (n ? n.split(" ")[0] : null);

function addWorkdays(n: number): string {
  const d = new Date();
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) left--;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const pctText = (d: number) => `${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(d)}%`;
const alsoText = (also: Signal[]) => also.slice(0, 2).map((s) => `${KPI_LABEL[s.kpi]} ${pctText(s.delta)}`).join(" · ");

type Props = {
  daling: TrendRow[];
  groei: TrendRow[];
  onvoldoende: Array<{ clientId: string; name: string; slug: string; reason: string }>;
  coordinatorBySlug: Record<string, string | null>;
  active: AlertCard[];
  closed: AlertCard[];
  lastRun: LastRun | null;
  staff: StaffOption[];
  viewerId: string;
  periodLabel: string;
  prevLabel: string;
};

export function GroeiDaling(p: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [showAll, setShowAll] = useState<{ d: boolean; g: boolean }>({ d: false, g: false });
  const [pending, start] = useTransition();
  const router = useRouter();

  const negByClient = new Map(p.active.filter((a) => a.kind === "negatief").map((a) => [a.clientId, a]));
  const posByClient = new Map(p.active.filter((a) => a.kind === "positief").map((a) => [a.clientId, a]));
  const inPeriod = new Set(p.daling.map((r) => r.clientId));
  // Lopende alerts uit de dagelijkse analyse die in deze periode geen daling tonen.
  const elsewhere = p.active.filter((a) => a.kind === "negatief" && !inPeriod.has(a.clientId));
  const urgent = p.daling.filter((r) => r.urgency === "hoog").length;

  const dShown = showAll.d ? p.daling : p.daling.slice(0, LIMIT);
  const gShown = showAll.g ? p.groei : p.groei.slice(0, LIMIT);
  const toggle = (k: string) => setOpen(open === k ? null : k);

  const rerun = () =>
    start(async () => {
      await rerunResultAlerts();
      router.refresh();
    });

  return (
    <section id="aandacht" className="mb-5 scroll-mt-4">
      <div className="grid gap-4 lg:grid-cols-2">
        {/* ------------------------------ Daling ------------------------------ */}
        <Column
          tone="warn"
          icon={<ArrowDownRight className="size-4" strokeWidth={2.5} />}
          title="Klanten met daling"
          count={p.daling.length}
          extra={urgent ? <span className="rounded-full bg-[var(--color-bad)] px-2 py-0.5 text-2xs font-bold text-white">{urgent} urgent</span> : null}
          question="Waar moeten we ingrijpen of bijsturen?"
          sub={`${p.periodLabel} t.o.v. ${p.prevLabel}`}
          action={
            <button type="button" onClick={rerun} disabled={pending} className="inline-flex size-7 items-center justify-center rounded-full text-[var(--color-ink-faint)] hover:bg-[var(--color-surface)] hover:text-[var(--color-ink)] disabled:opacity-60" title="Dagelijkse analyse nu opnieuw draaien">
              <RefreshCw className={`size-3.5 ${pending ? "animate-spin" : ""}`} />
            </button>
          }
        >
          {p.daling.length ? (
            <ul className="divide-y divide-[var(--color-line)]">
              {dShown.map((r) => (
                <DeclineRow
                  key={r.clientId}
                  r={r}
                  alert={negByClient.get(r.clientId) ?? null}
                  open={open === `d:${r.clientId}`}
                  onToggle={() => toggle(`d:${r.clientId}`)}
                  staff={p.staff}
                  viewerId={p.viewerId}
                  coordinatorId={p.coordinatorBySlug[r.slug] ?? null}
                />
              ))}
              {p.daling.length > dShown.length ? <MoreButton n={p.daling.length} onClick={() => setShowAll({ ...showAll, d: true })} /> : null}
            </ul>
          ) : (
            <Empty text="Geen klanten met een betrouwbare daling in deze periode." />
          )}
        </Column>

        {/* ------------------------------ Groei ------------------------------- */}
        <Column
          tone="good"
          icon={<ArrowUpRight className="size-4" strokeWidth={2.5} />}
          title="Klanten met groei"
          count={p.groei.length}
          question="Wat werkt goed en waar halen we meer uit?"
          sub={`${p.periodLabel} t.o.v. ${p.prevLabel}`}
        >
          {p.groei.length ? (
            <ul className="divide-y divide-[var(--color-line)]">
              {gShown.map((r) => (
                <GrowthRow key={r.clientId} r={r} alert={posByClient.get(r.clientId) ?? null} open={open === `g:${r.clientId}`} onToggle={() => toggle(`g:${r.clientId}`)} staff={p.staff} viewerId={p.viewerId} />
              ))}
              {p.groei.length > gShown.length ? <MoreButton n={p.groei.length} onClick={() => setShowAll({ ...showAll, g: true })} /> : null}
            </ul>
          ) : (
            <Empty text="Geen klanten met een betrouwbare groei in deze periode." />
          )}
        </Column>
      </div>

      {/* Onderaan, klein: wat er verder speelt */}
      {elsewhere.length || p.onvoldoende.length || p.closed.length ? (
        <div className="mt-2 flex flex-col gap-1.5 px-1">
          {elsewhere.length ? (
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs text-[var(--color-ink-muted)] [&::-webkit-details-marker]:hidden">
                <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
                {elsewhere.length} lopende {elsewhere.length === 1 ? "signaal" : "signalen"} uit de dagelijkse analyse (t.o.v. eigen historie)
              </summary>
              <ul className="mt-1.5 divide-y divide-[var(--color-line)] overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]">
                {elsewhere.map((a) => (
                  <li key={a.id}>
                    <button type="button" onClick={() => toggle(`e:${a.id}`)} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] hover:bg-[var(--color-surface-2)]">
                      <span className="size-2 shrink-0 rounded-full" style={{ background: a.level === "rood" ? "var(--color-bad)" : "var(--color-warn)" }} />
                      <ClientLogo name={a.clientName} logoUrl={a.logoUrl} color={a.color} size={22} />
                      <span className="font-semibold">{a.clientName}</span>
                      <span className="min-w-0 flex-1 truncate text-[var(--color-ink-muted)]">{a.headline}</span>
                      <StatusTag a={a} />
                    </button>
                    {open === `e:${a.id}` ? <div className="px-3 pb-3"><Detail key={a.id} a={a} staff={p.staff} viewerId={p.viewerId} startWithAction={false} /></div> : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {p.onvoldoende.length ? (
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs text-[var(--color-ink-faint)] [&::-webkit-details-marker]:hidden">
                <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
                {p.onvoldoende.length} {p.onvoldoende.length === 1 ? "klant" : "klanten"} met onvoldoende data voor een eerlijke vergelijking
              </summary>
              <ul className="mt-1 grid gap-x-6 gap-y-0.5 pl-5 text-xs sm:grid-cols-2">
                {p.onvoldoende.map((i) => (
                  <li key={i.clientId} className="truncate" title={i.reason}>
                    <Link href={`/analytics/${i.slug}`} className="font-medium hover:underline">{i.name}</Link>
                    <span className="text-[var(--color-ink-faint)]"> · {i.reason}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {p.closed.length ? <ClosedList closed={p.closed} /> : null}
        </div>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Bouwstenen
 * ------------------------------------------------------------------ */

function Column({ tone, icon, title, count, extra, question, sub, action, children }: {
  tone: "warn" | "good"; icon: React.ReactNode; title: string; count: number; extra?: React.ReactNode; question: string; sub: string; action?: React.ReactNode; children: React.ReactNode;
}) {
  const color = tone === "warn" ? "var(--color-warn)" : "var(--color-good)";
  const soft = tone === "warn" ? "var(--color-warn-soft)" : "var(--color-good-soft)";
  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-line)] border-t-[3px] bg-[var(--color-surface)]" style={{ borderTopColor: color }}>
      <div className="flex items-start gap-3 px-4 py-3" style={{ background: soft }}>
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full text-white" style={{ background: color }}>{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold tracking-tight">{title}</h2>
            <span className="grid h-6 min-w-6 place-items-center rounded-full bg-[var(--color-surface)] px-2 text-xs font-bold" style={{ color }}>{count}</span>
            {extra}
          </div>
          <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">{question} <span className="text-[var(--color-ink-faint)]">· {sub}</span></p>
        </div>
        {action}
      </div>
      <div className="flex-1 border-t border-[var(--color-line)]">{children}</div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="px-4 py-5 text-sm text-[var(--color-ink-muted)]">{text}</p>;
}

function MoreButton({ n, onClick }: { n: number; onClick: () => void }) {
  return (
    <li><button type="button" onClick={onClick} className="w-full py-2 text-xs font-semibold text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">Toon alle {n}</button></li>
  );
}

function StatusTag({ a }: { a: AlertCard }) {
  if (a.status !== "actie") return null;
  const who = firstName(a.task?.assigneeName ?? a.assigneeName);
  return <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[var(--color-ink-muted)]"><CheckCircle2 className="size-3.5" /> Opgepakt{who ? ` · ${who}` : ""}</span>;
}

function Pct({ d, color }: { d: number; color: string }) {
  return <span className="text-xl font-bold leading-none tabular-nums" style={{ color }}>{pctText(d)}</span>;
}

/* ------------------------------ Daling ------------------------------ */

function DeclineRow({ r, alert, open, onToggle, staff, viewerId, coordinatorId }: {
  r: TrendRow; alert: AlertCard | null; open: boolean; onToggle: () => void; staff: StaffOption[]; viewerId: string; coordinatorId: string | null;
}) {
  const [picking, setPicking] = useState(false);
  const dot = r.urgency === "hoog" ? "var(--color-bad)" : "var(--color-warn)";
  const picked = alert?.status === "actie";
  // Data-onderbouwd advies uit de dagelijkse analyse gaat voor op de standaardactie.
  const action = alert?.analysis.adviceShort || r.action;
  return (
    <li className={open || picking ? "bg-[var(--color-surface-2)]" : undefined}>
      <div className="grid grid-cols-[10px_32px_minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-3">
        <span className="size-2.5 rounded-full" style={{ background: dot }} title={r.urgency === "hoog" ? "Urgent: eerst oppakken" : "Bijsturen"} />
        <ClientLogo name={r.name} logoUrl={r.logoUrl} color={r.color} size={32} />
        <button type="button" onClick={onToggle} className="min-w-0 text-left" title="Meer details">
          <span className="flex items-baseline gap-2">
            <span className="truncate text-sm font-semibold">{r.name}</span>
            <span className="shrink-0 text-xs text-[var(--color-ink-muted)]">{KPI_LABEL[r.main.kpi]}{r.main.goal && r.goalLabel ? <span className="ml-1 rounded bg-[var(--color-surface-sunken)] px-1 py-px text-[10.5px] font-semibold" title={`Doel: ${r.goalLabel}`}>doel</span> : null}</span>
          </span>
          <span className="mt-0.5 block truncate text-xs text-[var(--color-ink-muted)]" title={r.note}>{r.note}</span>
        </button>
        <span className="text-right"><Pct d={r.main.delta} color={dot} /></span>

        <span className="col-span-2" />
        <span className="col-span-2 mt-1.5 flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold" title={action}>→ {action}</span>
          {picked ? (
            <span className="flex shrink-0 items-center gap-2">
              <StatusTag a={alert!} />
              {alert!.task ? <Link href={`/tasks?persoon=${alert!.task.assigneeId ?? ""}`} className="text-xs font-semibold text-[var(--color-ink-muted)] underline-offset-2 hover:underline">Taak</Link> : null}
            </span>
          ) : (
            <button type="button" onClick={() => setPicking(!picking)} className="shrink-0 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">Oppakken</button>
          )}
        </span>
      </div>

      {picking && !picked ? (
        <PickUpPanel r={r} action={action} alert={alert} staff={staff} viewerId={viewerId} coordinatorId={coordinatorId} onDone={() => setPicking(false)} />
      ) : null}

      {open ? (
        <div className="px-4 pb-3">
          {alert ? (
            <Detail key={alert.id} a={alert} staff={staff} viewerId={viewerId} startWithAction={false} />
          ) : (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3 text-[13px]">
              <dl className="grid grid-cols-[84px_1fr] gap-x-3 gap-y-1.5">
                <dt className="text-[var(--color-ink-faint)]">Signaal</dt><dd className="font-semibold">{r.note}</dd>
                {r.also.length ? (<><dt className="text-[var(--color-ink-faint)]">Ook</dt><dd>{alsoText(r.also)}</dd></>) : null}
                {r.goalLabel ? (<><dt className="text-[var(--color-ink-faint)]">Doel klant</dt><dd>{r.goalLabel}</dd></>) : null}
                <dt className="text-[var(--color-ink-faint)]">Onderzoek</dt><dd>Welke video&apos;s bleven achter, en verschillen hook, lengte of ritme met de periode ervoor?</dd>
              </dl>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                <Link href={`/analytics/${r.slug}`} className={btn}>Klantresultaten</Link>
                <Link href={`/contentgeheugen?klant=${r.slug}`} className={btn}>Contentgeheugen</Link>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </li>
  );
}

const btn = "inline-flex items-center gap-1 whitespace-nowrap rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2.5 py-1 text-xs font-semibold text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]";

function PickUpPanel({ r, action, alert, staff, viewerId, coordinatorId, onDone }: {
  r: TrendRow; action: string; alert: AlertCard | null; staff: StaffOption[]; viewerId: string; coordinatorId: string | null; onDone: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const preferred = [alert?.assigneeId, coordinatorId, viewerId].find((id) => id && staff.some((s) => s.id === id));
  const [assignee, setAssignee] = useState(preferred ?? staff[0]?.id ?? "");
  const [due, setDue] = useState(addWorkdays(r.urgency === "hoog" ? 2 : 5));

  const submit = () =>
    start(async () => {
      const res = await pickUpDecline({
        clientId: r.clientId,
        assigneeId: assignee,
        dueOn: due,
        headline: `${KPI_LABEL[r.main.kpi][0]!.toUpperCase()}${KPI_LABEL[r.main.kpi].slice(1)} ${pctText(r.main.delta)}`.slice(0, 200),
        action: action.slice(0, 240),
        title: `${r.name}: ${action}`.slice(0, 240),
        urgent: r.urgency === "hoog",
        note: [`Signaal: ${r.note}`, r.also.length ? `Ook: ${alsoText(r.also)}` : "", `Vergeleken met ${formatKpiValue(r.main.kpi, r.main.prev)} in de vorige periode.`].filter(Boolean).join("\n").slice(0, 600),
      });
      setMsg(res.message ?? null);
      if (res.ok) {
        router.refresh();
        onDone();
      }
    });

  return (
    <div className="mx-4 mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2.5 text-[13px]">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-0.5 text-xs text-[var(--color-ink-faint)]">Wie</span>
        {staff.map((s) => (
          <button key={s.id} type="button" onClick={() => setAssignee(s.id)} className={`rounded-full px-3 py-1 text-xs font-semibold ${assignee === s.id ? "bg-[var(--color-indigo-ink)] text-white" : "border border-[var(--color-line-strong)] text-[var(--color-ink-muted)]"}`}>
            {s.name.split(" ")[0]}
          </button>
        ))}
      </div>
      <label className="inline-flex items-center gap-1.5">
        <span className="text-xs text-[var(--color-ink-faint)]">Wanneer</span>
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2 py-1 text-xs" />
      </label>
      <button type="button" onClick={submit} disabled={pending || !assignee} className="ml-auto inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60">
        <ClipboardList className="size-3.5" /> {pending ? "Bezig..." : "Taak aanmaken"}
      </button>
      {msg ? <span className="w-full text-xs font-medium text-[var(--color-bad)]">{msg}</span> : null}
    </div>
  );
}

/* ------------------------------- Groei ------------------------------- */

function GrowthRow({ r, alert, open, onToggle, staff, viewerId }: { r: TrendRow; alert: AlertCard | null; open: boolean; onToggle: () => void; staff: StaffOption[]; viewerId: string }) {
  const works = r.works;
  const chance = alert?.analysis.adviceShort || r.action;
  return (
    <li className={open ? "bg-[var(--color-surface-2)]" : undefined}>
      <div className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-3">
        <ClientLogo name={r.name} logoUrl={r.logoUrl} color={r.color} size={32} />
        <Link href={`/analytics/${r.slug}`} className="group/g min-w-0" title={`Alle resultaten van ${r.name}`}>
          <span className="flex items-baseline gap-2">
            <span className="truncate text-sm font-semibold group-hover/g:underline">{r.name}</span>
            <span className="shrink-0 text-xs text-[var(--color-ink-muted)]">{KPI_LABEL[r.main.kpi]}{r.main.goal && r.goalLabel ? <span className="ml-1 rounded bg-[var(--color-surface-sunken)] px-1 py-px text-[10.5px] font-semibold" title={`Doel: ${r.goalLabel}`}>doel</span> : null}</span>
          </span>
          <span className="mt-0.5 block truncate text-xs text-[var(--color-ink-muted)]">{r.note}{r.also.length ? ` · ook ${alsoText(r.also)}` : ""}</span>
        </Link>
        <span className="text-right"><Pct d={r.main.delta} color="var(--color-good)" /></span>

        <span />
        <div className="col-span-2 mt-1.5 min-w-0 space-y-0.5 text-[13px]">
          {works ? <p className="truncate" title={works}><span className="font-semibold text-[var(--color-good)]">Werkt: </span>{works}</p> : null}
          <div className="flex min-w-0 items-center gap-2">
            <p className="min-w-0 flex-1 truncate font-semibold" title={chance}>→ {chance}</p>
            {alert ? (
              <button type="button" onClick={onToggle} className="shrink-0 text-xs font-semibold text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">{open ? "Minder" : "Analyse"}</button>
            ) : null}
            <Link href={`/analytics/${r.slug}`} className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-good)]/40 px-2.5 py-1 text-xs font-semibold text-[var(--color-good)] hover:bg-[var(--color-good-soft)]">
              Resultaten <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </div>
      </div>
      {open && alert ? <div className="px-4 pb-3"><Detail key={alert.id} a={alert} staff={staff} viewerId={viewerId} startWithAction={false} /></div> : null}
    </li>
  );
}
