import Link from "next/link";
import { AlertTriangle, CalendarClock, Camera, FileSignature, ListChecks, Users } from "lucide-react";
import { Card, EmptyState } from "@/components/ui";
import { daysSince, daysUntil, formatDate, plural, relativeDays } from "@/lib/format";
import { editorLoad } from "@/lib/metrics";
import { isOwner, type Viewer } from "@/server/auth/context";
import type { DashboardData } from "@/server/dashboard";
import type { getMyDay } from "@/server/my-day";

type MyDay = Awaited<ReturnType<typeof getMyDay>>;
type Tone = "bad" | "warn" | "good" | "neutral";

/**
 * Het "Vandaag"-dashboard toont per rol maximaal drie blokken. Elke regel zegt
 * in één oogopslag: wát er speelt, bij wélke klant/persoon, wat de volgende
 * stap is en hoeveel dagen het al loopt. Nooit tweemaal hetzelfde item. Doel:
 * wie inlogt weet binnen een minuut wat als eerste moet, zonder te scrollen.
 *
 * Losse KPI-tegels, de dagindeling-strip en de pipelinegrafiek zijn hier bewust
 * weggelaten — die leidden af van de vraag "wat moet ik nú doen?".
 */

type Line = { key: string; href: string; what: string; action: string; meta: string; tone: Tone };
type Accent = "bad" | "warn" | "info" | "good" | "ink";
type Block = { key: string; title: string; subtitle?: string; icon: React.ReactNode; accent?: Accent; lines: Line[]; empty: string };

/** Functionele koptekst-kleur per blok, zodat blokken niet allemaal gelijk ogen. */
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

/** "Klant — Titel", maar niet "Klant — Klant" als de titel gelijk is. */
function label(clientName: string, title: string): string {
  return title.trim().toLowerCase() === clientName.trim().toLowerCase() ? clientName : `${clientName} — ${title}`;
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

export function TodayView({ viewer, data, myDay, capMap }: { viewer: Viewer; data: DashboardData; myDay: MyDay; capMap: Map<string, number> }) {
  const role = viewer.primaryRole;
  const ownerView = isOwner(viewer) || role === "admin" || role === "finance";
  const videographerView = role === "videographer";

  const blocks = ownerView
    ? ownerBlocks(data, capMap)
    : videographerView
      ? videographerBlocks(myDay)
      : creativeBlocks(data, myDay);

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      {blocks.map((b) => (
        <BlockCard key={b.key} block={b} />
      ))}
    </div>
  );
}

