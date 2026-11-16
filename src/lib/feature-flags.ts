/**
 * Zichtbaarheid van nieuwe klantgerichte onderdelen.
 *
 * Contentgeheugen in het klantportaal: live sinds 12 nov 2026 (op verzoek van Jarno).
 * beoordeeld (intern te bekijken via Contentgeheugen > "Zo ziet de klant het").
 * Op true zetten = menu-item verschijnt voor alle klanten.
 */
export const PORTAL_CONTENTGEHEUGEN_LIVE = true;

/**
 * Directieversie van het maandoverzicht in het klantportaal (Resultaten).
 * Aan = de klant ziet bij een afgeronde maand waarvan de maandrapportage is
 * goedgekeurd en gepubliceerd het blok "Voor je directie". Zonder gepubliceerde
 * maandrapportage verschijnt er niets; de bestaande maandcontrole is dus ook de
 * goedkeuring van de directieversie. Intern is ze altijd te beoordelen.
 */
export const PORTAL_DIRECTIEVERSIE_LIVE = true;
