/**
 * Groei en daling per klant voor de Resultatenpagina (/analytics).
 *
 * Pure logica, zonder database: vergelijkt de gekozen periode met de even lange
 * periode ervoor (dezelfde periodefilter als de rest van de pagina) en bepaalt
 * per klant of er een betrouwbare daling of groei is. Een percentage op een te
 * kleine basis, of een periode waarin metingen ontbreken, telt nooit als
 * signaal: die klant valt onder "onvoldoende data".
 */

export type Kpi = "weergaven" | "bereik" | "volgers" | "kijktijd" | "engagement";

export const KPI_LABEL: Record<Kpi, string> = {
  weergaven: "weergaven",
  bereik: "bereik",
  volgers: "volgersgroei",
  kijktijd: "kijktijd",
  engagement: "engagement",
};

/** Welke KPI's het zwaarst wegen bij welke klantdoelstelling (client_strategy_profiles.primary_goal). */
export const GOAL_KPIS: Record<string, Kpi[]> = {
  bekendheid: ["bereik", "weergaven"],
  bereik: ["bereik", "weergaven"],
  volgers: ["volgers"],
  sollicitanten: ["engagement", "weergaven"],
  werkgeverschap: ["engagement", "kijktijd"],
  vertrouwen: ["kijktijd", "engagement"],
  websitebezoek: ["engagement", "weergaven"],
  aanvragen: ["engagement", "weergaven"],
  verkoop: ["engagement", "weergaven"],
};

/** Minimale verandering (in %) die als signaal telt. */
const THRESHOLD: Record<Kpi, number> = { weergaven: 25, bereik: 25, volgers: 30, kijktijd: 15, engagement: 20 };

export type RateStat = { cur: number | null; prev: number | null; curN: number; prevN: number };

export type TrendInput = {
  clientId: string;
  name: string;
  slug: string;
  color: string | null;
  logoUrl: string | null;
  goal: string | null;
  days: number;
  /** Meetdagen met accountcijfers in de periode en in de vergelijkingsperiode. */
  measureDays: number;
  measureDaysPrev: number;
  /** Alleen het eerlijk vergelijkbare deel (accountcijfers). */
  views: number; viewsPrev: number;
  reach: number; reachPrev: number;
  followers: number; followersPrev: number;
  /** Gemiddelde retentie (0..1) van video's in beide periodes. */
  retention: RateStat;
  /** Interacties / weergaven (0..1) van video's in beide periodes. */
  engagement: RateStat;
  videos: number; videosPrev: number;
  /** Beste hook van de periode t.o.v. het normale niveau van de klant, als die er is. */
  topHook: { hook: string; score: number } | null;
};

export type Signal = { kpi: Kpi; delta: number; cur: number; prev: number; goal: boolean };

export type TrendRow = {
  clientId: string;
  name: string;
  slug: string;
  color: string | null;
  logoUrl: string | null;
  /** De KPI waar de regel om draait (doel-KPI gaat voor). */
  main: Signal;
  /** Overige betrouwbare signalen in dezelfde richting. */
  also: Signal[];
  /** Korte, uit de data aantoonbare signalering. */
  note: string;
  /** Concrete aanbevolen actie (daling) of kans (groei). */
  action: string;
  /** Alleen bij groei: wat er aantoonbaar goed gaat, anders null. */
  works: string | null;
  /** Rangorde: hoger = urgenter (daling) of sterker en relevanter (groei). */
  score: number;
  /** Alleen bij daling: hoog = eerst oppakken. */
  urgency: "hoog" | "midden";
  goalLabel: string | null;
};

export type TrendResult = {
  daling: TrendRow[];
  groei: TrendRow[];
  onvoldoende: Array<{ clientId: string; name: string; slug: string; reason: string }>;
};

/** Minimale basis voor weergaven/bereik: schaalt mee met de lengte van de periode. */
export function minVolume(days: number): number {
  return Math.max(1000, Math.round(days * 100));
}

const pct = (cur: number, prev: number) => Math.round(((cur - prev) / prev) * 100);

/** Gewicht naar volume: grotere accounts geven een betrouwbaarder percentage. */
function volumeWeight(base: number): number {
  if (base <= 0) return 0.6;
  return Math.min(1.4, Math.max(0.6, Math.log10(base) / 4));
}

