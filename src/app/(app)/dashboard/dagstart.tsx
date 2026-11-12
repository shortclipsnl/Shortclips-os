"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, CalendarClock, Check, ChevronDown, Hourglass, Loader2, Sunrise } from "lucide-react";
import { DAGRITME } from "@/lib/werkdag";
import { Dagindeling } from "./dagindeling";
import { Card } from "@/components/ui";
import { setTaskStatus } from "@/server/actions/tasks";
import type { DoneItem, WaitingItem, WorkCategory, WorkItem } from "@/server/werkoverzicht";

const CAT_LABEL: Record<WorkCategory, string> = {
  klantcontact: "Klantcontact",
  scripting: "Scripting",
  opname: "Opname",
  editing: "Editing",
  publicatie: "Publicatie",
  intern: "Intern",
};

const nlDay = (s: string, opts: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" }) =>
  new Date(`${s}T12:00:00Z`).toLocaleDateString("nl-NL", { ...opts, timeZone: "UTC" });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const shortDay = (s: string) => nlDay(s, { weekday: "short", day: "numeric", month: "short" });
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

export type DagstartProps = {
  personName: string;
  isSelf: boolean;
  today: string;
  todayIsWorkday: boolean;
  nextDay: string;
  weekEnd: string;
  columns: { today: WorkItem[]; next: WorkItem[]; week: WorkItem[] };
  done: { today: DoneItem[]; weekCount: number };
  waiting: WaitingItem[];
  laterCount: number;
  workday: { start: string; end: string; offToday: string | null };
};

type Tone = "bad" | "warn" | "info" | "good" | "neutral";
const TONE: Record<Tone, { bar: string; pill: string }> = {
  bad: { bar: "border-l-[var(--color-bad)]", pill: "bg-[var(--color-bad)]/12 text-[var(--color-bad)]" },
  warn: { bar: "border-l-[var(--color-warn)]", pill: "bg-[var(--color-warn)]/14 text-[var(--color-warn)]" },
  info: { bar: "border-l-[var(--color-brand-700)]", pill: "bg-[var(--color-brand-700)]/14 text-[var(--color-brand-700)]" },
  good: { bar: "border-l-[var(--color-good)]", pill: "bg-[var(--color-good)]/14 text-[var(--color-good)]" },
  neutral: { bar: "border-l-[var(--color-line-strong)]", pill: "bg-[var(--color-neutral-soft)] text-[var(--color-ink-muted)]" },
};

/** Kleur + label van één taakkaart, afhankelijk van de kolom. */
function toneOf(i: WorkItem, col: "today" | "week", today: string): { tone: Tone; label: string } {
  if (i.state === "late") return { tone: "bad", label: `${i.daysLate} ${i.daysLate === 1 ? "dag" : "dagen"} te laat` };
  if (i.urgent) return { tone: "bad", label: "Urgent" };
  if (i.status === "bezig") return { tone: "info", label: "Bezig" };
  if (i.status === "geblokkeerd") return { tone: "warn", label: "Geblokkeerd" };
  if (i.flag) return { tone: "warn", label: i.flag };
  if (col === "week" && i.due && dayDiff(i.due, today) <= 2) return { tone: "warn", label: "Deadline nadert" };
  return { tone: "neutral", label: col === "week" && !i.due ? "Deze week" : "Open" };
}

/**
 * Vandaag-pagina, persoonlijk per medewerker: "Wat moet ik vandaag afronden?",
 * "Wat moet ik deze week afronden?" en rechts de eigen Dagindeling die live
 * meeloopt. Elk item staat in precies één kolom, urgent staat bovenaan, taken
 * zijn direct af te vinken en details klappen pas open bij aanklikken.
 */
export function Dagstart(p: DagstartProps) {
  const [done, setDone] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();
  const router = useRouter();

  const complete = (taskId: string) => {
    if (busy) return;
    setBusy(taskId);
    setDone((s) => new Set(s).add(taskId));
    start(async () => {
      await setTaskStatus(taskId, "done");
      router.refresh();
      setBusy(null);
    });
  };

  const rowProps = { done, busy, onComplete: complete, today: p.today };
  const first = p.personName.split(" ")[0];
  const wie = p.isSelf ? "ik" : first;
  // In het weekend gaat "vandaag" over de eerstvolgende werkdag.
  const dagWoord = p.todayIsWorkday ? "vandaag" : nlDay(p.nextDay, { weekday: "long" });
  const weekLabel = `t/m ${shortDay(p.weekEnd)}`;

  return (
    <div className="space-y-5">
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      {/* Dagindeling: het vaste dagritme, loopt live mee (geweest = groen). */}
      <Card padded={false} className="overflow-hidden ring-1 ring-[var(--color-good)]/20 lg:sticky lg:top-4 lg:order-2">
        <div className="flex items-center gap-2.5 bg-[var(--color-good)] px-4 py-3 text-white">
          <CalendarClock className="size-4.5 shrink-0 opacity-90" />
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-bold leading-tight tracking-tight">Dagindeling {first}</h2>
            <p className="truncate text-xs text-white/75">Het dagritme, geweest wordt groen.</p>
          </div>
        </div>
        <Dagindeling items={DAGRITME} />
      </Card>
      <div className="grid items-start gap-4 md:grid-cols-2 lg:order-1">
        <Column
          col="today"
          icon={<Sunrise className="size-4.5" />}
          title={`Wat moet ${wie} ${dagWoord} afronden?`}
          date={p.todayIsWorkday ? nlDay(p.today) : nlDay(p.nextDay)}
          accent="bg-[var(--color-indigo-ink)]"
          items={p.columns.today}
          empty={`Alles voor ${dagWoord} is af. Pak iets uit de weeklijst.`}
          doneToday={p.done.today}
          {...rowProps}
        />
        <Column
          col="week"
          icon={<CalendarCheck className="size-4.5" />}
          title={`Wat moet ${wie} deze week afronden?`}
          date={weekLabel}
          accent="bg-[var(--color-indigo-mist)]"
          items={p.columns.week}
          empty="Geen andere deadlines meer deze week."
          footer={[
            p.done.weekCount > 0 ? `${p.done.weekCount} afgerond deze week` : null,
            p.laterCount > 0 ? `${p.laterCount} later of lage prioriteit op Taken` : null,
          ].filter(Boolean).join(" · ") || null}
          {...rowProps}
        />
      </div>
      </div>

      <WaitingStrip items={p.waiting} isSelf={p.isSelf} personName={p.personName} />
    </div>
  );
}

const SHOW = 8;

function Column({
  col, icon, title, date, accent, items, empty, footer, doneToday, done, busy, onComplete, today,
}: {
  col: "today" | "week"; icon: React.ReactNode; title: string; date: string; accent: string;
  items: WorkItem[]; empty: string; footer?: string | null; doneToday?: DoneItem[];
  done: Set<string>; busy: string | null; onComplete: (id: string) => void; today: string;
}) {
  const [all, setAll] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const open = items.filter((i) => !(i.taskId && done.has(i.taskId)));
  const urgent = items.filter((i) => i.urgent || i.state === "late");
  const normal = items.filter((i) => !(i.urgent || i.state === "late"));
  const urgentOpen = urgent.filter((i) => !(i.taskId && done.has(i.taskId))).length;
  const visibleNormal = all ? normal : normal.slice(0, Math.max(0, SHOW - urgent.length));
  const hidden = normal.length - visibleNormal.length;
  const justDone = items.filter((i) => i.taskId && done.has(i.taskId)).length;
  const doneCount = (doneToday?.length ?? 0) + justDone;

  return (
    <Card padded={false} className="overflow-hidden">
      <div className={`flex items-center gap-2.5 px-4 py-3 text-white ${accent}`}>
        <span className="opacity-90">{icon}</span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-bold leading-tight tracking-tight">{title}</h2>
          <p className="truncate text-xs text-white/70">{cap(date)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {urgentOpen > 0 ? (
            <span className="rounded-full bg-[var(--color-bad)] px-2 py-0.5 text-xs font-bold" title="Urgent of te laat">{urgentOpen}<span className="hidden 2xl:inline"> urgent</span></span>
          ) : null}
          <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-sm font-bold tabular-nums" title="Openstaand">{open.length}</span>
        </div>
      </div>

      {/* Werkweek-tijdlijn: hoeveel tijd is er deze week nog om af te ronden. */}
      {col === "week" ? <WeekTimeline today={today} /> : null}

      {items.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-[var(--color-ink-muted)]">{empty}</p>
      ) : (
        <div className="space-y-1.5 p-2.5">
          {urgent.length > 0 && normal.length > 0 ? <GroupLabel>Urgent</GroupLabel> : null}
          {urgent.map((i) => <TaskCard key={i.key} item={i} col={col} {...{ done, busy, onComplete, today }} />)}
          {urgent.length > 0 && normal.length > 0 ? <GroupLabel>Overig</GroupLabel> : null}
          {visibleNormal.map((i) => <TaskCard key={i.key} item={i} col={col} {...{ done, busy, onComplete, today }} />)}
          {hidden > 0 || all ? (
            <button type="button" onClick={() => setAll((v) => !v)} className="w-full rounded-[var(--radius-sm)] py-1.5 text-xs font-semibold text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)]">
              {all ? "Minder tonen" : `Toon nog ${hidden}`}
            </button>
          ) : null}
        </div>
      )}

      {doneToday ? (
        <div className="border-t border-[var(--color-line)]">
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            disabled={doneCount === 0}
            className="flex w-full items-center gap-2 px-4 py-2 text-xs text-[var(--color-ink-muted)] enabled:hover:bg-[var(--color-surface-sunken)]"
          >
            <span className="grid size-4 place-items-center rounded-full bg-[var(--color-good)] text-white"><Check className="size-2.5" strokeWidth={3} /></span>
            <span className="font-semibold text-[var(--color-good)]">{doneCount} afgerond vandaag</span>
            {doneCount > 0 ? <ChevronDown className={`ml-auto size-3.5 transition ${showDone ? "rotate-180" : ""}`} /> : null}
          </button>
          {showDone && doneToday.length ? (
            <ul className="space-y-0.5 px-4 pb-2.5">
              {doneToday.map((d) => (
                <li key={d.key} className="truncate text-xs text-[var(--color-ink-faint)] line-through">
                  {d.clientName ? `${d.clientName} · ` : ""}{d.title}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {footer ? <p className="border-t border-[var(--color-line)] px-4 py-2 text-xs text-[var(--color-ink-muted)]">{footer}</p> : null}
    </Card>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-1 pt-1 text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-faint)]">{children}</div>;
}

const WEEK_DAYS = ["Ma", "Di", "Wo", "Do", "Vr"];

/** Kleur die met de week meeloopt: begin groen, midden oranje, richting vrijdag rood. */
function weekUrgency(dayIndex: number): { color: string; soft: string } {
  // dayIndex: 1=ma … 5=vr, 0=weekend (nieuwe week nog niet begonnen).
  if (dayIndex >= 4) return { color: "var(--color-bad)", soft: "var(--color-bad-soft)" }; // do/vr: rood
  if (dayIndex === 3) return { color: "var(--color-warn)", soft: "var(--color-warn-soft)" }; // wo: oranje
  return { color: "var(--color-good)", soft: "var(--color-good-soft)" }; // ma/di + weekend: groen
}

/**
 * Compacte werkweek-tijdlijn boven "Deze week afronden". Loopt automatisch mee
 * met de dag (uit de Amsterdamse datum in `today`), kleurt subtiel op richting
 * vrijdag en toont hoeveel werkdagen er nog over zijn. Puur tijd-gebaseerd —
 * losstaand van hoeveel taken al zijn afgevinkt. Reset vanzelf elke maandag.
 */
function WeekTimeline({ today }: { today: string }) {
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 zo … 6 za
  const dayIndex = dow >= 1 && dow <= 5 ? dow : 0; // 1..5 ma-vr, 0 = weekend
  const started = dayIndex > 0;
  const remaining = started ? 6 - dayIndex : 5; // ma→5 … vr→1 ; weekend→5
  const { color, soft } = weekUrgency(dayIndex);

  // Voortgang = verstreken tijd (midden van de huidige dag), NIET het percentage
  // afgevinkte taken. Dots staan op 10/30/50/70/90% → lijn loopt van 10% tot 90%.
  const centerPct = started ? ((dayIndex - 0.5) / 5) * 100 : 0;
  const fillPct = started ? Math.max(0, centerPct - 10) : 0;

  const label = !started
    ? "Nieuwe werkweek — maandag starten we opnieuw"
    : dayIndex === 5
      ? "Vrijdag — laatste dag om deze week af te ronden"
      : `Nog ${remaining} werkdag${remaining === 1 ? "" : "en"} om deze week af te ronden`;

  return (
    <div className="border-b border-[var(--color-line)] px-3.5 pb-3 pt-2.5">
      <div className="mb-2 flex items-center gap-1.5">
        <span className="size-1.5 shrink-0 rounded-full" style={{ background: color }} />
        <span className="text-[11.5px] font-semibold leading-tight" style={{ color }}>{label}</span>
      </div>
      <div className="relative">
        {/* grondlijn + verstreken tijd */}
        <div className="absolute left-[10%] right-[10%] top-[7px] h-[3px] rounded-full bg-[var(--color-line-strong)]/40" />
        <div className="absolute left-[10%] top-[7px] h-[3px] rounded-full transition-all" style={{ width: `${fillPct}%`, background: color }} />
        <div className="relative grid grid-cols-5">
          {WEEK_DAYS.map((d, idx) => {
            const n = idx + 1;
            const isToday = started && n === dayIndex;
            const isPast = started && n < dayIndex;
            return (
              <div key={d} className="flex flex-col items-center gap-1">
                <span
                  className="grid size-[15px] place-items-center rounded-full border-2"
                  style={{
                    borderColor: isToday || isPast ? color : "var(--color-line-strong)",
                    background: isPast ? color : isToday ? soft : "var(--color-surface)",
                    boxShadow: isToday ? `0 0 0 3px ${soft}` : undefined,
                  }}
                >
                  {isToday ? <span className="size-1.5 rounded-full" style={{ background: color }} /> : null}
                </span>
                <span
                  className="text-[10px] font-semibold"
                  style={{ color: isToday ? color : isPast ? "var(--color-ink-muted)" : "var(--color-ink-faint)" }}
                >
                  {d}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TaskCard({
  item: i, col, done, busy, onComplete, today,
}: {
  item: WorkItem; col: "today" | "week"; done: Set<string>; busy: string | null; onComplete: (id: string) => void; today: string;
}) {
  const [open, setOpen] = useState(false);
  const isDone = i.taskId ? done.has(i.taskId) : false;
  const t = isDone ? { tone: "good" as Tone, label: "Afgerond" } : toneOf(i, col, today);
  const deadline = i.due ? (i.due === today ? "vandaag" : shortDay(i.due)) : null;

  return (
    <div className={`rounded-[var(--radius-sm)] border border-l-[3px] border-[var(--color-line)] bg-[var(--color-surface)] ${TONE[t.tone].bar} ${isDone ? "opacity-55" : ""}`}>
      <div className="flex items-start gap-2.5 px-2.5 py-2">
        {i.taskId ? (
          <button
            type="button"
            onClick={() => onComplete(i.taskId!)}
            disabled={isDone}
            title="Afvinken"
            aria-label="Afvinken"
            className={`mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-[5px] border transition ${isDone ? "border-[var(--color-good)] bg-[var(--color-good)] text-white" : "border-[var(--color-line-strong)] hover:border-[var(--color-good)] hover:bg-[var(--color-good-soft)]"}`}
          >
            {busy === i.taskId ? <Loader2 className="size-3 animate-spin" /> : isDone ? <Check className="size-3" strokeWidth={3} /> : null}
          </button>
        ) : (
          <span className="mt-[7px] grid size-[18px] shrink-0 place-items-center" title="Signaal of opname: los het op via de link">
            <span className={`size-2 rounded-full ${t.tone === "neutral" ? "bg-[var(--color-ink-faint)]" : t.tone === "bad" ? "bg-[var(--color-bad)]" : t.tone === "warn" ? "bg-[var(--color-warn)]" : t.tone === "info" ? "bg-[var(--color-brand-700)]" : "bg-[var(--color-good)]"}`} />
          </span>
        )}
        <button type="button" onClick={() => setOpen((v) => !v)} className="min-w-0 flex-1 text-left" aria-expanded={open}>
          <span className={`block truncate text-[13px] font-semibold leading-snug ${isDone ? "line-through" : ""}`}>
            {i.clientName ? <span>{i.clientName}</span> : <span className="text-[var(--color-ink-muted)]">Intern</span>}
          </span>
          <span className={`block truncate text-[13px] leading-snug text-[var(--color-ink-muted)] ${isDone ? "line-through" : ""}`}>{i.title}</span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className={`rounded-full px-1.5 py-px text-[10.5px] font-semibold ${TONE[t.tone].pill}`}>{t.label}</span>
            <span className="text-[10.5px] text-[var(--color-ink-faint)]">{CAT_LABEL[i.category]}</span>
            {deadline && i.state !== "late" && col !== "today" ? <span className="ml-auto text-[10.5px] font-semibold tabular-nums text-[var(--color-ink-muted)]">{deadline}</span> : null}
          </span>
        </button>
        <ChevronDown className={`mt-1 size-3.5 shrink-0 text-[var(--color-ink-faint)] transition ${open ? "rotate-180" : ""}`} />
      </div>
      {open ? (
        <div className="space-y-1 border-t border-[var(--color-line)] px-2.5 py-2 pl-[38px] text-xs text-[var(--color-ink-muted)]">
          {i.detail ? <p className="leading-snug">{i.detail}</p> : null}
          <p>
            {i.source === "taak" ? "Taak" : i.source === "signaal" ? "Aandachtspunt" : "Opname"}{i.source !== "opname" ? ` · ${CAT_LABEL[i.category]}` : ""}
            {i.due ? ` · deadline ${nlDay(i.due, { weekday: "long", day: "numeric", month: "long" })}` : " · geen vaste deadline"}
          </p>
          <Link href={i.href ?? "/tasks"} className="inline-block font-semibold text-[var(--color-ink)] hover:underline">Openen →</Link>
        </div>
      ) : null}
    </div>
  );
}

function WaitingStrip({ items, isSelf, personName }: { items: WaitingItem[]; isSelf: boolean; personName: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 6);
  return (
    <Card padded={false} className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-[var(--color-line)] px-4 py-2.5">
        <Hourglass className="size-4 text-[var(--color-warn)]" />
        <h2 className="text-sm font-semibold">{isSelf ? "Ik wacht op de klant" : `${personName.split(" ")[0]} wacht op de klant`}</h2>
        <span className="rounded-full bg-[var(--color-neutral-soft)] px-2 py-0.5 text-xs font-semibold tabular-nums text-[var(--color-ink-muted)]">{items.length}</span>
        <span className="ml-auto hidden text-xs text-[var(--color-ink-muted)] sm:inline">Langer dan 3 werkdagen stil? Stuur de klant een herinnering.</span>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-3 text-sm text-[var(--color-ink-muted)]">Er ligt niets bij je klanten.</p>
      ) : (
        <>
          <ul className="grid gap-px bg-[var(--color-line)] sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((w) => (
              <li key={w.key} className="bg-[var(--color-surface)]">
                <Link href={w.href} className="sc-row-link flex items-center gap-3 px-4 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{w.clientName}</span>
                    <span className="block truncate text-xs text-[var(--color-ink-muted)]">{w.kind === "script" ? "Script" : "Video"}: {w.title}</span>
                  </span>
                  <span className={`shrink-0 rounded-full px-1.5 py-px text-[10.5px] font-semibold ${w.days >= 3 ? TONE.bad.pill : TONE.neutral.pill}`}>
                    {w.days === 0 ? "vandaag" : `${w.days} d`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {items.length > 6 ? (
            <button type="button" onClick={() => setAll((v) => !v)} className="w-full border-t border-[var(--color-line)] py-1.5 text-xs font-semibold text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)]">
              {all ? "Minder tonen" : `Toon alle ${items.length}`}
            </button>
          ) : null}
        </>
      )}
    </Card>
  );
}
