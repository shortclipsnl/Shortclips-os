/**
 * "Wat werkt voor deze klant": het recept voor de volgende video, puur
 * berekend uit de echte resultaten (geen AI, geen database).
 *
 * Per onderdeel (format, hook, lengte, filmstijl, scriptopbouw) een
 * uitkomst met een eerlijke status:
 *  - bewezen:     gedragen door minstens vier video's, consequent boven normaal;
 *  - indicatie:   wijst die kant op, maar (nog) te weinig of te wisselend;
 *  - onvoldoende: te weinig gegevens voor een conclusie.
 * De scriptopbouw is een analyse van de AI en is daarom nooit "bewezen".
 */

import { evidenceOf, median, MIN_VIDEOS, type ContentMemory, type Evidence, type MemoryGroup, type MemoryVideo } from "./analyze";
import type { FilmStyle, MemoryStrategy, ScriptBlueprint } from "./strategy";

export type PlayStatus = "bewezen" | "indicatie" | "onvoldoende";
export type PlayKey = "format" | "hook" | "lengte" | "filmstijl" | "script";

export type PlayMetric = { label: string; value: string };

export type PlayItem = {
  key: PlayKey;
  title: string;
  /** De conclusie in een paar woorden, null bij onvoldoende data. */
  value: string | null;
  /** Eén zin onderbouwing met de echte cijfers. */
  detail: string;
  status: PlayStatus;
  evidence: Evidence | null;
  n: number;
  perf: number | null;
  metrics: PlayMetric[];
  /** Letterlijke voorbeeldzin (bij hook). */
  quote: string | null;
  example: MemoryVideo | null;
};

export type Playbook = {
  items: PlayItem[];
  /** Het recept in één regel, alleen uit onderdelen met een conclusie. */
  recipe: Array<{ key: PlayKey; text: string; status: PlayStatus }>;
  script: ScriptBlueprint | null;
  scriptBasis: number;
  /** Hoeveel video's een herkende filmstijl hebben. */
  styleCoverage: { known: number; total: number };
  updatedAt: string | null;
  sufficient: boolean;
  videoCount: number;
};

const fx = (x: number) => `${x.toFixed(1).replace(".", ",")}x`;
const pc = (x: number) => `${Math.round(x * 100)}%`;

export const HOOK_PLAY: Record<string, string> = {
  Vraag: "Openen met een vraag",
  Prijs: "Prijs direct in de hook",
  Getal: "Een getal in de hook",
  Nieuwsgierigheid: "Nieuwsgierigheid wekken",
  "Spreekt kijker aan": "Kijker direct aanspreken",
  Rondleiding: "Rondleiding aankondigen",
};

function statusOf(g: Pick<MemoryGroup, "n" | "medianPerf" | "evidence">): PlayStatus {
  if ((g.evidence === "aannemelijk" || g.evidence === "sterk") && g.medianPerf >= 1.2) return "bewezen";
  if (g.n >= 2 && g.medianPerf >= 1) return "indicatie";
  return "onvoldoende";
}

const RANK: Record<PlayStatus, number> = { bewezen: 2, indicatie: 1, onvoldoende: 0 };
const pick = (gs: MemoryGroup[]) =>
  [...gs].sort((a, b) => RANK[statusOf(b)] - RANK[statusOf(a)] || b.medianPerf - a.medianPerf)[0] ?? null;

/** Kijkcijfers van een groep video's, alleen wat het platform echt levert. */
function watchMetrics(vs: MemoryVideo[]): PlayMetric[] {
  const out: PlayMetric[] = [];
  const views = median(vs.map((v) => v.viewScore));
  if (views != null) out.push({ label: "Bereik", value: `${fx(views)} normaal` });
  const ret = vs.map((v) => v.retention).filter((x): x is number => x != null);
  if (ret.length >= 2) out.push({ label: "Retentie", value: pc(median(ret)!) });
  const watch = vs.map((v) => v.avgWatchSeconds).filter((x): x is number => x != null && x > 0);
  if (watch.length >= 2) out.push({ label: "Kijktijd", value: `${Math.round(median(watch)!)} sec` });
  const eng = median(vs.map((v) => v.engScore));
  if (eng != null) out.push({ label: "Engagement", value: `${fx(eng)} normaal` });
  return out;
}

