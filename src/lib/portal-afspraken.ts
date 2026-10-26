import type { PortalSettings } from "@/server/portal-settings";

/**
 * De samenwerkingsafspraken (document "Zo leggen we het vast") op één plek.
 * Gevoed door de centrale, intern instelbare portal-settings, zodat bedragen en
 * termijnen overal gelijk zijn en nergens afwijken. Gegroepeerd per categorie
 * voor uitklapbare weergave in het portaal.
 */

export type Afspraak = { k: string; v: string };
export type AfsprakenGroep = { title: string; items: Afspraak[] };

/** Alle afspraken als platte lijst (centrale bron). */
export function buildAfsprakenFlat(s: PortalSettings): Afspraak[] {
  return [
    { k: "Looptijd", v: s.contractTerm },
    { k: "Facturatie", v: s.billingNote },
    { k: "Duur opnamedag", v: s.shootDuration },
    { k: "Feedbackrondes", v: `Per video is één gebundelde feedbackronde inbegrepen. Alle feedback wordt in één keer volledig aangeleverd. Extra aanvullingen nadat de feedbackronde is verwerkt, gelden als een nieuwe feedbackronde en kosten ${s.extraFeedbackFee}.` },
    { k: "Scripts", v: "Scripts worden vooraf afgestemd en vóór de opnamedag definitief akkoord gegeven. Kleine aanpassingen in woordkeuze op locatie zijn mogelijk. Grote inhoudelijke wijzigingen na akkoord zijn niet inbegrepen." },
    { k: "Opnieuw opnemen", v: `Bij wijzigingen aan een eerder goedgekeurd script: ${s.reshootFee}.` },
    { k: "Extra content op locatie", v: s.extraContentNote },
    { k: "Beoordelingstermijn", v: `${s.reviewDays} werkdagen na oplevering. Geen reactie binnen ${s.reviewAutoApproveDays} werkdagen geldt als akkoord.` },
    { k: "Annulering", v: `Kosteloos tot ${s.cancelNoticeDays} werkdagen voorafgaand aan de opnamedag. Bij annulering binnen ${s.cancelNoticeDays} werkdagen wordt ${s.cancelFee} in rekening gebracht. ${s.cancelLateNote}` },
    { k: "Reistijd", v: `Onze reiskosten bedragen ${s.travelCost}.` },
    { k: "Raw footage", v: `Blijft bij Shortclips. Op verzoek beschikbaar voor ${s.rawFootageFee}.` },
    { k: "Responstijd", v: s.responseTime },
  ];
}

/** Afspraken gegroepeerd per categorie (voor uitklapbare onderdelen). */
export function buildAfsprakenGroepen(s: PortalSettings): AfsprakenGroep[] {
  const flat = new Map(buildAfsprakenFlat(s).map((a) => [a.k, a]));
  const pick = (keys: string[]): Afspraak[] => keys.map((k) => flat.get(k)!).filter(Boolean);
  return [
    { title: "Samenwerking & looptijd", items: pick(["Looptijd", "Facturatie", "Responstijd"]) },
    { title: "Scripts & feedback", items: pick(["Scripts", "Feedbackrondes", "Beoordelingstermijn", "Opnieuw opnemen"]) },
    { title: "Opnamedag", items: pick(["Duur opnamedag", "Extra content op locatie", "Annulering", "Reistijd"]) },
    { title: "Beeldmateriaal", items: pick(["Raw footage"]) },
  ];
}
