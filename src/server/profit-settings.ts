import "server-only";
import { getBoolSetting, getNumberSetting, setBoolSetting, setNumberSetting } from "./app-settings";

/**
 * Door de eigenaar instelbare grenswaarden voor de winstgevendheid-weergave.
 * Opgeslagen in de bestaande app_settings-store (geen nieuwe tabel).
 */
export type ProfitSettings = {
  /** Brutomarge vanaf dit percentage = groen (gezond). */
  marginGreenPct: number;
  /** Brutomarge vanaf dit percentage = oranje; daaronder = rood. */
  marginOrangePct: number;
  /** Toegerekende overhead meenemen in de geschatte nettowinst. */
  includeOverhead: boolean;
  /** Intern uurtarief Shortclips (scripting/voorbereiding), ex btw. 0 = nog in te stellen. */
  internUurtarief: number;
  /** Standaard interne uren per klant per maand (scripting/voorbereiding). */
  internUrenPerKlant: number;
  /** Videograaf-uurtarief, ex btw. */
  vgUurtarief: number;
  /** Instelbare overhead per categorie (per maand, bedrijfsbreed). */
  overheadKantoor: number;
  overheadSoftware: number;
  overheadOverig: number;
};

const KEYS = {
  green: "profit.marginGreenPct",
  orange: "profit.marginOrangePct",
  overhead: "profit.includeOverhead",
  internRate: "profit.internUurtarief",
  internUren: "profit.internUrenPerKlant",
  vgRate: "profit.vgUurtarief",
  ohKantoor: "profit.overheadKantoor",
  ohSoftware: "profit.overheadSoftware",
  ohOverig: "profit.overheadOverig",
} as const;

export const PROFIT_DEFAULTS: ProfitSettings = {
  marginGreenPct: 50,
  marginOrangePct: 20,
  includeOverhead: true,
  internUurtarief: 16.5, // intern uurtarief Shortclips (aanpasbaar via Instellingen)
  internUrenPerKlant: 1.5,
  vgUurtarief: 16.75,
  overheadKantoor: 0,
  overheadSoftware: 0,
  overheadOverig: 0,
};

export async function getProfitSettings(): Promise<ProfitSettings> {
  const [green, orange, overhead, internRate, internUren, vgRate, ohKantoor, ohSoftware, ohOverig] = await Promise.all([
    getNumberSetting(KEYS.green, PROFIT_DEFAULTS.marginGreenPct),
    getNumberSetting(KEYS.orange, PROFIT_DEFAULTS.marginOrangePct),
    getBoolSetting(KEYS.overhead, PROFIT_DEFAULTS.includeOverhead),
    getNumberSetting(KEYS.internRate, PROFIT_DEFAULTS.internUurtarief),
    getNumberSetting(KEYS.internUren, PROFIT_DEFAULTS.internUrenPerKlant),
    getNumberSetting(KEYS.vgRate, PROFIT_DEFAULTS.vgUurtarief),
    getNumberSetting(KEYS.ohKantoor, PROFIT_DEFAULTS.overheadKantoor),
    getNumberSetting(KEYS.ohSoftware, PROFIT_DEFAULTS.overheadSoftware),
    getNumberSetting(KEYS.ohOverig, PROFIT_DEFAULTS.overheadOverig),
  ]);
  // Oranje kan nooit boven groen liggen.
  return {
    marginGreenPct: green,
    marginOrangePct: Math.min(orange, green),
    includeOverhead: overhead,
    internUurtarief: Math.max(0, internRate),
    internUrenPerKlant: Math.max(0, internUren),
    vgUurtarief: Math.max(0, vgRate),
    overheadKantoor: Math.max(0, ohKantoor),
    overheadSoftware: Math.max(0, ohSoftware),
    overheadOverig: Math.max(0, ohOverig),
  };
}

export async function setProfitSettings(input: Partial<ProfitSettings>, updatedById: string | null): Promise<void> {
  const opts = { category: "profit", updatedById: updatedById ?? undefined };
  if (input.marginGreenPct != null) await setNumberSetting(KEYS.green, Math.max(0, Math.min(100, Math.round(input.marginGreenPct))), opts);
  if (input.marginOrangePct != null) await setNumberSetting(KEYS.orange, Math.max(0, Math.min(100, Math.round(input.marginOrangePct))), opts);
  if (input.includeOverhead != null) await setBoolSetting(KEYS.overhead, input.includeOverhead, opts);
  if (input.internUurtarief != null) await setNumberSetting(KEYS.internRate, Math.max(0, input.internUurtarief), opts);
  if (input.internUrenPerKlant != null) await setNumberSetting(KEYS.internUren, Math.max(0, input.internUrenPerKlant), opts);
  if (input.vgUurtarief != null) await setNumberSetting(KEYS.vgRate, Math.max(0, input.vgUurtarief), opts);
  if (input.overheadKantoor != null) await setNumberSetting(KEYS.ohKantoor, Math.max(0, input.overheadKantoor), opts);
  if (input.overheadSoftware != null) await setNumberSetting(KEYS.ohSoftware, Math.max(0, input.overheadSoftware), opts);
  if (input.overheadOverig != null) await setNumberSetting(KEYS.ohOverig, Math.max(0, input.overheadOverig), opts);
}

/** Kleurcode van een brutomarge o.b.v. de ingestelde grenswaarden. */
export function marginColor(marginPct: number | null, s: ProfitSettings): "good" | "warn" | "bad" {
  if (marginPct == null) return "warn";
  if (marginPct >= s.marginGreenPct) return "good";
  if (marginPct >= s.marginOrangePct) return "warn";
  return "bad";
}
