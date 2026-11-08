/**
 * Afteller "Jouw contentplanning": pure logica (geen database), zodat klant-
 * portaal, intern overzicht en herinneringen exact dezelfde dagen en statussen
 * gebruiken.
 *
 * Ritme: dag 0 = planning beschikbaar, deadline = dag 21.
 *  21 t/m 11 dagen  groen   Voldoende tijd
 *  10 t/m 4 dagen   oranje  Deadline komt dichterbij
 *  3 t/m 1 dagen    rood    Actie vereist
 *  0 of minder      rood    Deadline bereikt
 */

export const DEADLINE_DAYS = 21;

export type DeadlinePhase = "ruim" | "dichterbij" | "actie" | "bereikt" | "afgerond";
export type DeadlineTone = "green" | "orange" | "red" | "grey";

export const PHASE: Record<DeadlinePhase, { tone: DeadlineTone; client: string; team: string }> = {
  ruim: { tone: "green", client: "Voldoende tijd", team: "Op schema" },
  dichterbij: { tone: "orange", client: "Deadline komt dichterbij", team: "Bijna verlopen" },
  actie: { tone: "red", client: "Actie vereist", team: "Actie vereist" },
  bereikt: { tone: "red", client: "Deadline bereikt", team: "Verlopen" },
  afgerond: { tone: "green", client: "Afgerond", team: "Afgerond" },
};

const DAY = 86_400_000;
const utc = (iso: string) => Date.parse(`${iso}T12:00:00Z`);

export function addDaysIso(iso: string, n: number): string {
  return new Date(utc(iso) + n * DAY).toISOString().slice(0, 10);
}

/** Hele dagen van `from` naar `to` (beide YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / DAY);
}

export function todayAmsterdam(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
}

export type DeadlineInput = { startedOn: string; deadlineOn: string; status: string };

export type DeadlineView = {
  startedOn: string;
  deadlineOn: string;
  /** Resterende dagen; 0 = vandaag is de deadline, negatief = verstreken. */
  daysLeft: number;
  /** Totale looptijd in dagen (normaal 21, anders na handmatige aanpassing). */
  totalDays: number;
  /** 0..1, deel van de looptijd dat verstreken is. */
  progress: number;
  phase: DeadlinePhase;
  tone: DeadlineTone;
  clientLabel: string;
  teamLabel: string;
  /** Korte tekst voor de kolom "Resterende tijd". */
  remainingLabel: string;
  done: boolean;
};

export function phaseFor(daysLeft: number, done: boolean): DeadlinePhase {
  if (done) return "afgerond";
  if (daysLeft <= 0) return "bereikt";
  if (daysLeft <= 3) return "actie";
  if (daysLeft <= 10) return "dichterbij";
  return "ruim";
}

export function deadlineView(d: DeadlineInput, today: string): DeadlineView {
  const done = d.status === "completed";
  const daysLeft = daysBetween(today, d.deadlineOn);
  const totalDays = Math.max(1, daysBetween(d.startedOn, d.deadlineOn));
  const elapsed = daysBetween(d.startedOn, today);
  const progress = done ? 1 : Math.min(1, Math.max(0, elapsed / totalDays));
  const phase = phaseFor(daysLeft, done);
  const remainingLabel = done
    ? "Afgerond"
    : daysLeft < 0
      ? "Verlopen"
      : daysLeft === 0
        ? "Vandaag"
        : `${daysLeft} ${daysLeft === 1 ? "dag" : "dagen"}`;
  return {
    startedOn: d.startedOn,
    deadlineOn: d.deadlineOn,
    daysLeft,
    totalDays,
    progress,
    phase,
    tone: PHASE[phase].tone,
    clientLabel: PHASE[phase].client,
    teamLabel: PHASE[phase].team,
    remainingLabel,
    done,
  };
}

/**
 * Herinneringsmomenten (dag na start): start, nog 7 dagen, nog 3 dagen,
 * deadline bereikt. Er gaat altijd alleen het laatst bereikte moment uit, zodat
 * een gemiste run nooit twee meldingen tegelijk oplevert.
 */
export type ReminderStep = "start" | "d14" | "d18" | "d21";

export function dueReminder(d: DeadlineInput, today: string): ReminderStep | null {
  if (d.status !== "active") return null;
  const left = daysBetween(today, d.deadlineOn);
  if (left <= 0) return left >= -2 ? "d21" : null; // na een paar dagen niet meer nasturen
  if (left <= 3) return "d18";
  if (left <= 7) return "d14";
  return "start";
}

export function reminderText(step: ReminderStep, deadlineLabel: string): { title: string; body: string } {
  switch (step) {
    case "start":
      return {
        title: "Je contentplanning staat klaar",
        body: `Je contentplanning staat klaar in het portaal. Je hebt ${DEADLINE_DAYS} dagen, tot ${deadlineLabel}, om de benodigde acties af te ronden. Zo kunnen we volgens planning publiceren.`,
      };
    case "d14":
      return {
        title: "Nog 7 dagen voor je contentplanning",
        body: `Je hebt nog 7 dagen, tot ${deadlineLabel}, om de openstaande acties voor je contentplanning af te ronden. In het portaal zie je precies wat er nog openstaat.`,
      };
    case "d18":
      return {
        title: "Nog 3 dagen voor je contentplanning",
        body: `De deadline van je contentplanning is ${deadlineLabel}. Rond de openstaande acties af, dan kunnen we je content op tijd publiceren.`,
      };
    case "d21":
      return {
        title: "De deadline van je contentplanning is bereikt",
        body: `De deadline van ${deadlineLabel} is bereikt en er staan nog acties open. Rond ze zo snel mogelijk af in het portaal, zodat we zonder vertraging kunnen publiceren.`,
      };
  }
}

export function longDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export function shortDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("nl-NL", { day: "numeric", month: "short", timeZone: "UTC" }).replace(".", "");
}

/** Klantteksten (bewust als verzoek, niet als contractvoorwaarde). */
export const WHY_TITLE = "Waarom is deze deadline belangrijk?";
export const WHY_TEXT =
  "Om jouw content volgens planning te kunnen publiceren, hebben we de benodigde informatie en goedkeuringen op tijd nodig. Zo voorkomen we vertraging en kunnen we jouw content consistent blijven plaatsen.";
export const AGREEMENT_TITLE = "Belangrijk voor jouw contentplanning";
export const AGREEMENT_TEXT =
  "Jouw samenwerking met Shortclips loopt door volgens de afgesproken planning en betalingsafspraken. Daarom vragen we je om de benodigde acties binnen 3 weken af te ronden. Zo kunnen we op tijd doorgaan met het publiceren van jouw content en halen we het maximale uit de samenwerking.";
