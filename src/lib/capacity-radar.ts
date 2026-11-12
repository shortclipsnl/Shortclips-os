/**
 * Capaciteitsradar: pure rekenmotor (geen database, geen React).
 *
 * Draait zowel op de server (Vandaag-blok) als in de browser (radar en
 * proefplanning). Alle invoer komt uit bestaande portaaldata: opnames
 * (Google Agenda → production_days), editingprojecten (deliverables) en de
 * capaciteit per persoon (capacity_people).
 *
 * Uitgangspunten:
 *  - Opnames kosten uren: opnameduur + reistijd + vaste op- en afbouwtijd.
 *  - Montage kost video's. Een opname levert 6 tot 8 video's en gaat altijd als
 *    één pakket naar één editor: advies en verplaatsen gaan nooit over losse
 *    video's.
 *  - Een opname die nog moet plaatsvinden wordt voorspeld: eerste versie over
 *    opname +1 t/m +7 werkdagen, feedback verwerken op +10 t/m +12 werkdagen.
 *    Zodra er echt editingwerk loopt, vervangt dat de voorspelling.
 *  - Geen capaciteit vastgelegd = "onbekend", nooit automatisch groen.
 */

export type RadarKind = "video" | "edit";
export type RadarStatus = "green" | "orange" | "red" | "grey" | "off";
export type ProjectStatus = "beschikbaar" | "bezig" | "intern" | "klant" | "feedback";
export type ItemKind = "bevestigd" | "voorspeld" | "sim";

export type RadarPerson = {
  id: string;
  name: string;
  kind: RadarKind;
  employment: "vast" | "freelance";
  group: "vast" | "pool";
  /** Videografen: beschikbare uren per week (null = onbekend). */
  hoursPerWeek?: number | null;
  /** Videografen: dagen per week, alleen voor weergave. */
  daysPerWeek?: number | null;
  /** Editors: video's per week (null = onbekend). */
  videosPerWeek?: number | null;
  /** Afwezigheid (verlof, vrije dagen), inclusief begin en eind. */
  absences: { from: string; to: string; label?: string }[];
  /** Mag deze persoon een opname of pakket toegewezen krijgen? */
  assignable?: boolean;
  /** Telt de capaciteit mee in het teamtotaal? (De eigenaar niet: die filmt alleen bij uitzondering.) */
  inTeam?: boolean;
};

export type RadarShoot = {
  id: string;
  date: string; // YYYY-MM-DD
  start: string | null; // HH:MM
  durationH: number;
  travelH: number;
  clientName: string;
  clientSlug: string | null;
  videographerId: string | null;
  editorId: string | null;
  videos: number;
  videosSource: "gepland" | "pakket" | "standaard";
  sim?: boolean;
};

export type RadarProject = {
  id: string;
  /** Pakket-sleutel: opname-id als die bekend is, anders project-id. */
  batchId: string;
  clientName: string;
  editorId: string;
  videos: number;
  status: ProjectStatus;
  shootOn: string;
};

export type RadarSettings = {
  green: number; // groen tot dit percentage
  red: number; // rood boven dit percentage
  extraPerShoot: number; // uur op- en afbouw per opname
  avgShootHours: number; // gemiddelde opname incl. reistijd, voor "nog X opnames"
  editorLeadDays: number; // eerste versie: opname + N werkdagen
  clientLeadDays: number; // klantoplevering: opname + N werkdagen
  feedbackShare: number; // deel van een pakket dat terugkomt als feedback
  weights: Record<ProjectStatus, number>;
};

export const DEFAULT_RADAR_SETTINGS: RadarSettings = {
  green: 80,
  red: 100,
  extraPerShoot: 1,
  avgShootHours: 6.5,
  editorLeadDays: 7,
  clientLeadDays: 14,
  feedbackShare: 0.25,
  weights: { beschikbaar: 1, bezig: 0.6, intern: 0.15, klant: 0, feedback: 0.25 },
};

export const BATCH_MIN = 6;
export const BATCH_MAX = 8;

export type RadarInput = {
  today: string;
  weeks: number;
  people: RadarPerson[];
  shoots: RadarShoot[];
  projects: RadarProject[];
  holidays: string[];
  settings: RadarSettings;
};

