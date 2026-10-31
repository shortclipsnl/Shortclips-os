/**
 * Gedeeld inhoudsmodel voor offertes (client- én serverveilig — geen imports uit
 * de database of node). Zowel de interne weergave, de publieke offertepagina als
 * de PDF renderen uit ditzelfde model, zodat alles identiek is.
 */

export type QuoteBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "image"; url: string; alt?: string }
  | { type: "lineItems"; title?: string } // rendert de offerteregels (prijzen)
  | { type: "terms"; title?: string; text: string };

export type QuoteContent = {
  /** Begeleidende introtekst bovenaan de offerte. */
  intro?: string;
  /** Opbouw van de offerte: koppen, tekst, afbeeldingen, prijstabel, voorwaarden. */
  blocks: QuoteBlock[];
  /** Accentkleur (merkkleur) — valt terug op de huisstijl als leeg. */
  accent?: string;
};

export type QuoteLineInput = {
  description: string;
  quantity: number;
  unitPrice: number;
};

/** Variabelen die in sjabloonteksten vervangen worden ({{bedrijf}} enz.). */
export type QuoteVars = {
  bedrijf?: string;
  contactpersoon?: string;
  datum?: string;
  offertenaam?: string;
};

export function lineTotal(l: Pick<QuoteLineInput, "quantity" | "unitPrice">): number {
  return Math.round(l.quantity * l.unitPrice * 100) / 100;
}

export function sumLines(lines: QuoteLineInput[]): number {
  return Math.round(lines.reduce((s, l) => s + lineTotal(l), 0) * 100) / 100;
}

export function euro(v: number): string {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(v);
}

/** Vervangt {{sleutel}} in alle tekstvelden door de opgegeven variabelen. */
export function substituteContent(content: QuoteContent, vars: QuoteVars): QuoteContent {
  const sub = (s: string | undefined): string | undefined =>
    s == null ? s : s.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => (vars as Record<string, string>)[k] ?? `{{${k}}}`);
  return {
    accent: content.accent,
    intro: sub(content.intro),
    blocks: (content.blocks ?? []).map((b) => {
      switch (b.type) {
        case "heading":
          return { ...b, text: sub(b.text) ?? "" };
        case "paragraph":
          return { ...b, text: sub(b.text) ?? "" };
        case "terms":
          return { ...b, title: sub(b.title), text: sub(b.text) ?? "" };
        default:
          return b;
      }
    }),
  };
}

/** Standaard-startinhoud voor een nieuw, leeg sjabloon. */
export const DEFAULT_TEMPLATE_CONTENT: QuoteContent = {
  intro:
    "Beste {{contactpersoon}},\n\nWat leuk dat {{bedrijf}} met Shortclips aan de slag wil. Hieronder vind je ons voorstel voor de samenwerking.",
  blocks: [
    { type: "heading", text: "Wat we voor je doen" },
    {
      type: "paragraph",
      text:
        "We verzorgen maandelijks professionele short-video's: van opname en montage tot de kant-en-klare content die je direct kunt plaatsen.",
    },
    { type: "lineItems", title: "Investering" },
    {
      type: "terms",
      title: "Voorwaarden",
      text:
        "Deze offerte is 30 dagen geldig. Prijzen zijn exclusief btw. De samenwerking loopt per maand, met een opzegtermijn van één kalendermaand.",
    },
  ],
};
