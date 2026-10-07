/**
 * Extra namen waaronder een klant in externe systemen kan voorkomen — een
 * Frame.io-projectnaam of een agenda-titel die niet exact gelijk is aan de
 * klantnaam. Door de founder aangeleverd. Vul hier aan als een project of
 * afspraak niet automatisch aan de juiste klant koppelt.
 *
 * Sleutel = klant-slug (zoals in de database), waarden = alternatieve namen.
 */
export const CLIENT_ALIASES: Record<string, string[]> = {
  // Frame.io-projectnaam / agenda-titel die afwijkt van de klantnaam.
  "shades-by-erik-kuster": ["shades by eric kuster", "buildings group", "buildingsgroup"],
  "marco-van-beek-premium-cars": ["marco van beek"],
  "benz-collector-sneek": ["benz collector museum", "benz collector", "benzcollector"],
  "donker-groep": ["donkergroen", "donker groen"],
  "kavel-10": ["kavel 10 | hetbestebeeld.nl", "hetbestebeeld"],
  // Metricool-merknamen die afwijken van de klantnaam.
  "bedrijfskleding-online": ["bedrijfskledingonline.nl", "bedrijfskledingonline"],
  nahv: ["nahv belastingadviseurs"],
};

/** Alle aliassen voor één klant-slug (leeg als er geen zijn). */
export function aliasesForSlug(slug: string): string[] {
  return CLIENT_ALIASES[slug] ?? [];
}
