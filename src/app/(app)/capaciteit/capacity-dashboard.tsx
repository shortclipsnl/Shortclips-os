"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Camera, Scissors, Settings2 } from "lucide-react";
import CapEngine from "@/lib/capacity-engine";

// De rekenmotor is pure JavaScript (gedeeld met het prototype); hier ongetypeerd.
const E: any = CapEngine;
import type { CapacityData } from "@/server/capacity-forecast";
import "./capacity.css";

type Drawer =
  | { type: "cell"; kind: string; pid?: string; i: number; r: "p" | "w" }
  | { type: "kpi"; k: string }
  | { type: "person"; pid: string }
  | null;

const ST_LABEL: Record<string, string> = { groen: "Gezond", oranje: "Let op", rood: "Probleem" };
const SRC_LABEL: Record<string, string> = { bevestigd: "Bevestigd", voorspeld: "Voorspeld", verwacht: "Verwacht uit pakket" };
const STATUS_COLOR: Record<string, string> = { groen: "var(--color-good)", oranje: "var(--color-warn)", rood: "var(--color-bad)", grijs: "#9a98a6", vrij: "#9a98a6" };
const N = (x: number) => (Math.round(x * 10) / 10).toString().replace(".", ",");
const pillText = (c: any) => (c.key === "grijs" ? "?" : c.key === "vrij" ? "Vrij" : c.pct === null ? "!" : `${c.pct}%`);
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
const SNOOZE_KEY = "cap-snoozed-v1";

