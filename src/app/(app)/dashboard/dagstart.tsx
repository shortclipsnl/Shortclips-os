"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, Check, ClipboardList, Hourglass, Loader2, MessageSquare, PenLine, Scissors, Send, Sunrise, CalendarCheck } from "lucide-react";
import { Card } from "@/components/ui";
import { setTaskStatus } from "@/server/actions/tasks";
import type { WaitingItem, WorkCategory, WorkItem } from "@/server/werkoverzicht";

const CATS: { key: WorkCategory; label: string; icon: React.ReactNode }[] = [
  { key: "klantcontact", label: "Klantcontact", icon: <MessageSquare className="size-4" /> },
  { key: "scripting", label: "Scripting", icon: <PenLine className="size-4" /> },
  { key: "opname", label: "Opnamevoorbereiding", icon: <Camera className="size-4" /> },
  { key: "editing", label: "Editing & kwaliteit", icon: <Scissors className="size-4" /> },
  { key: "publicatie", label: "Publicatie & resultaten", icon: <Send className="size-4" /> },
  { key: "intern", label: "Intern", icon: <ClipboardList className="size-4" /> },
];

const nlDay = (s: string, opts: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "short" }) =>
  new Date(`${s}T12:00:00Z`).toLocaleDateString("nl-NL", { ...opts, timeZone: "UTC" });

export type DagstartProps = {
  personName: string;
  isSelf: boolean;
  refDay: string;
  isWeekend: boolean;
  weekEnd: string;
  today: WorkItem[];
  week: WorkItem[];
  undated: WorkItem[];
  waiting: WaitingItem[];
  laterCount: number;
  counts: { late: number; today: number; week: number; waiting: number };
};

