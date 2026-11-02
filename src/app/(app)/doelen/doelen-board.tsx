"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight, Camera, Check, Info, LayoutGrid, Loader2, Pencil, Plus, Trash2, TrendingUp, Undo2, Users, X,
} from "lucide-react";
import type { GoalRow, GoalsOverview } from "@/server/goals/overview";
import type { GoalStatus } from "@/server/goals/status";
import {
  archiveGoal, createGoal, seedGoalsNow, setGoalTarget, toggleGoalAchieved, toggleGoalMilestone, updateGoalDetails, updateGoalStand,
} from "@/server/actions/goals";

/* Rustige weergave: alleen "aandacht" (achter/risico) krijgt kleur. */
const STATUS_LABEL: Record<GoalStatus, string> = {
  op_koers: "Op koers",
  risico: "Risico",
  achter: "Achter",
  niet_bijgewerkt: "Niet bijgewerkt",
  gepland: "Gepland",
  gehaald: "Gehaald",
};
const RANK: Record<GoalStatus, number> = { achter: 0, risico: 1, op_koers: 2, gehaald: 3, gepland: 4, niet_bijgewerkt: 5 };

const PILLAR_ICON: Record<string, typeof TrendingUp> = {
  sales: TrendingUp,
  productie: Camera,
  team: Users,
  systemen: LayoutGrid,
};

const BRON: Record<string, string> = {
  new_clients_q4: "Onze klanten",
  leads_weekly: "Leads",
  scripts_without_jarno: "Scripting",
  shoots_through_dec: "Opnameplanning",
  ontime_rate: "Editing",
  production_without_jarno: "Taken en Editing",
  results_coverage: "Resultatenoverzicht",
};

const isAttention = (g: GoalRow) => g.status === "achter" || g.status === "risico";
const isOk = (g: GoalRow) => g.status === "op_koers" || g.status === "gehaald";
const hasStand = (g: GoalRow) => g.type === "milestone" || (g.measured && g.target != null);

function fmt(n: number, unit: string | null): string {
  if (unit === "euro") return `€ ${Math.round(n).toLocaleString("nl-NL")}`;
  if (unit === "%") return `${Math.round(n)}%`;
  return `${Math.round(n * 10) / 10}`;
}
function shortValue(g: GoalRow): string {
  if (g.type === "milestone") return `${g.milestones.filter((m) => m.done).length}/${g.milestones.length || g.target || 0}`;
  if (!hasStand(g)) return "";
  if (g.unit === "%") return fmt(g.current, g.unit);
  return `${fmt(g.current, g.unit)} / ${fmt(g.target ?? 0, g.unit)}`;
}
function sortGoals(rows: GoalRow[]): GoalRow[] {
  return [...rows].sort((a, b) => RANK[a.status] + (hasStand(a) ? 0 : 6) - (RANK[b.status] + (hasStand(b) ? 0 : 6)));
}
function daysAgo(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}
function manualSource(g: GoalRow): string {
  const d = daysAgo(g.lastUpdateAt);
  if (d == null) return "Handmatig, nog niet bijgewerkt";
  return `Handmatig, ${d === 0 ? "vandaag" : `${d} dagen geleden`} bijgewerkt`;
}

/* ------------------------------------------------------------------ */

