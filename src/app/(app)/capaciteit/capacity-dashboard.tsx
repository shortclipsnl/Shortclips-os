"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Camera, Scissors, Settings2 } from "lucide-react";
import CapEngine from "@/lib/capacity-engine";

// De rekenmotor is pure JavaScript (gedeeld met het prototype); hier ongetypeerd.
const E: any = CapEngine;
import type { CapacityData } from "@/server/capacity-forecast";
import { Avatar } from "@/components/ui";
import "./capacity.css";

type Drawer =
  | { type: "cell"; kind: string; pid?: string; i: number; r: "p" | "w" }
  | { type: "kpi"; k: string }
  | { type: "person"; pid: string }
  | null;

const ST_LABEL: Record<string, string> = { groen: "Gezond", oranje: "Let op", rood: "Probleem" };
const SRC_LABEL: Record<string, string> = { bevestigd: "Opgenomen", voorspeld: "Ingepland", verwacht: "Verwacht uit pakket", simulatie: "Simulatie" };
const STATUS_COLOR: Record<string, string> = { groen: "var(--cap-g-fg)", oranje: "var(--cap-o-fg)", rood: "var(--cap-r-solid)", grijs: "var(--cap-grey)", vrij: "var(--cap-grey)" };
const N = (x: number) => (Math.round(x * 10) / 10).toString().replace(".", ",");
// Capaciteit onbekend: geen percentage, wel het geplande werk (zo verdwijnt er niets uit beeld).
const pillText = (c: any, unit?: string) =>
  c.key === "grijs" ? (c.load > 0.05 ? `${Math.round(c.load)} ${unit === "uur" ? "u" : "v."}` : "?")
  : c.key === "vrij" ? "Vrij" : c.pct === null ? "!" : `${c.pct}%`;
const SHORTS_SRC: Record<string, string> = { "video's": "", ingevuld: "", pakket: "aantal uit pakket", onbekend: "aantal onbekend" };
const SNOOZE_KEY = "cap-snoozed-v1";