/**
 * Dagstart: bovenaan in één oogopslag wat er vandaag moet gebeuren en wat er
 * deze week af moet, gegroepeerd per soort werk (klantcontact, scripting,
 * opnamevoorbereiding, editing, publicatie, intern). Taken zijn direct af te
 * vinken; signalen en opnames linken naar de plek waar je het oplost.
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

  const dayTitle = p.isWeekend ? `Eerstvolgende werkdag · ${nlDay(p.refDay)}` : `Vandaag · ${nlDay(p.refDay)}`;
  const tiles = [
    { label: "Te laat", value: p.counts.late, tone: p.counts.late ? "bad" : "good" },
    { label: p.isWeekend ? "Maandag te doen" : "Vandaag te doen", value: p.counts.today, tone: p.counts.today ? "warn" : "good" },
    { label: `Deze week af (t/m ${nlDay(p.weekEnd, { weekday: "short", day: "numeric", month: "short" })})`, value: p.counts.week, tone: "info" },
    { label: "Wacht op klant", value: p.counts.waiting, tone: p.counts.waiting ? "warn" : "good" },
  ] as const;
  const toneCls: Record<string, string> = {
    bad: "text-[var(--color-bad)]", warn: "text-[var(--color-warn)]", good: "text-[var(--color-good)]", info: "text-[var(--color-ink)]",
  };

  return (
    <div className="space-y-5">
      {/* Telstrip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label} className="px-4 py-3">
            <div className={`text-2xl font-bold tabular-nums ${toneCls[t.tone]}`}>{t.value}</div>
            <div className="text-xs text-[var(--color-ink-muted)]">{t.label}</div>
          </Card>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          {/* Vandaag */}
          <Section
            icon={<Sunrise className="size-5" />}
            title={dayTitle}
            subtitle={p.isSelf ? "Begin hier. Eerst wat te laat is, daarna per soort werk." : `Dagstart van ${p.personName}.`}
            empty="Niets meer voor vandaag. Pak iets uit Deze week af."
            items={p.today}
            showDay={false}
            done={done} busy={busy} onComplete={complete}
          />
          {/* Deze week */}
          <Section
            icon={<CalendarCheck className="size-5" />}
            title={`Deze week afronden · t/m ${nlDay(p.weekEnd)}`}
            subtitle="Alles met een deadline deze week, per soort werk en per dag."
            empty="Geen deadlines meer deze week."
            items={[...p.week, ...p.undated]}
            showDay
            done={done} busy={busy} onComplete={complete}
            footer={p.laterCount > 0 ? `${p.laterCount} punt${p.laterCount === 1 ? "" : "en"} met lage prioriteit staan op Aandachtspunten en Taken.` : null}
          />
        </div>

        {/* Rechterkolom: waar wacht ik op */}
        <Card padded={false} className="h-fit overflow-hidden">
          <div className="flex items-center gap-2 border-b border-[var(--color-line)] px-4 py-3">
            <Hourglass className="size-4 text-[var(--color-warn)]" />
            <h2 className="text-sm font-semibold">Ik wacht op de klant</h2>
            <span className="ml-auto text-xs text-[var(--color-ink-muted)]">{p.waiting.length}</span>
          </div>
          {p.waiting.length === 0 ? (
            <p className="px-4 py-4 text-sm text-[var(--color-ink-muted)]">Er ligt niets bij je klanten.</p>
          ) : (
            <ul className="divide-y divide-[var(--color-line)]">
              {p.waiting.map((w) => (
                <li key={w.key}>
                  <Link href={w.href} className="sc-row-link flex items-center gap-3 px-4 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{w.clientName}</span>
                      <span className="block truncate text-xs text-[var(--color-ink-muted)]">{w.kind === "script" ? "Script" : "Video"}: {w.title}</span>
                    </span>
                    <span className={`shrink-0 text-xs font-semibold ${w.days >= 3 ? "text-[var(--color-bad)]" : "text-[var(--color-ink-muted)]"}`}>
                      {w.days === 0 ? "vandaag" : `${w.days} d`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="border-t border-[var(--color-line)] px-4 py-2.5 text-xs text-[var(--color-ink-muted)]">
            Langer dan 3 werkdagen stil? Stuur een herinnering via Klantbericht.
          </p>
        </Card>
      </div>
    </div>
  );
}

function Section({
  icon, title, subtitle, items, empty, showDay, done, busy, onComplete, footer,
}: {
  icon: React.ReactNode; title: string; subtitle: string; items: WorkItem[]; empty: string; showDay: boolean;
  done: Set<string>; busy: string | null; onComplete: (id: string) => void; footer?: string | null;
}) {
  const groups = CATS.map((c) => ({ ...c, items: items.filter((i) => i.category === c.key) })).filter((g) => g.items.length > 0);
  return (
    <Card padded={false} className="overflow-hidden">
      <div className="flex items-center gap-2.5 bg-[var(--color-indigo-ink)] px-5 py-3 text-white">
        <span className="opacity-90">{icon}</span>
        <div className="min-w-0">
          <h2 className="truncate text-base font-bold tracking-tight">{title}</h2>
          <p className="truncate text-xs text-white/70">{subtitle}</p>
        </div>
        {items.length ? <span className="ml-auto rounded-full bg-white/20 px-2.5 py-0.5 text-sm font-semibold">{items.length}</span> : null}
      </div>
      {groups.length === 0 ? (
        <p className="px-5 py-5 text-sm text-[var(--color-ink-muted)]">{empty}</p>
      ) : (
        <div className="grid gap-px bg-[var(--color-line)] md:grid-cols-2">
          {groups.map((g) => (
            <div key={g.key} className="bg-[var(--color-surface)]">
              <div className="flex items-center gap-2 px-4 pb-1.5 pt-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
                {g.icon} {g.label}
                <span className="ml-auto normal-case tracking-normal">{g.items.length}</span>
              </div>
              <ul className="pb-2">
                {g.items.map((i) => (
                  <Row key={i.key} item={i} showDay={showDay} isDone={i.taskId ? done.has(i.taskId) : false} busy={busy === i.taskId} onComplete={onComplete} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {footer ? <p className="border-t border-[var(--color-line)] px-5 py-2.5 text-xs text-[var(--color-ink-muted)]">{footer}</p> : null}
    </Card>
  );
}

function Row({ item: i, showDay, isDone, busy, onComplete }: { item: WorkItem; showDay: boolean; isDone: boolean; busy: boolean; onComplete: (id: string) => void }) {
  const dot = i.state === "late" ? "bg-[var(--color-bad)]" : i.flag && i.flag !== "klaar" && i.flag !== "bezig" ? "bg-[var(--color-warn)]" : i.flag === "klaar" ? "bg-[var(--color-good)]" : "bg-[var(--color-ink-faint)]";
  const meta = i.state === "late"
    ? `${i.daysLate} ${i.daysLate === 1 ? "dag" : "dagen"} te laat`
    : showDay && i.due ? nlDay(i.due, { weekday: "short", day: "numeric" }) : showDay && !i.due ? "deze week" : i.flag ?? "";
  return (
    <li className={`flex items-start gap-2.5 px-4 py-2 ${isDone ? "opacity-50" : ""}`}>
      {i.taskId ? (
        <button
          type="button" onClick={() => onComplete(i.taskId!)} disabled={isDone} title="Afvinken"
          className={`mt-0.5 grid size-4.5 shrink-0 place-items-center rounded-[5px] border transition ${isDone ? "border-[var(--color-good)] bg-[var(--color-good)] text-white" : "border-[var(--color-line-strong)] hover:border-[var(--color-good)]"}`}
        >
          {busy ? <Loader2 className="size-3 animate-spin" /> : isDone ? <Check className="size-3" /> : null}
        </button>
      ) : (
        <span className={`mt-1.5 size-2 shrink-0 rounded-full ${dot}`} />
      )}
      <Link href={i.href ?? "/tasks"} className="min-w-0 flex-1 hover:underline">
        <span className={`block truncate text-sm font-medium ${isDone ? "line-through" : ""}`}>
          {i.clientName ? <span className="text-[var(--color-ink)]">{i.clientName} · </span> : null}{i.title}
        </span>
        {i.detail ? <span className="block truncate text-xs text-[var(--color-ink-muted)]">{i.detail}</span> : null}
      </Link>
      {meta ? (
        <span className={`shrink-0 text-xs font-semibold ${i.state === "late" ? "text-[var(--color-bad)]" : "text-[var(--color-ink-muted)]"}`}>{meta}</span>
      ) : null}
    </li>
  );
}