const empty = (key: PlayKey, title: string, detail: string): PlayItem => ({ key, title, value: null, detail, status: "onvoldoende", evidence: null, n: 0, perf: null, metrics: [], quote: null, example: null });

function fromGroup(key: PlayKey, title: string, g: MemoryGroup | null, all: MemoryVideo[], ofGroup: (v: MemoryVideo) => boolean, value: (g: MemoryGroup) => string, none: string): PlayItem {
  if (!g) return empty(key, title, none);
  const vs = all.filter(ofGroup);
  const status = statusOf(g);
  const hits = Math.round(g.hitRate * g.n);
  const detail = status === "onvoldoende"
    ? `${none} Beste kandidaat tot nu toe: ${value(g).toLowerCase()} (${g.n} video's, ${fx(g.medianPerf)} normaal).`
    : `${hits} van ${g.n} video's scoorden boven het normale niveau; gemiddeld ${fx(g.medianPerf)} normaal.`;
  return {
    key,
    title,
    value: status === "onvoldoende" ? null : value(g),
    detail,
    status,
    evidence: g.evidence,
    n: g.n,
    perf: g.medianPerf,
    metrics: watchMetrics(vs),
    quote: null,
    example: g.examples[0] ?? null,
  };
}

/** Groepeert video's op filmstijl, met dezelfde rekenregels als de andere groepen. */
function styleGroups(all: MemoryVideo[], styles: Record<string, FilmStyle>): MemoryGroup[] {
  const map = new Map<string, MemoryVideo[]>();
  for (const v of all) {
    const s = styles[v.id];
    if (s) map.set(s, [...(map.get(s) ?? []), v]);
  }
  return [...map.entries()].map(([label, vs]) => {
    const mp = median(vs.map((v) => v.perf)) ?? 1;
    const hitRate = vs.filter((v) => v.perf >= 1).length / vs.length;
    return {
      dimension: "format" as const,
      label,
      n: vs.length,
      medianPerf: Math.round(mp * 100) / 100,
      hitRate: Math.round(hitRate * 100) / 100,
      medianViews: Math.round(median(vs.map((v) => v.views)) ?? 0),
      medianEngagement: median(vs.map((v) => v.engagementRate)) ?? 0,
      medianWatchSeconds: null,
      verdict: (mp >= 1.2 ? "beter" : mp <= 0.8 ? "slechter" : "neutraal") as MemoryGroup["verdict"],
      evidence: evidenceOf(vs.length, hitRate, null),
      trend: null,
      examples: [...vs].sort((a, b) => b.perf - a.perf).slice(0, 3),
    };
  }).sort((a, b) => b.medianPerf - a.medianPerf);
}