/** Alle betrouwbare signalen van één klant. Geen basis = geen signaal. */
export function signalsOf(c: TrendInput): Signal[] {
  const goalKpis = (c.goal && GOAL_KPIS[c.goal]) || ["weergaven"];
  const isGoal = (k: Kpi) => goalKpis.includes(k);
  const out: Signal[] = [];
  const min = minVolume(c.days);
  const coverageOk = c.measureDaysPrev > 0 && c.measureDays >= Math.max(1, Math.floor(c.measureDaysPrev * 0.6));

  if (coverageOk && c.viewsPrev >= min) out.push({ kpi: "weergaven", delta: pct(c.views, c.viewsPrev), cur: c.views, prev: c.viewsPrev, goal: isGoal("weergaven") });
  if (coverageOk && c.reachPrev >= min) out.push({ kpi: "bereik", delta: pct(c.reach, c.reachPrev), cur: c.reach, prev: c.reachPrev, goal: isGoal("bereik") });
  // Volgersgroei: alleen bij een positieve basis van minstens 20 en een echt verschil.
  if (coverageOk && c.followersPrev >= 20 && Math.abs(c.followers - c.followersPrev) >= 10) {
    out.push({ kpi: "volgers", delta: pct(c.followers, c.followersPrev), cur: c.followers, prev: c.followersPrev, goal: isGoal("volgers") });
  }
  for (const [kpi, s] of [["kijktijd", c.retention], ["engagement", c.engagement]] as const) {
    if (s.cur != null && s.prev != null && s.prev > 0 && s.curN >= 3 && s.prevN >= 3) {
      out.push({ kpi, delta: pct(s.cur, s.prev), cur: s.cur, prev: s.prev, goal: isGoal(kpi) });
    }
  }
  return out;
}

function insufficientReason(c: TrendInput): string {
  if (c.measureDaysPrev === 0) return "nog geen vergelijkingsperiode";
  if (c.measureDays < Math.floor(c.measureDaysPrev * 0.6)) return "metingen in deze periode onvolledig";
  if (c.viewsPrev < minVolume(c.days)) return "te weinig weergaven voor een eerlijk percentage";
  return "te weinig video's om te vergelijken";
}

const weight = (s: Signal) => (s.goal ? 1.5 : 1);

function pickMain(list: Signal[], dir: 1 | -1): Signal {
  // Doel-KPI gaat voor, daarna de grootste gewogen verandering.
  return [...list].sort((a, b) => Number(b.goal) - Number(a.goal) || (dir * b.delta * weight(b) - dir * a.delta * weight(a)))[0]!;
}

const nl = (n: number) => n.toLocaleString("nl-NL");
function short(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${(n / 1_000_000).toLocaleString("nl-NL", { maximumFractionDigits: 1 })}M`;
  if (a >= 10_000) return `${Math.round(n / 1000).toLocaleString("nl-NL")}K`;
  if (a >= 1000) return `${(n / 1000).toLocaleString("nl-NL", { maximumFractionDigits: 1 })}K`;
  return nl(Math.round(n));
}
export function formatKpiValue(kpi: Kpi, v: number): string {
  if (kpi === "kijktijd" || kpi === "engagement") return `${(v * 100).toLocaleString("nl-NL", { maximumFractionDigits: 1 })}%`;
  if (kpi === "volgers") return `${v >= 0 ? "+" : ""}${nl(v)}`;
  return short(v);
}

function changeText(s: Signal): string {
  const label = KPI_LABEL[s.kpi];
  return `${label[0]!.toUpperCase()}${label.slice(1)} ${formatKpiValue(s.kpi, s.prev)} → ${formatKpiValue(s.kpi, s.cur)}`;
}

const videosDropped = (c: TrendInput) => c.videosPrev >= 3 && c.videos <= c.videosPrev * 0.6;
const videosRose = (c: TrendInput) => c.videos >= 3 && c.videos >= c.videosPrev * 1.4 && c.videos - c.videosPrev >= 2;

function declineNote(c: TrendInput, main: Signal): string {
  const parts = [changeText(main)];
  if (videosDropped(c)) parts.push(`${c.videosPrev} → ${c.videos} video's gepubliceerd`);
  return parts.join(" · ");
}

function declineAction(c: TrendInput, main: Signal): string {
  if (videosDropped(c)) return "Publicatieritme herstellen: contentplanning en openstaande video's checken";
  switch (main.kpi) {
    case "kijktijd": return "Eerste 3 seconden en videolengte aanscherpen";
    case "engagement": return "Sterkere CTA en reactievraag in de volgende scripts";
    case "volgers": return "Volg-CTA en een vast serieformat inzetten";
    default: return "Hooks en formats van de best presterende video's herhalen";
  }
}

