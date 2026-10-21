"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, ChevronDown, Loader2, Pencil } from "lucide-react";
import type { GoalRow, GoalsOverview } from "@/server/goals/overview";
import type { GoalStatus } from "@/server/goals/status";
import { archiveGoal, seedGoalsNow, setGoalOwner, setGoalTarget, toggleGoalMilestone, updateGoalStand } from "@/server/actions/goals";

type TeamMember = { id: string; name: string };

const STATUS_META: Record<GoalStatus, { label: string; color: string }> = {
  op_koers: { label: "Op koers", color: "var(--color-good)" },
  risico: { label: "Risico", color: "var(--color-warn)" },
  achter: { label: "Achter", color: "var(--color-bad)" },
  niet_bijgewerkt: { label: "Niet bijgewerkt", color: "#8b5cf6" },
  gepland: { label: "Gepland", color: "var(--color-info)" },
  gehaald: { label: "Gehaald", color: "var(--color-good)" },
};
const TILE_ORDER: GoalStatus[] = ["op_koers", "risico", "achter", "niet_bijgewerkt", "gepland", "gehaald"];

const BRON: Record<string, string> = {
  new_clients_q4: "Onze klanten",
  leads_weekly: "Leads",
  scripts_without_jarno: "Scripting",
  shoots_through_dec: "Opnameplanning",
  ontime_rate: "Editing",
  production_without_jarno: "Taken en Editing",
  results_coverage: "Resultatenoverzicht",
};

function fmt(n: number, unit: string | null): string {
  if (unit === "euro") return `€ ${Math.round(n).toLocaleString("nl-NL")}`;
  if (unit === "%") return `${Math.round(n)}%`;
  return `${Math.round(n * 10) / 10}`;
}
function daysAgo(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function DoelenLegeStaat({ isOwner }: { isOwner: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-8 text-center">
      <h2 className="text-base font-semibold">De Q4-doelen staan nog niet klaar</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-[var(--color-ink-muted)]">
        {isOwner
          ? "Plaats de 22 doelen voor dit kwartaal. Daarna wijs je per doel een eigenaar toe en werkt de status zich vanzelf bij."
          : "De doelen voor dit kwartaal worden binnenkort geplaatst door Jarno."}
      </p>
      {isOwner ? (
        <>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await seedGoalsNow();
                setMsg(r.message ?? null);
                if (r.ok) router.refresh();
              })
            }
            className="mt-4 inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-indigo-ink)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Plaats de Q4-doelen
          </button>
          {msg ? <p className="mt-2 text-xs text-[var(--color-ink-muted)]">{msg}</p> : null}
        </>
      ) : null}
    </div>
  );
}

