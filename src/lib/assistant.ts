/**
 * Gedeelde types en de vaste vragencatalogus voor de Shortclips AI Assistent.
 * Zowel de server (deterministische antwoorden uit de echte Hub-data) als de
 * UI (voorbeeldvragen per categorie) gebruiken dit als één bron van waarheid.
 */

export type AssistantTone = "bad" | "warn" | "good" | "info" | "neutral";

/** Eén concreet item in een antwoord, met een klikbare link naar het detail. */
export type AssistantItem = {
  title: string;
  subtitle?: string | null;
  meta?: string | null;
  tone?: AssistantTone;
  href?: string | null;
};

export type AssistantGroup = { heading?: string; items: AssistantItem[] };

export type AssistantAnswer = {
  /** Eén natuurlijke zin als samenvatting ("Er zijn 3 video's die aandacht nodig hebben."). */
  summary: string;
  groups: AssistantGroup[];
  /** Optionele notitie, bijv. als data ontbreekt of niet actueel is. */
  note?: string | null;
  /** Waar het antwoord op gebaseerd is (voor transparantie). */
  source?: string | null;
};

/** De vaste handlers die deterministisch (zonder AI) uit de Hub beantwoord worden. */
export type HandlerKey =
  | "vandaag"
  | "taken"
  | "scripts"
  | "opnames"
  | "videos"
  | "klanten"
  | "veranderd"
  | "resultaten";

export const HANDLER_KEYS: HandlerKey[] = ["vandaag", "taken", "scripts", "opnames", "videos", "klanten", "veranderd", "resultaten"];

export type ExampleQuestion = { text: string; handler: HandlerKey };
export type QuestionCategory = { key: string; label: string; questions: ExampleQuestion[] };

/** Zes categorieën; "Dagelijks" staat standaard open. Elke voorbeeldvraag is
 *  gekoppeld aan een handler die hem foutloos uit de echte data beantwoordt. */
export const QUESTION_CATEGORIES: QuestionCategory[] = [
  {
    key: "dagelijks",
    label: "Dagelijks",
    questions: [
      { text: "Wat moet ik vandaag doen en wat heeft prioriteit?", handler: "vandaag" },
      { text: "Welke taken wachten op mijn actie?", handler: "taken" },
      { text: "Wat is er sinds gisteren veranderd?", handler: "veranderd" },
    ],
  },
  {
    key: "scripting",
    label: "Scripting",
    questions: [
      { text: "Welke scripts moeten deze week nog af?", handler: "scripts" },
      { text: "Welke scripts wachten op goedkeuring?", handler: "scripts" },
    ],
  },
  {
    key: "opnames",
    label: "Opnames",
    questions: [
      { text: "Welke opnames hebben voorbereiding nodig?", handler: "opnames" },
    ],
  },
  {
    key: "editing",
    label: "Editing",
    questions: [
      { text: "Welke video's dreigen hun deadline te missen?", handler: "videos" },
      { text: "Welke video's vragen aandacht?", handler: "videos" },
    ],
  },
  {
    key: "klanten",
    label: "Klanten",
    questions: [
      { text: "Welke klanten wachten nog op een update?", handler: "klanten" },
    ],
  },
  {
    key: "resultaten",
    label: "Resultaten",
    questions: [
      { text: "Welke klanten presteerden de afgelopen 30 dagen het best?", handler: "resultaten" },
    ],
  },
];