function growthWorks(c: TrendInput, main: Signal): string | null {
  if (c.topHook && c.topHook.score >= 1.5) {
    const h = c.topHook.hook.length > 70 ? `${c.topHook.hook.slice(0, 67)}...` : c.topHook.hook;
    return `Hook "${h}" haalde ${c.topHook.score.toLocaleString("nl-NL", { maximumFractionDigits: 1 })}x het normale bereik`;
  }
  if (videosRose(c)) return `Meer video's gepubliceerd (${c.videosPrev} → ${c.videos})`;
  if (main.kpi !== "kijktijd" && c.retention.cur != null && c.retention.prev && c.retention.curN >= 3 && c.retention.prevN >= 3 && c.retention.cur >= c.retention.prev * 1.1) {
    return `Video's worden langer bekeken (kijktijd ${formatKpiValue("kijktijd", c.retention.prev)} → ${formatKpiValue("kijktijd", c.retention.cur)})`;
  }
  return null;
}

function growthAction(c: TrendInput, main: Signal): string {
  if (c.topHook && c.topHook.score >= 1.5) return "Deze hook en dit format terug laten komen in de volgende scriptsessie";
  if (videosRose(c)) return "Dit publicatieritme vasthouden in de contentplanning";
  switch (main.kpi) {
    case "kijktijd": return "Opbouw en lengte van deze video's als standaard nemen";
    case "engagement": return "Onderwerpen met de meeste reacties verder uitdiepen";
    case "volgers": return "Volgers vasthouden met een vaste serie";
    default: return "Best presterende video's als basis voor nieuwe ideeën gebruiken";
  }
}

export function classify(inputs: TrendInput[], goalLabel: (g: string | null) => string | null = () => null): TrendResult {
  const res: TrendResult = { daling: [], groei: [], onvoldoende: [] };
  for (const c of inputs) {
    const sigs = signalsOf(c);
    const down = sigs.filter((s) => s.delta <= -THRESHOLD[s.kpi]);
    const up = sigs.filter((s) => s.delta >= THRESHOLD[s.kpi]);
    if (!sigs.length) {
      res.onvoldoende.push({ clientId: c.clientId, name: c.name, slug: c.slug, reason: insufficientReason(c) });
      continue;
    }
    const base = { clientId: c.clientId, name: c.name, slug: c.slug, color: c.color, logoUrl: c.logoUrl, goalLabel: goalLabel(c.goal) };
    const downScore = down.reduce((s, x) => s + Math.abs(x.delta) * weight(x) * volumeWeight(x.kpi === "kijktijd" || x.kpi === "engagement" ? c.viewsPrev : x.prev), 0);
    const upScore = up.reduce((s, x) => s + Math.min(150, x.delta) * weight(x) * volumeWeight(x.kpi === "kijktijd" || x.kpi === "engagement" ? c.views : x.prev), 0);
    // Een dalende doel-KPI is altijd een aandachtspunt, ook als iets anders groeit.
    const isDecline = down.length > 0 && (down.some((s) => s.goal) || downScore >= upScore);

    if (isDecline) {
      const main = pickMain(down, -1);
      const score = Math.round(downScore + (down.length - 1) * 10 + (videosDropped(c) ? 10 : 0));
      res.daling.push({
        ...base,
        main,
        also: down.filter((s) => s !== main),
        note: declineNote(c, main),
        action: declineAction(c, main),
        works: null,
        score,
        urgency: main.delta <= -50 || score >= 70 || (main.goal && main.delta <= -35) ? "hoog" : "midden",
      });
    } else if (up.length) {
      const main = pickMain(up, 1);
      // Geen groei tonen op een piepkleine huidige waarde (bijv. +200% van 3 naar 9 volgers).
      if (main.kpi === "volgers" && main.cur < 30) continue;
      res.groei.push({
        ...base,
        main,
        also: up.filter((s) => s !== main),
        note: changeText(main),
        action: growthAction(c, main),
        works: growthWorks(c, main),
        score: Math.round(upScore + (up.length - 1) * 8),
        urgency: "midden",
      });
    }
  }
  res.daling.sort((a, b) => Number(b.urgency === "hoog") - Number(a.urgency === "hoog") || b.score - a.score);
  res.groei.sort((a, b) => b.score - a.score);
  res.onvoldoende.sort((a, b) => a.name.localeCompare(b.name, "nl"));
  return res;
}
