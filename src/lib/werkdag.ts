/**
 * Werktijden en vast dagritme van het kantoorteam. Er zijn (nog) geen
 * persoonlijke werktijden per medewerker vastgelegd; zodra die er zijn, kan
 * werkoverzicht.ts ze hier per persoon overschrijven.
 */
export const TEAM_WORKDAY = { start: "08:30", end: "17:00" } as const;

export type DagritmeItem = { from: string; to?: string; label: string };

/** Vaste momenten op de dag — als markeringen op de werkdagbalk. */
export const DAGRITME: DagritmeItem[] = [
  { from: "08:30", to: "09:00", label: "Dagstart" },
  { from: "12:30", to: "13:00", label: "Pauze" },
  { from: "13:00", to: "13:30", label: "Wat moet er vandaag echt af?" },
  { from: "16:45", to: "17:00", label: "To-do voor morgen klaarzetten" },
];

export const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