function DoelenLegeStaat({ isOwner }: { isOwner: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-8 text-center">
      <h2 className="text-base font-semibold">De Q4-doelen staan nog niet klaar</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-[var(--color-ink-muted)]">
        {isOwner
          ? "Plaats de 22 doelen voor dit kwartaal. Daarna werkt de status zich vanzelf bij."
          : "De doelen voor dit kwartaal worden binnenkort geplaatst door Jarno."}
      </p>
      {isOwner ? (
        <>
          <button
            type="button"
            disabled={pending}
            onClick={() => start(async () => { const r = await seedGoalsNow(); setMsg(r.message ?? null); if (r.ok) router.refresh(); })}
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

export function DoelenBoard({ overview, isOwner }: { overview: GoalsOverview; isOwner: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [editPillar, setEditPillar] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);

  const openGoal = useMemo(() => overview.rows.find((r) => r.id === openId) ?? null, [overview.rows, openId]);
  const editBlock = useMemo(() => overview.pillars.find((p) => p.key === editPillar) ?? null, [overview.pillars, editPillar]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { setOpenId(null); setEditPillar(null); setRulesOpen(false); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (overview.rows.length === 0) return <DoelenLegeStaat isOwner={isOwner} />;

  const attention = overview.rows.filter(isAttention).length;
  const ok = overview.rows.filter(isOk).length;
  const noStand = overview.rows.filter((g) => !hasStand(g)).length;

  return (
    <div className="space-y-4">
      {/* Eén samenvattende regel voor het hele kwartaal */}
      <div className="relative flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-[var(--color-ink-muted)]">
        <span className="inline-flex items-center gap-2 text-[var(--color-ink)]">
          <span className="size-2 rounded-full bg-[var(--color-bad)]" />
          <strong className="font-semibold tabular-nums">{attention}</strong> vragen aandacht
        </span>
        <span><strong className="font-semibold tabular-nums text-[var(--color-ink)]">{ok}</strong> op koers</span>
        <span><strong className="font-semibold tabular-nums text-[var(--color-ink)]">{noStand}</strong> zonder stand</span>
        <button
          type="button"
          onClick={() => setRulesOpen((o) => !o)}
          aria-expanded={rulesOpen}
          className="ml-auto inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-line)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
        >
          <Info className="size-3.5" /> Meldingen
        </button>
        {rulesOpen ? <MeldingUitleg onClose={() => setRulesOpen(false)} /> : null}
      </div>

      {/* Vier pijlers */}
      <div className="grid gap-3.5 lg:grid-cols-2">
        {overview.pillars.map((p) => (
          <PillarCard key={p.key} pillar={p} isOwner={isOwner} onOpen={setOpenId} onEdit={() => setEditPillar(p.key)} />
        ))}
      </div>

      {openGoal ? <GoalPanel g={openGoal} isOwner={isOwner} onClose={() => setOpenId(null)} /> : null}
      {editBlock && isOwner ? <EditPanel pillar={editBlock} onClose={() => setEditPillar(null)} /> : null}
    </div>
  );
}

function PillarCard({ pillar, isOwner, onOpen, onEdit }: { pillar: GoalsOverview["pillars"][number]; isOwner: boolean; onOpen: (id: string) => void; onEdit: () => void }) {
  const Icon = PILLAR_ICON[pillar.key] ?? LayoutGrid;
  const rows = sortGoals(pillar.rows);
  const n = rows.length;
  const ok = rows.filter(isOk).length;
  const att = rows.filter(isAttention).length;
  const rest = Math.max(0, n - ok - att);

  return (
    <section className="flex flex-col rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] px-5 pb-3 pt-4 shadow-[var(--shadow-card)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--color-ink)]">
            <Icon className="size-[18px] shrink-0 text-[var(--color-ink-muted)]" strokeWidth={1.8} />
            {pillar.label}
          </h2>
          <p className="mt-0.5 text-[13px] text-[var(--color-ink-muted)]">
            {ok} van {n} op koers
            {att ? <> · <span className="font-semibold text-[var(--color-bad)]">{att} {att === 1 ? "vraagt" : "vragen"} aandacht</span></> : null}
          </p>
        </div>
        {isOwner ? (
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line)] px-2.5 py-1 text-xs font-medium text-[var(--color-ink-muted)] hover:border-[var(--color-line-strong)] hover:text-[var(--color-ink)]"
          >
            <Pencil className="size-3.5" /> Bewerken
          </button>
        ) : null}
      </div>

      {n > 0 ? (
        <div className="mb-1.5 mt-3 flex h-[5px] gap-[3px]" aria-hidden>
          {ok ? <span className="rounded-full bg-[var(--color-ink)]" style={{ flex: ok }} /> : null}
          {att ? <span className="rounded-full bg-[var(--color-bad)]" style={{ flex: att }} /> : null}
          {rest ? <span className="rounded-full bg-[var(--color-surface-2)]" style={{ flex: rest }} /> : null}
        </div>
      ) : null}

      <ul>
        {rows.map((g) => {
          const alert = isAttention(g);
          const done = g.status === "gehaald";
          const v = shortValue(g);
          return (
            <li key={g.id}>
              <button
                type="button"
                onClick={() => onOpen(g.id)}
                title={g.title}
                className="-mx-1.5 flex w-[calc(100%+0.75rem)] min-w-0 items-center gap-2.5 rounded-[var(--radius-sm)] px-1.5 py-[5px] text-left text-[13.5px] hover:bg-[var(--color-surface-sunken)]"
              >
                <span className={`size-1.5 shrink-0 rounded-full ${alert ? "bg-[var(--color-bad)]" : done ? "bg-[var(--color-good)]" : "bg-[var(--color-line-strong)]"}`} />
                <span className={`min-w-0 flex-1 truncate ${alert ? "font-medium text-[var(--color-ink)]" : done ? "text-[var(--color-ink-faint)] line-through" : "text-[var(--color-ink-muted)]"}`}>
                  {g.title}
                </span>
                {v ? <span className={`shrink-0 text-xs tabular-nums ${alert ? "font-semibold text-[var(--color-bad)]" : "text-[var(--color-ink-faint)]"}`}>{v}</span> : null}
              </button>
            </li>
          );
        })}
        {n === 0 ? <li className="py-2 text-sm text-[var(--color-ink-faint)]">Nog geen doelen in deze pijler.</li> : null}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function Panel({ children, onClose, label }: { children: React.ReactNode; onClose: () => void; label: string }) {
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-label={label} aria-modal>
      <button type="button" aria-label="Sluiten" onClick={onClose} className="absolute inset-0 bg-black/50" />
      <aside className="absolute inset-x-0 bottom-0 flex max-h-[88vh] flex-col rounded-t-2xl border-t border-[var(--color-line-strong)] bg-[var(--color-surface)] shadow-2xl sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-[460px] sm:rounded-none sm:border-l sm:border-t-0">
        {children}
      </aside>
    </div>
  );
}

function PanelHead({ kicker, title, onClose }: { kicker: string; title: string; onClose: () => void }) {
  return (
    <div className="border-b border-[var(--color-line)] px-5 pb-4 pt-5">
      <div className="flex items-center justify-between gap-3 text-xs text-[var(--color-ink-muted)]">
        <span>{kicker}</span>
        <button type="button" onClick={onClose} aria-label="Sluiten" className="grid size-8 place-items-center rounded-[var(--radius-sm)] bg-[var(--color-surface-sunken)] hover:text-[var(--color-ink)]">
          <X className="size-4" />
        </button>
      </div>
      <h3 className="mt-2 text-lg font-semibold leading-snug text-[var(--color-ink)]">{title}</h3>
    </div>
  );
}

function GoalPanel({ g, isOwner, onClose }: { g: GoalRow; isOwner: boolean; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [val, setVal] = useState<string>(g.measured ? String(g.current) : "");
  const [note, setNote] = useState("");
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const alert = isAttention(g);
  const pct = g.type === "milestone"
    ? (g.milestones.length ? (g.milestones.filter((m) => m.done).length / g.milestones.length) * 100 : 0)
    : g.measured && g.target ? Math.min(100, Math.max(0, (g.current / g.target) * 100)) : null;
  const markerPct = g.target && g.expected != null ? Math.min(100, Math.max(0, (g.expected / g.target) * 100)) : null;

  function run(fn: () => Promise<{ ok: boolean; message?: string }>, after?: () => void) {
    start(async () => {
      const r = await fn();
      if (!r.ok && r.message) setMsg(r.message);
      else { setMsg(null); after?.(); }
      router.refresh();
    });
  }

  const statusTone = alert ? "text-[var(--color-bad)]" : g.status === "gehaald" ? "text-[var(--color-good)]" : "text-[var(--color-ink-muted)]";

  return (
    <Panel onClose={onClose} label="Doeldetails">
      <PanelHead kicker={g.pillarLabel} title={g.title} onClose={onClose} />
      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-3xl font-semibold tabular-nums text-[var(--color-ink)]">
              {g.type === "milestone" || hasStand(g) ? shortValue(g) : g.type === "weekly" && g.target == null ? "Geen doel" : "Geen stand"}
            </span>
            <span className={`text-xs font-semibold uppercase tracking-wide ${statusTone}`}>{STATUS_LABEL[g.status]}</span>
          </div>
          {pct != null ? (
            <>
              <div className="relative mt-3 h-2 rounded-full bg-[var(--color-surface-2)]">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: alert ? "var(--color-bad)" : "var(--color-ink-muted)" }} />
                {markerPct != null && g.type !== "milestone" ? (
                  <div className="absolute -top-1 h-4 w-0.5 rounded bg-[var(--color-ink)]" style={{ left: `calc(${markerPct}% - 1px)` }} title="Waar we nu zouden moeten staan" />
                ) : null}
              </div>
              {markerPct != null && g.type !== "milestone" ? <p className="mt-1.5 text-2xs text-[var(--color-ink-faint)]">Streepje = waar we nu zouden moeten staan</p> : null}
            </>
          ) : null}
        </div>

        {alert && (g.causeLabels.length > 0 || g.causeHref) ? (
          <div className="flex items-start justify-between gap-3 rounded-[var(--radius-md)] bg-[var(--color-bad-soft)] px-3 py-2.5 text-sm">
            <span className="text-[var(--color-ink)]">
              {g.causeLabels.length > 0 ? <>Let op: {g.causeLabels.slice(0, 4).join(", ")}{g.causeLabels.length > 4 ? ` en ${g.causeLabels.length - 4} meer` : ""}</> : "Dit doel vraagt aandacht."}
            </span>
            {g.causeHref ? <Link href={g.causeHref} className="inline-flex shrink-0 items-center gap-1 font-semibold text-[var(--color-brand-600)] hover:underline">Bekijken <ArrowRight className="size-3.5" /></Link> : null}
          </div>
        ) : null}

        {g.type === "milestone" && g.milestones.length > 0 ? (
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">Stappen</h4>
            <ul className="grid gap-1.5">
              {g.milestones.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(async () => { await toggleGoalMilestone(m.id, !m.done); return { ok: true }; })}
                    className="flex w-full items-center gap-2.5 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-sunken)] px-3 py-2.5 text-left text-sm hover:border-[var(--color-line-strong)]"
                  >
                    <span className={`grid size-[18px] shrink-0 place-items-center rounded border ${m.done ? "border-[var(--color-good)] bg-[var(--color-good)] text-white" : "border-[var(--color-line-strong)]"}`}>{m.done ? <Check className="size-3" /> : null}</span>
                    <span className={m.done ? "text-[var(--color-ink-muted)] line-through" : "text-[var(--color-ink)]"}>{m.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {g.source === "manual" && g.type !== "milestone" ? (
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">Stand bijwerken</h4>
            <div className="flex gap-2">
              <input value={val} onChange={(e) => setVal(e.target.value)} inputMode="decimal" placeholder={`Nieuwe stand${g.unit ? ` (${g.unit})` : ""}`} className="sc-input h-9 min-w-0 flex-1 text-sm" />
              <button
                type="button"
                disabled={pending || val.trim() === ""}
                onClick={() => { const v = Number(val.replace(",", ".")); if (Number.isFinite(v)) run(() => updateGoalStand(g.id, { value: v, note: note.trim() || undefined }), () => setNote("")); }}
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-indigo-ink)] px-3.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : null} Opslaan
              </button>
            </div>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Notitie (optioneel)" className="sc-input mt-2 h-9 w-full text-sm" />
          </div>
        ) : null}

        {isOwner && g.type === "weekly" && g.target == null ? <TargetSetter goalId={g.id} unit={g.unit} /> : null}

        {msg ? <p className="text-xs text-[var(--color-bad)]">{msg}</p> : null}

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
          <dt className="text-[var(--color-ink-faint)]">Bron</dt>
          <dd className="text-[var(--color-ink)]">{g.source === "live" ? `Live uit ${BRON[g.metricKey ?? ""] ?? "systeem"}` : manualSource(g)}</dd>
          <dt className="text-[var(--color-ink-faint)]">Deadline</dt>
          <dd className="text-[var(--color-ink)]">t/m {new Date(g.endDate).toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}</dd>
          {g.ownerName ? <><dt className="text-[var(--color-ink-faint)]">Eigenaar</dt><dd className="text-[var(--color-ink)]">{g.ownerName}</dd></> : null}
          {g.visibility === "founders" ? <><dt className="text-[var(--color-ink-faint)]">Zichtbaar</dt><dd className="text-[var(--color-ink)]">alleen eigenaar</dd></> : null}
        </dl>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-line)] px-5 py-3.5">
        {confirmArchive ? (
          <>
            <span className="text-xs text-[var(--color-ink-muted)]">Dit doel archiveren?</span>
            <span className="flex-1" />
            <button type="button" onClick={() => setConfirmArchive(false)} className="rounded-[var(--radius-md)] border border-[var(--color-line)] px-3 py-2 text-sm text-[var(--color-ink-muted)]">Annuleren</button>
            <button type="button" disabled={pending} onClick={() => run(async () => { await archiveGoal(g.id); return { ok: true }; }, onClose)} className="rounded-[var(--radius-md)] bg-[var(--color-bad)] px-3 py-2 text-sm font-medium text-white">Archiveren</button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(async () => { await toggleGoalAchieved(g.id, !g.achievedManually); return { ok: true }; })}
              className={g.achievedManually
                ? "inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-line)] px-3.5 py-2 text-sm text-[var(--color-ink-muted)]"
                : "inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-good)] px-3.5 py-2 text-sm font-medium text-white"}
            >
              {g.achievedManually ? <><Undo2 className="size-4" /> Behaald ongedaan maken</> : <><Check className="size-4" /> Markeer als behaald</>}
            </button>
            <span className="flex-1" />
            {isOwner ? <button type="button" onClick={() => setConfirmArchive(true)} className="text-xs text-[var(--color-ink-faint)] hover:text-[var(--color-bad)]">Archiveren</button> : null}
          </>
        )}
      </div>
    </Panel>
  );
}

function TargetSetter({ goalId, unit }: { goalId: string; unit: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [v, setV] = useState("");
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">Doel per week</h4>
      <div className="flex gap-2">
        <input value={v} onChange={(e) => setV(e.target.value)} inputMode="decimal" placeholder={`Doel per week${unit ? ` (${unit})` : ""}`} className="sc-input h-9 min-w-0 flex-1 text-sm" />
        <button type="button" disabled={pending} onClick={() => { const n = Number(v.replace(",", ".")); if (Number.isFinite(n) && v.trim()) start(async () => { await setGoalTarget(goalId, n); router.refresh(); }); }} className="rounded-[var(--radius-md)] bg-[var(--color-indigo-ink)] px-3.5 text-sm font-medium text-white disabled:opacity-50">
          {pending ? "…" : "Instellen"}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

type Draft = { id: string | null; title: string; target: string; hasTarget: boolean; del: boolean; orig?: { title: string; target: string } };

function EditPanel({ pillar, onClose }: { pillar: GoalsOverview["pillars"][number]; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<Draft[]>(() =>
    sortGoals(pillar.rows).map((g) => {
      const t = g.target != null ? String(g.target) : "";
      return { id: g.id, title: g.title, target: t, hasTarget: g.type !== "milestone", del: false, orig: { title: g.title, target: t } };
    }),
  );

  const set = (i: number, patch: Partial<Draft>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  function save() {
    setErr(null);
    start(async () => {
      for (const r of rows) {
        const num = r.target.trim() === "" ? null : Number(r.target.replace(",", "."));
        if (num != null && !Number.isFinite(num)) { setErr(`Ongeldige doelwaarde bij "${r.title}".`); return; }
        if (r.id) {
          if (r.del) { await archiveGoal(r.id); continue; }
          const changed = r.title.trim() !== r.orig?.title || r.target.trim() !== r.orig?.target;
          if (changed) {
            const res = await updateGoalDetails(r.id, { title: r.title, ...(r.hasTarget ? { target: num } : {}) });
            if (!res.ok) { setErr(res.message ?? "Opslaan mislukt."); return; }
          }
        } else if (!r.del && r.title.trim()) {
          const res = await createGoal({ pillar: pillar.key, title: r.title, target: num });
          if (!res.ok) { setErr(res.message ?? "Toevoegen mislukt."); return; }
        }
      }
      router.refresh();
      onClose();
    });
  }

  return (
    <Panel onClose={onClose} label="Doelen bewerken">
      <PanelHead kicker="Doelen bewerken" title={pillar.label} onClose={onClose} />
      <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
        <div className="grid grid-cols-[1fr_92px_36px] gap-2 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
          <span>Doel</span><span>Doelwaarde</span><span />
        </div>
        <ul className="grid gap-2">
          {rows.map((r, i) => (
            <li key={r.id ?? `nieuw-${i}`} className={`grid grid-cols-[1fr_92px_36px] items-start gap-2 ${r.del ? "opacity-45" : ""}`}>
              <textarea
                rows={2}
                value={r.title}
                disabled={r.del}
                onChange={(e) => set(i, { title: e.target.value })}
                placeholder="Omschrijving van het doel"
                className={`sc-input min-h-[44px] resize-y py-2 text-sm ${r.del ? "line-through" : ""}`}
              />
              <input
                value={r.target}
                disabled={r.del || !r.hasTarget}
                inputMode="decimal"
                onChange={(e) => set(i, { target: e.target.value })}
                placeholder={r.hasTarget ? "Geen" : "Stappen"}
                title={r.hasTarget ? "Getal waar je naartoe werkt" : "Dit doel rekent met stappen"}
                className="sc-input h-9 text-sm disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => (r.id ? set(i, { del: !r.del }) : setRows((x) => x.filter((_, j) => j !== i)))}
                title={r.del ? "Terugzetten" : "Verwijderen"}
                className="grid h-9 place-items-center rounded-[var(--radius-md)] border border-[var(--color-line)] text-[var(--color-ink-muted)] hover:border-[var(--color-bad)] hover:text-[var(--color-bad)]"
              >
                {r.del ? <Undo2 className="size-4" /> : <Trash2 className="size-4" />}
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => setRows((x) => [...x, { id: null, title: "", target: "", hasTarget: true, del: false }])}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-dashed border-[var(--color-line-strong)] px-3.5 py-2 text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
        >
          <Plus className="size-4" /> Doel toevoegen
        </button>
        <p className="text-2xs text-[var(--color-ink-faint)]">Verwijderen archiveert het doel; de historie blijft bewaard. Nieuwe doelen starten als handmatig doel tot het einde van het kwartaal.</p>
        {err ? <p className="text-xs text-[var(--color-bad)]">{err}</p> : null}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-[var(--color-line)] px-5 py-3.5">
        <button type="button" onClick={onClose} className="rounded-[var(--radius-md)] border border-[var(--color-line)] px-3.5 py-2 text-sm text-[var(--color-ink-muted)]">Annuleren</button>
        <button type="button" disabled={pending} onClick={save} className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-good)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
          {pending ? <Loader2 className="size-4 animate-spin" /> : null} Opslaan
        </button>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */

function MeldingUitleg({ onClose }: { onClose: () => void }) {
  const rules: { color: string; label: string; text: string }[] = [
    { color: "var(--color-warn)", label: "Risico", text: "Melding naar de eigenaar, en zichtbaar op Vandaag." },
    { color: "var(--color-bad)", label: "Achter", text: "Melding naar de eigenaar en Jarno, met belsignaal en onder Directe actie." },
    { color: "var(--color-ink-faint)", label: "Niet bijgewerkt", text: "Herinnering aan de eigenaar op maandagochtend." },
    { color: "var(--color-good)", label: "Gehaald", text: "Melding naar het hele team." },
  ];
  return (
    <div className="absolute right-0 top-10 z-30 w-[340px] max-w-full rounded-[var(--radius-lg)] border border-[var(--color-line-strong)] bg-[var(--color-surface-2)] p-4 shadow-xl">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--color-ink)]">Wanneer komt er een melding</h3>
        <button type="button" onClick={onClose} aria-label="Sluiten" className="text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"><X className="size-4" /></button>
      </div>
      <ul className="grid gap-2">
        {rules.map((r) => (
          <li key={r.label} className="flex items-start gap-2.5 text-[13px]">
            <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: r.color }} />
            <span><strong className="text-[var(--color-ink)]">{r.label}.</strong> <span className="text-[var(--color-ink-muted)]">{r.text}</span></span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-2xs text-[var(--color-ink-faint)]">Er komt alleen een melding bij een echte statuswissel, niet elke nacht opnieuw.</p>
    </div>
  );
}