export type EditItem = {
  id: string;
  batchId: string;
  clientName: string;
  editorId: string;
  videos: number;
  shootOn: string;
  phase: string;
  kind: ItemKind;
  load: number;
  days: string[];
  readyOn: string | null;
};

export type WeekItem = EditItem & { weekLoad: number };

export type Cell = {
  load: number;
  cap: number | null;
  confirmed: number;
  forecast: number;
  sim: number;
  status: RadarStatus;
  pct: number | null;
  shoots: RadarShoot[];
  items: WeekItem[];
};

export type RadarWeek = { i: number; start: string; nr: number; label: string };

export type RadarResult = {
  weeks: RadarWeek[];
  cells: Record<string, Cell[]>;
  unassigned: RadarShoot[][];
  team: { video: Cell[]; edit: Cell[] };
  items: EditItem[];
};

/* ------------------------------------------------------------------ *
 * Datumhulpen (UTC, YYYY-MM-DD)
 * ------------------------------------------------------------------ */

const DAY = 86_400_000;
const toD = (s: string) => new Date(s.slice(0, 10) + "T00:00:00Z");
const iso = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (s: string, n: number) => iso(new Date(toD(s).getTime() + n * DAY));
const dow = (s: string) => toD(s).getUTCDay();
const MONTHS = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const DAYS = ["zo", "ma", "di", "wo", "do", "vr", "za"];
export const DAY_NAMES = ["Zondag", "Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag", "Zaterdag"];

export function fmtDate(s: string): string {
  const d = toD(s);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
export function fmtDay(s: string): string {
  return `${DAYS[dow(s)]} ${fmtDate(s)}`;
}
export function isoWeek(s: string): number {
  const d = toD(s);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const fy = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d.getTime() - fy.getTime()) / DAY - 3 + ((fy.getUTCDay() + 6) % 7)) / 7);
}
export function mondayOf(s: string): string {
  return addDays(s, -((dow(s) + 6) % 7));
}
function weekLabel(start: string): string {
  const fr = addDays(start, 4);
  const a = toD(start), b = toD(fr);
  return a.getUTCMonth() === b.getUTCMonth() ? `${a.getUTCDate()} t/m ${fmtDate(fr)}` : `${fmtDate(start)} t/m ${fmtDate(fr)}`;
}

export function makeCalendar(holidays: string[]) {
  const hol = new Set(holidays);
  const isWorkday = (s: string) => dow(s) > 0 && dow(s) < 6 && !hol.has(s);
  const addWorkdays = (s: string, n: number) => {
    let d = s, c = 0;
    while (c < n) { d = addDays(d, 1); if (isWorkday(d)) c++; }
    return d;
  };
  /** Eerstvolgende werkdag vanaf (en inclusief) s. */
  const firstWorkday = (s: string) => (isWorkday(s) ? s : addWorkdays(s, 1));
  return { isWorkday, addWorkdays, firstWorkday, holidays: hol };
}

/* ------------------------------------------------------------------ *
 * Rekenmotor
 * ------------------------------------------------------------------ */

export function shootHours(s: RadarShoot, settings: RadarSettings): number {
  return s.durationH + s.travelH + settings.extraPerShoot;
}

export function statusOf(load: number, cap: number | null, settings: RadarSettings): { status: RadarStatus; pct: number | null } {
  if (cap == null) return { status: "grey", pct: null };
  if (cap <= 0) return { status: load > 0.05 ? "red" : "off", pct: null };
  const pct = (load / cap) * 100;
  if (load < 0.05) return { status: "green", pct };
  if (pct > settings.red) return { status: "red", pct };
  if (pct >= settings.green) return { status: "orange", pct };
  return { status: "green", pct };
}

