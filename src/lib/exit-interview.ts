/**
 * Exitgesprek: vaste vragen, opzegredenen en keuzes. Gedeeld door het
 * formulier (client) en de server action, zodat de lijsten op één plek staan.
 * De vragen zijn gelijk aan de gesprekskaart (PDF) die het team gebruikt.
 */

export const EXIT_QUESTIONS = [
  { key: "q1", q: "Wat is voor jullie de belangrijkste reden om de samenwerking te stoppen?", hint: "Ligt dat vooral bij onze aanpak, of speelt er bij jullie intern iets?" },
  { key: "q2", q: "Wat is er bij jullie veranderd sinds we begonnen?", hint: "Budget, marketingkoers, nieuwe collega's of contactpersoon, andere prioriteiten." },
  { key: "q3", q: "Hoe tevreden zijn jullie over de resultaten die we samen hebben behaald?", hint: "Welke resultaten hadden jullie bij de start voor ogen?", score: "scoreResults" },
  { key: "q4", q: "Hoe hebben jullie de samenwerking met ons team ervaren?", hint: "Communicatie, proactiviteit, kwaliteit van scripts en video's.", score: "scoreCollaboration" },
  { key: "q5", q: "In hoeverre woog de investering op tegen wat het jullie opleverde?", hint: "Was het budget zelf het probleem, of de waarde die jullie ervoeren?", score: "scoreValue" },
  { key: "q6", q: "Wat had er moeten gebeuren, bij ons of bij jullie, om door te gaan?", hint: "Was er een moment waarop het nog te redden was?" },
  { key: "q7", q: "Staan jullie open voor een nieuwe samenwerking in de toekomst? Waarom wel of niet?", hint: "Onder welke voorwaarden zou dat weer interessant zijn?" },
] as const;

export type ExitQuestionKey = (typeof EXIT_QUESTIONS)[number]["key"];
export type ExitScoreKey = "scoreResults" | "scoreCollaboration" | "scoreValue";

export const EXIT_REASON_GROUPS = [
  {
    label: "Bij Shortclips",
    reasons: [
      { key: "resultaten", label: "Onvoldoende resultaten" },
      { key: "meerwaarde", label: "Onvoldoende ervaren meerwaarde" },
      { key: "communicatie", label: "Communicatie of begeleiding" },
      { key: "kwaliteit", label: "Kwaliteit van scripts of video's" },
      { key: "planning", label: "Planning of oplevering" },
    ],
  },
  {
    label: "Bij de klant",
    reasons: [
      { key: "prijs", label: "Prijs of budget" },
      { key: "prioriteiten", label: "Andere marketingprioriteiten" },
      { key: "interne_verandering", label: "Interne verandering (koers, organisatie, contactpersoon)" },
      { key: "interne_creator", label: "Zelf content gaan produceren (interne creator)" },
      { key: "overstap", label: "Overstap naar andere partij" },
    ],
  },
  { label: "Overig", reasons: [{ key: "anders", label: "Anders" }] },
] as const;

export const EXIT_REASONS = EXIT_REASON_GROUPS.flatMap((g) => g.reasons.map((r) => r.key)) as [string, ...string[]];
export const EXIT_REASON_LABEL: Record<string, string> = Object.fromEntries(
  EXIT_REASON_GROUPS.flatMap((g) => g.reasons.map((r) => [r.key, r.label])),
);

export const EXIT_CAUSE = { shortclips: "Bij Shortclips", klant: "Bij de klant", beide: "Allebei" } as const;
export const EXIT_TRI = { ja: "Ja", misschien: "Misschien", nee: "Nee" } as const;
export type ExitCause = keyof typeof EXIT_CAUSE;
export type ExitTri = keyof typeof EXIT_TRI;

export type ExitAction = { action: string; ownerId: string | null; dueOn: string | null };

export type ExitInterviewData = {
  interviewDate: string | null;
  conductedById: string | null;
  endDate: string | null;
  answers: Partial<Record<ExitQuestionKey, string>>;
  scoreResults: number | null;
  scoreCollaboration: number | null;
  scoreValue: number | null;
  primaryReason: string | null;
  secondaryReason: string | null;
  otherReason: string | null;
  quote: string | null;
  interpretation: string | null;
  cause: ExitCause | null;
  preventable: ExitTri | null;
  lesson: string | null;
  actions: ExitAction[];
  futurePossible: ExitTri | null;
  followUpOn: string | null;
};

export const EMPTY_EXIT_INTERVIEW: ExitInterviewData = {
  interviewDate: null, conductedById: null, endDate: null, answers: {},
  scoreResults: null, scoreCollaboration: null, scoreValue: null,
  primaryReason: null, secondaryReason: null, otherReason: null,
  quote: null, interpretation: null, cause: null, preventable: null,
  lesson: null, actions: [], futurePossible: null, followUpOn: null,
};

/** Klantstatussen waarbij het exitgesprek op de klantpagina verschijnt. */
export const EXIT_STATUSES = ["paused", "churned"] as const;
