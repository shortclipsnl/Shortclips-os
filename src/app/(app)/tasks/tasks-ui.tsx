"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowUpRight, BarChart3, BellRing, CalendarClock, Gift, Check, Copy, Loader2, Lock, Pencil, Plus, Send, Trash2, X } from "lucide-react";
import { createTask, createTasksBulk, deleteTask, setTaskStatus, updateTask } from "@/server/actions/tasks";
import { Button, ClientLogo, ErrorNote, LinkButton, TeamAvatar } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { TaskSignal } from "@/lib/task-signals";

/**
 * Kort, vrolijk "belletje" wanneer een taak wordt afgevinkt — puur via de Web
 * Audio API, dus geen geluidsbestand nodig. Twee oplopende tonen = positief.
 * Alles in try/catch: als audio geblokkeerd is, gebeurt er simpelweg niets.
 */
let _audioCtx: AudioContext | null = null;
function playDing() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    _audioCtx = _audioCtx ?? new Ctx();
    const ctx = _audioCtx;
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime;
    [880, 1318.5].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = now + i * 0.1;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.16, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.3);
    });
  } catch {
    /* audio niet beschikbaar — stil doorgaan */
  }
}

export type UserOption = { id: string; fullName: string };
export type ClientOption = { id: string; name: string };

export type TaskItemData = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  category: string;
  dueOn: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeAvatar: string | null;
  clientName: string | null;
  clientSlug: string | null;
  clientColor: string | null;
  clientLogo: string | null;
  /** Waar de taak over gaat (bijv. de scriptsessie op Scripting), of null. */
  href?: string | null;
  /** Automatische melding (feedbackherinnering, maandrapportage) → compacte weergave met actieknop. */
  signal?: TaskSignal | null;
  /** Mag de kijker deze taak aanpassen? Taken van collega's zijn alleen-lezen. */
  canEdit?: boolean;
};

/** Vandaag in Nederlandse tijd als YYYY-MM-DD. */
function todayNL(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
}

