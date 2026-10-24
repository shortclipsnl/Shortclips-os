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
};

const KEYS = {
  green: "profit.marginGreenPct",
  orange: "profit.marginOrangePct",
  overhead: "profit.includeOverhead",
} as const;

export const PROFIT_DEFAULTS: ProfitSettings = { marginGreenPct: 50, marginOrangePct: 20, includeOverhead: true };

export async function getProfitSettings(): Promise<ProfitSettings> {
  const [green, orange, overhead] = await Promise.all([
    getNumberSetting(KEYS.green, PROFIT_DEFAULTS.marginGreenPct),
    getNumberSetting(KEYS.orange, PROFIT_DEFAULTS.marginOrangePct),
    getBoolSetting(KEYS.overhead, PROFIT_DEFAULTS.includeOverhead),
  ]);
  // Oranje kan nooit boven groen liggen.
  return { marginGreenPct: green, marginOrangePct: Math.min(orange, green), includeOverhead: overhead };
}

export async function setProfitSettings(input: Partial<ProfitSettings>, updatedById: string | null): Promise<void> {
  const opts = { category: "profit", updatedById: updatedById ?? undefined };
  if (input.marginGreenPct != null) await setNumberSetting(KEYS.green, Math.max(0, Math.min(100, Math.round(input.marginGreenPct))), opts);
  if (input.marginOrangePct != null) await setNumberSetting(KEYS.orange, Math.max(0, Math.min(100, Math.round(input.marginOrangePct))), opts);
  if (input.includeOverhead != null) await setBoolSetting(KEYS.overhead, input.includeOverhead, opts);
}

/** Kleurcode van een brutomarge o.b.v. de ingestelde grenswaarden. */
export function marginColor(marginPct: number | null, s: ProfitSettings): "good" | "warn" | "bad" {
  if (marginPct == null) return "warn";
  if (marginPct >= s.marginGreenPct) return "good";
  if (marginPct >= s.marginOrangePct) return "warn";
  return "bad";
}
