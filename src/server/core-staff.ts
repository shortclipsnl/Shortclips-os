import "server-only";

/**
 * Het kernteam: de vaste medewerkers van ShortClips, expliciet vastgesteld.
 * Dit is bewust een vaste lijst (geen afgeleide van rollen of Monday-import),
 * zodat vakantiesaldo en de "Vaste medewerkers"-kaarten precies deze vier
 * personen tonen — en niet elke als "intern" geïmporteerde freelancer.
 *
 * Volgorde is de weergavevolgorde (Janno eerst).
 */
export const CORE_STAFF_EMAILS = [
  "jarno@shortclips.nl",
  "milou@shortclips.nl",
  "jiska@shortclips.nl",
  "rutger@shortclips.nl",
] as const;

export function isCoreStaff(email: string | null | undefined): boolean {
  return !!email && (CORE_STAFF_EMAILS as readonly string[]).includes(email.toLowerCase());
}

/** Kernteam herkennen op voornaam (voor bronnen zonder e-mail, zoals de
 *  capaciteitstabel). Afgeleid van hetzelfde vaste lijstje. */
export function isCoreStaffByName(fullName: string | null | undefined): boolean {
  if (!fullName) return false;
  const first = fullName.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return CORE_STAFF_EMAILS.some((e) => e.split("@")[0] === first);
}

/** Sorteersleutel volgens de vaste volgorde; onbekende e-mails komen achteraan. */
export function coreStaffRank(email: string | null | undefined): number {
  if (!email) return CORE_STAFF_EMAILS.length;
  const i = (CORE_STAFF_EMAILS as readonly string[]).indexOf(email.toLowerCase());
  return i === -1 ? CORE_STAFF_EMAILS.length : i;
}