export function computeRadar(input: RadarInput): RadarResult {
  const { today, settings } = input;
  const cal = makeCalendar(input.holidays);
  const week0 = mondayOf(today);
  const W = input.weeks;
  const weeks: RadarWeek[] = Array.from({ length: W }, (_, i) => {
    const start = addDays(week0, 7 * i);
    return { i, start, nr: isoWeek(start), label: weekLabel(start) };
  });
  const weekIdx = (s: string) => Math.floor((toD(s).getTime() - toD(week0).getTime()) / (7 * DAY));
  const workdaysOf = (w: number) => Array.from({ length: 5 }, (_, k) => addDays(weeks[w].start, k)).filter(cal.isWorkday);
  const absent = (p: RadarPerson, d: string) => p.absences.some((a) => d >= a.from && d <= a.to);

  const capacity = (p: RadarPerson, w: number): number | null => {
    const all = workdaysOf(w);
    const avail = all.filter((d) => !absent(p, d) && d >= today).length;
    if (p.kind === "video") {
      if (p.hoursPerWeek == null) return null;
      // Met een vast aantal dagen per week: verlof op een "vrije" dag kost geen
      // capaciteit. Zonder dagen: naar rato van de beschikbare werkdagen.
      if (p.daysPerWeek) return Math.min(p.daysPerWeek, avail) * (p.hoursPerWeek / p.daysPerWeek);
      return (p.hoursPerWeek * avail) / 5;
    }
    if (p.videosPerWeek == null) return null;
    return (p.videosPerWeek * avail) / 5;
  };

  const blank = (): Omit<Cell, "cap"> => ({ load: 0, confirmed: 0, forecast: 0, sim: 0, status: "green", pct: null, shoots: [], items: [] });
  const cells: Record<string, Cell[]> = {};
  for (const p of input.people) cells[p.id] = weeks.map((w) => ({ ...blank(), cap: capacity(p, w.i) }));
  const unassigned: RadarShoot[][] = weeks.map(() => []);

  // Opnames → uren bij de videograaf.
  for (const s of input.shoots) {
    if (s.date < today) continue;
    const w = weekIdx(s.date);
    if (w < 0 || w >= W) continue;
    if (!s.videographerId || !cells[s.videographerId]) { unassigned[w].push(s); continue; }
    const c = cells[s.videographerId][w];
    const h = shootHours(s, settings);
    c.load += h;
    c.shoots.push(s);
    if (s.sim) c.sim += h; else c.confirmed += h;
  }

  // Editingwerk: lopende projecten + voorspelling uit komende opnames.
  const items = buildEditItems(input, cal);
  for (const it of items) {
    const per = it.days.length ? it.load / it.days.length : 0;
    const byWeek = new Map<number, number>();
    for (const d of it.days) {
      const w = weekIdx(d);
      if (w >= 0 && w < W) byWeek.set(w, (byWeek.get(w) ?? 0) + per);
    }
    for (const [w, v] of byWeek) {
      const c = cells[it.editorId]?.[w];
      if (!c) continue;
      c.load += v;
      c.items.push({ ...it, weekLoad: v });
      if (it.kind === "sim") c.sim += v; else if (it.kind === "bevestigd") c.confirmed += v; else c.forecast += v;
    }
  }

  for (const id in cells) for (const c of cells[id]) Object.assign(c, statusOf(c.load, c.cap, settings));

  // Teamtotalen per soort.
  const team = (kind: RadarKind): Cell[] =>
    weeks.map((w) => {
      const t: Cell = { ...blank(), cap: null };
      let cap = 0, known = false;
      for (const p of input.people.filter((x) => x.kind === kind)) {
        const c = cells[p.id][w.i];
        if (c.cap != null && p.inTeam !== false) { cap += c.cap; known = true; }
        t.load += c.load; t.confirmed += c.confirmed; t.forecast += c.forecast; t.sim += c.sim;
      }
      if (kind === "video") for (const s of unassigned[w.i]) { const h = shootHours(s, settings); t.load += h; if (s.sim) t.sim += h; else t.confirmed += h; }
      t.cap = known ? cap : null;
      Object.assign(t, statusOf(t.load, t.cap || null, settings));
      return t;
    });

  return { weeks, cells, unassigned, team: { video: team("video"), edit: team("edit") }, items };
}

