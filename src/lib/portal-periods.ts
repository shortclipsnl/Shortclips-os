/**
 * Periodekeuze voor de resultatenpagina (klantportaal én interne voorbeeldweergave).
 * Eén bron zodat beide portalen exact dezelfde perioden en vergelijking gebruiken.
 */

export const PORTAL_PERIODS = [
  { key: "30", days: 30, label: "30 dagen" },
  { key: "90", days: 90, label: "3 maanden" },
  { key: "180", days: 180, label: "6 maanden" },
  { key: "365", days: 365, label: "12 maanden" },
] as const;

export type PortalPeriod = { days: number; from?: string; to?: string; key: string };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Leest ?periode= (+ ?van=&tot= voor een eigen periode) uit de query. */
export function parsePortalPeriod(sp: { periode?: string; van?: string; tot?: string }): PortalPeriod {
  const { periode, van, tot } = sp;
  if (periode === "custom" && van && tot && ISO.test(van) && ISO.test(tot) && van <= tot) {
    const days = Math.round((Date.parse(`${tot}T12:00:00Z`) - Date.parse(`${van}T12:00:00Z`)) / 86_400_000) + 1;
    return { days: Math.max(1, days), from: van, to: tot, key: "custom" };
  }
  const match = PORTAL_PERIODS.find((p) => p.key === periode);
  return { days: match?.days ?? 30, key: match?.key ?? "30" };
}

/** Bouwt de query-string voor een periode (voor links). */
export function portalPeriodQuery(p: { key: string; from?: string; to?: string }): string {
  if (p.key === "custom" && p.from && p.to) return `periode=custom&van=${p.from}&tot=${p.to}`;
  return `periode=${p.key}`;
}
