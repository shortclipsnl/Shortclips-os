import Link from "next/link";
import { AlertTriangle, CalendarClock, ListChecks } from "lucide-react";
import { Card, EmptyState } from "@/components/ui";
import { daysSince, daysUntil, plural } from "@/lib/format";
import { type Viewer } from "@/server/auth/context";
import type { DashboardData } from "@/server/dashboard";
import type { getMyDay } from "@/server/my-day";
import { Dagindeling, type ScheduleItem } from "./dagindeling";

/** Het vaste dagritme van het kantoorteam — loopt live mee: geweest = groen. */
const DAGINDELING: ScheduleItem[] = [
  { from: "08:30", to: "09:00", label: "Dagstart", detail: "Samen de dag doornemen: wat staat er op de planning en wat heeft prioriteit." },
  { from: "12:30", to: "13:00", label: "Pauze", detail: "Even weg van het scherm — tot 13:00." },
  { from: "13:00", to: "13:30", label: "Wat moet er vandaag echt af?", detail: "Check de belangrijkste deadlines en stem af waar nodig." },
  { from: "16:45", label: "To-do-lijst voor morgen maken", detail: "Zet klaar wat morgen als eerste moet, zodat je direct kunt starten." },
];

type MyDay = Awaited<ReturnType<typeof getMyDay>>;
type Tone = "bad" | "warn" | "good" | "neutral";

/** "wo 22 okt" — dagnaam + datum. */
function dayName(input: string | Date): string {
  const d = new Date(typeof input === "string" ? `${input.slice(0, 10)}T00:00:00` : input);
  return d.toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" });
}

/**
 * Het "Vandaag"-dashboard voor het kantoorteam (Jarno, Milou, Jiska, Rutger):
 * precies twee blokken onder elkaar — je eigen to-do's (uit de takenpagina) en
 * de editing die nu aandacht vraagt (te laat, wacht op klant). Meer hoeft er op
 * vandaag niet te staan.
 */
type Line = { key: string; href: string; what: string; action: string; meta: string; tone: Tone };
type Accent = "bad" | "warn" | "info" | "good" | "ink";
type Block = { key: string; title: string; subtitle?: string; icon: React.ReactNode; accent: Accent; lines: Line[]; empty: string };

const BLOCK_HEADER: Record<Accent, string> = {
  bad: "bg-[var(--color-bad)]",
  warn: "bg-[var(--color-warn)]",
  info: "bg-[var(--color-brand-600)]",
  good: "bg-[var(--color-good)]",
  ink: "bg-[var(--color-indigo-ink)]",
};
const BLOCK_RING: Record<Accent, string> = {
  bad: "ring-1 ring-[var(--color-bad)]/25 border-[var(--color-bad)]/40",
  warn: "ring-1 ring-[var(--color-warn)]/25",
  info: "ring-1 ring-[var(--color-brand-600)]/20",
  good: "ring-1 ring-[var(--color-good)]/20",
  ink: "ring-1 ring-[var(--color-indigo-ink)]/10",
};

/** Ruwe ISO-datums (2026-10-20) in een titel vervangen door een leesbare datum. */
function prettyTitle(title: string): string {
  return title.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_, y, m, d) =>
    new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString("nl-NL", { day: "numeric", month: "short" }),
  );
}
function label(clientName: string, title: string): string {
  const t = prettyTitle(title);
  return t.trim().toLowerCase() === clientName.trim().toLowerCase() ? clientName : `${clientName} — ${t}`;
}

const DOT: Record<Tone, string> = {
  bad: "bg-[var(--color-bad)]",
  warn: "bg-[var(--color-warn)]",
  good: "bg-[var(--color-good)]",
  neutral: "bg-[var(--color-ink-faint)]",
};
const META: Record<Tone, string> = {
  bad: "text-[var(--color-bad)]",
  warn: "text-[var(--color-warn)]",
  good: "text-[var(--color-good)]",
  neutral: "text-[var(--color-ink-muted)]",
};

export function TodayView({ data, myDay }: { viewer: Viewer; data: DashboardData; myDay: MyDay; capMap: Map<string, number> }) {
  const blocks = officeBlocks(data, myDay);
  return (
    // Links de twee werkblokken (Mijn to-do + Editing), rechts de live dagindeling.
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(280px,340px)]">
      {blocks.map((b) => (
        <BlockCard key={b.key} block={b} />
      ))}
      <DagindelingCard />
    </div>
  );
}

