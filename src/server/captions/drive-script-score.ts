/**
 * Pure scorelogica voor het koppelen van Drive-script-PDF's aan opnames.
 * Geen server-only/DB-afhankelijkheden, zodat dit los te testen is.
 *
 * Betrouwbare sleutel (met het team bevestigd): dezelfde klant + de opnamedatum
 * in de bestandsnaam of mapnaam, en losse mappen per opname. We koppelen alleen
 * automatisch bij een zekere datumtreffer; twijfel = suggestie.
 */

const MONTHS_NL = [
  "januari", "februari", "maart", "april", "mei", "juni",
  "juli", "augustus", "september", "oktober", "november", "december",
];
const MONTHS_SHORT = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

export type MatchConfidence = "hoog" | "middel" | "laag";

export type ScoreInput = {
  /** Opnamedatum, ISO "YYYY-MM-DD". */
  scheduledOn: string;
  /** Titel van de opname (vaak generiek). */
  title?: string | null;
  /** Naam van de klant — om generieke tokens te negeren. */
  clientName?: string | null;
};

export type ScoreFile = {
  name: string;
  path?: string | null;
  modifiedAt?: Date | string | null;
};

export type ScoreResult = {
  score: number;
  confidence: MatchConfidence;
  reason: string;
  /** Harde datumtreffer (dag + maand) in naam of pad — de betrouwbaarste sleutel. */
  dateHit: boolean;
};

/** Normaliseert tekst voor losse matching: kleine letters, scheidingstekens → spatie. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Bouwt de datumvarianten van een opnamedatum ("12 nov", "12 11", "2026 11 12", …). */
export function dateTokens(iso: string): { strong: string[]; month: string[] } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return { strong: [], month: [] };
  const year = m[1]!;
  const mo = Number(m[2]);
  const day = Number(m[3]);
  const dd = String(day).padStart(2, "0");
  const mm = String(mo).padStart(2, "0");
  const monthLong = MONTHS_NL[mo - 1]!;
  const monthShort = MONTHS_SHORT[mo - 1]!;

  const strong = new Set<string>([
    norm(`${year} ${mm} ${dd}`),
    norm(`${dd} ${mm} ${year}`),
    norm(`${dd} ${mm}`),
    norm(`${day} ${mo}`),
    norm(`${day} ${monthLong}`),
    norm(`${day} ${monthShort}`),
    norm(`${dd} ${monthLong}`),
    norm(`${dd} ${monthShort}`),
  ].filter(Boolean));

  const month = new Set<string>([
    norm(`${monthLong} ${year}`),
    norm(`${monthShort} ${year}`),
    norm(`${year} ${mm}`),
    norm(monthLong),
  ].filter(Boolean));

  return { strong: [...strong], month: [...month] };
}

/** Bevat de (genormaliseerde) tekst een token als losse reeks? */
function containsToken(haystack: string, token: string): boolean {
  if (!token) return false;
  return ` ${haystack} `.includes(` ${token} `) || haystack.includes(token);
}

/**
 * Scoort hoe goed één Drive-bestand bij één opname past. Puur en deterministisch.
 * Alleen aanroepen voor bestanden van dezelfde klant (klantfilter doet de caller).
 */
export function scoreScriptFileForShoot(shoot: ScoreInput, file: ScoreFile): ScoreResult {
  const hay = `${norm(file.name)} ${norm(file.path ?? "")}`.trim();
  const { strong, month } = dateTokens(shoot.scheduledOn);

  let score = 0;
  const reasons: string[] = [];

  const strongHit = strong.find((t) => containsToken(hay, t));
  const dateHit = Boolean(strongHit);
  if (strongHit) {
    score += 100;
    reasons.push(`datum "${strongHit}" in naam/map`);
  }

  const monthHit = !dateHit ? month.find((t) => containsToken(hay, t)) : undefined;
  if (monthHit) {
    score += 40;
    reasons.push(`maand/periode "${monthHit}" in map`);
  }

  if (file.modifiedAt) {
    const mod = typeof file.modifiedAt === "string" ? new Date(file.modifiedAt) : file.modifiedAt;
    const day = new Date(`${shoot.scheduledOn}T00:00:00`);
    if (!Number.isNaN(mod.getTime()) && !Number.isNaN(day.getTime())) {
      const diffDays = Math.abs((mod.getTime() - day.getTime()) / 86_400_000);
      if (diffDays <= 21) {
        score += Math.max(0, 15 - Math.round(diffDays / 2));
        if (diffDays <= 10) reasons.push("rond de opnamedatum bewerkt");
      }
    }
  }

  const stop = new Set([
    "opnamedag", "opname", "opnames", "scripts", "script", "shortclips", "short", "video", "videos",
    ...norm(shoot.clientName ?? "").split(" ").filter(Boolean),
  ]);
  const titleTokens = norm(shoot.title ?? "").split(" ").filter((t) => t.length >= 3 && !stop.has(t));
  const nameTokens = new Set(norm(file.name).split(" ").filter(Boolean));
  const overlap = titleTokens.filter((t) => nameTokens.has(t)).length;
  if (overlap > 0) {
    score += Math.min(20, overlap * 10);
    reasons.push(`titel-overeenkomst (${overlap})`);
  }

  let confidence: MatchConfidence = "laag";
  if (dateHit) confidence = "hoog";
  else if (monthHit || score >= 30) confidence = "middel";

  return { score, confidence, reason: reasons.join(", ") || "geen duidelijke aanwijzingen", dateHit };
}

/** Één kandidaat: het Drive-bestand plus de score t.o.v. de opname. */
export type ShootCandidate = {
  fileExternalId: string;
  fileName: string;
  filePath: string | null;
  result: ScoreResult;
};

/**
 * Kiest de beste match en bepaalt of het een zekere koppeling of een suggestie is.
 * - Geen aanwijzing → null.
 * - Eén duidelijke datumtreffer (niet ambigu) → "gekoppeld".
 * - Twee even sterke datumtreffers of alleen zwakkere aanwijzingen → "suggestie".
 */
export function decideBestMatch(candidates: ShootCandidate[]): {
  best: ShootCandidate;
  status: "gekoppeld" | "suggestie";
} | null {
  const scored = candidates.filter((c) => c.result.score > 0).sort((a, b) => b.result.score - a.result.score);
  if (scored.length === 0) return null;
  const best = scored[0]!;
  const runnerUp = scored[1];
  const ambiguous = Boolean(runnerUp && best.result.score - runnerUp.result.score < 20);
  if (best.result.dateHit && !ambiguous) return { best, status: "gekoppeld" };
  return { best, status: "suggestie" };
}
