"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Plus, SlidersHorizontal, X } from "lucide-react";
import type { RadarData } from "@/server/capacity-radar";
import { setRadarCapacity, setRadarSettings } from "@/server/actions/capacity-radar";
import {
  DAY_NAMES,
  addDays,
  batchCandidates,
  batchesIn,
  bestBatchMove,
  bestShootMove,
  buildAlerts,
  computeRadar,
  countBottlenecks,
  fmtDate,
  fmtDay,
  makeCalendar,
  roomText,
  shootHours,
  type Cell,
  type RadarAlert,
  type RadarKind,
  type RadarPerson,
  type RadarResult,
  type RadarShoot,
  type RadarStatus,
} from "@/lib/capacity-radar";

/* ------------------------------------------------------------------ *
 * Kleuren (gelijk aan de rest van het portaal)
 * ------------------------------------------------------------------ */

const CELL: Record<RadarStatus, string> = {
  green: "bg-[#e3f3eb] text-[#1f7552]",
  orange: "bg-[#e39a1c] text-white",
  red: "bg-[#d9483b] text-white",
  grey: "text-[var(--color-ink-faint)]",
  off: "bg-[var(--color-surface-sunken)] text-[var(--color-ink-faint)]",
};
const GREY_BG = { background: "repeating-linear-gradient(135deg,#efeee9 0 6px,#e4e2dc 6px 12px)" };
const DOT: Record<RadarStatus, string> = { green: "#3aa57a", orange: "#e39a1c", red: "#d9483b", grey: "#b8b5ad", off: "#b8b5ad" };
const TAG: Record<RadarStatus, string> = {
  green: "bg-[var(--color-good-soft)] text-[#1f7552]",
  orange: "bg-[var(--color-warn-soft)] text-[#8a5300]",
  red: "bg-[var(--color-bad-soft)] text-[#b23a2f]",
  grey: "bg-[var(--color-neutral-soft)] text-[var(--color-ink-muted)]",
  off: "bg-[var(--color-neutral-soft)] text-[var(--color-ink-muted)]",
};
const n1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString("nl-NL");

type Drawer =
  | { type: "cell"; personId: string; week: number }
  | { type: "unassigned"; week: number }
  | { type: "team"; kind: RadarKind; week: number }
  | { type: "person"; personId: string }
  | { type: "shoot"; shootId: string }
  | { type: "alerts" }
  | null;

type Sim = { name: string; videosPerMonth: number; shoots: RadarShoot[] };