function DagindelingCard() {
  return (
    <Card padded={false} className="overflow-hidden ring-1 ring-[var(--color-good)]/20">
      <div className="flex items-center gap-2.5 bg-[var(--color-good)] px-5 py-3 text-white">
        <CalendarClock className="size-5 shrink-0 opacity-90" />
        <div className="min-w-0">
          <h2 className="truncate text-base font-bold tracking-tight">Dagindeling</h2>
          <p className="truncate text-xs text-white/70">Het dagritme — geweest wordt groen.</p>
        </div>
      </div>
      <Dagindeling items={DAGINDELING} />
    </Card>
  );
}

function officeBlocks(data: DashboardData, myDay: MyDay): Block[] {
  // 1) Mijn to-do — de eigen taken van deze medewerker (uit de takenpagina).
  const todo: Line[] = myDay.tasks.map((t) => ({
    key: `task-${t.id}`,
    href: "/tasks",
    what: prettyTitle(t.title),
    action: t.clientName ? `${t.clientName} → oppakken` : "Eigen taak → oppakken",
    meta: t.dueOn ? `${dayName(t.dueOn)}${t.overdue ? " · te laat" : ""}` : "",
    tone: (t.overdue ? "bad" : t.priority === "urgent" || t.priority === "high" ? "warn" : "neutral") as Tone,
  }));

  // 2) Editing die aandacht vraagt — te laat en wacht op klant (één regel per video).
  const lateIds = new Set(data.videos.late.map((v) => v.id));
  const stalled = data.videos.stalledAtClient.filter((v) => !lateIds.has(v.id));
  const editing: Line[] = [
    // Al gesorteerd op dueOn (meest te laat eerst). Onderscheid in ernst: licht
    // over de deadline (1–2 dagen) oranje, langer te laat rood.
    ...data.videos.late.map((v) => {
      const dagenTeLaat = Math.max(1, -daysUntil(v.dueOn));
      return {
        key: `late-${v.id}`,
        href: `/videos/${v.id}`,
        what: label(v.clientName, v.title),
        action: `Over de deadline · ${v.editorName ?? "geen editor"} → afmaken`,
        meta: `${plural(dagenTeLaat, "dag", "dagen")} te laat`,
        tone: (dagenTeLaat >= 3 ? "bad" : "warn") as Tone,
      };
    }),
    ...stalled.map((v) => ({
      key: `wait-${v.id}`,
      href: `/videos/${v.id}`,
      what: label(v.clientName, v.title),
      action: "Wacht op klantfeedback → herinneren",
      meta: `${plural(daysSince(v.statusChangedAt), "dag", "dagen")} stil`,
      tone: (daysSince(v.statusChangedAt) > 4 ? "bad" : "warn") as Tone,
    })),
  ];

  return [
    { key: "todo", title: "Mijn to-do", subtitle: "Jouw taken van de takenpagina.", icon: <ListChecks className="size-5" />, accent: "info", lines: todo.slice(0, 15), empty: "Geen openstaande taken op jouw naam." },
    { key: "editing", title: "Editing Deadlines", subtitle: "Over de deadline en wacht op klantfeedback — pak dit als eerste op. Live uit het Editing-dashboard.", icon: <AlertTriangle className="size-5" strokeWidth={2.25} />, accent: "bad", lines: editing.slice(0, 15), empty: "Geen editing die nu over de deadline is." },
  ];
}

function BlockCard({ block }: { block: Block }) {
  const accent = block.accent;
  return (
    <Card padded={false} className={`overflow-hidden ${BLOCK_RING[accent]}`}>
      <div className={`flex items-center gap-2.5 px-5 py-3 text-white ${BLOCK_HEADER[accent]}`}>
        <span className="shrink-0 opacity-90">{block.icon}</span>
        <div className="min-w-0">
          <h2 className="truncate text-base font-bold tracking-tight">{block.title}</h2>
          {block.subtitle ? <p className="truncate text-xs text-white/70">{block.subtitle}</p> : null}
        </div>
        {block.lines.length > 0 ? (
          <span className="ml-auto shrink-0 rounded-full bg-white/20 px-2.5 py-0.5 text-sm font-semibold">{block.lines.length}</span>
        ) : null}
      </div>
      {block.lines.length === 0 ? (
        <EmptyState title={block.empty} />
      ) : (
        <ul className="divide-y divide-[var(--color-line)]">
          {block.lines.map((l) => (
            <li key={l.key}>
              <Link href={l.href} className="sc-row-link flex items-center gap-3 px-5 py-3">
                <span className={`size-2.5 shrink-0 rounded-full ${DOT[l.tone]}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{l.what}</span>
                  <span className="block truncate text-xs text-[var(--color-ink-muted)]">{l.action}</span>
                </span>
                {l.meta ? <span className={`shrink-0 text-xs font-semibold ${META[l.tone]}`}>{l.meta}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