/** Compacte deadline: "Vandaag", "Morgen", "Verlopen · di 11 nov" of "do 20 nov". */
function DueBadge({ dueOn, done }: { dueOn: string | null; done: boolean }) {
  if (!dueOn) return null;
  const today = todayNL();
  const tomorrow = new Date(new Date(`${today}T12:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
  const label = new Date(`${dueOn}T12:00:00Z`).toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  let text = label;
  let tone = "bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]";
  if (!done) {
    if (dueOn < today) {
      text = `Verlopen · ${label}`;
      tone = "bg-[var(--color-bad-soft)] text-[var(--color-bad)]";
    } else if (dueOn === today) {
      text = "Vandaag";
      tone = "bg-[var(--color-warn-soft)] text-[#8a5300]";
    } else if (dueOn === tomorrow) {
      text = "Morgen";
    }
  }
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-semibold tabular-nums", tone)} title={`Deadline: ${label}`}>
      <CalendarClock className="size-3" />
      {text}
    </span>
  );
}

/** Kleur van de statusregel van een maandrapportagetaak (oranje = wacht op cijfers of aanpassing). */
function rapportStatusTone(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("voorlopig") || s.includes("definitieve") || s.includes("aanpassing")) return "bg-[var(--color-warn-soft)] text-[#8a5300]";
  if (s.startsWith("goedgekeurd")) return "bg-[var(--color-good-soft)] text-[var(--color-good)]";
  return "bg-[var(--color-info-soft)] text-[var(--color-info)]";
}

const PRIORITIES = [
  { value: "low", label: "Laag" },
  { value: "normal", label: "Normaal" },
  { value: "high", label: "Hoog" },
  { value: "urgent", label: "Urgent" },
];

/** Soort taak — nog maar twee keuzes voor de groepering op de takenpagina. */
export const TASK_CATEGORIES = [
  { value: "klantcontact", label: "Klantcontact" },
  { value: "werkzaamheden", label: "Werkzaamheden" },
];
export const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(TASK_CATEGORIES.map((c) => [c.value, c.label]));
/** Oude categorieën (scripting/overig) tonen we als "Werkzaamheden". */
const normCategory = (c: string) => (c === "klantcontact" ? "klantcontact" : "werkzaamheden");

const prioDot: Record<string, string> = {
  low: "var(--color-ink-faint)",
  normal: "var(--color-info)",
  high: "var(--color-warn)",
  urgent: "var(--color-bad)",
};

/** Supersnelle invoer: typ taken, één per regel. Elke regel wordt een taak.
 *  `compact` maakt het vak kleiner, zodat de nadruk op de takenlijst blijft. */
export function QuickTaskLines({ users, defaultAssignee, compact = false }: { users: UserOption[]; defaultAssignee?: string; compact?: boolean }) {
  const [lines, setLines] = useState("");
  const [assigneeId, setAssigneeId] = useState(defaultAssignee ?? "");
  const [category, setCategory] = useState("werkzaamheden");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function add() {
    if (!lines.trim()) return;
    start(async () => {
      const res = await createTasksBulk({ lines, assigneeId: assigneeId || null, category });
      if (res.ok) {
        setLines("");
        // Overgeslagen dubbele taken blijven zichtbaar als melding.
        setErr(res.message ?? null);
        router.refresh();
      } else {
        setErr(res.message ?? "Mislukt");
      }
    });
  }

  const count = lines.split(/\r?\n/).filter((l) => l.replace(/^[-*•\s]+/, "").trim().length > 0).length;

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-[var(--color-ink-muted)]">{compact ? "Nieuwe taak toevoegen — één per regel:" : "Snel toevoegen — typ taken, één per regel:"}</span>
        <label className="ml-auto flex items-center gap-1.5 text-2xs font-medium text-[var(--color-ink-faint)]">
          Soort
          <select className="sc-input h-8 w-36 py-0 text-xs" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Soort taak">
            {TASK_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-2xs font-medium text-[var(--color-ink-faint)]">
          Voor wie
          <select className="sc-input h-8 w-44 py-0 text-xs" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} aria-label="Toewijzen aan">
            <option value="">Algemeen / niet toegewezen</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.fullName}</option>
            ))}
          </select>
        </label>
      </div>
      <textarea
        className="sc-input resize-y text-sm leading-relaxed"
        rows={compact ? 2 : 4}
        placeholder={"• Montage Koops afmaken\n• Script Luxewagen inplannen\n• Feedback KKFH verwerken"}
        value={lines}
        onChange={(e) => setLines(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) add();
        }}
      />
      <div className="mt-2 flex items-center gap-3">
        <Button onClick={add} disabled={pending || count === 0} size="sm">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          {count > 0 ? `${count} ${count === 1 ? "taak" : "taken"} toevoegen` : "Toevoegen"}
        </Button>
        <span className="text-xs text-[var(--color-ink-faint)]">Tip: ⌘/Ctrl + Enter om toe te voegen.</span>
      </div>
      {err ? <div className="mt-2"><ErrorNote>{err}</ErrorNote></div> : null}
    </div>
  );
}

export function NewTaskForm({ users, clients }: { users: UserOption[]; clients: ClientOption[] }) {
  const [title, setTitle] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [clientId, setClientId] = useState("");
  const [priority, setPriority] = useState("normal");
  const [dueOn, setDueOn] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function add() {
    if (!title.trim()) return;
    start(async () => {
      const res = await createTask({
        title,
        assigneeId: assigneeId || null,
        clientId: clientId || null,
        priority: priority as "normal",
        dueOn: dueOn || null,
      });
      if (res.ok) {
        setTitle("");
        setDueOn("");
        setErr(null);
        router.refresh();
      } else {
        setErr(res.message ?? "Mislukt");
      }
    });
  }

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="sc-input min-w-48 flex-1"
          placeholder="Nieuwe taak…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
        />
        <select className="sc-input w-36" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} aria-label="Toewijzen aan">
          <option value="">Algemeen</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.fullName}</option>
          ))}
        </select>
        <select className="sc-input w-36" value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="Klant">
          <option value="">Intern</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select className="sc-input w-28" value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Prioriteit">
          {PRIORITIES.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
        <input className="sc-input w-36" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} aria-label="Deadline" />
        <Button onClick={add} disabled={pending || !title.trim()} size="sm">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Toevoegen
        </Button>
      </div>
      {err ? <div className="mt-2"><ErrorNote>{err}</ErrorNote></div> : null}
    </div>
  );
}

const PRAISE = ["Goed bezig", "Lekker bezig", "Weer eentje af", "Alweer afgerond", "Topper"];

export function TaskItem({
  task,
  users,
  canWrite,
  celebrateName,
}: {
  task: TaskItemData;
  users: UserOption[];
  canWrite: boolean;
  celebrateName?: string;
}) {
  const [pending, start] = useTransition();
  const [justDone, setJustDone] = useState(false);
  const [optimisticDone, setOptimisticDone] = useState(false);
  const [celebration, setCelebration] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [reminderCopied, setReminderCopied] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);
  // Bewerkvelden — voorgevuld met de huidige taakgegevens.
  const [eTitle, setETitle] = useState(task.title);
  const [eDesc, setEDesc] = useState(task.description ?? "");
  const [eDue, setEDue] = useState(task.dueOn ?? "");
  const [eAssignee, setEAssignee] = useState(task.assigneeId ?? "");
  const [ePriority, setEPriority] = useState(task.priority);
  const [eCategory, setECategory] = useState(normCategory(task.category));
  const router = useRouter();
  const done = task.status === "done" || optimisticDone;
  // Taken van een collega: wel bekijken, niet afvinken, bewerken of verwijderen.
  const editable = canWrite && task.canEdit !== false;

  function run(fn: () => Promise<unknown>) {
    start(async () => {
      await fn();
      router.refresh();
    });
  }

  function openEdit() {
    // Altijd vanaf de actuele taakgegevens starten.
    setETitle(task.title);
    setEDesc(task.description ?? "");
    setEDue(task.dueOn ?? "");
    setEAssignee(task.assigneeId ?? "");
    setEPriority(task.priority);
    setECategory(normCategory(task.category));
    setEditErr(null);
    setEditing(true);
  }

  function saveEdit() {
    if (!eTitle.trim()) { setEditErr("Geef de taak een titel."); return; }
    start(async () => {
      const res = await updateTask(task.id, {
        title: eTitle.trim(),
        description: eDesc.trim() || null,
        dueOn: eDue || null,
        assigneeId: eAssignee || null,
        priority: ePriority as "normal",
        category: normCategory(eCategory),
      });
      if (res.ok) { setEditing(false); router.refresh(); }
      else setEditErr(res.message ?? "Opslaan mislukt.");
    });
  }

  async function copyDescription() {
    if (!task.description) return;
    try { await navigator.clipboard.writeText(task.description); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* klembord niet beschikbaar */ }
  }

  async function copyReminder(message: string) {
    try { await navigator.clipboard.writeText(message); } catch { /* klembord niet beschikbaar */ }
    setReminderCopied(true);
  }

  function toggleDone() {
    if (!done) {
      // Afvinken: meteen groen vinkje + geluidje + een kort schouderklopje, en
      // pas ná de viering de lijst verversen (anders springt de taak direct weg).
      playDing();
      setOptimisticDone(true);
      setJustDone(true);
      const name = celebrateName?.trim();
      const msg = PRAISE[Math.floor(Math.random() * PRAISE.length)];
      setCelebration(name ? `${msg}, ${name}! 🎉` : `${msg}! 🎉`);
      setTimeout(() => setJustDone(false), 600);
      void (async () => {
        await setTaskStatus(task.id, "done");
        await new Promise((r) => setTimeout(r, 1700));
        setCelebration(null);
        router.refresh();
      })();
      return;
    }
    // Heropenen.
    setOptimisticDone(false);
    run(() => setTaskStatus(task.id, "todo"));
  }

  const signal = task.signal ?? null;
  const signalAccent = signal?.kind === "maandrapport" ? "var(--color-brand-500)" : signal?.kind === "klantmoment" ? "var(--color-indigo-ink)" : "var(--color-warn)";

  // Gedeelde onderdelen van de taakregel (gewone taak en automatische melding).
  // Afvinkknop met positief belletje bij afronden.
  const checkbox = (
    <>
      <button
        type="button"
        disabled={!editable || pending}
        onClick={toggleDone}
        aria-pressed={done}
        aria-label={done ? `Taak heropenen: ${task.title}` : `Taak afronden: ${task.title}`}
        className={cn(
          "grid size-6 shrink-0 place-items-center rounded-full border-2 transition-all duration-150 disabled:opacity-50",
          done
            ? "border-[var(--color-good)] bg-[var(--color-good)] text-white"
            : "border-[var(--color-line-strong)] text-transparent hover:border-[var(--color-good)] hover:text-[var(--color-good)]/40",
          justDone && "scale-125",
        )}
      >
        {pending ? <Loader2 className="size-3.5 animate-spin text-[var(--color-ink-faint)]" /> : <Check className="size-3.5" strokeWidth={3} />}
      </button>
    </>
  );
  const prioBadge = (
    <>
      {task.priority !== "normal" ? (
        <span
          className="inline-flex shrink-0 items-center gap-1 text-2xs font-medium"
          style={{ color: prioDot[task.priority] }}
          title={`Prioriteit: ${PRIORITIES.find((p) => p.value === task.priority)?.label}`}
        >
          <span className="size-2 rounded-full" style={{ background: prioDot[task.priority] }} />
          {PRIORITIES.find((p) => p.value === task.priority)?.label}
        </span>
      ) : null}

    </>
  );
  const avatarEl = (
    <>
      {task.assigneeName ? (
        <span className="hidden shrink-0 items-center gap-1.5 text-xs text-[var(--color-ink-muted)] sm:inline-flex" title={`Toegewezen aan ${task.assigneeName}`}>
          <TeamAvatar name={task.assigneeName} avatarUrl={task.assigneeAvatar} size={28} />
        </span>
      ) : null}

    </>
  );
  const actionsEl = (
    <>
      {editable ? (
        <>
          <button
            type="button"
            disabled={pending}
            onClick={() => (editing ? setEditing(false) : openEdit())}
            className="shrink-0 rounded p-1.5 text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
            aria-label={editing ? "Bewerken sluiten" : "Taak bewerken"}
            title={editing ? "Bewerken sluiten" : "Taak bewerken"}
          >
            {editing ? <X className="size-4" /> : <Pencil className="size-4" />}
          </button>

          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => deleteTask(task.id))}
            className="shrink-0 rounded p-1.5 text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-bad)]"
            aria-label="Taak verwijderen"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
          </button>
        </>
      ) : canWrite ? (
        <span className="shrink-0 p-1.5 text-[var(--color-ink-faint)]" title="Taak van een collega: alleen bekijken" aria-label="Alleen bekijken">
          <Lock className="size-3.5" />
        </span>
      ) : null}
    </>
  );

  return (
    <li className="relative px-4 py-2.5">
      {celebration ? (
        <span className="pointer-events-none absolute left-9 top-0 z-10 -translate-y-1.5 whitespace-nowrap rounded-full bg-[var(--color-good)] px-2.5 py-1 text-xs font-semibold text-white shadow-[var(--shadow-raised)] [animation:scNotifIn_.2s_ease-out]">
          {celebration}
        </span>
      ) : null}
      {signal ? (
        <div
          className="flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-l-[3px] px-3 py-2"
          style={{
            borderColor: `color-mix(in srgb, ${signalAccent} 30%, transparent)`,
            borderLeftColor: signalAccent,
            background: `color-mix(in srgb, ${signalAccent} 8%, transparent)`,
          }}
        >
      {checkbox}
      <span
        className="grid size-8 shrink-0 place-items-center rounded-full"
        style={{ color: signalAccent, background: `color-mix(in srgb, ${signalAccent} 18%, transparent)` }}
        aria-hidden
      >
        {signal?.kind === "maandrapport" ? <BarChart3 className="size-4" /> : signal?.kind === "klantmoment" ? <Gift className="size-4" /> : <BellRing className="size-4" />}
      </span>
      <span className="min-w-40 flex-1">
        {task.href ? (
          <Link href={task.href} className={cn("group/tl flex w-fit items-center gap-1 text-sm font-semibold hover:text-[var(--color-brand-600)] hover:underline", done && "text-[var(--color-ink-faint)] line-through")} title="Open waar deze melding over gaat">
            {signal?.title}
            <ArrowUpRight className="size-3.5 shrink-0 text-[var(--color-ink-faint)] group-hover/tl:text-[var(--color-brand-600)]" />
          </Link>
        ) : (
          <span className={cn("block text-sm font-semibold", done && "text-[var(--color-ink-faint)] line-through")}>{signal?.title}</span>
        )}
        <span className="mt-0.5 block text-xs text-[var(--color-ink-muted)]">
          {signal?.text}
          {signal?.meta ? <span className="text-[var(--color-ink-faint)]"> · {signal.meta}</span> : null}
        </span>
        {signal?.kind === "maandrapport" && signal.status && !done ? (
          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-2xs">
            <span className="text-[var(--color-ink-faint)]">Status:</span>
            <span className={cn("rounded-full px-2 py-0.5 font-medium", rapportStatusTone(signal.status))}>{signal.status}</span>
          </span>
        ) : null}
      </span>
      <DueBadge dueOn={task.dueOn} done={done} />
      {prioBadge}
      {avatarEl}
      {!done && signal?.kind === "feedback" ? (
        reminderCopied ? (
          <span className="flex shrink-0 items-center gap-2">
            <span className="hidden text-2xs font-medium text-[var(--color-good)] sm:inline">Bericht gekopieerd</span>
            {editable ? (
              <Button size="sm" onClick={toggleDone} disabled={pending}>
                <Check className="size-4" /> Verstuurd, afronden
              </Button>
            ) : null}
          </span>
        ) : (
          <Button size="sm" onClick={() => copyReminder(signal.message)} title="Kopieert een vriendelijk herinneringsbericht om in WhatsApp te plakken">
            <Send className="size-4" /> Herinnering versturen
          </Button>
        )
      ) : null}
      {!done && signal?.kind === "maandrapport" ? (
        <LinkButton size="sm" href={signal.actionHref}>
          <BarChart3 className="size-4" /> Bekijk rapportage
        </LinkButton>
      ) : null}
      {!done && signal?.kind === "klantmoment" && signal.actionHref ? (
        <LinkButton size="sm" variant="secondary" href={signal.actionHref}>
          <Gift className="size-4" /> Naar klant
        </LinkButton>
      ) : null}
      {actionsEl}
        </div>
      ) : (
      <div className="flex flex-wrap items-center gap-3">
      {checkbox}
      <span className="min-w-40 flex-1">
        {task.href ? (
          <Link href={task.href} className={cn("group/tl flex w-fit items-center gap-1 text-sm font-medium hover:text-[var(--color-brand-600)] hover:underline", done && "text-[var(--color-ink-faint)] line-through")} title="Open waar deze taak over gaat">
            {task.title}
            <ArrowUpRight className="size-3.5 shrink-0 text-[var(--color-ink-faint)] group-hover/tl:text-[var(--color-brand-600)]" />
          </Link>
        ) : (
          <span className={cn("block text-sm font-medium", done && "text-[var(--color-ink-faint)] line-through")}>
            {task.title}
          </span>
        )}
        {task.clientSlug ? (
          <Link href={`/clients/${task.clientSlug}`} className="mt-0.5 inline-flex items-center gap-1 text-xs text-[var(--color-ink-muted)] hover:underline">
            <ClientLogo name={task.clientName ?? "?"} logoUrl={task.clientLogo} color={task.clientColor} size={14} />
            {task.clientName}
          </Link>
        ) : (
          <span className="mt-0.5 block text-xs text-[var(--color-ink-faint)]">intern</span>
        )}
      </span>

      {/* Prioriteit als kleine stip — rustig in de regel, details in bewerken. */}
      <DueBadge dueOn={task.dueOn} done={done} />
      {prioBadge}
      {avatarEl}
      {actionsEl}
      </div>
      )}

      {/* Beschrijving (bv. het voorbeeldbericht bij een na-opname-taak) met een
          kopieerknop — zichtbaar zolang je niet aan het bewerken bent. */}
      {task.description && !editing && !signal ? (
        <div className="mt-2 ml-9 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface-2)] p-2.5">
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-[var(--color-ink-muted)]">{task.description}</p>
          <button
            type="button"
            onClick={copyDescription}
            className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-[var(--color-surface)] px-2.5 py-1 text-2xs font-semibold text-[var(--color-ink)] ring-1 ring-[var(--color-line)] hover:brightness-95"
          >
            {copied ? <><Check className="size-3 text-[var(--color-good)]" /> Gekopieerd</> : <><Copy className="size-3" /> Kopieer bericht</>}
          </button>
        </div>
      ) : null}

      {/* Bewerkformulier — voorgevuld, wijzigt de bestaande taak direct. */}
      {editing && editable ? (
        <div className="mt-2 ml-9 space-y-2 rounded-[var(--radius-md)] border border-[var(--color-line-strong)] bg-[var(--color-surface-2)] p-3">
          <div>
            <label className="mb-0.5 block text-2xs font-medium text-[var(--color-ink-faint)]">Titel</label>
            <input className="sc-input w-full" value={eTitle} onChange={(e) => setETitle(e.target.value)} placeholder="Titel van de taak" />
          </div>
          <div>
            <label className="mb-0.5 block text-2xs font-medium text-[var(--color-ink-faint)]">Beschrijving</label>
            <textarea className="sc-input w-full resize-y text-sm leading-relaxed" rows={3} value={eDesc} onChange={(e) => setEDesc(e.target.value)} placeholder="Extra toelichting (optioneel)" />
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-0.5 block text-2xs font-medium text-[var(--color-ink-faint)]">Deadline</label>
              <input className="sc-input w-40" type="date" value={eDue} onChange={(e) => setEDue(e.target.value)} />
            </div>
            <div>
              <label className="mb-0.5 block text-2xs font-medium text-[var(--color-ink-faint)]">Verantwoordelijke</label>
              <select className="sc-input w-40" value={eAssignee} onChange={(e) => setEAssignee(e.target.value)}>
                <option value="">Algemeen</option>
                {users.map((u) => (<option key={u.id} value={u.id}>{u.fullName}</option>))}
              </select>
            </div>
            <div>
              <label className="mb-0.5 block text-2xs font-medium text-[var(--color-ink-faint)]">Prioriteit</label>
              <select className="sc-input w-28" value={ePriority} onChange={(e) => setEPriority(e.target.value)}>
                {PRIORITIES.map((p) => (<option key={p.value} value={p.value}>{p.label}</option>))}
              </select>
            </div>
            <div>
              <label className="mb-0.5 block text-2xs font-medium text-[var(--color-ink-faint)]">Soort</label>
              <select className="sc-input w-36" value={eCategory} onChange={(e) => setECategory(e.target.value)}>
                {TASK_CATEGORIES.map((c) => (<option key={c.value} value={c.value}>{c.label}</option>))}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={saveEdit} disabled={pending || !eTitle.trim()}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Opslaan
            </Button>
            <button type="button" onClick={() => setEditing(false)} className="rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
              Annuleren
            </button>
          </div>
          {editErr ? <ErrorNote>{editErr}</ErrorNote> : null}
        </div>
      ) : null}
    </li>
  );
}