/* ---------------- Eigenaar / beheer ---------------- */
function ownerBlocks(data: DashboardData, capMap: Map<string, number>): Block[] {
  const urgentShoots = data.shoots.filter(
    (s) => daysUntil(s.scheduledOn) <= 2 && (Number(s.openBlockers) > 0 || Number(s.unapprovedScripts) > 0),
  );

  // Een video die al als "te laat" staat, niet nóg eens als "stil bij de klant"
  // tonen — één regel per video.
  const lateIds = new Set(data.videos.late.map((v) => v.id));
  const stalled = data.videos.stalledAtClient.filter((v) => daysSince(v.statusChangedAt) > 3 && !lateIds.has(v.id));

  const attention: Line[] = [
    ...data.videos.late.map((v) => {
      const d = Math.max(1, -daysUntil(v.dueOn));
      return {
        key: `late-${v.id}`,
        href: `/videos/${v.id}`,
        what: label(v.clientName, v.title),
        action: `Over de deadline · ${v.editorName ?? "geen editor"} → afmaken`,
        meta: `${plural(d, "dag", "dagen")} te laat`,
        tone: "bad" as const,
      };
    }),
    ...stalled.map((v) => ({
      key: `stall-${v.id}`,
      href: `/videos/${v.id}`,
      what: label(v.clientName, v.title),
      action: "Klant reageert niet → achterna bellen",
      meta: `${plural(daysSince(v.statusChangedAt), "dag", "dagen")} stil`,
      tone: "warn" as const,
    })),
    ...urgentShoots.map((s) => ({
      key: `ushoot-${s.id}`,
      href: `/productions/${s.id}`,
      what: `${s.clientName} — opname ${relativeDays(s.scheduledOn)}`,
      action: `Nog niet rond · ${s.videographerName ?? "geen videograaf"} → voorbereiden`,
      meta: `${Number(s.openBlockers) + Number(s.unapprovedScripts)} open`,
      tone: "warn" as const,
    })),
  ];

  // Klanten die actie nodig hebben — één regel per klant, geen dubbele.
  const seen = new Set<string>();
  const clientLines: Line[] = [];
  for (const c of data.clients.atRisk) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    clientLines.push({
      key: `risk-${c.id}`,
      href: `/clients/${c.slug}`,
      what: c.name,
      action: `${c.riskReason ?? "Risico"} → contact opnemen`,
      meta: "risico",
      tone: "bad",
    });
  }
  for (const q of data.clients.quotaGap) {
    if (seen.has(q.clientId)) continue;
    seen.add(q.clientId);
    clientLines.push({
      key: `gap-${q.clientId}`,
      href: `/clients/${q.clientSlug}`,
      what: q.clientName,
      action: `${q.published + q.inProgress} van ${q.quota} deze maand → opname of edit inplannen`,
      meta: `${q.gap} tekort`,
      tone: "warn",
    });
  }
  for (const c of data.clients.withoutShoot) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    clientLines.push({
      key: `noshoot-${c.id}`,
      href: `/clients/${c.slug}`,
      what: c.name,
      action: `Geen opname gepland${c.lastShoot ? ` · laatst ${formatDate(c.lastShoot)}` : ""} → opnamedag plannen`,
      meta: "plannen",
      tone: "warn",
    });
  }

  // Team & contracten — overbelaste editors en aflopende contracten.
  const teamLines: Line[] = [];
  for (const e of data.editors) {
    const { pct, level } = editorLoad(Number(e.open), capMap.get(e.editorId) ?? 0);
    if (level !== "hoog" && level !== "overbelast") continue;
    teamLines.push({
      key: `editor-${e.editorId}`,
      href: "/editing",
      what: e.editorName,
      action: level === "overbelast" ? "Overbelast → werk herverdelen" : "Hoge belasting → in de gaten houden",
      meta: pct != null ? `${pct}%` : `${e.open} open`,
      tone: level === "overbelast" ? "bad" : "warn",
    });
  }
  for (const c of data.contracts.slice(0, 5)) {
    const d = daysUntil(c.endsOn);
    teamLines.push({
      key: `contract-${c.id}`,
      href: `/clients/${c.clientSlug}?tab=contract`,
      what: c.clientName,
      action: `Contract loopt af · ${c.autoRenew ? "verlengt automatisch" : "verlengt niet"} → ${c.autoRenew ? "bevestigen" : "verlengen bespreken"}`,
      meta: `over ${d} d`,
      tone: d < 60 ? "bad" : "warn",
    });
  }

  return [
    { key: "attention", title: "Vraagt nu aandacht", subtitle: "Over de deadline, stil bij de klant of opname niet rond.", icon: <AlertTriangle className="size-5" strokeWidth={2.25} />, accent: "bad", lines: attention, empty: "Niets urgents — alles loopt op schema." },
    { key: "clients", title: "Klanten die actie nodig hebben", subtitle: "Risico, achterstand op de afspraak of geen opname.", icon: <Users className="size-5" />, accent: "warn", lines: clientLines.slice(0, 8), empty: "Alle klanten lopen op schema." },
    { key: "team", title: "Team & contracten", subtitle: "Capaciteit van editors en aflopende contracten.", icon: <FileSignature className="size-5" />, accent: "ink", lines: teamLines.slice(0, 8), empty: "Capaciteit in orde, geen contracten binnen 90 dagen." },
  ];
}