function buildEditItems(input: RadarInput, cal: ReturnType<typeof makeCalendar>): EditItem[] {
  const { today, settings } = input;
  const items: EditItem[] = [];
  const realBatches = new Set<string>();
  const t0 = cal.firstWorkday(today);

  for (const p of input.projects) {
    const w = settings.weights[p.status] ?? 0;
    realBatches.add(p.batchId);
    if (!w) continue;
    const ready = cal.addWorkdays(p.shootOn, settings.editorLeadDays);
    let days: string[] = [];
    if (p.status === "beschikbaar" || p.status === "bezig") {
      let d = cal.firstWorkday(cal.addWorkdays(p.shootOn, 1) > today ? cal.addWorkdays(p.shootOn, 1) : today);
      while (d <= ready) { days.push(d); d = cal.addWorkdays(d, 1); }
      if (!days.length) days = [t0];
    } else if (p.status === "intern") {
      days = [t0, cal.addWorkdays(t0, 1)];
    } else {
      days = [t0, cal.addWorkdays(t0, 1), cal.addWorkdays(t0, 2)];
    }
    items.push({ id: p.id, batchId: p.batchId, clientName: p.clientName, editorId: p.editorId, videos: p.videos, shootOn: p.shootOn, phase: PHASE_LABEL[p.status], kind: "bevestigd", load: p.videos * w, days, readyOn: ready });
  }

  for (const s of input.shoots) {
    if (s.date < today || !s.editorId || realBatches.has(s.id)) continue;
    const n = s.videos;
    const first = Array.from({ length: settings.editorLeadDays }, (_, k) => cal.addWorkdays(s.date, k + 1));
    const fb = [10, 11, 12].map((k) => cal.addWorkdays(s.date, k));
    const kind: ItemKind = s.sim ? "sim" : "voorspeld";
    const base = { batchId: s.id, clientName: s.clientName, editorId: s.editorId, videos: n, shootOn: s.date, kind };
    items.push({ ...base, id: `${s.id}-v1`, phase: "Eerste versie", load: n, days: first, readyOn: first[first.length - 1] });
    items.push({ ...base, id: `${s.id}-fb`, phase: "Feedback verwerken", load: n * settings.feedbackShare, days: fb, readyOn: fb[2] });
  }
  return items;
}

export const PHASE_LABEL: Record<ProjectStatus, string> = {
  beschikbaar: "Klaar om te monteren",
  bezig: "Montage bezig",
  intern: "Interne controle",
  klant: "Bij klant",
  feedback: "Feedback verwerken",
};

/* ------------------------------------------------------------------ *
 * Gewone taal
 * ------------------------------------------------------------------ */

/** Wat er nog past, in gewone taal. Altijd in lijn met de kleur. */
export function roomText(kind: RadarKind, cell: Pick<Cell, "load" | "cap" | "status">, settings: RadarSettings): string {
  const { load, cap, status } = cell;
  if (cap == null) return load > 0.05 ? "Onbekend" : "";
  if (cap <= 0) return load > 0.05 ? "Afwezig" : "Vrij";
  const unit = kind === "video" ? settings.avgShootHours : 1;
  const one = kind === "video" ? "opname" : "video";
  const many = kind === "video" ? "opnames" : "video's";
  if (status === "red") return `${Math.max(1, Math.ceil((load - cap) / unit))} te veel`;
  const n = Math.floor((cap - load) / unit);
  if (status === "orange" && n < 1) return "Vol";
  const m = Math.max(1, n);
  return `Nog ${m} ${m === 1 ? one : many}`;
}

/* ------------------------------------------------------------------ *
 * Pakketten verplaatsen en meldingen
 * ------------------------------------------------------------------ */

export function batchWeekLoads(result: RadarResult, batchId: string, weekStart: string): Map<number, number> {
  const week0 = toD(weekStart).getTime();
  const out = new Map<number, number>();
  for (const it of result.items) {
    if (it.batchId !== batchId) continue;
    const per = it.days.length ? it.load / it.days.length : 0;
    for (const d of it.days) {
      const w = Math.floor((toD(d).getTime() - week0) / (7 * DAY));
      if (w >= 0 && w < result.weeks.length) out.set(w, (out.get(w) ?? 0) + per);
    }
  }
  return out;
}

