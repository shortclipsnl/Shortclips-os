/**
 * Klantgezondheid voor de Resultatenpagina (/analytics): per klant één status
 * die resultaten, levering, klantfeedback en het verlengmoment combineert, met
 * direct de actie die erbij hoort.
 *
 * Pure logica, zonder database. De resultaten komen uit `evaluateResults`
 * (src/lib/client-retention.ts): vaste vensters van 30 dagen tegenover de 30
 * daarvoor, mediaan per video, minimale basis. Daardoor verandert een status
 * niet als iemand op de pagina een andere periode kiest.
 *
 * Standen:
 *  - spoed:     de klant ziet slechte cijfers én krijgt te weinig nieuws (late
 *               levering of verlengmoment binnen 60 dagen), of er is ernstige
 *               of herhaalde ontevredenheid;
 *  - bijsturen: resultaten dalen (levering is op schema) of er is een open klacht;
 *  - inhalen:   resultaten stabiel, maar de levering loopt achter (ligt aan ons tempo);
 *  - koers:     geen van beide;
 *  - geen_data: geen betrouwbaar oordeel (geen koppeling, verouderde of te weinig data).
 */

export type GezondheidStatus = "spoed" | "bijsturen" | "inhalen" | "koers" | "geen_data";

export const STATUS_LABEL: Record<GezondheidStatus, string> = {
  spoed: "Spoed",
  bijsturen: "Bijsturen",
  inhalen: "Inhalen",
  koers: "Op koers",
  geen_data: "Geen oordeel",
};

/** Volgorde in de lijst: urgentste eerst. */
export const STATUS_RANK: Record<GezondheidStatus, number> = { spoed: 0, bijsturen: 1, inhalen: 2, geen_data: 3, koers: 4 };

export type GezondheidInput = {
  resultsState: "ok" | "daling" | "onvoldoende_data" | "verouderd" | "geen_koppeling";
  /** Verandering weergaven per video in % (laatste 30 dagen t.o.v. de 30 daarvoor); null = niet bekend. */
  viewsPct: number | null;
  /** Aantal open opleveringen dat zijn deadline mist. */
  lateCount: number;
  /** Dagen te laat van de meest vertraagde oplevering. */
  lateDays: number;
  /** Verlenging of opzegmoment binnen 60 dagen (of net gepasseerd). */
  renewalSoon: boolean;
  /** Open klantfeedback: ernstig (klantbehoud in gevaar) en ontevredenheid. */
  feedbackSerious: number;
  feedbackUnhappy: number;
};

export function statusOf(i: GezondheidInput): GezondheidStatus {
  const daalt = i.resultsState === "daling";
  const achter = i.lateCount > 0;
  const spoed =
    i.feedbackSerious > 0 ||
    i.feedbackUnhappy >= 3 ||
    (daalt && (achter || i.renewalSoon || i.feedbackUnhappy > 0)) ||
    (i.feedbackUnhappy > 0 && achter);
  if (spoed) return "spoed";
  if (daalt || i.feedbackUnhappy > 0) return "bijsturen";
  if (achter) return "inhalen";
  if (i.resultsState !== "ok") return "geen_data";
  return "koers";
}

const fmtPct = (n: number) => `${n > 0 ? "+" : n < 0 ? "-" : ""}${Math.abs(Math.round(n))}%`;

/** Korte, aantoonbare reden in gewone taal (de data erachter staat in de uitklap). */
export function redenOf(i: GezondheidInput, status: GezondheidStatus): string {
  const parts: string[] = [];
  if (i.resultsState === "daling" && i.viewsPct != null) parts.push(`Weergaven ${fmtPct(i.viewsPct)}`);
  else if (i.resultsState === "daling") parts.push("Resultaten dalen");
  if (i.lateCount > 0) parts.push(i.lateCount === 1 ? `${i.lateDays} dagen te laat` : `${i.lateCount} video's te laat, tot ${i.lateDays} dagen`);
  if (i.feedbackSerious > 0) parts.push("klantbehoud in gevaar");
  else if (i.feedbackUnhappy > 0) parts.push(i.feedbackUnhappy === 1 ? "open klacht" : `${i.feedbackUnhappy} open klachten`);
  if (status === "spoed" && i.renewalSoon) parts.push("verlenging binnen 60 dagen");
  if (parts.length) return parts.join(", ");
  if (status === "geen_data") {
    return i.resultsState === "geen_koppeling" ? "Geen resultatenkoppeling" : i.resultsState === "verouderd" ? "Resultaten niet actueel" : "Te weinig data voor een oordeel";
  }
  if (i.viewsPct != null && i.viewsPct >= 10) return `Weergaven ${fmtPct(i.viewsPct)}, levering op schema`;
  return "Stabiel en op schema";
}

