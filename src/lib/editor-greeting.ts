/**
 * Pure helper voor de persoonlijke editor-begroeting. Geen database: alle cijfers
 * komen uit de dashboardlaag. Dagelijks wisselende, motiverende teksten (geseed op
 * de dag, zodat ze stabiel zijn binnen een dag en verrassen over dagen). Nooit een
 * negatieve melding bij een rustige dag — freelancers werken niet elke dag.
 */

export type EditorGreetingInput = {
  firstName: string;
  /** Uur van de dag (0-23) in Amsterdam. */
  hour: number;
  /** Dag-seed voor dagelijkse variatie (bijv. dag-van-het-jaar). */
  daySeed: number;
  videosForYou: number;
  approvedThisWeek: number;
  onTimeRate: number | null;
  withDeadline: number;
};

export type EditorGreeting = {
  greeting: string; // "Goedemorgen"
  headline: string; // "Jouw Shortclips dag"
  message: string;
  compliment: string | null;
};

const CLOSERS = [
  "Lekker bezig! 🔥",
  "Je crusht het! 💪",
  "Topwerk! ✨",
  "Keep going! 🚀",
  "Strak bezig! 🎬",
  "Helemaal top! 🙌",
  "Vette vibes vandaag! ⚡",
];

const REST_DAY = [
  "Even een rustige dag? Geniet ervan — je werk staat strak. ✌️",
  "Niets op je bord nu. Perfecte dag om even bij te tanken. 🌿",
  "Geen openstaand werk — lekker vrij of even chillen. 😎",
  "Rustig moment. Zodra er een video klaarstaat, vind je 'm hier. 🎬",
];

const pick = <T,>(arr: T[], seed: number): T => arr[((seed % arr.length) + arr.length) % arr.length]!;

export function buildEditorGreeting(input: EditorGreetingInput): EditorGreeting {
  const greeting = input.hour < 6 ? "Goedenacht" : input.hour < 12 ? "Goedemorgen" : input.hour < 18 ? "Goedemiddag" : "Goedenavond";

  const parts: string[] = [];
  if (input.videosForYou > 0) {
    parts.push(input.videosForYou === 1 ? "Vandaag staat er 1 video voor je klaar." : `Vandaag staan er ${input.videosForYou} video's voor je klaar.`);
  }
  if (input.approvedThisWeek > 0) {
    parts.push(input.approvedThisWeek === 1 ? "Deze week is er al 1 video van je goedgekeurd." : `Deze week zijn er al ${input.approvedThisWeek} video's van je goedgekeurd.`);
  }
  const message = parts.length === 0 ? pick(REST_DAY, input.daySeed) : `${parts.join(" ")} ${pick(CLOSERS, input.daySeed)}`;

  // Compliment bij een behaalde prestatie (eerste passende wint).
  let compliment: string | null = null;
  if (input.approvedThisWeek >= 5) compliment = "Vijf+ video's goedgekeurd deze week — absolute topper! 🏆";
  else if (input.approvedThisWeek >= 3) compliment = "Al meerdere video's goedgekeurd deze week — lekker bezig! 🔥";
  else if (input.onTimeRate === 100 && input.withDeadline >= 3) compliment = "Je haalt al je deadlines — strak geregeld! ⏱️";

  return { greeting, headline: "Jouw Shortclips dag", message, compliment };
}