export function CapacityDashboard({ data, canEdit }: { data: CapacityData; canEdit: boolean }) {
  // Altijd per week (met datums), doorlopend tot en met februari.
  const mode = "week" as "overzicht" | "week";
  const [filter, setFilter] = useState<"alle" | "videografie" | "editing">("alle");
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [showAll, setShowAll] = useState(false);
  const [snoozed, setSnoozed] = useState<string[]>([]);
  // Verbergen geldt alleen deze week; daarna komen meldingen vanzelf terug.
  // Pas na het laden uitlezen, zodat server en browser hetzelfde tonen.
  useEffect(() => {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(SNOOZE_KEY) ?? "null");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (parsed && parsed.week === E.mondayOf(data.today)) setSnoozed(parsed.ids ?? []);
    } catch { /* geen opslag beschikbaar */ }
  }, [data.today]);
  const snooze = (id: string) => {
    const next = [...snoozed, id];
    setSnoozed(next);
    try { window.localStorage.setItem(SNOOZE_KEY, JSON.stringify({ week: E.mondayOf(data.today), ids: next })); } catch { /* */ }
  };

  const model = useMemo(() => {
    E.configure({ today: data.today, holidays: data.holidays });
    const engineData = { people: data.people, clients: data.clients, shoots: data.shoots, projects: data.projects };
    const st: any = {
      settings: { ...E.defaultSettings(), greenBelow: data.settings.greenBelow, orangeMax: data.settings.orangeMax, defaultTravel: data.settings.defaultTravel },
      moves: {}, vgMoves: {}, snoozed,
    };
    const P = E.periods();
    const R = E.compute(engineData, st, Math.max(E.weeksUntil(P[P.length - 1].friday), 8));
    const WMAP: number[] = R.weeks.map((w: any) => P.findIndex((p: any) => w.days[2] >= p.monday && w.days[2] <= p.friday));
    const HW = WMAP.filter((x) => x >= 0).length;
    const RP = E.compute(engineData, st, P);
    const SIG = E.signals(engineData, st, R, HW, []);
    const lv = (s: any) => (s.week < 6 ? 0 : 1);
    SIG.all.sort((a: any, b: any) => lv(a) - lv(b) || b.sev - a.sev);
    return { st, P, R, RP, WMAP, HW, SIG, engineData };
  }, [data, snoozed]);
  const { st, P, R, RP, WMAP, HW, SIG } = model;
  const RR = mode === "overzicht" ? RP : R;
  const cols: number[] = R.weeks.map((_: any, i: number) => i).filter((i: number) => R.weeks[i].monday <= P[P.length - 1].friday);
  const G = st.settings.greenBelow, O = st.settings.orangeMax;
  const lvl = (pct: number) => (pct > O ? "rood" : pct >= G ? "oranje" : "groen");

  /* ---------------- kerncijfers ---------------- */
  const K = useMemo(() => {
    const end4 = E.addDays(R.weeks[0].monday, 27);
    const inWin = (d: string) => d >= R.weeks[0].monday && d <= end4;
    const shoots = R.vgItems.filter((i: any) => inWin(i.date) && i.source === "bevestigd");
    const noVg = shoots.filter((i: any) => !i.vg && i.date >= data.today).length;
    const in7 = E.addDays(data.today, 7);
    const noVgSoon = shoots.filter((i: any) => !i.vg && i.date >= data.today && i.date <= in7).length;
    const conf = R.edItems.filter((i: any) => i.source === "bevestigd");
    const queue = conf.reduce((a: number, i: any) => a + i.open, 0);
    const fc = R.edItems.filter((i: any) => i.source === "voorspeld" && inWin(i.date)).reduce((a: number, i: any) => a + i.videos, 0);
    let vgFree = 0, edFree = 0, vl = 0, vc = 0, el = 0, ec = 0, cap2 = 0, load2 = 0;
    for (let i = 0; i < 4; i++) {
      R.vgRows.forEach((r: any) => { const c = r.cells[i]; if (c.cap) vgFree += Math.max(0, c.cap.value - c.load); });
      R.edRows.forEach((r: any) => { const c = r.cells[i]; if (c.cap) edFree += Math.max(0, c.cap.value - c.load); });
      vl += R.vgTeam[i].load; vc += R.vgTeam[i].cap; el += R.edTeam[i].load; ec += R.edTeam[i].cap;
    }
    for (let i = 0; i < 2; i++) { R.edRows.forEach((r: any) => { const c = r.cells[i]; if (c.cap) cap2 += c.cap.value; }); load2 += R.edTeam[i].load; }
    const vgPct = vc ? Math.round((vl / vc) * 100) : null;
    const edPct = ec ? Math.round((el / ec) * 100) : null;
    const reds: any[] = [];
    for (let i = 0; i < HW; i++) R.vgRows.concat(R.edRows).forEach((r: any) => { if (r.cells[i].key === "rood" && WMAP[i]! >= 0) reds.push({ r, i, c: r.cells[i], pi: WMAP[i] }); });
    const combos: any[] = [];
    reds.forEach((x) => { if (!combos.some((c) => c.r === x.r && c.pi === x.pi)) combos.push({ r: x.r, pi: x.pi }); });
    const firstPi = combos.length ? Math.min(...combos.map((x) => x.pi)) : -1;
    const first = combos.filter((c) => c.pi === firstPi);

    const shootsSt = noVgSoon ? { k: "rood", why: `${noVgSoon} opname${noVgSoon === 1 ? "" : "s"} binnen 7 dagen zonder videograaf` }
      : noVg ? { k: "oranje", why: `${noVg} opname${noVg === 1 ? "" : "s"} nog zonder videograaf` } : { k: "groen", why: "Alle opnames hebben een videograaf" };
    const overdue = conf.filter((i: any) => i.overdue).length;
    const unassigned = conf.filter((i: any) => !i.editor && i.open > 0).reduce((a: number, i: any) => a + i.open, 0);
    const q2 = cap2 ? Math.round((load2 / cap2) * 100) : null;
    const queueSt = overdue ? { k: "rood", why: `${overdue} project${overdue === 1 ? "" : "en"} over de editordeadline` }
      : q2 !== null && q2 > O ? { k: "rood", why: `Wachtrij ${q2}% van de capaciteit komende 2 weken` }
      : unassigned ? { k: "oranje", why: `${unassigned} video's nog zonder editor` }
      : data.stale.length ? { k: "oranje", why: `${data.stale.length} opname${data.stale.length === 1 ? "" : "s"} met een status die niet is bijgewerkt` }
      : q2 === null ? { k: "oranje", why: "Capaciteit van editors nog niet vastgelegd" }
      : q2 >= G ? { k: "oranje", why: `Wachtrij ${q2}% van de capaciteit komende 2 weken` } : { k: "groen", why: `Wachtrij ${q2}% van de capaciteit komende 2 weken` };
    const vgK = vgPct === null ? "oranje" : lvl(vgPct), edK = edPct === null ? "oranje" : lvl(edPct);
    const rank: Record<string, number> = { groen: 0, oranje: 1, rood: 2 };
    const capK = rank[vgK]! >= rank[edK]! ? vgK : edK;
    const soon = reds.some((x) => x.i < 4);
    const redSt = !combos.length ? "groen" : soon ? "rood" : "oranje";
    return { shoots, queue, fc, vgFree, edFree, vgPct, edPct, vgK, edK, capK, reds, combos, first, shootsSt, queueSt, redSt, conf };
  }, [R, HW, WMAP, data.today, data.stale.length, G, O]); // eslint-disable-line react-hooks/exhaustive-deps

  const signals = SIG.all;
  const shown = showAll ? signals : signals.slice(0, 3);
  const urgentCount = signals.filter((s: any) => s.week < 6).length;

  const peaks = (kind: "vg" | "ed", pid: string, pi: number) => {
    if (mode !== "overzicht") return [];
    const row = (kind === "vg" ? R.vgRows : R.edRows).find((r: any) => r.person.id === pid);
    return row ? row.cells.map((c: any, wi: number) => ({ c, wi })).filter(({ c, wi }: any) => WMAP[wi] === pi && c.key === "rood") : [];
  };

  /* ---------------- radarblok ---------------- */
  const block = (kind: "vg" | "ed") => {
    const vg = kind === "vg";
    const rows = vg ? RR.vgRows : RR.edRows;
    const unit = vg ? "uur" : "video's";
    let free = 0, tl = 0, tc = 0;
    for (let i = 0; i < 4; i++) {
      (vg ? R.vgRows : R.edRows).forEach((r: any) => { const c = r.cells[i]; if (c.cap) free += Math.max(0, c.cap.value - c.load); });
      const t = (vg ? R.vgTeam : R.edTeam)[i]; tl += t.load; tc += t.cap;
    }
    const tp = tc ? Math.round((tl / tc) * 100) : null;
    const tk = tp === null ? "grijs" : lvl(tp);
    const open = vg ? RR.vgOpen : RR.edOpen;
    const team = vg ? RR.vgTeam : RR.edTeam;
    const r = mode === "overzicht" ? "p" : "w";
    return (
      <div className={`cap-block ${kind}`}>
        <div className="cap-rhead">
          <span className="cap-ricon">{vg ? <Camera className="size-[18px]" /> : <Scissors className="size-[18px]" />}</span>
          <div>
            <h3>{vg ? "Videografie" : "Editing"}</h3>
            <p>{vg ? "Uren: opnameduur, reistijd en opbouw" : "Video's: resterende werklast per editingstatus"}</p>
          </div>
          <div className="cap-rfree"><span className={`cap-dot ${tk}`} /><b>{tp === null ? "?" : `${tp}%`} bezet</b> · {Math.round(free)} {unit} vrij komende 4 weken</div>
        </div>
        <div className="cap-scroll">
          <table className="cap-radar" style={{ minWidth: 220 + cols.length * 86 }}>
            <thead>
              <tr>
                <th className="rl" />
                {cols.map((i) => {
                  const w = RR.weeks[i];
                  return (
                    <th key={i} className={i === 0 ? "now" : ""}>
                      {w.label}
                      <small>{i === 0 ? "deze week" : i === 1 ? "volgende week" : w.monday.slice(0, 4) !== data.today.slice(0, 4) ? w.monday.slice(0, 4) : "\u00a0"}</small>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td className="rl" colSpan={cols.length + 1}><span className="cap-s">Nog niemand gekoppeld.</span></td></tr>
              ) : null}
              {rows.map((row: any) => {
                const p = row.person;
                const fl = p.employment === "freelance";
                return (
                  <tr key={p.id}>
                    <td className="rl">
                      <button className="cap-who" onClick={() => setDrawer({ type: "person", pid: p.id })}>
                        <span className={`cap-av ${fl ? "fl" : ""}`}>{initials(p.name)}</span>
                        <span>
                          <span className="nm">{p.name}<span className={`cap-tag ${fl ? "fl" : ""}`}>{fl ? "Freelance" : "Vast"}</span></span>
                          <span className="sub">{p.capacityNote}</span>
                        </span>
                      </button>
                    </td>
                    {cols.map((i) => {
                      const c = row.cells[i];
                      const exp = vg ? c.items.some((x: any) => x.source === "verwacht") : c.parts.some((x: any) => x.item.source === "verwacht");
                      const pk = peaks(kind, p.id, i);
                      return (
                        <td key={i}>
                          <button className={`cap-pill ${c.key}`} title={`${p.name} · ${c.wk.label}: ${N(c.load)} van ${c.cap ? N(c.cap.value) : "?"} ${unit}`}
                            onClick={() => setDrawer({ type: "cell", kind, pid: p.id, i, r })}>
                            {pillText(c)}
                            {exp ? <span className="exp" /> : null}
                            {pk.length && c.key !== "rood" ? <b className="cap-pk" title={`${pk.length} ${pk.length === 1 ? "week" : "weken"} boven 100%`}>!</b> : null}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              <tr>
                <td className="rl">
                  <div className="cap-who"><span className="cap-av open">?</span><span><span className="nm">{vg ? "Freelance videograaf" : "Nog geen editor"}</span><span className="sub">{vg ? "Opnames" : "Video's"} zonder toewijzing</span></span></div>
                </td>
                {cols.map((i) => {
                  const c = open[i];
                  const n = vg ? c.count : Math.round(c.load);
                  return (
                    <td key={i}>
                      {n ? (
                        <button className="cap-pill count" onClick={() => setDrawer({ type: "cell", kind: vg ? "vgopen" : "edopen", i, r })}>
                          {n} {vg ? (n === 1 ? "opname" : "opn.") : "video's"}
                        </button>
                      ) : <span className="cap-none">·</span>}
                    </td>
                  );
                })}
              </tr>
              <tr>
                <td className="rl"><div className="cap-who"><span className="cap-av team">∑</span><span className="nm" style={{ fontWeight: 500, color: "var(--color-ink-muted)" }}>Totaal {vg ? "videografie" : "editing"}</span></div></td>
                {cols.map((i) => (
                  <td key={i}>
                    <button className={`cap-pill team ${team[i].key}`} onClick={() => setDrawer({ type: "cell", kind: vg ? "vgteam" : "edteam", i, r })}>{pillText(team[i])}</button>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  };


  return (
    <div className="cap">
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-[var(--color-ink)]">Capaciteit</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">Wie zit vol, wie heeft ruimte en waar moeten we ingrijpen.</p>
        </div>
        {canEdit ? (
          <Link href="/capaciteit/team" className="cap-btn ml-auto"><Settings2 className="size-4" />Capaciteit per persoon instellen</Link>
        ) : null}
      </div>

      {/* Kerncijfers */}
      <div className="cap-kpis">
        <button className={`cap-kpi st-${K.shootsSt.k}`} onClick={() => setDrawer({ type: "kpi", k: "shoots" })}>
          <div className="cap-l">Opnames komende 4 weken <span className={`cap-stt ${K.shootsSt.k}`}>{ST_LABEL[K.shootsSt.k]}</span></div>
          <div className="cap-v">{K.shoots.length}</div>
          <div className="cap-s">{K.shootsSt.why}</div>
        </button>
        <button className={`cap-kpi st-${K.queueSt.k}`} onClick={() => setDrawer({ type: "kpi", k: "queue" })}>
          <div className="cap-l">Editing in wachtrij <span className={`cap-stt ${K.queueSt.k}`}>{ST_LABEL[K.queueSt.k]}</span></div>
          <div className="cap-v">{K.queue} <small>+{K.fc} verwacht</small></div>
          <div className="cap-s">{K.queueSt.why}</div>
        </button>
        <button className={`cap-kpi st-${K.capK}`} onClick={() => setDrawer({ type: "kpi", k: "free" })}>
          <div className="cap-l">Beschikbare capaciteit <span className={`cap-stt ${K.capK}`}>{ST_LABEL[K.capK]}</span></div>
          <div className="cap-rows2">
            <div><span className={`cap-dot ${K.vgK}`} /><span>Videografie</span><b>{Math.round(K.vgFree)} uur vrij</b><em>{K.vgPct === null ? "?" : `${K.vgPct}%`}</em></div>
            <div><span className={`cap-dot ${K.edK}`} /><span>Editing</span><b>{Math.round(K.edFree)} video&apos;s vrij</b><em>{K.edPct === null ? "?" : `${K.edPct}%`}</em></div>
          </div>
          <div className="cap-s">Bezetting komende 4 weken</div>
        </button>
        <button className={`cap-kpi st-${K.redSt}`} onClick={() => setDrawer({ type: "kpi", k: "reds" })}>
          <div className="cap-l">Verwachte knelpunten <span className={`cap-stt ${K.redSt}`}>{ST_LABEL[K.redSt]}</span></div>
          <div className="cap-v">{K.combos.length}</div>
          <div className="cap-s">{K.combos.length ? `Eerst: ${P[K.first[0].pi].label.toLowerCase()} · ${K.first.map((c: any) => c.r.person.name).join(", ")}` : "Niemand boven de 100%"}</div>
        </button>
      </div>

      {/* Radar */}
      <div className="cap-bar">
        <h2 className="text-sm font-bold">Capaciteitsradar</h2>
        <div className="cap-seg">
          {(["alle", "editing", "videografie"] as const).map((f) => (
            <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>{{ alle: "Alles", videografie: "Videografie", editing: "Editing" }[f]}</button>
          ))}
        </div>
      </div>
      {filter !== "videografie" ? block("ed") : null}
      {filter !== "editing" ? block("vg") : null}
      <div className="cap-legend">
        <span><i style={{ background: "var(--color-good-soft)", border: "1px solid #bfe3d2" }} />Ruimte (&lt;{G}%)</span>
        <span><i style={{ background: "#fbe6c4" }} />Bijna vol ({G} t/m {O}%)</span>
        <span><i style={{ background: "var(--color-bad)" }} />Overbelast (&gt;{O}%)</span>
        <span><i style={{ background: "repeating-linear-gradient(135deg,#f1f0ec 0 3px,#e2e0da 3px 6px)" }} />Capaciteit onbekend</span>
        {mode === "overzicht" ? <span><b className="cap-pk" style={{ position: "static", display: "inline-grid", marginRight: 6 }}>!</b>Piekweek boven 100% binnen de periode</span> : null}
        <span><span className="cap-dot" style={{ background: "var(--color-good)", opacity: 0.6, marginRight: 6 }} />Bevat verwacht werk uit pakket</span>
      </div>

      {/* Signalering */}
      <div className="cap-sighead">
        <h2>Signalering</h2>
        <span className="meta">{signals.length ? `${urgentCount} urgent · ${Math.min(3, signals.length)} belangrijkste van ${signals.length}` : "Geen signalen"}</span>
        {signals.length > 3 ? <button onClick={() => setShowAll(!showAll)}>{showAll ? "Alleen top 3" : `Alle ${signals.length} tonen`}</button> : null}
        {SIG.hiddenCount ? <button onClick={() => { setSnoozed([]); try { window.localStorage.removeItem(SNOOZE_KEY); } catch { /* */ } }}>{SIG.hiddenCount} verborgen · herstel</button> : null}
      </div>
      <div className="cap-sigs">
        {shown.length ? shown.map((s: any) => {
          const urgent = s.week < 6;
          return (
            <div key={s.id} className={`cap-sig ${urgent ? "urgent" : "attn"}`}>
              <div className="area"><span className="lvl">{urgent ? "URGENT" : "AANDACHT"}</span><br />{s.area}</div>
              <div><div className="t">{s.title}</div><div className="a"><b>Advies:</b> {s.advice}</div></div>
              <div className="acts">
                <button className="cap-btn" onClick={() => setDrawer({ type: "cell", kind: s.cell.kind, pid: s.cell.pid, i: s.cell.i, r: "w" })}>Details</button>
                <button className="cap-btn ghost" onClick={() => snooze(s.id)}>Verbergen</button>
              </div>
            </div>
          );
        }) : <div className="cap-empty">Geen knelpunten in de komende drie maanden.</div>}
      </div>

      {drawer ? (
        <>
          <div className="cap-scrim" onClick={() => setDrawer(null)} />
          <aside className="cap-drawer">
            <DrawerBody d={drawer} R={R} RP={RP} WMAP={WMAP} K={K} P={P} st={st} SIG={SIG} data={data} setDrawer={setDrawer} peaks={peaks} />
          </aside>
        </>
      ) : null}
    </div>
  );
}

/* ---------------- detailvenster ---------------- */
function DrawerBody({ d, R, RP, WMAP, K, P, st, SIG, data, setDrawer, peaks }: any) {
  const close = <button className="x" onClick={() => setDrawer(null)} aria-label="Sluiten">×</button>;
  const src = (s: string) => <span className={`cap-src ${s}`}>{SRC_LABEL[s] ?? s}</span>;
  const meter = (pct: number | null, k: string) => <div className="cap-meter"><span style={{ width: `${Math.min(100, pct ?? 0)}%`, background: STATUS_COLOR[k] }} /></div>;
  const head = (t: string, sub: string) => <div className="cap-dh"><div><h3>{t}</h3><p>{sub}</p></div>{close}</div>;
  const prodLink = (id: string) => <Link className="cap-btn" href={`/productions/${id}`}>Openen</Link>;
  const phaseText = (c: Record<string, number>) => {
    const L: Record<string, string> = { beschikbaar: "beschikbaar voor editing", bezig: "editing bezig", review: "interne review", bijKlant: "feedback klant", feedback: "feedback verwerken" };
    return Object.entries(c).filter(([, v]) => v).map(([k, v]) => `${v} ${L[k] ?? k}`).join(" · ");
  };
  const solutions = (kind: string, pid: string | undefined, i: number) =>
    SIG.all.filter((s: any) => s.cell && s.cell.kind === kind && s.cell.i === i && (!pid || s.cell.pid === pid))
      .map((s: any) => <div className="cap-sol" key={s.id}><b>{s.title}</b><br />{s.advice}</div>);

  if (d.type === "cell") {
    const S = d.r === "p" ? RP : R;
    const i = d.i; const wk = S.weeks[i]; const per = d.r === "p";
    const weekStrip = (kind: "vg" | "ed", pid: string) => {
      const row = (kind === "vg" ? R.vgRows : R.edRows).find((r: any) => r.person.id === pid);
      const ws = row.cells.map((c: any, wi: number) => ({ c, wi })).filter(({ wi }: any) => WMAP[wi] === i);
      return (
        <>
          <div className="cap-dsec">Per week</div>
          <div className="cap-chips">{ws.map(({ c, wi }: any) => (
            <button key={wi} className={`cap-pill cap-wk ${c.key}`} onClick={() => setDrawer({ type: "cell", kind, pid, i: wi, r: "w" })}><span>wk {c.wk.num}</span>{pillText(c)}</button>
          ))}</div>
        </>
      );
    };
    if (d.kind === "vg" || d.kind === "ed") {
      const vg = d.kind === "vg";
      const row = (vg ? S.vgRows : S.edRows).find((r: any) => r.person.id === d.pid);
      if (!row) return head("Niet gevonden", "");
      const c = row.cells[i]; const p = row.person;
      const pk = per ? peaks(d.kind, p.id, i) : [];
      const items = vg ? [...c.items].sort((a: any, b: any) => (a.date + (a.start ?? "")).localeCompare(b.date + (b.start ?? ""))) : [...c.parts].sort((a: any, b: any) => b.amount - a.amount);
      return (
        <>
          {head(`${p.name} · ${wk.label}`, `${wk.range} · ${vg ? "videografie" : "editing"}`)}
          <div className="cap-db">
            <div className="cap-big">
              <div className={`p ${c.key}`}>{pillText(c)}</div>
              <div className="nums">
                <b>{N(c.load)} {vg ? "uur" : "video's"}</b> ingepland{vg ? ` (${c.count} ${c.count === 1 ? "opname" : "opnames"})` : ""}<br />
                {c.cap ? <><b>{N(c.cap.value)}</b> capaciteit · <b>{N(Math.max(0, c.cap.value - c.load))}</b> vrij</> : "Capaciteit niet vastgelegd"}
                {meter(c.pct, c.key)}
              </div>
            </div>
            {per ? weekStrip(d.kind, p.id) : null}
            <div className="cap-dsec">Geplande opdrachten</div>
            {items.length ? (
              <div className="cap-list">
                {vg ? items.map((x: any) => (
                  <div className="cap-li" key={x.id}>
                    <div className="d">{E.fmtDayLong(x.date)}{x.start ? <><br />{x.start}</> : null}</div>
                    <div className="m"><b>{x.clientName}</b>{src(x.source)}<small>{N(x.dur)} u opname + {N(x.travel)} u reistijd + {N(st.settings.setupHours)} u opbouw · {x.shorts} video&apos;s</small></div>
                    {x.source !== "verwacht" ? prodLink(x.id) : null}
                  </div>
                )) : items.map(({ item: x, amount }: any) => (
                  <div className="cap-li" key={x.id}>
                    <div className="d">{N(amount)}<br /><span style={{ fontSize: 10.5 }}>deze periode</span></div>
                    <div className="m"><b>{x.clientName}</b>{src(x.source)}
                      <small>{x.source === "bevestigd" ? phaseText(x.counts) : `${x.videos} video's · opname ${E.fmtDayLong(x.date)}`}<br />Editordeadline {E.fmtDayLong(x.editorDue)} · klant {E.fmtDay(x.clientDue)}</small>
                    </div>
                    {x.source !== "verwacht" ? prodLink(x.id) : null}
                  </div>
                ))}
              </div>
            ) : <div className="cap-ok">Niets ingepland.</div>}
            <div className="cap-dsec">Conflicten</div>
            {c.conflicts.length ? c.conflicts.map((x: string) => <div className="cap-conf" key={x}>{x}</div>) : <div className="cap-ok">Geen conflicten.</div>}
            {(c.key === "rood" || pk.length) ? (
              <>
                <div className="cap-dsec">Mogelijke oplossingen</div>
                {per ? pk.map(({ wi }: any) => solutions(d.kind, p.id, wi)) : solutions(d.kind, p.id, i)}
              </>
            ) : null}
            <p className="cap-note">{vg
              ? "Een opname telt niet als hele werkdag: duur, reistijd en opbouw tellen in uren."
              : "Werklast is het resterende werk per editingfase. Elke opname telt één keer, op de huidige fase. Voorspelde video's worden vanzelf bevestigd zodra de opname is geweest."}</p>
          </div>
        </>
      );
    }
    if (d.kind === "vgopen" || d.kind === "edopen") {
      const vg = d.kind === "vgopen";
      const c = (vg ? S.vgOpen : S.edOpen)[i];
      return (
        <>
          {head(`${vg ? "Opnames zonder videograaf" : "Video's zonder editor"} · ${wk.label}`, wk.range)}
          <div className="cap-db">
            <div className="cap-list">
              {vg ? c.items.map((x: any) => (
                <div className="cap-li" key={x.id}><div className="d">{E.fmtDayLong(x.date)}</div><div className="m"><b>{x.clientName}</b><small>{N(x.hours)} uur incl. reistijd · {x.shorts} video&apos;s</small></div>{prodLink(x.id)}</div>
              )) : c.parts.map(({ item: x, amount }: any) => (
                <div className="cap-li" key={x.id}><div className="d">{N(amount)}</div><div className="m"><b>{x.clientName}</b>{src(x.source)}<small>Editordeadline {E.fmtDayLong(x.editorDue)}</small></div>{prodLink(x.id)}</div>
              ))}
            </div>
            <div className="cap-dsec">Mogelijke oplossingen</div>
            {solutions(d.kind, undefined, i)}
            <p className="cap-note">Toewijzen doe je op de opname zelf. De radar werkt daarna vanzelf bij.</p>
          </div>
        </>
      );
    }
    const vg = d.kind === "vgteam";
    const t = (vg ? S.vgTeam : S.edTeam)[i]; const rows = vg ? S.vgRows : S.edRows;
    return (
      <>
        {head(`Totaal ${vg ? "videografie" : "editing"} · ${wk.label}`, wk.range)}
        <div className="cap-db">
          <div className="cap-big"><div className={`p ${t.key}`}>{pillText(t)}</div><div className="nums"><b>{N(t.load)}</b> ingepland, inclusief niet toegewezen<br /><b>{N(t.cap)}</b> bekende capaciteit{meter(t.pct, t.key)}</div></div>
          <div className="cap-list">
            {rows.map((r: any) => { const c = r.cells[i]; return (
              <div className="cap-li" key={r.person.id}><div className="m"><b>{r.person.name}</b><small>{N(c.load)} van {c.cap ? N(c.cap.value) : "?"}</small></div><span className={`cap-pill ${c.key}`} style={{ width: 64 }}>{pillText(c)}</span></div>
            ); })}
          </div>
          <p className="cap-note">Mensen zonder vastgelegde capaciteit tellen niet mee als ruimte. Zo lijkt het team nooit ruimer dan het is.</p>
        </div>
      </>
    );
  }

  if (d.type === "person") {
    const p = data.people.find((x: any) => x.id === d.pid);
    if (!p) return head("Niet gevonden", "");
    const vg = p.role === "videograaf";
    const row = (vg ? R.vgRows : R.edRows).find((r: any) => r.person.id === p.id);
    const items = vg
      ? R.vgItems.filter((x: any) => x.vg === p.id && x.date >= data.today).sort((a: any, b: any) => a.date.localeCompare(b.date))
      : R.edItems.filter((x: any) => x.editor === p.id && x.open > 0).sort((a: any, b: any) => a.editorDue.localeCompare(b.editorDue));
    return (
      <>
        {head(p.name, `${vg ? "Videograaf" : "Editor"} · ${p.employment} · ${p.capacityNote ?? ""}`)}
        <div className="cap-db">
          <div className="cap-dsec" style={{ marginTop: 0 }}>Komende 8 weken</div>
          <div className="cap-chips">{row.cells.slice(0, 8).map((c: any, wi: number) => (
            <button key={wi} className={`cap-pill cap-wk ${c.key}`} onClick={() => setDrawer({ type: "cell", kind: vg ? "vg" : "ed", pid: p.id, i: wi, r: "w" })}><span>wk {c.wk.num}</span>{pillText(c)}</button>
          ))}</div>
          {p.leave?.length ? <><div className="cap-dsec">Afwezig (uit Vakantie en eigen beschikbaarheid)</div><div className="cap-chips">{p.leave.map(([a, b]: string[]) => <span className="cap-chip" key={a}>{E.fmtDay(a)} t/m {E.fmtDay(b)}</span>)}</div></> : null}
          <div className="cap-dsec">{vg ? "Geplande opnames" : "Lopende en verwachte opdrachten"}</div>
          {items.length ? (
            <div className="cap-list">{items.slice(0, 20).map((x: any) => (
              <div className="cap-li" key={x.id}>
                <div className="d">{vg ? E.fmtDayLong(x.date) : E.fmtDay(x.editorDue)}</div>
                <div className="m"><b>{x.clientName}</b>{src(x.source)}<small>{vg ? `${N(x.hours)} uur incl. reistijd · ${x.shorts} video's` : x.source === "bevestigd" ? phaseText(x.counts) : `${x.videos} video's · opname ${E.fmtDay(x.date)}`}</small></div>
              </div>
            ))}</div>
          ) : <div className="cap-ok">Niets ingepland.</div>}
          {!p.pattern ? <p className="cap-note">Capaciteit is nog niet vastgelegd, daarom is deze rij grijs. Jarno stelt dit in via Capaciteit per persoon instellen.</p> : null}
        </div>
      </>
    );
  }

  // kerncijfers
  if (d.k === "shoots") return (
    <>
      {head("Opnames komende 4 weken", "Uit Google Agenda")}
      <div className="cap-db"><div className="cap-list">{[...K.shoots].sort((a: any, b: any) => a.date.localeCompare(b.date)).map((x: any) => (
        <div className="cap-li" key={x.id}><div className="d">{E.fmtDayLong(x.date)}</div><div className="m"><b>{x.clientName}</b><small>{x.vg ? data.people.find((p: any) => p.id === x.vg)?.name ?? "Videograaf" : "Freelance videograaf"} · {N(x.hours)} uur · {x.shorts} video&apos;s</small></div>{prodLink(x.id)}</div>
      ))}</div></div>
    </>
  );
  if (d.k === "queue") {
    const fc = R.edItems.filter((x: any) => x.source === "voorspeld" && x.date <= R.weeks[3].friday);
    return (
      <>
        {head("Editing in wachtrij", "Video's die nog editingcapaciteit nodig hebben")}
        <div className="cap-db">
          <div className="cap-dsec" style={{ marginTop: 0 }}>Lopend ({K.queue} video&apos;s)</div>
          <div className="cap-list">{K.conf.filter((x: any) => x.open > 0).map((x: any) => (
            <div className="cap-li" key={x.id}><div className="d">{E.fmtDay(x.editorDue)}</div><div className="m"><b>{x.clientName}</b><small>{phaseText(x.counts)} · {x.editor ? data.people.find((p: any) => p.id === x.editor)?.name ?? "Editor" : "Nog geen editor"}</small></div>{prodLink(x.id)}</div>
          ))}</div>
          {data.stale.length ? (
            <>
              <div className="cap-dsec">Status niet bijgewerkt ({data.stale.length})</div>
              <p className="cap-note" style={{ marginTop: 0, marginBottom: 8 }}>Deze opnames zijn ruim over de klantdeadline maar staan nog niet op Afgerond. Ze tellen niet mee als werk. Zet de status goed op de Editingpagina.</p>
              <div className="cap-list">{data.stale.map((x: any) => (
                <div className="cap-li" key={x.id}><div className="d">{E.fmtDay(x.date)}</div><div className="m"><b>{x.clientName}</b><small>Fase: {x.editStatus.replace(/_/g, " ")}</small></div>{prodLink(x.id)}</div>
              ))}</div>
            </>
          ) : null}
          <div className="cap-dsec">Verwacht uit geplande opnames ({K.fc} video&apos;s)</div>
          <div className="cap-list">{fc.map((x: any) => (
            <div className="cap-li" key={x.id}><div className="d">{E.fmtDay(x.handover)}</div><div className="m"><b>{x.clientName}</b><small>{x.videos} video&apos;s · bij editor {E.fmtDayLong(x.handover)}</small></div>{prodLink(x.id)}</div>
          ))}</div>
        </div>
      </>
    );
  }
  if (d.k === "free") {
    const tbl = (rows: any[]) => (
      <div className="cap-list">{rows.map((r: any) => (
        <div className="cap-li" key={r.person.id}><div className="m"><b>{r.person.name}</b></div>
          {[0, 1, 2, 3].map((i) => { const c = r.cells[i]; return <span key={i} style={{ width: 54, textAlign: "right", fontSize: 12 }}>{c.cap ? N(Math.max(0, c.cap.value - c.load)) : "?"}</span>; })}
        </div>
      ))}</div>
    );
    return (
      <>
        {head("Beschikbare capaciteit", `Vrije ruimte per week · weken ${R.weeks.slice(0, 4).map((w: any) => w.num).join(", ")}`)}
        <div className="cap-db">
          <div className="cap-dsec" style={{ marginTop: 0 }}>Videografie · uren vrij</div>{tbl(R.vgRows)}
          <div className="cap-dsec">Editing · video&apos;s vrij</div>{tbl(R.edRows)}
          <p className="cap-note">Een vraagteken betekent dat de capaciteit niet is vastgelegd. Die ruimte telt niet mee.</p>
        </div>
      </>
    );
  }
  const groups = K.combos.map(({ r, pi }: any) => ({ r, pi, weeks: K.reds.filter((x: any) => x.r === r && x.pi === pi) }));
  return (
    <>
      {head("Verwachte knelpunten", `Per persoon en periode, tot en met ${P[P.length - 1].label.toLowerCase()}`)}
      <div className="cap-db">
        {groups.length ? <div className="cap-list">{groups.map(({ r, pi, weeks }: any) => (
          <div className="cap-li" key={`${r.person.id}-${pi}`}>
            <div className="d">{P[pi].label}</div>
            <div className="m"><b>{r.person.name}</b><small>{weeks.length} {weeks.length === 1 ? "week" : "weken"} boven {st.settings.orangeMax}%</small>
              <div className="cap-chips" style={{ marginTop: 6 }}>{weeks.map(({ i, c }: any) => (
                <button key={i} className="cap-btn" onClick={() => setDrawer({ type: "cell", kind: r.person.role === "videograaf" ? "vg" : "ed", pid: r.person.id, i, r: "w" })}>wk {c.wk.num} · {pillText(c)}</button>
              ))}</div>
            </div>
          </div>
        ))}</div> : <div className="cap-ok">Geen knelpunten.</div>}
      </div>
    </>
  );
}
