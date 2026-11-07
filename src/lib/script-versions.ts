/**
 * Herkennen of een PDF in Drive een nieuwere versie is van het gekoppelde
 * script. Puur (geen database), zodat de regels los te testen zijn.
 *
 * Uitgangspunt: alleen automatisch overstappen als het zeker hetzelfde script
 * is. Twee namen zijn "hetzelfde script" als ze, na het weglaten van
 * versie-aanduidingen (V2, (1), kopie, final, sessie 7, 2.0, datums ...),
 * dezelfde woorden bevatten. Een variant zoals "RUTGER", "videograaf",
 * "advertentie" of "voice over" is een ander document en wordt nooit
 * automatisch gekozen; die tonen we alleen als hint.
 */

/** Woorden die alleen een versie/sessie aanduiden en niets over de inhoud zeggen. */
const NEUTRAL = new Set([
  "v", "versie", "version", "nieuw", "nieuwe", "new", "final", "finale", "finaal", "definitief", "def",
  "concept", "kopie", "copy", "aangepast", "update", "updated", "herzien", "bijgewerkt", "sessie", "pdf",
  "jan", "januari", "feb", "februari", "mrt", "maart", "apr", "april", "mei", "jun", "juni", "jul", "juli",
  "aug", "augustus", "sep", "sept", "september", "okt", "oktober", "nov", "november", "dec", "december",
]);

/** Kernwoorden van een scriptnaam (zonder extensie, versie-aanduidingen en getallen). */
export function scriptNameTokens(name: string): string[] {
  const base = name
    .toLowerCase()
    .replace(/^\._/, "")
    .replace(/(\.pptx|\.docx)?\.pdf$/i, "")
    .replace(/\bv\s?\d+(\.\d+)?\b/g, " ") // V2, v 3, v1.1
    .replace(/\(\d+\)/g, " "); // (1)
  return base
    .split(/[^a-z0-9à-ÿ]+/i)
    .filter(Boolean)
    .filter((t) => !/^\d+$/.test(t)) // losse getallen (2.0, 365, datums)
    .filter((t) => !NEUTRAL.has(t));
}

/** Zelfde script, alleen een andere versie? */
export function isSameScript(a: string, b: string): boolean {
  const ta = new Set(scriptNameTokens(a));
  const tb = new Set(scriptNameTokens(b));
  if (ta.size === 0 || tb.size === 0) return false;
  if (ta.size !== tb.size) return false;
  for (const t of ta) if (!tb.has(t)) return false;
  return true;
}

export type VersionFile = { externalId: string; name: string; modifiedAt: string | null; deleted?: boolean };

export type VersionCheck = {
  /** Nieuwere versie van hetzelfde script: hier stappen we automatisch naar over. */
  upgradeTo: VersionFile | null;
  /** Andere nieuwere PDF's in dezelfde map: alleen tonen als hint. */
  otherNewer: VersionFile[];
};

/**
 * Bepaalt of er in dezelfde map een nieuwere versie van het gekoppelde script
 * staat. "Nieuwer" = gewijzigd na de gekoppelde PDF én na het moment van
 * koppelen, zodat een bewuste keuze voor een oudere versie blijft staan.
 */
export function checkForNewerVersion(input: {
  linked: VersionFile;
  linkedAt: string | null;
  siblings: VersionFile[];
}): VersionCheck {
  const floor = [input.linked.deleted ? null : input.linked.modifiedAt, input.linkedAt]
    .filter((x): x is string => Boolean(x))
    .sort()
    .at(-1) ?? null;
  const newer = input.siblings
    .filter((f) => f.externalId !== input.linked.externalId && !f.deleted && f.modifiedAt)
    .filter((f) => !floor || f.modifiedAt! > floor)
    .sort((a, b) => b.modifiedAt!.localeCompare(a.modifiedAt!));
  const same = newer.filter((f) => isSameScript(f.name, input.linked.name));
  const upgradeTo = same[0] ?? null;
  return { upgradeTo, otherNewer: newer.filter((f) => f !== upgradeTo && !same.includes(f)) };
}

/**
 * Welke bron is het nieuwst: de laatste scriptcontrole-PDF uit het klantportaal
 * of de gekoppelde Drive-PDF? De nieuwste wint, zodat captions altijd op de
 * laatste versie gebaseerd zijn.
 */
export function newestSource(review: { createdAt: string } | null, driveVersionAt: string | null): "review" | "drive" | null {
  if (!review && !driveVersionAt) return null;
  if (!review) return "drive";
  if (!driveVersionAt) return "review";
  return driveVersionAt > review.createdAt ? "drive" : "review";
}
