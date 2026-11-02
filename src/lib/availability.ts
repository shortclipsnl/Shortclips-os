/**
 * Gedeelde, pure helpers voor beschikbaarheid. Geen server- of DB-afhankelijkheden,
 * zodat zowel de server-actie als de client-component (de beschikbaarheidskaart)
 * dezelfde periode-omschrijving gebruiken.
 */

export type AvailabilityPeriod = {
  id: string;
  from: string | null; // ISO-datum "2026-11-10" (begin), of null bij "terugkerend"
  to: string | null; // ISO-datum (einde); null = losse dag of open einde
  label: string | null; // vrije periode-omschrijving voor terugkerend
  note: string; // wat er geldt in deze periode
};

/** "2026-11-10" → "10 nov" (jaar alleen als het afwijkt van het huidige jaar). */
export function formatDay(iso: string): string {
  try {
    const d = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString("nl-NL", sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

/** Leesbare periode-omschrijving ("10 nov", "10 nov t/m 14 nov", "woensdagmiddagen"). */
export function describePeriod(p: Pick<AvailabilityPeriod, "from" | "to" | "label">): string {
  if (p.from && p.to && p.from !== p.to) return `${formatDay(p.from)} t/m ${formatDay(p.to)}`;
  if (p.from) return formatDay(p.from);
  if (p.label && p.label.trim()) return p.label.trim();
  return "Doorlopend";
}
