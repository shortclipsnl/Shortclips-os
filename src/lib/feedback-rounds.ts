/**
 * Feedbackrondes per opname (editingproject). Het kernteam houdt handmatig bij
 * hoeveel feedbackrondes een opname heeft gehad. De eerste ronde valt binnen de
 * standaard dienstverlening; vanaf ronde 2 gelden extra kosten volgens de
 * geldende Shortclips prijslijst (bewust geen vast bedrag in het portaal).
 */
export const FEEDBACK_ROUNDS_MAX = 6;
export const FEEDBACK_ROUNDS_EXTRA_FROM = 2;
export const FEEDBACK_ROUND_OPTIONS = [0, 1, 2, 3, 4, 5, 6] as const;

export function isExtraFeedbackRound(n: number | null | undefined): boolean {
  return (n ?? 0) >= FEEDBACK_ROUNDS_EXTRA_FROM;
}

const RANGTELWOORD: Record<number, string> = {
  2: "tweede",
  3: "derde",
  4: "vierde",
  5: "vijfde",
  6: "zesde",
};

/** Waarschuwingstekst bij ronde 2 of hoger. */
export function extraFeedbackRoundText(n: number): string {
  const rang = RANGTELWOORD[n] ?? `${n}e`;
  return `Deze opname heeft de ${rang} feedbackronde bereikt. Vanaf de tweede ronde worden extra kosten in rekening gebracht volgens de geldende Shortclips prijslijst.`;
}
