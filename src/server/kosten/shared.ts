/**
 * Gedeelde begrippen van de Kostenmonitor — groepen, categorieën en de regel
 * "wat telt als bedrijfskosten". Eén op één overgenomen uit de originele
 * Kostenmonitor, zodat de cijfers exact gelijk blijven.
 *
 * Géén `server-only`: dit wordt ook door het seed-script (tsx) gebruikt.
 */

/** Het ruwe exportformaat zoals de maandelijkse DigiBoox-uitlezing het levert. */
export type KostenPayload = {
  bijgewerkt?: string | null;
  /** Leveranciersnamen; regels verwijzen met een index. */
  lev: string[];
  /** Subcategorieën als [naam, groep, soort]. */
  subs: [string, string, string][];
  /** Per maand (YYYY-MM) regels: [leverancierIndex, subIndex, metBtw, zonderBtw, aantal]. */
  m: Record<string, [number, number, number, number, number][]>;
  /** Gefactureerde omzet (zonder btw) per maand. */
  omzet?: Record<string, number>;
};

/** Eén regel zoals de pagina hem gebruikt: [levIndex, subIndex, metBtw, zonderBtw, aantal]. */
export type Regel = [number, number, number, number, number];

/** Wat de pagina ingeladen krijgt — dezelfde vorm als het oude `D`-object. */
export type KostenData = {
  bijgewerkt: string | null;
  lev: string[];
  subs: [string, string, string][];
  m: Record<string, Regel[]>;
  omzet: Record<string, number>;
};

/**
 * Groepen in vaste volgorde, met label en een vaste reekskleur (series color).
 * De kleuren zijn bewust letterlijk: het zijn categorie-identiteiten in grafieken
 * en moeten in licht én donker hetzelfde blijven, los van de themakleuren.
 */
export const GROUPS: Record<string, { label: string; color: string }> = {
  personeel: { label: "Personeel", color: "#2a78d6" },
  editors: { label: "Editors", color: "#eb6834" },
  freelancers: { label: "Freelancers", color: "#1baf7a" },
  marketing: { label: "Marketing en leads", color: "#6250d6" },
  vast: { label: "Vaste lasten", color: "#eda100" },
  operationeel: { label: "Operationeel", color: "#e87ba4" },
  controle: { label: "Nog controleren", color: "#98a3b3" },
};

/** Volgorde waarin de groepen getoond worden. */
export const GORDER = ["personeel", "editors", "freelancers", "marketing", "vast", "operationeel", "controle"] as const;

/** Bedrijfskosten = alle groepen behalve 'controle' (en behalve prive/belasting). */
export const isBedrijfskost = (groep: string): boolean => (GORDER as readonly string[]).includes(groep) && groep !== "controle";

/** De vaste 17 subcategorieën, in de canonieke volgorde van de bron. */
export const CANON_SUBS: [string, string, string][] = [
  ["Lonen", "personeel", "vast"],
  ["Loonheffing", "personeel", "vast"],
  ["Editors", "editors", "variabel"],
  ["Freelancers", "freelancers", "variabel"],
  ["Marketing en leads", "marketing", "variabel"],
  ["Huur en kantoor", "vast", "vast"],
  ["Software en tools", "vast", "vast"],
  ["Verzekeringen", "vast", "vast"],
  ["Boekhouding en bank", "vast", "vast"],
  ["Telefoon en internet", "vast", "vast"],
  ["Auto en vervoer", "operationeel", "variabel"],
  ["Reizen en horeca", "operationeel", "variabel"],
  ["Apparatuur en inkopen", "operationeel", "eenmalig"],
  ["Overige kosten", "operationeel", "variabel"],
  ["Nog controleren", "controle", "controle"],
  ["Privé en reserveringen", "prive", "geen"],
  ["Btw en inkomstenbelasting", "belasting", "geen"],
];

export const MN = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
export const MNL = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];

/* ---- Belastingberekening (IB 2026) — letterlijk uit de bron ---- */

export const IB26 = {
  s1: 38883,
  s2: 78426,
  t1: 0.3575,
  t2: 0.3756,
  t3: 0.495,
  za: 1200,
  mkb: 0.127,
  ahk: 3115,
  ahkVan: 29736,
  ahkAf: 0.06398,
  ak: 5685,
  akVan: 45592,
  akAf: 0.0651,
  zvw: 0.0485,
  zvwMax: 79409,
};

export type IbResult = { W: number; ibNet: number; zvw: number; tax: number; netto: number; eff: number };

/** Verwachte inkomstenbelasting + Zvw over een jaarwinst W. Letterlijk overgenomen. */
export function ibCalc(W: number): IbResult {
  const P = IB26;
  W = Math.max(0, W);
  const za = Math.min(P.za, W);
  const w1 = W - za;
  const mkb = w1 * P.mkb;
  const T = w1 - mkb;
  let ib = Math.min(T, P.s1) * P.t1 + Math.max(0, Math.min(T, P.s2) - P.s1) * P.t2 + Math.max(0, T - P.s2) * P.t3;
  ib += Math.min(za + mkb, Math.max(0, W - P.s2)) * (P.t3 - P.t2);
  const ahk = T >= P.s2 ? 0 : Math.max(0, P.ahk - Math.max(0, T - P.ahkVan) * P.ahkAf);
  const ak = Math.max(0, P.ak - Math.max(0, w1 - P.akVan) * P.akAf);
  const ibNet = Math.max(0, ib - ahk - ak);
  const zvw = Math.min(T, P.zvwMax) * P.zvw;
  return { W, ibNet, zvw, tax: ibNet + zvw, netto: W - ibNet - zvw, eff: W ? (ibNet + zvw) / W : 0 };
}