/** Welke editors kunnen een heel pakket hebben? Laagste piekbezetting eerst. */
export function batchCandidates(result: RadarResult, people: RadarPerson[], batchId: string, exceptId: string | null): { person: RadarPerson; peak: number }[] {
  const add = batchWeekLoads(result, batchId, result.weeks[0].start);
  const out: { person: RadarPerson; peak: number }[] = [];
  for (const p of people) {
    if (p.kind !== "edit" || p.id === exceptId || p.assignable === false) continue;
    let peak = 0, ok = true;
    for (const [w, v] of add) {
      const c = result.cells[p.id][w];
      if (!c.cap) { ok = false; break; }
      peak = Math.max(peak, ((c.load + v) / c.cap) * 100);
    }
    if (ok) out.push({ person: p, peak });
  }
  return out.sort((a, b) => a.peak - b.peak);
}

export function batchesIn(result: RadarResult, personId: string, w: number) {
  const map = new Map<string, { batchId: string; clientName: string; videos: number; shootOn: string; weekLoad: number }>();
  for (const it of result.cells[personId][w].items) {
    if (it.kind === "sim") continue;
    const b = map.get(it.batchId) ?? { batchId: it.batchId, clientName: it.clientName, videos: it.videos, shootOn: it.shootOn, weekLoad: 0 };
    b.weekLoad += it.weekLoad;
    map.set(it.batchId, b);
  }
  return [...map.values()].sort((a, b) => b.weekLoad - a.weekLoad);
}

export function bestBatchMove(result: RadarResult, people: RadarPerson[], personId: string, w: number, settings: RadarSettings) {
  for (const b of batchesIn(result, personId, w)) {
    const c = batchCandidates(result, people, b.batchId, personId).find((x) => x.peak <= settings.red);
    if (c) return { batch: b, to: c.person, peak: c.peak };
  }
  return null;
}

export function bestShootMove(result: RadarResult, personId: string, w: number, settings: RadarSettings) {
  const c = result.cells[personId][w];
  const cands: { shoot: RadarShoot; to: number; after: number }[] = [];
  for (const s of c.shoots.filter((x) => !x.sim)) {
    for (const to of [w + 1, w - 1, w + 2]) {
      if (to < 1 || to >= result.weeks.length) continue;
      const t = result.cells[personId][to];
      if (!t.cap) continue;
      const after = ((t.load + shootHours(s, settings)) / t.cap) * 100;
      if (after < settings.green) cands.push({ shoot: s, to, after });
    }
  }
  cands.sort((a, b) => shootHours(a.shoot, settings) - shootHours(b.shoot, settings) || Math.abs(a.to - w) - Math.abs(b.to - w) || a.after - b.after);
  return cands[0] ?? null;
}

export type RadarAlert = {
  tone: "bad" | "warn";
  week: number;
  title: string;
  advice: string;
  action: { kind: "cell" | "unassigned" | "team" | "settings"; personId?: string; week: number };
  score: number;
};

