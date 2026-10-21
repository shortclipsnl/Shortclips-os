/**
 * Awards-config voor de Showcase. Eén plek voor drempels, namen, kleuren en de
 * badge-tekst, zodat we dit later kunnen aanpassen zonder door de code te zoeken.
 */
export type AwardTier = {
  key: string;
  threshold: number;
  name: string;
  description: string;
  color: string;
  /** Korte tekst in de badge (het getal). */
  badge: string;
};

export const AWARD_TIERS: AwardTier[] = [
  { key: "eerste_cut", threshold: 5, name: "Eerste cut", description: "Je eerste vijf shorts opgeleverd", color: "#8fb3d1", badge: "5" },
  { key: "op_ritme", threshold: 25, name: "Op ritme", description: "25 shorts, je draait mee", color: "#d0935c", badge: "25" },
  { key: "vaste_kracht", threshold: 50, name: "Vaste kracht", description: "50 shorts voor Shortclips", color: "#c3ccd8", badge: "50" },
  { key: "century", threshold: 100, name: "Century", description: "Je honderdste short opgeleverd", color: "#e8bf52", badge: "100" },
  { key: "shortclips_pro", threshold: 250, name: "Shortclips Pro", description: "250 shorts, een vaste waarde", color: "#4aa8ec", badge: "250" },
  { key: "master_editor", threshold: 500, name: "Master editor", description: "500 shorts, de standaard voor het team", color: "#ae97f6", badge: "500" },
  { key: "legend", threshold: 1000, name: "Legend", description: "1000 shorts voor Shortclips", color: "#ffffff", badge: "1K" },
];

export const AWARD_COUNT = AWARD_TIERS.length;

export function awardByKey(key: string): AwardTier | undefined {
  return AWARD_TIERS.find((t) => t.key === key);
}