export function DoelenBoard({ overview, isOwner, viewerId, team }: { overview: GoalsOverview; isOwner: boolean; viewerId: string; team: TeamMember[] }) {
  const [filter, setFilter] = useState<string>("alles");

  // Lege staat: de doelen staan nog niet in deze omgeving.
  if (overview.rows.length === 0) {
    return <DoelenLegeStaat isOwner={isOwner} />;
  }

  const rows = useMemo(() => {
    if (filter === "alles") return overview.rows;
    if (filter === "mijn") return overview.rows.filter((r) => r.ownerId === viewerId);
    if (filter === "aandacht") return overview.rows.filter((r) => ["achter", "risico", "niet_bijgewerkt"].includes(r.status));
    return overview.rows.filter((r) => r.pillar === filter);
  }, [overview.rows, filter, viewerId]);

  const pillars = useMemo(() => {
    const keys = [...new Set(rows.map((r) => r.pillar))];
    return overview.pillars.filter((p) => keys.includes(p.key)).map((p) => ({ ...p, rows: rows.filter((r) => r.pillar === p.key) }));
  }, [overview.pillars, rows]);

  const FILTERS: { key: string; label: string }[] = [
    { key: "alles", label: "Alles" },
    ...overview.pillars.map((p) => ({ key: p.key, label: p.label })),
    { key: "mijn", label: "Mijn doelen" },
    { key: "aandacht", label: "Alleen aandacht" },
  ];

  return (
    <div className="space-y-5">
      {/* Statustegels */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {TILE_ORDER.map((s) => (
          <div key={s} className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3" style={{ boxShadow: `inset 3px 0 0 ${STATUS_META[s].color}` }}>
            <div className="text-2xl font-bold tabular-nums" style={{ color: STATUS_META[s].color }}>{overview.counts[s]}</div>
            <div className="text-2xs font-medium uppercase tracking-wide text-[var(--color-ink-muted)]">{STATUS_META[s].label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" onClick={() => setFilter(f.key)}
            className={filter === f.key
              ? "rounded-full bg-[var(--color-indigo-ink)] px-3 py-1 text-xs font-semibold text-white"
              : "rounded-full border border-[var(--color-line-strong)] px-3 py-1 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}>
            {f.label}
          </button>
        ))}
      </div>

      {pillars.length === 0 ? (
        <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line-strong)] px-4 py-8 text-center text-sm text-[var(--color-ink-muted)]">Geen doelen in deze weergave.</div>
      ) : (
        pillars.map((p) => <PillarBlock key={p.key} pillar={p} isOwner={isOwner} team={team} />)
      )}

      <MeldingUitleg />
    </div>
  );
}

function PillarBlock({ pillar, isOwner, team }: { pillar: GoalsOverview["pillars"][number]; isOwner: boolean; team: TeamMember[] }) {
  const hasRood = pillar.rows.some((r) => r.status === "achter");
  const [open, setOpen] = useState(hasRood);
  const summary = (["op_koers", "risico", "achter", "niet_bijgewerkt", "gepland", "gehaald"] as GoalStatus[])
    .filter((s) => pillar.counts[s] > 0)
    .map((s) => `${pillar.counts[s]} ${STATUS_META[s].label.toLowerCase()}`)
    .join(" · ");

  return (
    <section className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-3 bg-[var(--color-indigo-ink)] px-5 py-3 text-left text-white">
        <div className="min-w-0">
          <div className="text-base font-bold tracking-tight">{pillar.label}</div>
          <div className="text-2xs text-white/70">{summary || "geen doelen"}</div>
        </div>
        <ChevronDown className={`size-5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <ul className="divide-y divide-[var(--color-line)]">
          {pillar.rows.map((g) => <GoalRowItem key={g.id} g={g} isOwner={isOwner} team={team} />)}
        </ul>
      ) : null}
    </section>
  );
}

function GoalRowItem({ g, isOwner, team }: { g: GoalRow; isOwner: boolean; team: TeamMember[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState<string>(g.measured ? String(g.current) : "");
  const [note, setNote] = useState("");
  const meta = STATUS_META[g.status];

  const pct = g.measured && g.target ? Math.min(100, Math.max(0, (g.current / g.target) * 100)) : 0;
  const markerPct = g.target && g.expected != null ? Math.min(100, Math.max(0, (g.expected / g.target) * 100)) : null;
  const attention = g.status === "achter" || g.status === "risico";
  const hasBar = g.type !== "milestone" && g.target != null && g.measured;
  const milePct = g.type === "milestone" && g.target ? Math.min(100, Math.max(0, (g.current / g.target) * 100)) : null;

  // Korte waarde voor de scanbare regel.
  const compactValue =
    g.type === "milestone" ? `${g.current}/${g.target ?? 0}`
    : g.target == null ? null
    : !g.measured ? "n.n.g."
    : `${fmt(g.current, g.unit)} / ${fmt(g.target, g.unit)}`;

  function save() {
    const n = Number(val.replace(",", "."));
    if (!Number.isFinite(n)) return;
    start(async () => {
      await updateGoalStand(g.id, { value: n, note: note.trim() || undefined });
      setEditing(false);
      setNote("");
      router.refresh();
    });
  }
  function toggle(mid: string, done: boolean) {
    start(async () => { await toggleGoalMilestone(mid, done); router.refresh(); });
  }
  function assign(ownerId: string) {
    start(async () => { await setGoalOwner(g.id, ownerId || null); router.refresh(); });
  }
  function doArchive() {
    start(async () => { await archiveGoal(g.id); router.refresh(); });
  }

  return (
    <li style={{ boxShadow: `inset 4px 0 0 ${meta.color}` }}>
      {/* Scanbare regel: titel · status · eigenaar · stand. Klik voor details. */}
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full flex-col gap-1 px-4 py-2.5 text-left hover:bg-[var(--color-surface-sunken)]">
        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--color-ink)]">{g.title}</span>
          <span className="shrink-0 text-2xs font-bold uppercase tracking-wide" style={{ color: meta.color }}>
            {g.status === "gehaald" ? "✓ " : null}{meta.label}
          </span>
          <ChevronDown className={`size-4 shrink-0 text-[var(--color-ink-faint)] transition-transform ${open ? "rotate-180" : ""}`} />
        </div>
        <div className="flex items-center gap-2 text-2xs text-[var(--color-ink-muted)]">
          <span className="shrink-0">
            {g.ownerName ? g.ownerName : <span className="font-semibold text-[var(--color-warn)]">Geen eigenaar</span>}
          </span>
          {compactValue ? <><span className="text-[var(--color-ink-faint)]">·</span><span className="shrink-0 tabular-nums font-medium text-[var(--color-ink)]">{compactValue}</span></> : <><span className="text-[var(--color-ink-faint)]">·</span><span className="font-medium text-[var(--color-warn)]">doel instellen</span></>}
          {hasBar || milePct != null ? (
            <span className="ml-auto h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-[var(--color-surface-2)] sm:w-24">
              <span className="block h-full rounded-full" style={{ width: `${hasBar ? pct : milePct}%`, background: meta.color }} />
            </span>
          ) : null}
        </div>
      </button>

      {/* Details (ingeklapt tot je erop klikt) */}
      {open ? (
        <div className="space-y-2.5 px-4 pb-3.5 pt-0.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-[var(--color-ink-muted)]">
            <span>{g.source === "live" ? `Live uit ${BRON[g.metricKey ?? ""] ?? "systeem"}` : manualSource(g)}</span>
            <span className="text-[var(--color-ink-faint)]">·</span>
            <span>t/m {new Date(g.endDate).toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}</span>
            {g.visibility === "founders" ? <><span className="text-[var(--color-ink-faint)]">·</span><span className="font-medium text-[#8b5cf6]">alleen eigenaar</span></> : null}
          </div>

          {/* Voortgangsbalk met tempostreep */}
          {hasBar ? (
            <div className="relative h-2 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: meta.color }} />
              {markerPct != null ? <div className="absolute top-[-2px] h-[12px] w-0.5 bg-[var(--color-ink)] opacity-60" style={{ left: `calc(${markerPct}% - 1px)` }} title="Waar we nu zouden moeten staan" /> : null}
            </div>
          ) : null}

          {/* Mijlpaal-checklist */}
          {g.type === "milestone" && g.milestones.length > 0 ? (
            <ul className="grid gap-1">
              {g.milestones.map((m) => (
                <li key={m.id}>
                  <button type="button" disabled={pending} onClick={() => toggle(m.id, !m.done)} className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-sm hover:bg-[var(--color-surface-sunken)]">
                    <span className={`grid size-4 shrink-0 place-items-center rounded border ${m.done ? "border-[var(--color-good)] bg-[var(--color-good)] text-white" : "border-[var(--color-line-strong)]"}`}>{m.done ? <Check className="size-3" /> : null}</span>
                    <span className={m.done ? "text-[var(--color-ink-muted)] line-through" : ""}>{m.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {/* Oorzaak + actieknop bij risico/achter */}
          {attention && (g.causeLabels.length > 0 || g.causeHref) ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-sm)] bg-[var(--color-bad-soft)]/50 px-3 py-2 text-xs">
              <span className="min-w-0 text-[var(--color-ink)]">
                {g.causeLabels.length > 0 ? <>Let op: {g.causeLabels.slice(0, 4).join(", ")}{g.causeLabels.length > 4 ? ` en ${g.causeLabels.length - 4} meer` : ""}</> : "Dit doel vraagt aandacht."}
              </span>
              {g.causeHref ? <Link href={g.causeHref} className="inline-flex shrink-0 items-center gap-1 font-semibold text-[var(--color-brand-600)] hover:underline">Bekijken <ArrowRight className="size-3.5" /></Link> : null}
            </div>
          ) : null}

          {/* Handmatige stand bijwerken */}
          {g.source === "manual" && g.type !== "milestone" ? (
            editing ? (
              <div className="flex flex-wrap items-center gap-2">
                <input autoFocus value={val} onChange={(e) => setVal(e.target.value)} placeholder={`Nieuwe stand${g.unit ? ` (${g.unit})` : ""}`} className="sc-input h-8 w-40 py-0 text-sm" />
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Notitie (optioneel)" className="sc-input h-8 min-w-48 flex-1 py-0 text-sm" />
                <button type="button" disabled={pending} onClick={save} className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">{pending ? <Loader2 className="size-3.5 animate-spin" /> : null} Opslaan</button>
                <button type="button" onClick={() => setEditing(false)} className="text-xs text-[var(--color-ink-muted)]">Annuleren</button>
              </div>
            ) : (
              <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-brand-600)] hover:underline"><Pencil className="size-3.5" /> Stand bijwerken</button>
            )
          ) : null}

          {/* Beheer (alleen eigenaar) */}
          {isOwner ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-line)] pt-2 text-2xs">
              <span className="text-[var(--color-ink-faint)]">Beheer:</span>
              <select disabled={pending} value={g.ownerId ?? ""} onChange={(e) => assign(e.target.value)} className="sc-input h-7 py-0 text-2xs" aria-label="Eigenaar toewijzen">
                <option value="">Geen eigenaar</option>
                {team.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              {g.type === "weekly" && g.target == null ? <TargetSetter goalId={g.id} unit={g.unit} /> : null}
              <button type="button" disabled={pending} onClick={doArchive} className="text-[var(--color-ink-faint)] hover:text-[var(--color-bad)]">Archiveren</button>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function TargetSetter({ goalId, unit }: { goalId: string; unit: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [v, setV] = useState("");
  return (
    <span className="inline-flex items-center gap-1">
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder={`Doel per week${unit ? ` (${unit})` : ""}`} className="sc-input h-7 w-32 py-0 text-2xs" />
      <button type="button" disabled={pending} onClick={() => { const n = Number(v.replace(",", ".")); if (Number.isFinite(n)) start(async () => { await setGoalTarget(goalId, n); router.refresh(); }); }} className="rounded bg-[var(--color-indigo-ink)] px-2 py-1 text-2xs font-semibold text-white">{pending ? "…" : "Instellen"}</button>
    </span>
  );
}

function manualSource(g: GoalRow): string {
  const d = daysAgo(g.lastUpdateAt);
  if (d == null) return "Handmatig, nog niet bijgewerkt";
  return `Handmatig, ${d === 0 ? "vandaag" : `${d} dagen geleden`} bijgewerkt`;
}

function MeldingUitleg() {
  const rules: { color: string; label: string; text: string }[] = [
    { color: "var(--color-warn)", label: "Risico", text: "Melding naar de eigenaar, en zichtbaar op Vandaag." },
    { color: "var(--color-bad)", label: "Achter", text: "Melding naar de eigenaar en Jarno, met belsignaal en onder Directe actie." },
    { color: "#8b5cf6", label: "Niet bijgewerkt", text: "Herinnering aan de eigenaar op maandagochtend." },
    { color: "var(--color-good)", label: "Gehaald", text: "Melding naar het hele team." },
  ];
  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-card)]">
      <h3 className="text-base font-semibold text-[var(--color-ink)]">Wanneer komt er een melding</h3>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {rules.map((r) => (
          <li key={r.label} className="flex items-start gap-2.5 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2.5">
            <span className="mt-1 size-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
            <span className="text-sm"><strong className="text-[var(--color-ink)]">{r.label}.</strong> <span className="text-[var(--color-ink-muted)]">{r.text}</span></span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-2xs text-[var(--color-ink-faint)]">Er komt alleen een melding bij een echte statuswissel, niet elke nacht opnieuw.</p>
    </section>
  );
}
