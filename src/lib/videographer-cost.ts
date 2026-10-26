/**
 * Videograafkosten: €16,75 per uur, met maximaal 8 uur filmen per opnamedag.
 * Een klant-maand zonder vastgelegde opnamedag rekenen we als één standaard
 * opnamedag (8 u × €16,75 = €134), zodat er nergens videograafkosten ontbreken.
 * Eén bron zodat editkosten én winstgevendheid dezelfde cijfers gebruiken.
 */
export const VG_RATE = 16.75;
export const VG_MAX_HOURS = 8;
export const VG_DAY = VG_RATE * VG_MAX_HOURS; // €134 — één standaard opnamedag.
