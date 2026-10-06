/**
 * Extra namen waaronder een klant in externe systemen kan voorkomen — een
 * Frame.io-projectnaam of een agenda-titel die niet exact gelijk is aan de
 * klantnaam. Door de founder aangeleverd. Vul hier aan als een project of
 * afspraak niet automatisch aan de juiste klant koppelt.
 *
 * Sleutel = klant-slug (zoals in de database), waarden = alternatieve namen.
 */
export const CLIENT_ALIASES: Record<string, string[]> = {
  "shades-by-erik-kuster": ["buildings group", "buildingsgroup", "buildings"],
  "marco-van-beek-premium-cars": ["marco van beek"],
  "benz-collector-sneek": ["benz collector", "benzcollector"],
  "donker-groep": ["donkergroen", "donker groen"],
};

/** Alle aliassen voor één klant-slug (leeg als er geen zijn). */
export function aliasesForSlug(slug: string): string[] {
  return CLIENT_ALIASES[slug] ?? [];
}
