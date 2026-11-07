/**
 * Werktijden en vast dagritme van het kantoorteam. Er zijn (nog) geen
 * persoonlijke werktijden per medewerker vastgelegd; zodra die er zijn, kan
 * werkoverzicht.ts ze hier per persoon overschrijven.
 */
export const TEAM_WORKDAY = { start: "08:30", end: "17:00" } as const;

export type DagritmeItem = { from: string; to?: string; label: string; detail?: string };

/** Het vaste dagritme van het kantoorteam (Dagindeling-blok + markeringen op de werkdagbalk). */
export const DAGRITME: DagritmeItem[] = [
  { from: "08:30", to: "09:00", label: "Dagstart", detail: "Samen de dag doornemen: wat staat er op de planning en wat heeft prioriteit." },
  { from: "12:30", to: "13:00", label: "Pauze", detail: "Even weg van het scherm, tot 13:00." },
  { from: "13:00", to: "13:30", label: "Wat moet er vandaag echt af?", detail: "Check de belangrijkste deadlines en stem af waar nodig." },
  { from: "16:45", label: "To-do-lijst voor morgen maken", detail: "Zet klaar wat morgen als eerste moet, zodat je direct kunt starten." },
];

export const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
