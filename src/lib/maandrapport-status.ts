/**
 * Weergavestatus en sortering voor de pagina Maandrapportages.
 * Puur (zonder database), zodat de tabel, de statistieken en de Vandaag-pagina
 * exact dezelfde indeling gebruiken en dit los te testen is.
 */

export type ViewStatus =
  | "nog_genereren"
  | "bezig"
  | "gegenereerd"
  | "controleren"
  | "goedgekeurd"
  | "gepubliceerd"
  | "mislukt";

export type ViewStatusInput = {
  /** Ontbreekt er nog een rapport voor deze klant en maand. */
  exists: boolean;
  status?: string | null;
  /** Persoonlijke beoordeling (3 vragen) volledig ingevuld. */
  beoordeeld?: boolean;
  /** Analyse staat te lang op 'bezig'. */
  stale?: boolean;
};

export function viewStatus(r: ViewStatusInput): ViewStatus {
  if (!r.exists) return "nog_genereren";
  switch (r.status) {
    case "gegevens_verzamelen":
      return "bezig";
    case "analyse_bezig":
      return r.stale ? "mislukt" : "bezig";
    case "klaar_voor_controle":
      return r.beoordeeld ? "controleren" : "gegenereerd";
    case "aanpassing_nodig":
      return "controleren";
    case "goedgekeurd":
      return "goedgekeurd";
    case "gepubliceerd":
      return "gepubliceerd";
    case "mislukt":
      return "mislukt";
    default:
      return "nog_genereren";
  }
}

export const VIEW_STATUS_META: Record<ViewStatus, { label: string; tone: "neutral" | "info" | "violet" | "warn" | "good" | "lime" | "bad"; uitleg: string }> = {
  nog_genereren: { label: "Nog genereren", tone: "neutral", uitleg: "Er is voor deze maand nog geen rapport." },
  bezig: { label: "Bezig", tone: "info", uitleg: "De cijfers worden verzameld en de AI stelt de analyse op." },
  gegenereerd: { label: "Gegenereerd", tone: "violet", uitleg: "Beide PDF's staan klaar. Nog niemand heeft de controle gedaan." },
  controleren: { label: "Controleren", tone: "warn", uitleg: "In controle: beoordeling ingevuld of aanpassing gevraagd." },
  goedgekeurd: { label: "Goedgekeurd", tone: "good", uitleg: "Goedgekeurd. Nog publiceren naar het klantportaal." },
  gepubliceerd: { label: "Gepubliceerd", tone: "lime", uitleg: "De klantversie staat in het klantportaal." },
  mislukt: { label: "Mislukt", tone: "bad", uitleg: "Genereren is mislukt. Probeer het opnieuw." },
};

/**
 * Sorteergroep: 0 = actie nodig (controleren, goedkeuren, publiceren),
 * 1 = nog genereren of bezig, 2 = afgerond en gepubliceerd, 3 = mislukt.
 */
export function sortGroup(s: ViewStatus): number {
  if (s === "gegenereerd" || s === "controleren" || s === "goedgekeurd") return 0;
  if (s === "nog_genereren" || s === "bezig") return 1;
  if (s === "gepubliceerd") return 2;
  return 3;
}

/** Binnen de actiegroep eerst wat al het verst is (goedkeuren/publiceren), daarna op naam. */
const WITHIN: Record<ViewStatus, number> = {
  controleren: 0, gegenereerd: 1, goedgekeurd: 2, nog_genereren: 0, bezig: 1, gepubliceerd: 0, mislukt: 0,
};

export function compareRows<T extends { view: ViewStatus; clientName: string; period: string }>(a: T, b: T): number {
  return sortGroup(a.view) - sortGroup(b.view)
    || WITHIN[a.view] - WITHIN[b.view]
    || b.period.localeCompare(a.period)
    || a.clientName.localeCompare(b.clientName, "nl");
}

/** Tellers voor de statistiekenrij bovenaan. */
export function countStatuses(views: ViewStatus[]): {
  totaal: number; nogGenereren: number; bezig: number; teControleren: number; goedgekeurd: number; gepubliceerd: number; mislukt: number;
} {
  const n = (k: ViewStatus) => views.filter((v) => v === k).length;
  return {
    totaal: views.length,
    nogGenereren: n("nog_genereren"),
    bezig: n("bezig"),
    teControleren: n("gegenereerd") + n("controleren"),
    goedgekeurd: n("goedgekeurd"),
    gepubliceerd: n("gepubliceerd"),
    mislukt: n("mislukt"),
  };
}