export function CapacityDashboard({ data, canEdit }: { data: CapacityData; canEdit: boolean }) {
  // Altijd per week (met datums), doorlopend tot en met februari.
  const mode = "week" as "overzicht" | "week";
  const [filter, setFilter] = useState<"alle" | "videografie" | "editing">("alle");
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [showAll, setShowAll] = useState(false);
  const [snoozed, setSnoozed] = useState<string[]>([]);
  const router = useRouter();
  // De radar leest live uit Opnames en Editing. Elke minuut en bij terugkeren
  // naar het tabblad opnieuw ophalen, zodat een planningswijziging direct zichtbaar is.
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") router.refresh(); };
    const t = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(t); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [router]);
  // Esc sluit het zijpaneel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDrawer(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
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
        <div className="cap-scroll" onScroll={(e) => e.currentTarget.classList.toggle("is-scrolled", e.currentTarget.scrollLeft > 2)}>
          <table className="cap-radar" style={{ minWidth: 240 + cols.length * 112 }}>
            <thead>
              <tr>
                <th className="rl" />
                {cols.map((i) => {
                  const w = RR.weeks[i];
                  return (
                    <th key={i} className={`wkcol ${i === 0 ? "now" : ""}`}>
                      <span className="cap-wh">
                        <span className="cap-whn">Week {w.num ?? E.isoWeek(w.monday)}</span>
                        <span className="cap-whd">{w.label}</span>
                        <span className="cap-whs">{i === 0 ? "Deze week" : i === 1 ? "Volgende week" : w.monday.slice(0, 4) !== data.today.slice(0, 4) ? w.monday.slice(0, 4) : "\u00a0"}</span>
                      </span>
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
                        <span className={`cap-ph ${fl ? "fl" : ""}`}><Avatar name={p.name} src={p.avatarUrl} size={36} color="var(--color-indigo-ink)" /></span>
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
                        <td key={i} className={i === 0 ? "now" : ""}>
                          <button className={`cap-pill ${c.key}`} title={`${p.name} · ${c.wk.label}: ${N(c.load)} van ${c.cap ? N(c.cap.value) : "?"} ${unit}. Klik voor de opdrachten.`}
                            aria-label={`${p.name}, week ${c.wk.num}: ${c.pct === null ? "capaciteit onbekend" : `${c.pct} procent bezet`}. Toon opdrachten.`}
                            onClick={() => setDrawer({ type: "cell", kind, pid: p.id, i, r })}>
                            {pillText(c, unit)}
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
                    <td key={i} className={i === 0 ? "now" : ""}>
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
                  <td key={i} className={i === 0 ? "now" : ""}>
                    <button className={`cap-pill team ${team[i].key}`} onClick={() => setDrawer({ type: "cell", kind: vg ? "vgteam" : "edteam", i, r })}>{pillText(team[i], unit)}</button>
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

      <SourcesBar data={data} R={R} />

      {/* Kerncijfers */}
      <div className="cap-kpis">
        <button className={`cap-kpi st-${K.shootsSt.k}`} onClick={() => setDrawer({ type: "kpi", k: "shoots" })}>
          <div className="cap-l">Opnames komende 4 weken <span className={`cap-stt ${K.shootsSt.k}`}>{ST_LABEL[K.shootsSt.k]}</span></div>
          <div className="cap-v">{K.shoots.length}</div>
          <div className="cap-s">{K.shootsSt.why}</div>
        </button>
        <button className={`cap-kpi st-${K.queueSt.k}`} onClick={() => setDrawer({ type: "kpi", k: "queue" })}>
          <div className="cap-l">Editing in wachtrij <span className={`cap-stt ${K.queueSt.k}`}>{ST_LABEL[K.queueSt.k]}</span></div>
          <div className="cap-v">{K.queue} <small>+{K.fc} ingepland</small></div>
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
        <span><i className="lg-groen" />Ruimte (&lt;{G}%)</span>
        <span><i className="lg-oranje" />Bijna vol ({G} t/m {O}%)</span>
        <span><i className="lg-rood" />Overbelast (&gt;{O}%)</span>
        <span><i className="lg-grijs" />Capaciteit niet ingesteld (aantal video&apos;s zichtbaar)</span>
        <span className="hint">Klik op een percentage voor de opdrachten erachter</span>
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
    if (d.kind === "ed" && !per) return <EdPanel pid={d.pid} i={i} R={R} st={st} data={data} head={head} prodLink={prodLink} setDrawer={setDrawer} />;
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
              <div className={`p ${c.key}`}>{pillText(c, vg ? "uur" : "video's")}</div>
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
          <div className="cap-big"><div className={`p ${t.key}`}>{pillText(t)}</div><div className="nums"><b>{N(t.load)}</b> ingepland, inclusief niet toegewezen<br /><b>{N(t.cap)}</b> bekende capaciteit{!vg && t.unknownLoad ? <><br /><b>{N(t.unknownLoad)}</b> video&apos;s bij editors zonder ingestelde capaciteit (niet in dit percentage)</> : null}{meter(t.pct, t.key)}</div></div>
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
          <div className="cap-dsec">Ingepland, opname nog niet geweest ({K.fc} video&apos;s)</div>
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

/* ---------------- bronnen en ontbrekende gegevens ---------------- */
function SourcesBar({ data, R }: { data: CapacityData; R: any }) {
  const noCap = data.people.filter((p) => p.role === "editor" && !p.shortsPerWeek).map((p) => p.name);
  const horizonEnd = R.weeks[R.weeks.length - 1].friday;
  const inH = (x: any) => x.date >= data.today && x.date <= horizonEnd;
  const pakket = data.shoots.filter((x) => inH(x) && x.shortsSource === "pakket").length
    + data.projects.filter((x) => x.shortsSource === "pakket").length;
  const unknown = [...data.shoots.filter((x) => inH(x) && x.shortsSource === "onbekend"), ...data.projects.filter((x) => x.shortsSource === "onbekend")];
  const noEditor = data.shoots.filter((x) => inH(x) && !x.editor).length;
  return (
    <div className="cap-sources">
      <span className="lbl">Bron</span>
      <span className="it">Opnames uit Google Agenda</span>
      <span className="it">Editingplanning (editor en status per video)</span>
      <span className="it">Ingestelde capaciteit per persoon</span>
      <span className="it">Vakantie en beschikbaarheid</span>
      <span className="sync">Live bijgewerkt · {data.generatedAt}</span>
      {noCap.length || unknown.length || pakket || noEditor ? (
        <div className="cap-miss">
          {noCap.length ? <span><b>Capaciteit niet ingesteld:</b> {noCap.join(", ")}. Daar staat geen percentage, alleen het aantal video&apos;s.</span> : null}
          {unknown.length ? <span><b>Aantal video&apos;s onbekend:</b> {unknown.map((x) => x.clientName).join(", ")}. Telt als 0 tot het op de opname is ingevuld.</span> : null}
          {pakket ? <span><b>{pakket} {pakket === 1 ? "opname" : "opnames"}</b> zonder ingevuld aantal video&apos;s; het pakket van de klant is gebruikt.</span> : null}
          {noEditor ? <span><b>{noEditor} {noEditor === 1 ? "opname" : "opnames"}</b> nog zonder editor (rij Nog geen editor).</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/* ---------------- zijpaneel: één editor in één week ---------------- */
function EdPanel({ pid, i, R, st, data, head, prodLink, setDrawer }: any) {
  const engineData = { people: data.people, clients: data.clients, shoots: data.shoots, projects: data.projects };
  const D = useMemo(() => E.editorCellDetail(engineData, st, R, pid, i, []), [R, pid, i]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!D) return head("Niet gevonden", "");
  const { cell: c, cap, rows, excess, others, moves, missing } = D;
  const p = D.row.person; const wk = c.wk;
  const over = c.key === "rood";
  const nameOf = (id: string | null) => (id ? data.people.find((x: any) => x.id === id)?.name ?? "Onbekend" : "Nog geen editor");
  const causes = rows.filter((r: any) => r.cause);
  const risks = rows.filter((r: any) => r.risk);
  const total = rows.reduce((a: number, r: any) => a + r.amount, 0);
  return (
    <>
      {head(`${p.name} · week ${wk.num}`, `${wk.range} · editing`)}
      <div className="cap-db">
        <div className={`cap-big st-${c.key}`}>
          <div className={`p ${c.key}`}>{c.pct === null ? (cap === 0 ? "Afwezig" : "?") : `${c.pct}%`}</div>
          <div className="nums">
            <b>{N(total)} video&apos;s</b> werk deze week · {rows.length} {rows.length === 1 ? "opdracht" : "opdrachten"}<br />
            {cap === null ? <>Capaciteit niet ingesteld</>
              : <><b>{N(cap)}</b> capaciteit deze week · {excess ? <b className="t-bad">{N(excess)} boven capaciteit</b> : <><b>{N(Math.max(0, cap - c.load))}</b> vrij</>}</>}
            {c.pct !== null ? <div className="cap-meter"><span style={{ width: `${Math.min(100, c.pct)}%`, background: STATUS_COLOR[c.key] }} /></div> : null}
          </div>
        </div>
        {cap === null ? <div className="cap-warn">Voor {p.name} is geen capaciteit ingesteld. Daarom berekenen we geen percentage; het geplande werk staat hieronder wel. Stel de capaciteit in via Capaciteit per persoon instellen.</div> : null}
        {missing.length ? <div className="cap-warn">Bij {missing.map((x: any) => x.clientName).join(", ")} is het aantal video&apos;s niet op de opname ingevuld. {missing.some((x: any) => x.shortsSource === "onbekend") ? "Waar ook geen pakket bekend is, telt het als 0." : "Het pakket van de klant is gebruikt."}</div> : null}

        <div className="cap-dsec">Opdrachten deze week</div>
        {rows.length ? (
          <div className="cap-ops">
            {rows.map((r: any) => {
              const x = r.item;
              const inW = cap ? Math.min(100, ((r.amount - r.over) / cap) * 100) : 0;
              const ovW = cap ? Math.min(100 - inW, (r.over / cap) * 100) : 0;
              return (
                <div className={`cap-op ${r.cause ? "cause" : ""}`} key={x.id}>
                  <div className="top">
                    <b className="cl">{x.clientName}</b>
                    {r.cause ? <span className="tag bad">Veroorzaakt overbelasting</span> : null}
                    {r.risk ? <span className="tag bad-soft">Deadline in gevaar</span> : null}
                    {!r.movable ? <span className="tag">Al gestart</span> : x.source === "voorspeld" ? <span className="tag info">Opname {E.fmtDay(x.date)}</span> : null}
                    <span className="sp" />
                    {prodLink(x.id)}
                  </div>
                  <div className="facts">
                    <div><span>Video&apos;s</span><b>{x.videos}</b>{SHORTS_SRC[x.shortsSource] ? <em>{SHORTS_SRC[x.shortsSource]}</em> : null}</div>
                    <div><span>Deze week</span><b>{N(r.amount)}</b><em>{r.share === null ? "capaciteit onbekend" : `${r.share}% van capaciteit`}</em></div>
                    <div><span>Editing</span><b>{E.fmtDay(x.handover ?? x.date)} – {E.fmtDay(x.editorDue)}</b><em>opname {E.fmtDayLong(x.date)}</em></div>
                    <div><span>Deadline</span><b className={r.risk ? "t-bad" : ""}>editor {E.fmtDay(x.editorDue)}</b><em>klant {E.fmtDay(x.clientDue)}</em></div>
                  </div>
                  {x.videoStatus?.length ? <div className="sts">{x.videoStatus.map((v: any) => <span key={v.label}>{v.n} × {v.label}</span>)}</div> : null}
                  {cap ? <div className="share"><span className="in" style={{ width: `${inW}%` }} /><span className="ov" style={{ width: `${ovW}%` }} /></div> : null}
                </div>
              );
            })}
          </div>
        ) : <div className="cap-ok">Niets ingepland in deze week.</div>}

        {over ? (
          <>
            <div className="cap-dsec">Overbelasting</div>
            <ol className="cap-ovl">
              <li><b>Veroorzakers</b>{causes.length ? causes.map((r: any) => `${r.item.clientName} (${N(r.over)} van ${N(r.amount)} past niet)`).join(" · ") : cap === 0 ? `${p.name} is deze week afwezig; al het werk valt erbuiten.` : "Al het werk samen; geen enkele opdracht valt erbuiten."}</li>
              <li><b>Boven capaciteit</b>{excess !== null ? `${N(excess)} video's` : `${N(c.load)} video's (afwezig)`}</li>
              <li><b>Deadlines in gevaar</b>{risks.length ? risks.map((r: any) => `${r.item.clientName}: editor ${E.fmtDayLong(r.item.editorDue)}, klant ${E.fmtDay(r.item.clientDue)}`).join(" · ") : "Geen editordeadline in deze week; het werk schuift door, let op de week erna."}</li>
              <li><b>Ruimte bij andere editors (week {wk.num})</b>
                <span className="cap-chips" style={{ marginTop: 4 }}>{others.map((o: any) => (
                  <button key={o.person.id} className={`cap-chip st-${o.key}`} onClick={() => setDrawer({ type: "cell", kind: "ed", pid: o.person.id, i, r: "w" })}>
                    {o.person.name} · {o.free === null ? "capaciteit onbekend" : `${N(o.free)} vrij (${o.pct ?? 0}%)`}
                  </button>
                ))}</span>
              </li>
              <li><b>Mogelijke verschuivingen</b>
                {moves.length ? (
                  <span className="cap-moves">{moves.map((m: any) => (
                    <span className="mv" key={m.item.id + m.to.id}>
                      <span>{m.item.clientName} ({m.item.videos} video&apos;s) naar <b>{m.to.name}</b></span>
                      <small>Daarna {p.name} {m.srcPct === null ? "?" : `${m.srcPct}%`} · {m.to.name} max {m.toPeak}% (wk {m.toWeeks.map((w: any) => w.num).join(", ")}){m.solves ? " · lost het op" : ""}</small>
                    </span>
                  ))}</span>
                ) : <span>Geen verschuiving binnen het team waarbij een andere editor onder de grens blijft. {rows.some((r: any) => !r.movable) ? "Werk dat al gestart is, verplaatsen we niet. " : ""}Overweeg een extra freelance editor of overleg over de deadline.</span>}
              </li>
            </ol>
            <p className="cap-note">Voorstellen worden niet automatisch uitgevoerd. Ben je het eens, wijzig dan de editor op de opname (Openen); de radar werkt zich daarna vanzelf bij.</p>
          </>
        ) : null}

        {c.conflicts.length ? <><div className="cap-dsec">Conflicten</div>{c.conflicts.map((x: string) => <div className="cap-conf" key={x}>{x}</div>)}</> : null}
        <p className="cap-note">Werklast per week: video&apos;s die nog bewerkt moeten worden, verdeeld over de werkdagen tussen beelden bij editor (opname + 1 werkdag) en editordeadline (opname + 7 werkdagen). Video&apos;s die al in edit zijn tellen voor de helft, in review 10%, bij de klant of in feedback 25%. Goedgekeurde en geplaatste video&apos;s tellen niet meer. Elke opname telt één keer. Editor: {nameOf(p.id)}.</p>
      </div>
    </>
  );
}