export function RadarView({ data, canEdit }: { data: RadarData; canEdit: boolean }) {
  const [weeks, setWeeks] = useState(6);
  const [filter, setFilter] = useState<"all" | "video" | "edit">("all");
  const [agWeek, setAgWeek] = useState(0);
  const [showIdle, setShowIdle] = useState<Record<RadarKind, boolean>>({ video: false, edit: false });
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [simOpen, setSimOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sim, setSim] = useState<Sim | null>(null);

  const people = data.people;
  const settings = data.settings;
  const result = useMemo(() => computeRadar({ ...data, shoots: data.shoots.concat(sim?.shoots ?? []) }), [data, sim]);
  const showVideo = filter !== "edit";
  const showEdit = filter !== "video";
  const ws = result.weeks.slice(0, weeks);
  const alerts = useMemo(() => buildAlerts(result, people, settings, { weeks, video: showVideo, edit: showEdit }), [result, people, settings, weeks, showVideo, showEdit]);
  const bottlenecks = countBottlenecks(result, people, weeks);
  const person = (id: string | null) => (id ? people.find((p) => p.id === id) ?? null : null);

  const openAlert = (a: RadarAlert) => {
    if (a.action.kind === "unassigned") setDrawer({ type: "unassigned", week: a.action.week });
    else if (a.action.kind === "team") setDrawer({ type: "team", kind: "edit", week: a.action.week });
    else if (a.action.personId && a.action.kind === "settings") setDrawer({ type: "person", personId: a.action.personId });
    else if (a.action.personId) setDrawer({ type: "cell", personId: a.action.personId, week: a.action.week });
  };

  return (
    <div className="mx-auto max-w-[1320px]">
      {/* Kop */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Capaciteit</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            Wie zit vol, wie heeft ruimte en wat staat er gepland. Berekend uit Google Agenda en de Editingpagina.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Seg value={filter} onChange={(v) => setFilter(v as typeof filter)} options={[["all", "Alles"], ["video", "Opnames"], ["edit", "Montage"]]} />
          <Seg value={String(weeks)} onChange={(v) => setWeeks(Number(v))} options={[["4", "4 weken"], ["6", "6 weken"], ["8", "8 weken"]]} />
          <button type="button" onClick={() => setSimOpen(true)} className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-indigo-ink)] px-3.5 text-sm font-medium text-white hover:opacity-90">
            <Plus className="size-4" /> Nieuwe klant proefplannen
          </button>
          {canEdit ? (
            <button type="button" onClick={() => setSettingsOpen(true)} title="Grenzen en aannames" className="grid size-9 place-items-center rounded-[var(--radius-md)] border border-[var(--color-line-strong)] bg-[var(--color-surface)]">
              <SlidersHorizontal className="size-4" />
            </button>
          ) : null}
        </div>
      </div>

      {sim ? (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-[var(--radius-lg)] bg-[var(--color-violet-soft)] px-4 py-2.5 text-sm text-[#4a33b8]">
          <span><strong>Proefplanning actief:</strong> {sim.name}, {sim.videosPerMonth} video&apos;s per maand. Vakken met een paarse rand veranderen hierdoor. Er is niets opgeslagen.</span>
          <span className="ml-auto flex gap-2">
            <SmallBtn onClick={() => setSimOpen(true)}>Resultaat</SmallBtn>
            <SmallBtn onClick={() => setSim(null)}>Stoppen</SmallBtn>
          </span>
        </div>
      ) : null}

      {/* 1. Wie zit vol? */}
      <section className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] px-5 pb-4 pt-4">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <h2 className="text-base font-semibold">Wie zit vol?</h2>
            <button type="button" onClick={() => setDrawer({ type: "alerts" })} className={`rounded-full px-3 py-1 text-xs font-semibold ${bottlenecks ? "bg-[var(--color-bad-soft)] text-[#b23a2f]" : "bg-[#e3f3eb] text-[#1f7552]"}`}>
              {bottlenecks ? `${bottlenecks} ${bottlenecks === 1 ? "knelpunt" : "knelpunten"} in de komende ${weeks} weken` : "Alles past"}
            </button>
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-[var(--color-ink-muted)]">
            <Legend color="#3aa57a">Er past nog wat bij</Legend>
            <Legend color="#e39a1c">Bijna vol</Legend>
            <Legend color="#d9483b">Te vol</Legend>
            <Legend grey>Onbekend</Legend>
          </div>
        </div>
        <p className="mb-2 text-[13px] text-[var(--color-ink-muted)]">
          Elk vak is één persoon in één week. In het vak staat hoeveel er nog bij past. Een opname is 6 tot 8 video&apos;s en gaat altijd in één keer naar één editor.
        </p>
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[680px] border-separate border-spacing-x-[5px] border-spacing-y-[6px]">
            <thead>
              <tr>
                <th className="w-[215px]" />
                {ws.map((w) => (
                  <th key={w.i} className="px-1 text-center text-[12.5px] font-semibold whitespace-nowrap">
                    {w.label}
                    <span className="block text-[10.5px] font-normal text-[var(--color-ink-faint)]">{w.i === 0 ? "deze week" : w.i === 1 ? "volgende week" : `week ${w.nr}`}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {showVideo ? (
                <>
                  <GroupRow span={ws.length + 1}>Opnames (videografie)</GroupRow>
                  <TeamRow label="Alle videografen" sub="samen" kind="video" cells={result.team.video} weeks={ws.map((w) => w.i)} settings={settings} onClick={(w) => setDrawer({ type: "team", kind: "video", week: w })} />
                  <PeopleRows kind="video" people={people} result={result} weeks={ws.map((w) => w.i)} settings={settings} showIdle={showIdle.video} toggleIdle={() => setShowIdle((s) => ({ ...s, video: !s.video }))} onCell={(id, w) => setDrawer({ type: "cell", personId: id, week: w })} onPerson={(id) => setDrawer({ type: "person", personId: id })} />
                  {ws.some((w) => result.unassigned[w.i].length) ? (
                    <tr>
                      <td><RowLabel avatar="!" avatarClass="bg-[var(--color-warn-soft)] text-[#8a5300]" name="Nog geen videograaf" meta="Iemand toewijzen" /></td>
                      {ws.map((w) => (
                        <td key={w.i}>
                          {result.unassigned[w.i].length ? (
                            <button type="button" onClick={() => setDrawer({ type: "unassigned", week: w.i })} className="h-8 w-full rounded-[9px] bg-[var(--color-warn-soft)] text-xs font-semibold text-[#8a5300] ring-1 ring-[#e39a1c]/40">
                              {result.unassigned[w.i].length} opname{result.unassigned[w.i].length > 1 ? "s" : ""}
                            </button>
                          ) : null}
                        </td>
                      ))}
                    </tr>
                  ) : null}
                </>
              ) : null}
              {showEdit ? (
                <>
                  <GroupRow span={ws.length + 1}>Montage (editing)</GroupRow>
                  <TeamRow label="Alle editors" sub="samen, incl. komende opnames" kind="edit" cells={result.team.edit} weeks={ws.map((w) => w.i)} settings={settings} onClick={(w) => setDrawer({ type: "team", kind: "edit", week: w })} />
                  <PeopleRows kind="edit" people={people} result={result} weeks={ws.map((w) => w.i)} settings={settings} showIdle={showIdle.edit} toggleIdle={() => setShowIdle((s) => ({ ...s, edit: !s.edit }))} onCell={(id, w) => setDrawer({ type: "cell", personId: id, week: w })} onPerson={(id) => setDrawer({ type: "person", personId: id })} />
                </>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-[11px] text-[var(--color-ink-faint)]">
          Een opname telt gemiddeld als {n1(settings.avgShootHours)} uur inclusief reistijd. Zonder ingevulde eindtijd rekent het portaal met 3 uur filmen en 1 uur reizen.
        </p>
      </section>

      {/* 2. Wat moet er gebeuren? */}
      {alerts.length ? (
        <section className="mt-4 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-2">
          <div className="flex items-center justify-between px-3 pb-1 pt-2">
            <h2 className="text-sm font-semibold">Wat moet er gebeuren?</h2>
            {alerts.length > 3 ? (
              <button type="button" onClick={() => setDrawer({ type: "alerts" })} className="text-xs text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]">
                Alle {alerts.length} bekijken
              </button>
            ) : null}
          </div>
          {alerts.slice(0, 3).map((a, i) => (
            <AlertRow key={i} alert={a} onOpen={() => openAlert(a)} />
          ))}
        </section>
      ) : null}

      {/* 3. Welke opnames komen eraan? */}
      <Agenda result={result} data={data} week={agWeek} setWeek={setAgWeek} onShoot={(id) => setDrawer({ type: "shoot", shootId: id })} />

      {/* Detailpaneel */}
      {drawer ? (
        <DrawerShell onClose={() => setDrawer(null)} {...drawerContent({ drawer, result, data, setDrawer, canEdit, alerts, openAlert, person })} />
      ) : null}

      {simOpen ? <SimModal data={data} result={result} sim={sim} setSim={setSim} onClose={() => setSimOpen(false)} /> : null}
      {settingsOpen ? <SettingsModal data={data} onClose={() => setSettingsOpen(false)} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Kleine bouwstenen
 * ------------------------------------------------------------------ */

function Seg({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="inline-flex rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-[3px]">
      {options.map(([v, l]) => (
        <button key={v} type="button" onClick={() => onChange(v)} className={`rounded-[7px] px-3 py-1 text-[12.5px] font-medium ${value === v ? "bg-[var(--color-indigo-ink)] text-white" : "text-[var(--color-ink-muted)]"}`}>
          {l}
        </button>
      ))}
    </div>
  );
}
function SmallBtn({ onClick, children, primary }: { onClick: () => void; children: ReactNode; primary?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-[var(--radius-md)] border px-3 py-1.5 text-xs font-medium ${primary ? "border-[var(--color-indigo-ink)] bg-[var(--color-indigo-ink)] text-white" : "border-[var(--color-line-strong)] bg-[var(--color-surface)] text-[var(--color-ink)]"}`}>
      {children}
    </button>
  );
}
function Legend({ color, grey, children }: { color?: string; grey?: boolean; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i className="inline-block size-[11px] rounded-[4px]" style={grey ? GREY_BG : { background: color }} />
      {children}
    </span>
  );
}
function GroupRow({ span, children }: { span: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={span} className="pt-3">
        <div className="flex items-center gap-2.5 text-[10.5px] font-bold tracking-[0.1em] text-[var(--color-ink-faint)] uppercase after:h-px after:flex-1 after:bg-[var(--color-line)]">{children}</div>
      </td>
    </tr>
  );
}
function RowLabel({ avatar, avatarClass, name, meta, onClick, bold }: { avatar?: string; avatarClass?: string; name: string; meta: string; onClick?: () => void; bold?: boolean }) {
  const inner = (
    <>
      {avatar ? <span className={`grid size-[26px] shrink-0 place-items-center rounded-full text-[10.5px] font-semibold ${avatarClass ?? "bg-[var(--color-indigo-ink)] text-white"}`}>{avatar}</span> : null}
      <span className="min-w-0">
        <span className={`block truncate leading-tight ${bold ? "text-[13.5px] font-bold" : "text-[13px] font-semibold"}`}>{name}</span>
        <span className="block truncate text-[11px] leading-tight text-[var(--color-ink-faint)]">{meta}</span>
      </span>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-2.5 rounded-lg px-1 py-1 text-left hover:bg-[var(--color-surface-sunken)]">{inner}</button>
  ) : (
    <div className="flex items-center gap-2.5 px-1 py-1">{inner}</div>
  );
}
const initials = (n: string) => n.split(/\s+/).map((x) => x[0]).join("").slice(0, 2).toUpperCase();

function CellButton({ cell, text, sub, tall, onClick, title }: { cell: Cell; text: string; sub?: string; tall?: boolean; onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={cell.status === "grey" ? GREY_BG : undefined}
      className={`flex w-full min-w-[86px] flex-col items-center justify-center rounded-[12px] transition hover:-translate-y-px hover:shadow-md ${tall ? "h-[52px]" : "h-[44px]"} ${CELL[cell.status]} ${cell.sim > 0.05 ? "outline-[2.5px] outline-offset-2 outline-dashed outline-[var(--color-violet)]" : ""}`}
    >
      <span className={`font-bold leading-none tabular-nums ${tall ? "text-[15px]" : "text-[13.5px]"}`}>{text}</span>
      {sub ? <span className="mt-1 text-[10.5px] leading-none opacity-90">{sub}</span> : null}
    </button>
  );
}

function TeamRow({ label, sub, kind, cells, weeks, settings, onClick }: { label: string; sub: string; kind: RadarKind; cells: Cell[]; weeks: number[]; settings: RadarData["settings"]; onClick: (w: number) => void }) {
  return (
    <tr>
      <td><RowLabel name={label} meta={sub} bold /></td>
      {weeks.map((w) => {
        const c = cells[w];
        const subTxt = c.cap ? `${Math.round(c.load)} van ${Math.round(c.cap)} ${kind === "video" ? "uur" : "video's"} gepland` : "";
        return (
          <td key={w}>
            <CellButton cell={c} tall text={roomText(kind, c, settings) || "Onbekend"} sub={subTxt} onClick={() => onClick(w)} title={c.pct != null ? `${Math.round(c.pct)}% bezet` : "Onbekend"} />
          </td>
        );
      })}
    </tr>
  );
}

function PeopleRows({ kind, people, result, weeks, settings, showIdle, toggleIdle, onCell, onPerson }: {
  kind: RadarKind; people: RadarPerson[]; result: RadarResult; weeks: number[]; settings: RadarData["settings"]; showIdle: boolean; toggleIdle: () => void; onCell: (id: string, w: number) => void; onPerson: (id: string) => void;
}) {
  const list = people.filter((p) => p.kind === kind);
  const idle = (p: RadarPerson) => weeks.every((w) => result.cells[p.id][w].load < 0.05);
  const active = list.filter((p) => !idle(p));
  const idleList = list.filter(idle);
  const row = (p: RadarPerson) => {
    const meta = kind === "video"
      ? p.inTeam === false ? "Filmt alleen bij uitzondering" : p.hoursPerWeek == null ? "Videograaf · capaciteit onbekend" : `Videograaf · ${p.daysPerWeek ? `${n1(p.daysPerWeek)} dagen/week` : `${Math.round(p.hoursPerWeek)} uur/week`}`
      : p.videosPerWeek == null ? "Editor · aantal onbekend" : `${p.group === "pool" ? "Reserve" : "Editor"} · ${n1(p.videosPerWeek)} per week`;
    return (
      <tr key={p.id}>
        <td><RowLabel avatar={initials(p.name)} name={p.name} meta={meta} onClick={() => onPerson(p.id)} /></td>
        {weeks.map((w) => {
          const c = result.cells[p.id][w];
          const text = c.status === "grey" ? (c.load > 0.05 ? "Onbekend" : "") : c.status === "off" ? "Vrij" : roomText(kind, c, settings);
          const title = `${p.name}, ${result.weeks[w].label}: ${c.cap == null ? "niet bekend hoeveel er past" : c.cap === 0 ? "afwezig" : `${Math.round(c.pct ?? 0)}% bezet (${n1(c.load)} van ${n1(c.cap)} ${kind === "video" ? "uur" : "video's"})`}`;
          return (
            <td key={w}>
              <CellButton cell={c} text={text} onClick={() => onCell(p.id, w)} title={title} />
            </td>
          );
        })}
      </tr>
    );
  };
  return (
    <>
      {active.map(row)}
      {idleList.length ? (
        <tr>
          <td colSpan={weeks.length + 1}>
            <button type="button" onClick={toggleIdle} className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-ink)]">
              {showIdle ? "Verberg" : "Ook beschikbaar"}: {idleList.map((p) => p.name).join(", ")}
              {showIdle ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
            </button>
          </td>
        </tr>
      ) : null}
      {showIdle ? idleList.map(row) : null}
    </>
  );
}

function AlertRow({ alert, onOpen }: { alert: RadarAlert; onOpen: () => void }) {
  return (
    <div className="grid grid-cols-[10px_1fr_auto] items-center gap-3 rounded-[10px] px-3 py-2.5 hover:bg-[var(--color-surface-sunken)]">
      <span className="size-2.5 rounded-full" style={{ background: alert.tone === "warn" ? "#e39a1c" : "#d9483b" }} />
      <div>
        <div className="text-[13px] font-semibold">{alert.title}</div>
        <div className="mt-0.5 text-xs text-[var(--color-ink-muted)]">{alert.advice}</div>
      </div>
      <SmallBtn onClick={onOpen}>{alert.action.kind === "settings" ? "Bekijk" : "Bekijk details"}</SmallBtn>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Opnameplanning
 * ------------------------------------------------------------------ */

function PersonChip({ person, status, missing }: { person: RadarPerson | null; status?: RadarStatus; missing: string }) {
  if (!person) return <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#8a5300]"><span className="grid size-[22px] place-items-center rounded-full bg-[var(--color-warn-soft)] text-[10px]">!</span>{missing}</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium">
      <span className="grid size-[22px] place-items-center rounded-full bg-[var(--color-indigo-ink)] text-[9.5px] font-semibold text-white">{initials(person.name)}</span>
      {person.name}
      <span title="Hoe vol die week" className="size-2 rounded-full" style={{ background: DOT[status ?? "grey"] }} />
    </span>
  );
}

function Agenda({ result, data, week, setWeek, onShoot }: { result: RadarResult; data: RadarData; week: number; setWeek: (w: number) => void; onShoot: (id: string) => void }) {
  const cal = useMemo(() => makeCalendar(data.holidays), [data.holidays]);
  const w0 = result.weeks[week];
  const list = data.shoots.filter((s) => s.date >= w0.start && s.date <= addDays(w0.start, 6)).sort((a, b) => (a.date + (a.start ?? "")).localeCompare(b.date + (b.start ?? "")));
  const weekIdx = (s: string) => result.weeks.findIndex((w) => s >= w.start && s <= addDays(w.start, 6));
  const p = (id: string | null) => (id ? data.people.find((x) => x.id === id) ?? null : null);
  const cols = "grid grid-cols-[96px_52px_minmax(140px,1.4fr)_1fr_1fr_64px_96px] max-md:grid-cols-[78px_46px_1.3fr_1fr_1fr_56px] gap-3";
  return (
    <section className="mt-4 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] px-5 pb-3 pt-4">
      <div className="mb-1 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Welke opnames komen eraan?</h2>
          <p className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-[var(--color-ink-faint)]">
            <span className="size-[7px] rounded-full bg-[#3aa57a]" /> Komt automatisch uit Google Agenda. Het stipje achter een naam laat zien hoe vol iemand die week zit.
          </p>
        </div>
        <Seg value={String(week)} onChange={(v) => setWeek(Number(v))} options={[["0", "Deze week"], ["1", "Volgende week"], ["2", "Week erna"]]} />
      </div>
      <div className={`${cols} px-1 pt-2 text-[10.5px] font-semibold tracking-[0.06em] text-[var(--color-ink-faint)] uppercase`}>
        <span>Dag</span><span>Tijd</span><span>Klant</span><span>Filmt</span><span>Monteert</span><span>Video&apos;s</span><span className="max-md:hidden">Montage klaar</span>
      </div>
      {list.length === 0 ? <p className="px-1 py-4 text-sm text-[var(--color-ink-faint)]">Geen opnames in de week van {w0.label}.</p> : null}
      {list.map((s, i) => {
        const newDay = i === 0 || list[i - 1].date !== s.date;
        const past = s.date < data.today;
        const vw = weekIdx(s.date);
        const ew = weekIdx(cal.addWorkdays(s.date, 3));
        return (
          <button key={s.id} type="button" onClick={() => onShoot(s.id)} className={`${cols} w-full items-center border-b border-[var(--color-line)] px-1 py-2.5 text-left text-[13px] last:border-b-0 hover:bg-[var(--color-surface-sunken)] ${newDay ? "border-t border-t-[var(--color-line-strong)]" : ""} ${past ? "opacity-50" : ""}`}>
            <span className="text-[12.5px] font-semibold">{newDay ? <>{DAY_NAMES[new Date(s.date + "T00:00:00Z").getUTCDay()]}<span className="block text-[11px] font-normal text-[var(--color-ink-faint)]">{fmtDate(s.date)}{s.date === data.today ? " · vandaag" : ""}</span></> : null}</span>
            <span className="font-semibold tabular-nums">{s.start ?? "–"}</span>
            <span className="font-semibold">{s.clientName}<span className="block text-[11px] font-normal text-[var(--color-ink-faint)]">{n1(s.durationH)} uur filmen, {n1(s.travelH)} uur reizen</span></span>
            <span><PersonChip person={p(s.videographerId)} status={vw >= 0 && s.videographerId ? result.cells[s.videographerId]?.[vw]?.status : undefined} missing="Nog niemand" /></span>
            <span><PersonChip person={p(s.editorId)} status={ew >= 0 && s.editorId ? result.cells[s.editorId]?.[ew]?.status : undefined} missing="Nog niemand" /></span>
            <span className="tabular-nums" title={s.videosSource === "gepland" ? "Ingepland" : "Verwacht, op basis van het klantpakket"}>{s.videos}</span>
            <span className="max-md:hidden">{past ? "Al gefilmd" : fmtDate(cal.addWorkdays(s.date, data.settings.editorLeadDays))}</span>
          </button>
        );
      })}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Detailpaneel
 * ------------------------------------------------------------------ */

function DrawerShell({ title, sub, body, onClose }: { title: string; sub: string; body: ReactNode; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-50 bg-[rgba(0,0,41,.32)]" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-[60] flex w-full max-w-[470px] flex-col bg-[var(--color-surface)] shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-line)] px-5 py-4">
          <div>
            <h3 className="text-base font-semibold">{title}</h3>
            <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">{sub}</p>
          </div>
          <button type="button" onClick={onClose} className="grid size-8 place-items-center rounded-full bg-[var(--color-surface-sunken)]"><X className="size-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-8 pt-4">{body}</div>
      </aside>
    </>
  );
}
const Sec = ({ children }: { children: ReactNode }) => <div className="mb-2 mt-4 text-[10.5px] font-bold tracking-[0.1em] text-[var(--color-ink-faint)] uppercase">{children}</div>;
const Note = ({ tone, children }: { tone: "bad" | "good" | "plain"; children: ReactNode }) => (
  <div className={`mb-2 rounded-[var(--radius-md)] px-3 py-2.5 text-xs leading-relaxed ${tone === "bad" ? "bg-[var(--color-bad-soft)] text-[#8f2f26]" : tone === "good" ? "bg-[var(--color-good-soft)] text-[#1a5e43]" : "bg-[var(--color-surface-sunken)] text-[var(--color-ink-muted)]"}`}>{children}</div>
);
const Item = ({ title, meta, right, children, onClick }: { title: ReactNode; meta?: ReactNode; right?: ReactNode; children?: ReactNode; onClick?: () => void }) => (
  <div onClick={onClick} className={`mb-2 rounded-[var(--radius-md)] border border-[var(--color-line)] px-3 py-2.5 ${onClick ? "cursor-pointer hover:bg-[var(--color-surface-sunken)]" : ""}`}>
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="text-[13px] font-semibold">{title}</div>
        {meta ? <div className="mt-0.5 text-[11.5px] text-[var(--color-ink-muted)]">{meta}</div> : null}
      </div>
      {right}
    </div>
    {children}
  </div>
);
const Stats = ({ items }: { items: [string, string, string?][] }) => (
  <div className="mb-3 grid grid-cols-3 gap-2">
    {items.map(([v, l, c], i) => (
      <div key={i} className="rounded-[var(--radius-md)] bg-[var(--color-surface-sunken)] px-3 py-2">
        <b className="block text-[17px] tabular-nums" style={c ? { color: c } : undefined}>{v}</b>
        <span className="text-[10.5px] text-[var(--color-ink-faint)]">{l}</span>
      </div>
    ))}
  </div>
);
const pctTag = (c: Cell) => <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${TAG[c.status]}`}>{c.cap == null ? "onbekend" : c.cap === 0 ? "afwezig" : `${Math.round(c.pct ?? 0)}%`}</span>;

function drawerContent({ drawer, result, data, setDrawer, canEdit, alerts, openAlert, person }: {
  drawer: NonNullable<Drawer>; result: RadarResult; data: RadarData; setDrawer: (d: Drawer) => void; canEdit: boolean; alerts: RadarAlert[]; openAlert: (a: RadarAlert) => void; person: (id: string | null) => RadarPerson | null;
}): { title: string; sub: string; body: ReactNode } {
  const { settings } = data;
  const cal = makeCalendar(data.holidays);
  const weekIdx = (s: string) => result.weeks.findIndex((w) => s >= w.start && s <= addDays(w.start, 6));

  if (drawer.type === "alerts") {
    return {
      title: "Alle knelpunten",
      sub: `${alerts.length} signalen, het meest dringende eerst`,
      body: alerts.length ? alerts.map((a, i) => <Item key={i} title={a.title} meta={a.advice} onClick={() => openAlert(a)} />) : <Note tone="good">Alles past. Er zijn geen knelpunten.</Note>,
    };
  }

  if (drawer.type === "unassigned") {
    const w = drawer.week;
    const vgs = data.people.filter((p) => p.kind === "video");
    return {
      title: `Nog geen videograaf · ${result.weeks[w].label}`,
      sub: `week ${result.weeks[w].nr}`,
      body: (
        <>
          <Sec>Opnames</Sec>
          {result.unassigned[w].map((s) => (
            <Item key={s.id} title={s.clientName} meta={`${fmtDay(s.date)}${s.start ? ` · ${s.start}` : ""} · ${n1(shootHours(s, settings))} uur incl. reizen`}>
              {!s.sim ? <Link href={`/productions/${s.id}`} className="mt-2 inline-block text-xs font-semibold text-[var(--color-indigo-ink)] underline">Videograaf toewijzen op de opname</Link> : null}
            </Item>
          ))}
          <Sec>Wie heeft die week tijd?</Sec>
          {vgs.map((p) => {
            const c = result.cells[p.id][w];
            return <Item key={p.id} title={p.name} meta={c.cap == null ? "Beschikbaarheid onbekend" : roomText("video", c, settings)} right={pctTag(c)} onClick={() => setDrawer({ type: "cell", personId: p.id, week: w })} />;
          })}
        </>
      ),
    };
  }

  if (drawer.type === "team") {
    const w = drawer.week, kind = drawer.kind;
    const t = result.team[kind][w];
    const list = data.people.filter((p) => p.kind === kind);
    const incoming = kind === "edit"
      ? data.shoots.filter((s) => s.date >= data.today && s.editorId && Array.from({ length: settings.editorLeadDays }, (_, k) => weekIdx(cal.addWorkdays(s.date, k + 1))).includes(w))
      : [];
    return {
      title: `${kind === "edit" ? "Alle editors" : "Alle videografen"} · ${result.weeks[w].label}`,
      sub: t.cap ? `${n1(t.load)} van ${n1(t.cap)} ${kind === "edit" ? "video's" : "uur"} gepland` : "Capaciteit onbekend",
      body: (
        <>
          <Sec>Per persoon</Sec>
          {list.map((p) => {
            const c = result.cells[p.id][w];
            return <Item key={p.id} title={p.name} meta={`${n1(c.load)} van ${c.cap == null ? "?" : n1(c.cap)} ${kind === "edit" ? "video's" : "uur"}`} right={pctTag(c)} onClick={() => setDrawer({ type: "cell", personId: p.id, week: w })} />;
          })}
          {incoming.length ? (
            <>
              <Sec>Komt deze week binnen uit opnames</Sec>
              {incoming.map((s) => <Item key={s.id} title={`${s.clientName} · ${s.videos} video's`} meta={`Opname ${fmtDay(s.date)} · ${person(s.editorId)?.name ?? "?"} · montage klaar ${fmtDate(cal.addWorkdays(s.date, settings.editorLeadDays))}`} onClick={() => setDrawer({ type: "shoot", shootId: s.id })} />)}
            </>
          ) : null}
        </>
      ),
    };
  }

  if (drawer.type === "shoot") {
    const s = data.shoots.find((x) => x.id === drawer.shootId);
    if (!s) return { title: "Opname", sub: "", body: <Note tone="plain">Niet gevonden.</Note> };
    const vw = weekIdx(s.date), ew = weekIdx(cal.addWorkdays(s.date, 3));
    const vg = person(s.videographerId), ed = person(s.editorId);
    return {
      title: s.clientName,
      sub: `Opname ${fmtDay(s.date)} · uit Google Agenda`,
      body: (
        <>
          <Stats items={[[s.start ?? "–", fmtDay(s.date)], [`${n1(shootHours(s, settings))} u`, "incl. reistijd"], [String(s.videos), s.videosSource === "gepland" ? "video's ingepland" : "video's verwacht"]]} />
          <Sec>Planning</Sec>
          <Item title="Opname" meta={`${fmtDay(s.date)}${s.start ? ` · ${s.start}` : ""}`} right={<PersonChip person={vg} status={vg && vw >= 0 ? result.cells[vg.id][vw].status : undefined} missing="Nog niemand" />} />
          <Item title="Montage" meta={`vanaf ${fmtDate(cal.addWorkdays(s.date, 1))} · klaar ${fmtDate(cal.addWorkdays(s.date, settings.editorLeadDays))}`} right={<PersonChip person={ed} status={ed && ew >= 0 ? result.cells[ed.id][ew].status : undefined} missing="Nog niemand" />} />
          <Item title="Oplevering klant" meta={`uiterlijk ${fmtDay(cal.addWorkdays(s.date, settings.clientLeadDays))} (14 werkdagen)`} />
          {ed && ew >= 0 ? (
            <>
              <Sec>Kan een andere editor dit pakket hebben?</Sec>
              {batchCandidates(result, data.people, s.id, ed.id).slice(0, 3).map((c) => (
                <Item key={c.person.id} title={c.person.name} meta={`Komt dan op ${Math.round(c.peak)}%`} right={<span className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${c.peak > settings.red ? TAG.red : c.peak >= settings.green ? TAG.orange : TAG.green}`}>{c.peak > settings.red ? "te vol" : "past"}</span>} />
              ))}
            </>
          ) : null}
          <Note tone="plain">Wijzigen doe je in Google Agenda of op de opname zelf. Deze pagina past zich daarna vanzelf aan.</Note>
          <Link href={`/productions/${s.id}`} className="inline-block rounded-[var(--radius-md)] bg-[var(--color-indigo-ink)] px-3.5 py-2 text-xs font-semibold text-white">Open opname</Link>
        </>
      ),
    };
  }

  if (drawer.type === "person") {
    const p = person(drawer.personId);
    if (!p) return { title: "Persoon", sub: "", body: null };
    const ws = result.weeks.slice(0, 6);
    const upcomingShoots = data.shoots.filter((s) => s.date >= data.today && (p.kind === "video" ? s.videographerId === p.id : s.editorId === p.id) && weekIdx(s.date) >= 0).sort((a, b) => a.date.localeCompare(b.date));
    const running = data.projects.filter((x) => x.editorId === p.id);
    return {
      title: p.name,
      sub: p.kind === "video" ? (p.hoursPerWeek == null ? "Videograaf · capaciteit onbekend" : `Videograaf · ${p.daysPerWeek ? `${n1(p.daysPerWeek)} dagen per week` : `${Math.round(p.hoursPerWeek)} uur per week`}`) : p.videosPerWeek == null ? "Editor · aantal per week onbekend" : `Editor · ${n1(p.videosPerWeek)} video's per week`,
      body: (
        <>
          <div className="mb-3 grid grid-cols-3 gap-2">
            {ws.map((w) => {
              const c = result.cells[p.id][w.i];
              return (
                <button key={w.i} type="button" onClick={() => setDrawer({ type: "cell", personId: p.id, week: w.i })} className="rounded-[var(--radius-md)] bg-[var(--color-surface-sunken)] px-3 py-2 text-left">
                  <b className="block text-sm">{c.status === "grey" ? "Onbekend" : roomText(p.kind, c, settings) || "Vrij"}</b>
                  <span className="text-[10.5px] text-[var(--color-ink-faint)]">{w.label}</span>
                </button>
              );
            })}
          </div>
          {canEdit && p.assignable ? <CapacityForm person={p} /> : null}
          {p.kind === "edit" ? (
            <>
              <Sec>Nu in montage ({running.length})</Sec>
              {running.length ? running.map((x) => <Item key={x.id} title={`${x.clientName} · ${x.videos} video's`} meta={`Opname ${fmtDate(x.shootOn)} · ${x.status === "klant" ? "bij klant" : x.status}`} />) : <Note tone="plain">Geen lopend werk.</Note>}
            </>
          ) : null}
          <Sec>{p.kind === "video" ? "Komende opnames" : "Komt eraan uit opnames"} ({upcomingShoots.length})</Sec>
          {upcomingShoots.length ? upcomingShoots.map((s) => <Item key={s.id} title={`${s.clientName}${p.kind === "edit" ? ` · ${s.videos} video's` : ""}`} meta={`${fmtDay(s.date)}${s.start ? ` · ${s.start}` : ""}`} onClick={() => setDrawer({ type: "shoot", shootId: s.id })} />) : <Note tone="plain">Niets ingepland.</Note>}
        </>
      ),
    };
  }

  // Eén persoon in één week
  const p = person(drawer.personId);
  if (!p) return { title: "", sub: "", body: null };
  const w = drawer.week;
  const c = result.cells[p.id][w];
  const isV = p.kind === "video";
  const conflicts: string[] = [];
  const solutions: ReactNode[] = [];
  if (c.cap == null) conflicts.push(`Niet bekend hoeveel ${isV ? "uur" : "video's"} ${p.name} per week kan. Dit vak blijft grijs tot dat is ingevuld.`);
  if (c.status === "red" && c.cap) conflicts.push(`${n1(c.load - c.cap)} ${isV ? "uur" : "video's"} meer gepland dan er past.`);
  if (c.status === "red" && c.cap === 0) conflicts.push(`${p.name} is deze week afwezig, maar er staat werk gepland.`);
  if (isV) {
    const byDay = new Map<string, RadarShoot[]>();
    for (const s of c.shoots) byDay.set(s.date, [...(byDay.get(s.date) ?? []), s]);
    for (const [d, l] of byDay) { const h = l.reduce((a, s) => a + shootHours(s, settings), 0); if (h > 10) conflicts.push(`${fmtDay(d)}: ${l.length} opnames, ${n1(h)} uur inclusief reistijd. Te veel voor één dag.`); }
  }
  if (c.status === "red") {
    if (isV) {
      const mv = bestShootMove(result, p.id, w, settings);
      if (mv) solutions.push(<>Verplaats <b>{mv.shoot.clientName}</b> ({fmtDay(mv.shoot.date)}) naar de week van {result.weeks[mv.to].label}. {p.name} komt daar op {Math.round(mv.after)}%.</>);
      solutions.push("Of laat een freelance videograaf een opname overnemen.");
    } else {
      const mv = bestBatchMove(result, data.people, p.id, w, settings);
      solutions.push(mv ? <>Geef de opname van <b>{mv.batch.clientName}</b> ({mv.batch.videos} video&apos;s) in één keer aan <b>{mv.to.name}</b>. Die komt dan op {Math.round(mv.peak)}%.</> : "Niemand heeft ruimte voor een hele opname. Zet een freelance editor in of schuif een opname door.");
      solutions.push("Een opname gaat altijd in zijn geheel naar één editor, dus niet opsplitsen.");
    }
  }
  const absentDays = Array.from({ length: 5 }, (_, k) => addDays(result.weeks[w].start, k)).filter((d) => p.absences.some((a) => d >= a.from && d <= a.to));
  const holidays = Array.from({ length: 5 }, (_, k) => addDays(result.weeks[w].start, k)).filter((d) => cal.holidays.has(d));
  return {
    title: `${p.name} · ${result.weeks[w].label}`,
    sub: `${isV ? "Opnames" : "Montage"} · week ${result.weeks[w].nr}`,
    body: (
      <>
        <Stats items={[[n1(c.load), isV ? "uur gepland" : "video's werk"], [c.cap == null ? "?" : n1(c.cap), isV ? "uur beschikbaar" : "video's capaciteit"], [c.cap == null ? "?" : c.cap === 0 ? "afwezig" : `${Math.round(c.pct ?? 0)}%`, "bezetting", DOT[c.status]]]} />
        {absentDays.length ? <Note tone="plain">Afwezig: {absentDays.map(fmtDay).join(", ")}.</Note> : null}
        {holidays.length ? <Note tone="plain">Feestdag: {holidays.map(fmtDay).join(", ")}.</Note> : null}
        {conflicts.length ? <><Sec>Wat er mis is</Sec>{conflicts.map((t, i) => <Note key={i} tone="bad">{t}</Note>)}</> : null}
        {solutions.length ? <><Sec>Wat kan helpen</Sec>{solutions.map((t, i) => <Note key={i} tone="good">{t}</Note>)}</> : null}
        {isV ? (
          <>
            <Sec>Opnames deze week ({c.shoots.length})</Sec>
            {c.shoots.length ? c.shoots.slice().sort((a, b) => a.date.localeCompare(b.date)).map((s) => (
              <Item key={s.id} title={s.clientName} meta={`${fmtDay(s.date)}${s.start ? ` · ${s.start}` : ""} · ${n1(s.durationH)} uur filmen + ${n1(s.travelH)} uur reizen + ${n1(settings.extraPerShoot)} uur op- en afbouw`} right={s.sim ? <span className="rounded-full bg-[var(--color-violet-soft)] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--color-violet)]">proef</span> : undefined} onClick={s.sim ? undefined : () => setDrawer({ type: "shoot", shootId: s.id })} />
            )) : <Note tone="plain">Geen opnames.</Note>}
          </>
        ) : (
          <>
            <Sec>Werk deze week</Sec>
            {batchesIn(result, p.id, w).length ? batchesIn(result, p.id, w).map((b) => {
              const alt = batchCandidates(result, data.people, b.batchId, p.id).filter((x) => x.peak <= settings.red)[0];
              const isShoot = data.shoots.some((s) => s.id === b.batchId);
              return (
                <Item key={b.batchId} title={`${b.clientName} · opname ${fmtDate(b.shootOn)} · ${b.videos} video's`} meta={<>Deze week ca. {n1(b.weekLoad)} video&apos;s werk{c.status === "red" && alt ? <> · kan in zijn geheel naar <b>{alt.person.name}</b> ({Math.round(alt.peak)}%)</> : null}</>} onClick={isShoot ? () => setDrawer({ type: "shoot", shootId: b.batchId }) : undefined} />
              );
            }) : <Note tone="plain">Geen werk gepland.</Note>}
            {c.items.some((i) => i.kind === "sim") ? <Note tone="plain">Inclusief de proefplanning (paars).</Note> : null}
          </>
        )}
        {canEdit && c.cap == null && p.assignable ? <CapacityForm person={p} /> : null}
      </>
    ),
  };
}

function CapacityForm({ person }: { person: RadarPerson }) {
  const router = useRouter();
  const [val, setVal] = useState(String(person.kind === "edit" ? person.videosPerWeek ?? "" : person.daysPerWeek ?? ""));
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="mb-2 mt-3 rounded-[var(--radius-md)] border border-dashed border-[var(--color-line-strong)] px-3 py-3">
      <div className="text-xs font-semibold">{person.kind === "edit" ? `Hoeveel video's maakt ${person.name} per week?` : `Hoeveel dagen per week filmt ${person.name}?`}</div>
      <div className="mt-2 flex items-center gap-2">
        <input value={val} onChange={(e) => setVal(e.target.value)} inputMode="decimal" placeholder="leeg = onbekend" className="h-8 w-28 rounded-[7px] border border-[var(--color-line-strong)] px-2 text-sm" />
        <SmallBtn primary onClick={() => start(async () => {
          const v = val.trim() === "" ? null : Number(val.replace(",", "."));
          const res = await setRadarCapacity({ userId: person.id, kind: person.kind, value: v });
          setMsg(res.ok ? "Opgeslagen." : res.message ?? "Mislukt.");
          if (res.ok) router.refresh();
        })}>{pending ? "Bezig..." : "Opslaan"}</SmallBtn>
        {msg ? <span className="text-xs text-[var(--color-ink-muted)]">{msg}</span> : null}
      </div>
      <div className="mt-1.5 text-[11px] text-[var(--color-ink-faint)]">Alleen zichtbaar voor jou. Leeg laten betekent onbekend: dan wordt het vak grijs.</div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Proefplanning nieuwe klant (alleen in de browser, niets opgeslagen)
 * ------------------------------------------------------------------ */

const PRESETS: { n: string; v: number; s: number }[] = [
  { n: "6 video's, 1 opname", v: 6, s: 1 },
  { n: "8 video's, 1 opname", v: 8, s: 1 },
  { n: "12 video's, 2 opnames", v: 12, s: 2 },
  { n: "16 video's, 2 opnames", v: 16, s: 2 },
];

function planSim(data: RadarData, base: RadarResult, f: { name: string; videos: number; shoots: number; start: string; dur: number; travel: number }): RadarShoot[] {
  const cal = makeCalendar(data.holidays);
  const settings = data.settings;
  const W = base.weeks.length;
  const weekIdx = (s: string) => base.weeks.findIndex((w) => s >= w.start && s <= addDays(w.start, 6));
  const perShoot = Math.max(1, Math.round(f.videos / f.shoots));
  const startW = Math.max(1, weekIdx(f.start) < 0 ? 1 : weekIdx(f.start));
  const gap = Math.max(1, Math.round(4 / f.shoots));
  const hrs = f.dur + f.travel + settings.extraPerShoot;
  const extraV = new Map<string, number>(), extraE = new Map<string, number>();
  const out: RadarShoot[] = [];
  const count = Math.min(f.shoots * 2, Math.floor((W - 2 - startW) / gap) + 1);
  for (let k = 0; k < count; k++) {
    const target = startW + k * gap;
    let best: { p: RadarPerson; w: number; score: number } | null = null;
    for (const w of [target, target + 1, target + 2]) {
      if (w < startW || w >= W - 2) continue;
      for (const p of data.people.filter((x) => x.kind === "video" && x.assignable !== false)) {
        const c = base.cells[p.id][w];
        if (!c.cap) continue;
        const pct = ((c.load + (extraV.get(`${p.id}|${w}`) ?? 0) + hrs) / c.cap) * 100;
        const score = pct + (p.employment === "freelance" ? 15 : 0) + Math.abs(w - target) * 20;
        if (!best || score < best.score) best = { p, w, score };
      }
    }
    if (!best) continue;
    const bp = best.p, bw = best.w;
    extraV.set(`${bp.id}|${bw}`, (extraV.get(`${bp.id}|${bw}`) ?? 0) + hrs);
    const days = Array.from({ length: 5 }, (_, i) => addDays(base.weeks[bw].start, i)).filter((d) => cal.isWorkday(d) && d >= f.start && !bp.absences.some((a) => d >= a.from && d <= a.to));
    if (!days.length) continue;
    const dayLoad = (d: string) => base.cells[bp.id][bw].shoots.filter((s) => s.date === d).length + out.filter((s) => s.date === d).length;
    const day = days.slice().sort((a, b) => dayLoad(a) - dayLoad(b) || a.localeCompare(b))[0];
    // Editor: laagste piek over de weken van de eerste versie, hele pakket bij één editor.
    const share = new Map<number, number>();
    for (let i = 1; i <= settings.editorLeadDays; i++) { const w = weekIdx(cal.addWorkdays(day, i)); if (w >= 0) share.set(w, (share.get(w) ?? 0) + perShoot / settings.editorLeadDays); }
    let bestE: { p: RadarPerson; score: number } | null = null;
    for (const p of data.people.filter((x) => x.kind === "edit" && x.assignable !== false)) {
      let peak = 0, ok = true;
      for (const [w, v] of share) { const c = base.cells[p.id][w]; if (!c.cap) { ok = false; break; } peak = Math.max(peak, ((c.load + (extraE.get(`${p.id}|${w}`) ?? 0) + v) / c.cap) * 100); }
      if (!ok) continue;
      if (!bestE || peak < bestE.score) bestE = { p, score: peak };
    }
    if (bestE) for (const [w, v] of share) extraE.set(`${bestE.p.id}|${w}`, (extraE.get(`${bestE.p.id}|${w}`) ?? 0) + v);
    out.push({ id: `sim-${k}`, date: day, start: "10:00", durationH: f.dur, travelH: f.travel, clientName: f.name, clientSlug: null, videographerId: bp.id, editorId: bestE?.p.id ?? null, videos: perShoot, videosSource: "gepland", sim: true });
  }
  return out;
}

function SimModal({ data, result, sim, setSim, onClose }: { data: RadarData; result: RadarResult; sim: Sim | null; setSim: (s: Sim | null) => void; onClose: () => void }) {
  const cal = makeCalendar(data.holidays);
  const [f, setF] = useState({ name: sim?.name ?? "Nieuwe klant", videos: sim?.videosPerMonth ?? 8, shoots: 1, start: addDays(data.today, 14), dur: 3, travel: 1 });
  const base = useMemo(() => computeRadar(data), [data]);
  const run = () => setSim({ name: f.name || "Nieuwe klant", videosPerMonth: f.videos, shoots: planSim(data, base, f) });

  // Impact: welke vakken veranderen van kleur.
  const changes: { p: RadarPerson; w: number; from: RadarStatus; to: RadarStatus; pct: number | null }[] = [];
  if (sim) for (const p of data.people) for (let w = 0; w < result.weeks.length; w++) { const a = base.cells[p.id][w], b = result.cells[p.id][w]; if (a.status !== b.status && b.cap) changes.push({ p, w, from: a.status, to: b.status, pct: b.pct }); }
  const lbl: Record<RadarStatus, string> = { green: "groen", orange: "oranje", red: "rood", grey: "grijs", off: "vrij" };
  const reds = changes.filter((c) => c.to === "red");
  const edReds = reds.filter((c) => c.p.kind === "edit"), vgReds = reds.filter((c) => c.p.kind === "video");
  const noEditor = sim?.shoots.some((s) => !s.editorId) ?? false;
  const verdict = !sim ? null : reds.length || noEditor ? { c: "bg-[var(--color-bad-soft)]", i: "!", ic: "#d9483b", t: "Past niet zonder extra capaciteit", s: "Er ontstaat overbelasting of er is een freelancer nodig." } : changes.some((c) => c.to === "orange") ? { c: "bg-[var(--color-warn-soft)]", i: "~", ic: "#e39a1c", t: "Past, maar het wordt krap", s: "Geen overbelasting, wel weken die bijna vol zitten." } : { c: "bg-[var(--color-good-soft)]", i: "✓", ic: "#3aa57a", t: "Past in de huidige planning", s: "Alle betrokken weken blijven onder de grens." };
  const lastPlanned = Math.max(...data.shoots.map((s) => result.weeks.findIndex((w) => s.date >= w.start && s.date <= addDays(w.start, 6))));
  const thin = sim?.shoots.some((s) => result.weeks.findIndex((w) => s.date >= w.start && s.date <= addDays(w.start, 6)) >= lastPlanned - 1);

  const field = "h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2.5 text-sm";
  return (
    <>
      <div className="fixed inset-0 z-50 bg-[rgba(0,0,41,.32)]" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-[70] max-h-[calc(100vh-48px)] w-[min(720px,calc(100%-32px))] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-[var(--radius-xl)] bg-[var(--color-surface)] shadow-2xl">
        <div className="flex items-start justify-between gap-3 px-6 pt-5">
          <div>
            <h3 className="text-[17px] font-semibold">Nieuwe klant proefplannen</h3>
            <p className="mt-1 text-[12.5px] text-[var(--color-ink-muted)]">Tijdelijke berekening. Er wordt niets opgeslagen en de echte planning verandert niet.</p>
          </div>
          <button type="button" onClick={onClose} className="grid size-8 place-items-center rounded-full bg-[var(--color-surface-sunken)]"><X className="size-4" /></button>
        </div>
        <div className="px-6 pb-6 pt-4">
          <div className="mb-3 flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button key={p.n} type="button" onClick={() => setF({ ...f, videos: p.v, shoots: p.s })} className={`rounded-full border px-3 py-1 text-xs ${f.videos === p.v && f.shoots === p.s ? "border-[var(--color-indigo-ink)] bg-[var(--color-indigo-ink)] text-white" : "border-[var(--color-line-strong)]"}`}>{p.n}</button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
            <label className="col-span-2 text-[11px] font-semibold text-[var(--color-ink-muted)]">Klantnaam<input className={field} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
            <label className="text-[11px] font-semibold text-[var(--color-ink-muted)]">Video&apos;s per maand<input className={field} type="number" min={1} value={f.videos} onChange={(e) => setF({ ...f, videos: Math.max(1, Number(e.target.value) || 1) })} /></label>
            <label className="text-[11px] font-semibold text-[var(--color-ink-muted)]">Opnames per maand<input className={field} type="number" min={1} max={4} value={f.shoots} onChange={(e) => setF({ ...f, shoots: Math.min(4, Math.max(1, Number(e.target.value) || 1)) })} /></label>
            <label className="text-[11px] font-semibold text-[var(--color-ink-muted)]">Startdatum<input className={field} type="date" value={f.start} min={addDays(data.today, 1)} max={addDays(data.today, 70)} onChange={(e) => setF({ ...f, start: e.target.value || f.start })} /></label>
            <label className="text-[11px] font-semibold text-[var(--color-ink-muted)]">Uur filmen<input className={field} type="number" step={0.5} value={f.dur} onChange={(e) => setF({ ...f, dur: Number(e.target.value) || 3 })} /></label>
            <label className="text-[11px] font-semibold text-[var(--color-ink-muted)]">Uur reizen (retour)<input className={field} type="number" step={0.5} value={f.travel} onChange={(e) => setF({ ...f, travel: Number(e.target.value) || 0 })} /></label>
            <div className="flex items-end"><button type="button" onClick={run} className="h-9 w-full rounded-[var(--radius-md)] bg-[var(--color-indigo-ink)] text-sm font-medium text-white">Doorrekenen</button></div>
          </div>

          {sim && verdict ? (
            <div className="mt-4 border-t border-[var(--color-line)] pt-4">
              <div className={`mb-3 flex items-center gap-3 rounded-[var(--radius-lg)] px-4 py-3 ${verdict.c}`}>
                <span className="grid size-8 shrink-0 place-items-center rounded-full font-bold text-white" style={{ background: verdict.ic }}>{verdict.i}</span>
                <div><b className="text-sm">{verdict.t}</b><span className="block text-xs text-[var(--color-ink-muted)]">{verdict.s}</span></div>
              </div>
              <div className="grid gap-2">
                {sim.shoots.map((s, i) => {
                  const w = result.weeks.findIndex((x) => s.date >= x.start && s.date <= addDays(x.start, 6));
                  const vg = data.people.find((p) => p.id === s.videographerId);
                  const ed = data.people.find((p) => p.id === s.editorId);
                  return (
                    <div key={s.id} className="grid grid-cols-[110px_1fr] items-center gap-3 rounded-[var(--radius-md)] bg-[var(--color-surface-sunken)] px-3 py-2 text-[12.5px]">
                      <span className="text-[11.5px] font-medium text-[var(--color-ink-faint)]">Opname {i + 1}</span>
                      <span><b>{fmtDay(s.date)}</b> (week {result.weeks[w]?.nr}) · filmt: {vg?.name ?? "?"} · monteert: {ed?.name ?? <b className="text-[#b23a2f]">niemand heeft ruimte</b>}<span className="block text-[11.5px] text-[var(--color-ink-muted)]">{s.videos} video&apos;s · montage klaar {fmtDate(cal.addWorkdays(s.date, data.settings.editorLeadDays))} · klant {fmtDate(cal.addWorkdays(s.date, data.settings.clientLeadDays))}</span></span>
                    </div>
                  );
                })}
                <div className="grid grid-cols-[110px_1fr] items-center gap-3 rounded-[var(--radius-md)] bg-[var(--color-surface-sunken)] px-3 py-2 text-[12.5px]">
                  <span className="text-[11.5px] font-medium text-[var(--color-ink-faint)]">Editors</span>
                  <span>{edReds.length || noEditor ? <><b>Te weinig ruimte.</b> {[...new Set(edReds.map((c) => c.p.name))].join(", ")} {edReds.length ? "komen boven de grens." : ""} Zet een freelance editor in voor een hele opname, of kies een latere start.</> : <><b>Past.</b> Het werk past bij de editors.</>}</span>
                </div>
                <div className="grid grid-cols-[110px_1fr] items-center gap-3 rounded-[var(--radius-md)] bg-[var(--color-surface-sunken)] px-3 py-2 text-[12.5px]">
                  <span className="text-[11.5px] font-medium text-[var(--color-ink-faint)]">Videografie</span>
                  <span>{vgReds.length ? <><b>Te vol.</b> Plan een freelance videograaf in of kies een rustigere week.</> : <><b>Past.</b></>}</span>
                </div>
                <div className="grid grid-cols-[110px_1fr] items-center gap-3 rounded-[var(--radius-md)] bg-[var(--color-surface-sunken)] px-3 py-2 text-[12.5px]">
                  <span className="text-[11.5px] font-medium text-[var(--color-ink-faint)]">Wat verandert</span>
                  <span>{changes.length ? changes.slice(0, 5).map((c) => `${c.p.name} (${result.weeks[c.w].label}): ${lbl[c.from]} naar ${lbl[c.to]}`).join(" · ") : "Geen kleurwijzigingen in de radar."}</span>
                </div>
              </div>
              {thin ? <Note tone="plain">Let op: verder vooruit staan nog weinig opnames gepland. De bezetting is daar waarschijnlijk te rooskleurig. Reken opnieuw zodra de opnames van bestaande klanten zijn ingepland.</Note> : null}
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <SmallBtn onClick={() => { setSim(null); onClose(); }}>Stoppen</SmallBtn>
                <SmallBtn primary onClick={onClose}>Bekijk in de radar</SmallBtn>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Instellingen (alleen eigenaar)
 * ------------------------------------------------------------------ */

function SettingsModal({ data, onClose }: { data: RadarData; onClose: () => void }) {
  const router = useRouter();
  const s = data.settings;
  const [v, setV] = useState({ green: s.green, red: s.red, avgShoot: s.avgShootHours, extraShoot: s.extraPerShoot });
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const field = "h-9 w-24 rounded-[var(--radius-md)] border border-[var(--color-line-strong)] px-2.5 text-sm";
  return (
    <>
      <div className="fixed inset-0 z-50 bg-[rgba(0,0,41,.32)]" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-[70] w-[min(520px,calc(100%-32px))] -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-xl)] bg-[var(--color-surface)] p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="text-[17px] font-semibold">Grenzen en aannames</h3>
            <p className="mt-1 text-xs text-[var(--color-ink-muted)]">Alleen voor jou. Capaciteit per persoon stel je in door op een naam te klikken.</p>
          </div>
          <button type="button" onClick={onClose} className="grid size-8 place-items-center rounded-full bg-[var(--color-surface-sunken)]"><X className="size-4" /></button>
        </div>
        <div className="grid gap-3 text-sm">
          <label className="flex items-center justify-between gap-3">Groen tot (%)<input className={field} type="number" value={v.green} onChange={(e) => setV({ ...v, green: Number(e.target.value) })} /></label>
          <label className="flex items-center justify-between gap-3">Rood boven (%)<input className={field} type="number" value={v.red} onChange={(e) => setV({ ...v, red: Number(e.target.value) })} /></label>
          <label className="flex items-center justify-between gap-3">Gemiddelde opname incl. reistijd (uur)<input className={field} type="number" step={0.5} value={v.avgShoot} onChange={(e) => setV({ ...v, avgShoot: Number(e.target.value) })} /></label>
          <label className="flex items-center justify-between gap-3">Op- en afbouw per opname (uur)<input className={field} type="number" step={0.5} value={v.extraShoot} onChange={(e) => setV({ ...v, extraShoot: Number(e.target.value) })} /></label>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          {msg ? <span className="mr-auto text-xs text-[var(--color-ink-muted)]">{msg}</span> : null}
          <SmallBtn onClick={onClose}>Annuleren</SmallBtn>
          <SmallBtn primary onClick={() => start(async () => {
            const res = await setRadarSettings(v);
            setMsg(res.ok ? "Opgeslagen." : res.message ?? "Mislukt.");
            if (res.ok) { router.refresh(); onClose(); }
          })}>{pending ? "Bezig..." : "Opslaan"}</SmallBtn>
        </div>
      </div>
    </>
  );
}
