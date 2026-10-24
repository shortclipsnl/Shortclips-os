import "server-only";
import { getNumberSetting, setNumberSetting } from "@/server/app-settings";

/**
 * Instelbare termijnen voor de deadlinebewaking (herinneringen + escalaties).
 * Stonden vroeger hardcoded; nu per sleutel in app_settings, met een veilige
 * default zodat alles blijft werken als er niets is ingesteld. De jobs lezen
 * deze waarden live; de beheerpagina (/settings/deadlines) zet ze.
 */
export type DeadlineSettingKey =
  | "deadline.editorSoonDays"
  | "deadline.taskSoonDays"
  | "deadline.clientFeedbackDays"
  | "deadline.scriptFeedbackDays"
  | "deadline.escalateCoordinatorDays"
  | "deadline.escalateOwnerDays";

export type DeadlineSettingDef = {
  key: DeadlineSettingKey;
  label: string;
  description: string;
  unit: "dagen" | "werkdagen";
  default: number;
  min: number;
  max: number;
};

/** De definities — bron voor zowel de defaults als de beheerpagina. */
export const DEADLINE_SETTING_DEFS: DeadlineSettingDef[] = [
  {
    key: "deadline.editorSoonDays",
    label: "Editor: deadline komt eraan",
    description: "Zoveel dagen vóór de interne opleverdeadline krijgt de editor een vooraankondiging.",
    unit: "dagen",
    default: 2, min: 0, max: 14,
  },
  {
    key: "deadline.taskSoonDays",
    label: "Taken: deadline komt eraan",
    description: "Zoveel dagen vóór de taakdeadline krijgt de taakhouder een herinnering.",
    unit: "dagen",
    default: 2, min: 0, max: 14,
  },
  {
    key: "deadline.clientFeedbackDays",
    label: "Klantfeedback op video",
    description: "Na zoveel dagen zonder feedback op een video krijgt de klant een herinnering en de coördinator een opvolgsignaal.",
    unit: "dagen",
    default: 3, min: 1, max: 30,
  },
  {
    key: "deadline.scriptFeedbackDays",
    label: "Klantfeedback op script",
    description: "Na zoveel dagen zonder feedback op een script krijgt de klant een herinnering.",
    unit: "dagen",
    default: 3, min: 1, max: 30,
  },
  {
    key: "deadline.escalateCoordinatorDays",
    label: "Escalatie naar coördinator",
    description: "Staat een eerste versie zoveel dagen óver de interne deadline, dan wordt de coördinator ingeschakeld.",
    unit: "dagen",
    default: 1, min: 0, max: 30,
  },
  {
    key: "deadline.escalateOwnerDays",
    label: "Escalatie naar eigenaar",
    description: "Staat een eerste versie zoveel dagen óver de interne deadline, dan wordt ook de eigenaar ingeschakeld.",
    unit: "dagen",
    default: 3, min: 1, max: 60,
  },
];

export type DeadlineSettings = Record<DeadlineSettingKey, number>;

const DEFAULTS = Object.fromEntries(DEADLINE_SETTING_DEFS.map((d) => [d.key, d.default])) as DeadlineSettings;

/** Alle termijnen in één keer (live uit app_settings, met defaults). */
export async function getDeadlineSettings(): Promise<DeadlineSettings> {
  const entries = await Promise.all(
    DEADLINE_SETTING_DEFS.map(async (d) => [d.key, await getNumberSetting(d.key, d.default)] as const),
  );
  return Object.fromEntries(entries) as DeadlineSettings;
}

export function defaultDeadlineSettings(): DeadlineSettings {
  return { ...DEFAULTS };
}

/** Eén termijn zetten (met clamping binnen de toegestane grenzen). */
export async function setDeadlineSetting(key: DeadlineSettingKey, value: number, updatedById?: string): Promise<number> {
  const def = DEADLINE_SETTING_DEFS.find((d) => d.key === key);
  if (!def) throw new Error(`Onbekende deadline-instelling: ${key}`);
  const clamped = Math.round(Math.max(def.min, Math.min(def.max, value)));
  await setNumberSetting(key, clamped, { category: "deadlines", description: def.label, updatedById });
  return clamped;
}