export function buildPlaybook(m: ContentMemory, s: MemoryStrategy | null): Playbook {
  const all = m.all;
  const short = m.sufficient ? "" : `Nog maar ${m.videoCount} van de minimaal ${MIN_VIDEOS} video's met resultaten.`;

  // 1. Format
  const fmt = pick(m.formats.filter((g) => g.n >= 2));
  const format = fromGroup("format", "Bestwerkend format", fmt, all, (v) => v.format === fmt?.label, (g) => g.label,
    short || (m.formatsLabeled ? "Nog geen format dat consequent boven het normale niveau scoort." : "Formats zijn nog niet herkend."));

  // 2. Hook: rangschikken op prestatie, onderbouwen met bereik en retentie.
  const hg = pick(m.hooks.filter((g) => g.label !== "Stelling" && g.n >= 2));
  const hook = fromGroup("hook", "Bestwerkende hook", hg, all, (v) => !!hg && v.hookTypes.includes(hg.label), (g) => HOOK_PLAY[g.label] ?? g.label,
    short || "Nog geen openingsstijl die consequent boven het normale niveau scoort.");
  if (hg) {
    const best = all.find((v) => v.hookTypes.includes(hg.label) && v.hook.length >= 12);
    hook.quote = best?.hook ?? null;
    hook.example = best ?? hook.example;
  }

  // 3. Lengte
  const lg = pick(m.lengths.filter((g) => g.n >= 3));
  const lengte = fromGroup("lengte", "Ideale videolengte", lg, all, (v) => !!lg && lengthLabel(v) === lg.label, (g) => g.label,
    short || "Nog geen lengte die duidelijk beter presteert dan de rest.");

  // 4. Filmstijl (herkend door de AI, beoordeeld op echte cijfers)
  const styles = s?.styles ?? {};
  const known = all.filter((v) => styles[v.id]).length;
  const sg = pick(styleGroups(all, styles).filter((g) => g.n >= 2));
  const filmstijl = !s
    ? empty("filmstijl", "Beste manier van filmen", "De filmstijl per video wordt nog bepaald.")
    : fromGroup("filmstijl", "Beste manier van filmen", sg, all, (v) => !!sg && styles[v.id] === sg.label, (g) => g.label,
        short || (known < 4 ? `Bij te weinig video's herkenbaar (${known} van ${all.length}).` : "Nog geen filmstijl die duidelijk beter presteert."));
  if (s && filmstijl.status !== "onvoldoende") filmstijl.detail += ` Filmstijl herkend bij ${known} van ${all.length} video's.`;

  // 5. Scriptopbouw (analyse, nooit "bewezen")
  const script: PlayItem = s?.script
    ? {
        key: "script",
        title: "Beste scriptopbouw",
        value: "Zie de opbouw hieronder",
        detail: `Afgeleid uit de ${s.scriptBasis} best presterende video's${m.sufficient ? "" : " (nog weinig data)"} en de eerdere scripts.`,
        status: m.sufficient ? "indicatie" : "onvoldoende",
        evidence: null,
        n: s.scriptBasis,
        perf: null,
        metrics: [],
        quote: null,
        example: null,
      }
    : empty("script", "Beste scriptopbouw", "De scriptopbouw wordt nog geanalyseerd.");

  const items = [format, hook, lengte, filmstijl, script];
  const recipe = items
    .filter((i) => i.value && i.status !== "onvoldoende" && i.key !== "script")
    .map((i) => ({ key: i.key, text: i.key === "lengte" ? (i.value as string).toLowerCase() : (i.value as string), status: i.status }));

  return { items, recipe, script: s?.script ?? null, scriptBasis: s?.scriptBasis ?? 0, styleCoverage: { known, total: all.length }, updatedAt: s?.updatedAt ?? null, sufficient: m.sufficient, videoCount: m.videoCount };
}

/** Zelfde indeling als lengthBucket in analyze.ts. */
function lengthLabel(v: MemoryVideo): string | null {
  const sec = v.durationSeconds;
  if (!sec || sec <= 0) return null;
  if (sec < 20) return "Korter dan 20 sec";
  if (sec < 35) return "20 tot 35 sec";
  if (sec < 50) return "35 tot 50 sec";
  if (sec < 75) return "50 tot 75 sec";
  return "Langer dan 75 sec";
}

/** Voor de Script Engine: het recept als korte briefingtekst. */
export function playbookPromptText(p: Playbook): string {
  if (!p.videoCount) return "";
  const lines = p.items
    .filter((i) => i.key !== "script")
    .map((i) => `- ${i.title}: ${i.value ?? "nog geen conclusie"} [${i.status}]${i.value ? ` (${i.detail})` : ""}`);
  if (p.script) {
    lines.push(`- Scriptopbouw [analyse]: opening: ${p.script.opening} | informatie: ${p.script.informatie} | tempo: ${p.script.tempo} | spanning: ${p.script.spanning} | afsluiting: ${p.script.cta}`);
  }
  return `WAT WERKT VOOR DEZE KLANT (bewezen = consequent bij minstens vier video's; indicatie = nog te bevestigen):\n${lines.join("\n")}`;
}

