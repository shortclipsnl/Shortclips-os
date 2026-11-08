/**
 * Maandcontrole van de maandrapportages: één controletaak per medewerker per
 * maand, met een controledag en een vaste fase per rapportage. Puur (zonder
 * database), zodat de taak, de pagina Maandrapportages en Vandaag exact
 * dezelfde regels gebruiken en dit los te testen is.
 */
import { addWorkingDays, snapToWorkingDay } from "./workdays";

type Holidays = ReadonlySet<string> | undefined;

/** Sleutel van de maandtaak: `report_batch:<YYYY-MM>:<userId>`. */
export const BATCH_PREFIX = "report_batch:";
export const batchKey = (period: string, userId: string) => `${BATCH_PREFIX}${period}:${userId}`;
export function parseBatchKey(key: string | null | undefined): { period: string; userId: string } | null {
  if (!key?.startsWith(BATCH_PREFIX)) return null;
  const [period, userId] = key.slice(BATCH_PREFIX.length).split(":");
  return period && userId && /^\d{4}-\d{2}$/.test(period) ? { period, userId } : null;
}
export const batchHref = (period: string) => `/analytics/maandrapportages?maand=${period}&weergave=mijn-controle`;

/** Op welke werkdag van de nieuwe maand de controle standaard staat. */
export const CONTROLE_WERKDAG = 2;

/** De maand ná een rapportperiode (YYYY-MM). */
export function nextPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m!, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** De n-de werkdag van een maand (YYYY-MM), feestdagen meegerekend. */
export function nthWorkday(month: string, n: number, holidays?: Holidays): string {
  const first = `${month}-01`;
  // Eerste werkdag: de 1e zelf, of de eerstvolgende werkdag.
  const firstWorkday = snapToWorkingDay(first, holidays) === first ? first : addWorkingDays(first, 1, holidays);
  return n <= 1 ? firstWorkday : addWorkingDays(firstWorkday, n - 1, holidays);
}

/**
 * Standaard controledag: de tweede werkdag van de maand na de rapportperiode.
 * Ligt die al in het verleden (rapporten kwamen later binnen), dan de
 * eerstvolgende werkdag vanaf vandaag.
 */
export function defaultControleDag(period: string, today: string, holidays?: Holidays): string {
  const dag = nthWorkday(nextPeriod(period), CONTROLE_WERKDAG, holidays);
  if (dag >= today) return dag;
  return snapToWorkingDay(today, holidays) === today ? today : addWorkingDays(today, 1, holidays);
}

/* ------------------------------------------------------------------ *
 * Fase per rapportage (de zes stappen van de maandcontrole)
 * ------------------------------------------------------------------ */

export type ControleFase =
  | "gegenereerd"
  | "wacht_op_controle"
  | "ingepland"
  | "in_controle"
  | "klaar_voor_goedkeuring"
  | "goedgekeurd"
  | "beschikbaar";

export const FASE_STAPPEN: Array<{ key: Exclude<ControleFase, "goedgekeurd">; nr: number; label: string }> = [
  { key: "gegenereerd", nr: 1, label: "Rapportage gegenereerd" },
  { key: "wacht_op_controle", nr: 2, label: "Wacht op interne controle" },
  { key: "ingepland", nr: 3, label: "Controle ingepland" },
  { key: "in_controle", nr: 4, label: "Wordt gecontroleerd" },
  { key: "klaar_voor_goedkeuring", nr: 5, label: "Klaar voor goedkeuring" },
  { key: "beschikbaar", nr: 6, label: "Goedgekeurd en beschikbaar voor klant" },
];

export const FASE_LABEL: Record<ControleFase, string> = {
  gegenereerd: "Rapportage gegenereerd",
  wacht_op_controle: "Wacht op interne controle",
  ingepland: "Controle ingepland",
  in_controle: "Wordt gecontroleerd",
  klaar_voor_goedkeuring: "Klaar voor goedkeuring",
  goedgekeurd: "Goedgekeurd, nog publiceren",
  beschikbaar: "Goedgekeurd en beschikbaar voor klant",
};

export type FaseInput = {
  status: string;
  /** De drie beoordelingsvragen zijn volledig ingevuld. */
  beoordeeld: boolean;
  /** Er is al iets ingevuld, feedback gegeven of een aanpassing gevraagd. */
  gestart: boolean;
  /** Aantal verplichte controlepunten dat nog openstaat. */
  openChecks: number;
  /** De maandtaak van de controleur: bestaat die, en heeft hij een controledag. */
  batch: { exists: boolean; planned: boolean } | null;
};

/** Of de controleur klaar is met deze rapportage (de bal ligt bij de goedkeurder). */
export function gecontroleerd(r: Pick<FaseInput, "status" | "beoordeeld" | "openChecks">): boolean {
  if (r.status === "goedgekeurd" || r.status === "gepubliceerd") return true;
  return r.status === "klaar_voor_controle" && r.beoordeeld && r.openChecks === 0;
}

/** Fase van een rapportage, of null als hij nog gegenereerd wordt of mislukt is. */
export function controleFase(r: FaseInput): ControleFase | null {
  if (r.status === "gepubliceerd") return "beschikbaar";
  if (r.status === "goedgekeurd") return "goedgekeurd";
  if (r.status !== "klaar_voor_controle" && r.status !== "aanpassing_nodig") return null;
  if (gecontroleerd(r)) return "klaar_voor_goedkeuring";
  if (r.gestart || r.status === "aanpassing_nodig") return "in_controle";
  if (!r.batch?.exists) return "gegenereerd";
  return r.batch.planned ? "ingepland" : "wacht_op_controle";
}

/** Tellers per stap (goedgekeurd-nog-publiceren apart, als hint bij stap 6). */
export function countFases(fases: Array<ControleFase | null>): Record<ControleFase, number> {
  const out = { gegenereerd: 0, wacht_op_controle: 0, ingepland: 0, in_controle: 0, klaar_voor_goedkeuring: 0, goedgekeurd: 0, beschikbaar: 0 } as Record<ControleFase, number>;
  for (const f of fases) if (f) out[f]++;
  return out;
}

/** Korte voortgangstekst voor de taak: "8 van 24 gecontroleerd". */
export function voortgangTekst(klaar: number, totaal: number): string {
  return `${klaar} van ${totaal} gecontroleerd`;
}