/* ---------------- Content Creative / coördinator ---------------- */
function creativeBlocks(data: DashboardData, myDay: MyDay): Block[] {
  const mine: Line[] = [
    ...myDay.tasks.map((t) => ({
      key: `task-${t.id}`,
      href: "/tasks",
      what: t.title,
      action: t.clientName ? `${t.clientName} → oppakken` : "Eigen taak → oppakken",
      meta: t.overdue ? "te laat" : t.dueOn ? relativeDays(t.dueOn) : "geen datum",
      tone: (t.overdue ? "bad" : t.priority === "urgent" || t.priority === "high" ? "warn" : "neutral") as Tone,
    })),
    ...myDay.videos.map((v) => ({
      key: `myvid-${v.id}`,
      href: `/videos/${v.id}`,
      what: label(v.clientName, v.title),
      action: "Jouw video → volgende stap zetten",
      meta: v.dueOn ? relativeDays(v.dueOn) : "",
      tone: "neutral" as Tone,
    })),
  ];

  const stalled = data.videos.stalledAtClient.filter((v) => daysSince(v.statusChangedAt) > 2);
  const waiting: Line[] = stalled.map((v) => ({
    key: `wait-${v.id}`,
    href: `/videos/${v.id}`,
    what: label(v.clientName, v.title),
    action: "Wacht op feedback van de klant → herinneren",
    meta: `${plural(daysSince(v.statusChangedAt), "dag", "dagen")} stil`,
    tone: daysSince(v.statusChangedAt) > 4 ? "bad" : "warn",
  }));

  const soon: Line[] = [
    ...data.shoots.slice(0, 5).map((s) => {
      const open = Number(s.openBlockers) + Number(s.unapprovedScripts);
      return {
        key: `shoot-${s.id}`,
        href: `/productions/${s.id}`,
        what: `${s.clientName} — opname`,
        action: open > 0 ? `${open} punt(en) open → voorbereiden` : "Rond → klaar voor opname",
        meta: relativeDays(s.scheduledOn),
        tone: (open > 0 && daysUntil(s.scheduledOn) <= 2 ? "warn" : "neutral") as Tone,
      };
    }),
    ...data.scripts.slice(0, 4).map((s) => ({
      key: `script-${s.id}`,
      href: `/scripting`,
      what: label(s.clientName, s.title),
      action: "Script ter goedkeuring → nakijken",
      meta: s.shootOn ? relativeDays(s.shootOn) : "",
      tone: "neutral" as Tone,
    })),
  ];

  return [
    { key: "mine", title: "Mijn acties vandaag", subtitle: "Jouw taken en video's die op jou wachten.", icon: <ListChecks className="size-5" />, accent: "info", lines: mine.slice(0, 8), empty: "Geen openstaande acties op jouw naam." },
    { key: "waiting", title: "Mijn klanten wachten", subtitle: "Video's die te lang bij de klant liggen.", icon: <Users className="size-5" />, accent: "warn", lines: waiting.slice(0, 8), empty: "Geen klanten die op feedback laten wachten." },
    { key: "soon", title: "Komende dagen", subtitle: "Opnames en scripts die eraan komen.", icon: <CalendarClock className="size-5" />, accent: "ink", lines: soon.slice(0, 8), empty: "Niets op de planning de komende dagen." },
  ];
}

/* ---------------- Videograaf ---------------- */
function videographerBlocks(myDay: MyDay): Block[] {
  const shoots: Line[] = myDay.shoots.map((s) => ({
    key: `shoot-${s.id}`,
    href: `/productions/${s.id}`,
    what: `${s.clientName}`,
    action: `${s.locationName ?? "locatie onbekend"}${s.startTime ? ` · ${s.startTime.slice(0, 5)}` : ""} → opnemen`,
    meta: relativeDays(s.scheduledOn),
    tone: (daysUntil(s.scheduledOn) <= 1 ? "warn" : "neutral") as Tone,
  }));

  // "Na de opname": opnames van gisteren/vandaag waarvan de beelden nog geüpload
  // moeten worden. We leiden dit af uit de eerstvolgende opnames niet; in plaats
  // daarvan tonen we de taken, die de uploadherinnering bevatten.
  const tasks: Line[] = myDay.tasks.map((t) => ({
    key: `task-${t.id}`,
    href: "/tasks",
    what: t.title,
    action: t.clientName ? `${t.clientName} → oppakken` : "Eigen taak → oppakken",
    meta: t.overdue ? "te laat" : t.dueOn ? relativeDays(t.dueOn) : "geen datum",
    tone: (t.overdue ? "bad" : t.priority === "urgent" || t.priority === "high" ? "warn" : "neutral") as Tone,
  }));

  return [
    { key: "shoots", title: "Mijn opnames", subtitle: "Jouw opnamedagen, eerstvolgende bovenaan.", icon: <Camera className="size-5" />, accent: "info", lines: shoots.slice(0, 8), empty: "Geen opnames op jouw naam de komende twee weken." },
    { key: "tasks", title: "Mijn taken", subtitle: "Beelden uploaden en andere acties op jouw naam.", icon: <ListChecks className="size-5" />, accent: "ink", lines: tasks.slice(0, 8), empty: "Geen openstaande taken." },
  ];
}

/* ---------------- Weergave ---------------- */
function BlockCard({ block }: { block: Block }) {
  const accent: Accent = block.accent ?? "ink";
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
