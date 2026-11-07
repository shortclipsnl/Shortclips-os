"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, CalendarDays, Check, ChevronDown, Hourglass, Loader2, Sunrise } from "lucide-react";
import { Card } from "@/components/ui";
import { setTaskStatus } from "@/server/actions/tasks";
import type { DoneItem, WaitingItem, WorkCategory, WorkItem } from "@/server/werkoverzicht";
import { WerkdagBalk, type Focus } from "./werkdag-balk";

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
function toneOf(i: WorkItem, col: "today" | "next" | "week", today: string): { tone: Tone; label: string } {
  if (i.state === "late") return { tone: "bad", label: `${i.daysLate} ${i.daysLate === 1 ? "dag" : "dagen"} te laat` };
  if (i.urgent) return { tone: "bad", label: "Urgent" };
  if (i.status === "bezig") return { tone: "info", label: "Bezig" };
  if (i.status === "geblokkeerd") return { tone: "warn", label: "Geblokkeerd" };
  if (i.flag) return { tone: "warn", label: i.flag };
  if (col === "week" && i.due && dayDiff(i.due, today) <= 2) return { tone: "warn", label: "Deadline nadert" };
  return { tone: "neutral", label: col === "week" && !i.due ? "Deze week" : "Open" };
}

/**
 * Vandaag-pagina: bovenaan de werkdagbalk (tijd, voortgang, wat nu eerst),
 * daaronder drie kolommen — Vandaag, Eerstvolgende werkdag en Deze week
 * afronden. Elk item staat in precies één kolom, urgent staat bovenaan, taken
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

  // Wat heeft nu prioriteit: het bovenste open item van vandaag (of, buiten
  // werktijd/in het weekend, van de eerstvolgende werkdag).
  const focus: Focus = useMemo(() => {
    const pool = [...p.columns.today, ...p.columns.next];
    const first = pool.find((i) => !(i.taskId && done.has(i.taskId)));
    if (!first) return null;
    const col = p.columns.today.includes(first) ? "today" : "next";
    const t = toneOf(first, col, p.today);
    return {
      title: first.title,
      clientName: first.clientName,
      reason: `${t.label}${first.detail ? ` · ${first.detail}` : ""}`,
      href: first.href,
      tone: t.tone === "good" ? "neutral" : t.tone,
    };
  }, [p.columns, p.today, done]);

  const rowProps = { done, busy, onComplete: complete, today: p.today };
  const weekLabel = `t/m ${shortDay(p.weekEnd)}`;

  return (
    <div className="space-y-5">
      <WerkdagBalk
        start={p.workday.start}
        end={p.workday.end}
        isWorkday={p.todayIsWorkday}
        offToday={p.workday.offToday}
        nextDayLabel={nlDay(p.nextDay)}
        focus={focus}
      />

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Column
          col="today"
          icon={<Sunrise className="size-4.5" />}
          title="Vandaag"
          date={p.todayIsWorkday ? nlDay(p.today) : `${nlDay(p.today)} · geen werkdag`}
          accent="bg-[var(--color-indigo-ink)]"
          items={p.columns.today}
          empty={p.todayIsWorkday ? "Alles voor vandaag is af. Pak iets uit Deze week afronden." : "Geen werkdag. Niets dat te laat is."}
          doneToday={p.done.today}
          {...rowProps}
        />
        <Column
          col="next"
          icon={<CalendarDays className="size-4.5" />}
          title="Eerstvolgende werkdag"
          date={nlDay(p.nextDay)}
          accent="bg-[var(--color-indigo-soft)]"
          items={p.columns.next}
          empty={`Nog niets met een deadline op ${nlDay(p.nextDay, { weekday: "long" })}.`}
          {...rowProps}
        />
        <Column
          col="week"
          icon={<CalendarCheck className="size-4.5" />}
          title="Deze week afronden"
          date={weekLabel}
          accent="bg-[var(--color-indigo-mist)]"
          items={p.columns.week}
          empty={p.nextDay > p.weekEnd ? "De werkweek is rond. Alles voor vandaag staat links." : "Geen andere deadlines meer deze week."}
          footer={[
            p.done.weekCount > 0 ? `${p.done.weekCount} afgerond deze week` : null,
            p.laterCount > 0 ? `${p.laterCount} later of lage prioriteit op Taken` : null,
          ].filter(Boolean).join(" · ") || null}
          {...rowProps}
        />
      </div>

      <WaitingStrip items={p.waiting} isSelf={p.isSelf} personName={p.personName} />
    </div>
  );
}

const SHOW = 8;

function Column({
  col, icon, title, date, accent, items, empty, footer, doneToday, done, busy, onComplete, today,
}: {
  col: "today" | "next" | "week"; icon: React.ReactNode; title: string; date: string; accent: string;
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
          <h2 className="truncate text-[15px] font-bold leading-tight tracking-tight">{title}</h2>
          <p className="truncate text-xs text-white/70">{cap(date)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {urgentOpen > 0 ? (
            <span className="rounded-full bg-[var(--color-bad)] px-2 py-0.5 text-xs font-bold" title="Urgent of te laat">{urgentOpen} urgent</span>
          ) : null}
          <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-sm font-bold tabular-nums" title="Openstaand">{open.length}</span>
        </div>
      </div>

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

function TaskCard({
  item: i, col, done, busy, onComplete, today,
}: {
  item: WorkItem; col: "today" | "next" | "week"; done: Set<string>; busy: string | null; onComplete: (id: string) => void; today: string;
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
        <span className="ml-auto hidden text-xs text-[var(--color-ink-muted)] sm:inline">Langer dan 3 werkdagen stil? Stuur een herinnering via Klantbericht.</span>
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
