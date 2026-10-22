import "server-only";

/**
 * Vaste verjaardagen van het kernteam, door Jarno aangeleverd. Net als
 * {@link ./core-staff} bewust een vaste lijst (geen DB-veld): het kernteam is
 * klein en stabiel. Wil je later ook editors/freelancers hun verjaardag laten
 * zien, dan kan dit naar een kolom op team_members verhuizen.
 */
const TEAM_BIRTHDAYS: { email: string; firstName: string; month: number; day: number }[] = [
  { email: "jarno@shortclips.nl", firstName: "Jarno", month: 4, day: 3 },
  { email: "milou@shortclips.nl", firstName: "Milou", month: 10, day: 26 },
  { email: "jiska@shortclips.nl", firstName: "Jiska", month: 5, day: 20 },
  { email: "rutger@shortclips.nl", firstName: "Rutger", month: 7, day: 1 },
];

const MONTHS = [
  "januari", "februari", "maart", "april", "mei", "juni",
  "juli", "augustus", "september", "oktober", "november", "december",
];

/** Leesbare verjaardagsdatum voor een e-mail, of null als onbekend. */
export function birthdayLabel(email: string | null | undefined): string | null {
  if (!email) return null;
  const b = TEAM_BIRTHDAYS.find((x) => x.email === email.toLowerCase());
  return b ? `${b.day} ${MONTHS[b.month - 1]}` : null;
}

/** Wie is er vandaag jarig? Datum in Europe/Amsterdam, zodat het om middernacht
 *  hier omslaat en niet op UTC. */
export function birthdaysToday(): { firstName: string }[] {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);
  return TEAM_BIRTHDAYS.filter((b) => b.month === month && b.day === day).map((b) => ({ firstName: b.firstName }));
}