export function buildAlerts(result: RadarResult, people: RadarPerson[], settings: RadarSettings, opts: { weeks: number; video: boolean; edit: boolean }): RadarAlert[] {
  const alerts: RadarAlert[] = [];
  const ws = result.weeks.slice(0, opts.weeks).map((w) => w.i);
  const weekOf = (w: number) => `de week van ${result.weeks[w].label}`;
  const name = (id: string) => people.find((p) => p.id === id)?.name ?? "Onbekend";

  if (opts.video)
    for (const w of ws)
      for (const s of result.unassigned[w]) {
        if (s.sim) continue;
        alerts.push({ tone: "bad", week: w, title: `${s.clientName} op ${fmtDay(s.date)} heeft nog geen videograaf`, advice: "Wijs iemand toe op de Opnamespagina. Klik voor wie er die week tijd heeft.", action: { kind: "unassigned", week: w }, score: 320 - w * 12 });
      }

  const teamWeeks = new Set<number>();
  if (opts.edit)
    for (const w of ws) {
      const t = result.team.edit[w];
      if (t.cap && t.pct != null && t.pct > settings.red) {
        teamWeeks.add(w);
        alerts.push({ tone: "bad", week: w, title: `De editors hebben samen te veel werk in ${weekOf(w)}`, advice: `Er zijn ${Math.ceil(t.load - t.cap)} video's te veel. Zet een freelance editor in voor een hele opname, of schuif een opname een week door.`, action: { kind: "team", week: w }, score: 300 - w * 12 + Math.min(30, (t.pct - 100) / 2) });
      }
    }

  for (const p of people) {
    if (p.kind === "video" && !opts.video) continue;
    if (p.kind === "edit" && !opts.edit) continue;
    const reds = ws.filter((w) => result.cells[p.id][w].status === "red" && !(p.kind === "edit" && teamWeeks.has(w)));
    if (reds.length) {
      const w = reds[0], c = result.cells[p.id][w];
      const more = reds.length > 1 ? ` Ook in ${reds.slice(1).map(weekOf).join(" en ")}.` : "";
      const pct = c.pct ?? 150;
      if (p.kind === "video") {
        const mv = bestShootMove(result, p.id, w, settings);
        alerts.push({ tone: "bad", week: w, title: `${p.name} heeft te veel opnames in ${weekOf(w)}`, advice: (mv ? `Verplaats ${mv.shoot.clientName} (${fmtDay(mv.shoot.date)}) naar ${weekOf(mv.to)}, of laat een freelancer filmen.` : "Laat een freelancer een opname overnemen.") + more, action: { kind: "cell", personId: p.id, week: w }, score: 310 - w * 12 + Math.min(30, (pct - 100) / 2) });
      } else {
        const mv = bestBatchMove(result, people, p.id, w, settings);
        const big = batchesIn(result, p.id, w)[0];
        alerts.push({
          tone: "bad", week: w,
          title: c.cap === 0 ? `${p.name} is afwezig in ${weekOf(w)}, maar heeft werk` : `${p.name} heeft te veel montagewerk in ${weekOf(w)}`,
          advice: (mv ? `Geef de opname van ${mv.batch.clientName} (${mv.batch.videos} video's) in één keer aan ${name(mv.to.id)}.` : `Niemand heeft ruimte voor een hele opname${big ? ` van ${big.videos} video's` : ""}. Zet een freelance editor in of schuif een opname door.`) + more,
          action: { kind: "cell", personId: p.id, week: w }, score: 300 - w * 12 + Math.min(30, (pct - 100) / 2),
        });
      }
    }
    const greys = ws.filter((w) => result.cells[p.id][w].status === "grey" && result.cells[p.id][w].load > 0.05);
    if (greys.length) {
      alerts.push({ tone: "warn", week: greys[0], title: p.kind === "edit" ? `We weten niet hoeveel video's ${p.name} per week kan maken` : `We weten niet hoeveel ${p.name} kan filmen`, advice: `${p.name} heeft wel werk gepland. Vraag het na en laat het invullen, dan ziet de pagina of het past.`, action: { kind: "settings", personId: p.id, week: greys[0] }, score: 200 - greys[0] * 12 });
    }
  }
  return alerts.sort((a, b) => b.score - a.score);
}

/** Aantal knelpunten: rode vakken, opnames zonder videograaf en mensen met werk maar zonder capaciteit (één keer per persoon). */
export function countBottlenecks(result: RadarResult, people: RadarPerson[], weeks: number): number {
  let n = 0;
  const ws = result.weeks.slice(0, weeks).map((w) => w.i);
  for (const p of people) {
    n += ws.filter((w) => result.cells[p.id][w].status === "red").length;
    if (ws.some((w) => result.cells[p.id][w].status === "grey" && result.cells[p.id][w].load > 0.05)) n++;
  }
  n += ws.filter((w) => result.unassigned[w].some((s) => !s.sim)).length;
  return n;
}

/** Aantal video's per opname als er niets is ingepland: 6 tot 8, afgeleid van het pakket. */
export function videosPerShoot(planned: number | null | undefined, packagePerMonth: number | null | undefined): { videos: number; source: RadarShoot["videosSource"] } {
  if (planned && planned > 0) return { videos: planned, source: "gepland" };
  if (packagePerMonth && packagePerMonth > 0) return { videos: Math.min(BATCH_MAX, Math.max(BATCH_MIN, packagePerMonth)), source: "pakket" };
  return { videos: BATCH_MAX, source: "standaard" };
}
