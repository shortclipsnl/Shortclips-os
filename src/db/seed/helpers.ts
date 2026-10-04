/** Datumhulpjes zodat de seed altijd "vandaag" als ijkpunt gebruikt. */
export const NOW = new Date();

export function daysFromNow(days: number, hour = 10): Date {
  const d = new Date(NOW);
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d;
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function dateOffset(days: number): string {
  return isoDate(daysFromNow(days));
}

export function period(offsetMonths = 0): string {
  const d = new Date(NOW);
  d.setDate(1);
  d.setMonth(d.getMonth() + offsetMonths);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Voorspelbare pseudo-random getallen: elke seed-run geeft dezelfde cijfers. */
export function makeRandom(seed = 42) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

export function pick<T>(rnd: () => number, items: readonly T[]): T {
  return items[Math.floor(rnd() * items.length)]!;
}

export function between(rnd: () => number, min: number, max: number): number {
  return Math.floor(min + rnd() * (max - min + 1));
}