export type Actie = { titel: string; stappen: string[]; werkdagen: number };

/** Vaste actie per stand, zodat het team niets hoeft te bedenken. */
export const ACTIES: Record<Exclude<GezondheidStatus, "koers" | "geen_data">, Actie> = {
  spoed: {
    titel: "Vol gas, binnen 2 werkdagen",
    werkdagen: 2,
    stappen: [
      "Geef de editing van deze klant voorrang. Bekijk de verschuifmogelijkheden in de capaciteitsradar (er wordt nooit automatisch verschoven).",
      "Neem binnen 48 uur contact op met de klant, met een plan in plaats van een excuus.",
      "Meet na twee weken of de resultaten en de levertijd zijn hersteld.",
    ],
  },
  bijsturen: {
    titel: "De content bijsturen, binnen 5 werkdagen",
    werkdagen: 5,
    stappen: [
      "Bekijk de laatste video's en zie welke hooks zijn afgevallen.",
      "Pas de scripts voor de volgende opnamedag aan op wat wel werkt.",
      "Meet na twee weken het effect en leg het vast in het Contentgeheugen.",
    ],
  },
  inhalen: {
    titel: "Het tempo herstellen, binnen 3 werkdagen",
    werkdagen: 3,
    stappen: [
      "Bekijk in de capaciteitsradar wie ruimte heeft in de editing.",
      "Verschuif de montage of vraag een extra editor uit de editordatabase.",
      "Laat de klant weten wanneer de video's komen, voordat hij ernaar vraagt.",
    ],
  },
};

/** Weergaven per week van de laatste 8 weken (oudste eerst) als punten voor een 84x28-lijntje. */
export function sparkPoints(series: number[], width = 84, height = 28): string | null {
  if (series.length < 4 || series.filter((v) => v > 0).length < 3) return null;
  const base = series.slice(0, Math.max(3, Math.floor(series.length / 2)));
  const mean = base.reduce((s, v) => s + v, 0) / base.length;
  if (mean <= 0) return null;
  const pad = 3;
  const step = (width - 4) / (series.length - 1);
  return series
    .map((v, i) => {
      // Vaste schaal: 60% tot 140% van het eigen gemiddelde. Zo zien +2% en -34% er verschillend uit.
      const idx = Math.max(60, Math.min(140, (v / mean) * 100));
      const x = 2 + i * step;
      const y = height - pad - ((idx - 60) / 80) * (height - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

/** Y-positie van de stippellijn (het eigen gemiddelde = 100%) voor dezelfde schaal. */
export function baselineY(height = 28): number {
  const pad = 3;
  return height - pad - ((100 - 60) / 80) * (height - 2 * pad);
}

/** De weergaven-verandering die de reden het best samenvat: bij daling de slechtste platform, anders het grootste. */
export function viewsPctOf(platforms: { state: string; changes: { key: string; pct: number; cur: number }[] }[]): number | null {
  const views = platforms
    .filter((p) => p.state === "ok" || p.state === "daling")
    .map((p) => ({ state: p.state, c: p.changes.find((c) => c.key === "weergaven") }))
    .filter((x): x is { state: string; c: { key: string; pct: number; cur: number } } => !!x.c);
  if (!views.length) return null;
  const dropping = views.filter((v) => v.state === "daling");
  if (dropping.length) return dropping.reduce((m, v) => (v.c.pct < m.c.pct ? v : m)).c.pct;
  return views.reduce((m, v) => (v.c.cur > m.c.cur ? v : m)).c.pct;
}

export type GezondheidRow = {
  clientId: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  color: string | null;
  status: GezondheidStatus;
  reden: string;
  viewsPct: number | null;
  /** Weergaven per week, oudste eerst (8 weken). */
  series: number[];
  lateCount: number;
  lateDays: number;
  renewalSoon: boolean;
  feedbackSerious: number;
  feedbackUnhappy: number;
  resultsState: GezondheidInput["resultsState"];
  ownerId: string | null;
  ownerName: string | null;
};

export const sortRows = (rows: GezondheidRow[]) =>
  [...rows].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || (a.viewsPct ?? 0) - (b.viewsPct ?? 0) || a.name.localeCompare(b.name, "nl"));
