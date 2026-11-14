export const WEGING = {
  sales: { label: "Sales en nieuwe omzet", gewicht: 0.3 },
  winst: { label: "Winstgevendheid", gewicht: 0.25 },
  strategie: { label: "Strategische groei", gewicht: 0.2 },
  team: { label: "Team en schaalbaarheid", gewicht: 0.15 },
  effectiviteit: { label: "Persoonlijke effectiviteit", gewicht: 0.1 },
} as const;

export type Onderdeel = keyof typeof WEGING;

export type Actie = { wat: string; waarom: string; klaarAls: string; tijd?: string; status?: "open" | "gehaald" | "deels" | "niet" };

export type Ochtend = {
  kern: string;
  acties: Actie[];
  opvolging: string;
  blokkades: string;
  delegeren: string;
  waarschuwing?: string;
  gemaaktOp: string;
  model?: string;
};

export type EigenInput = {
  gedaan: string;
  uitkomsten: string;
  salesgesprekken: number | null;
  offertesOpgevolgd: number | null;
  verspild: string;
  ingevuldOp: string;
};

export type Avond = {
  scores: Record<Onderdeel, { score: number; bewijs: string }>;
  gewogen: number;
  actieStatus: Array<{ wat: string; status: "gehaald" | "deels" | "niet" | "onbekend"; toelichting?: string }>;
  bereikt: string;
  verspild: string;
  gemisteKans: string;
  actieMorgen: string;
  patroon?: string;
  vragen: string[];
  status: "voorlopig" | "definitief";
  gemaaktOp: string;
  model?: string;
};

export type CoachDag = {
  datum: string;
  ochtend?: Ochtend;
  input?: EigenInput;
  avond?: Avond;
};

export type SalesCijfers = {
  activiteit: Array<{ label: string; waarde: string }>;
  voortgang: Array<{ label: string; waarde: string }>;
  gerealiseerd: Array<{ label: string; waarde: string }>;
};

export type CoachWeek = {
  id: string;
  van: string;
  tot: string;
  gemiddeldeScore: number | null;
  dagscores: Array<{ datum: string; score: number | null }>;
  cijfers: SalesCijfers;
  rapport: Array<{ titel: string; tekst: string }>;
  prioriteiten: Array<{ wat: string; klaarAls: string }>;
  waarheid: string;
  gemaaktOp: string;
  model?: string;
};

export function gewogenScore(scores: Partial<Record<Onderdeel, { score: number }>>): number {
  let som = 0;
  for (const [k, v] of Object.entries(WEGING) as Array<[Onderdeel, { gewicht: number }]>) {
    const s = Math.max(1, Math.min(10, Number(scores[k]?.score ?? 1)));
    som += s * v.gewicht;
  }
  return Math.round(som * 10) / 10;
}
