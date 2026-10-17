import "server-only";

/**
 * Voorspellende risicosignalering (Deel 3.2) met transparante regels: niet
 * alleen wat al te laat is, maar wat waarschijnlijk vertraging oploopt. Elke
 * uitkomst benoemt de oorzakende factoren. Pure functie → testbaar; kan later
 * uitgebreid worden met een voorspellend model zodra er genoeg historie is.
 */

export type RiskLevel = "groen" | "oranje" | "rood";

/** Statussen waarin de video nog bij de editor/in bewerking is (vóór klant). */
const EARLY_EDIT = ["recorded", "footage_upload", "awaiting_editor", "editing", "editor_revision", "internal_review"];
const AT_CLIENT = ["client_review", "client_revision"];

export function projectRisk(input: {
  isLate: boolean;
  daysToDeadline: number | null;
  status: string;
  editorOverloaded?: boolean;
  daysAtClient?: number | null;
}): { level: RiskLevel; factors: string[] } {
  const factors: string[] = [];

  if (input.isLate) {
    factors.push("Deadline verstreken");
    return { level: "rood", factors };
  }

  const d = input.daysToDeadline;
  // Deadline nabij terwijl het werk nog vroeg in de edit zit → oranje.
  if (d != null && d <= 3 && EARLY_EDIT.includes(input.status)) {
    factors.push(`Deadline over ${d} werkdag(en), nog in bewerking`);
  }
  // Wacht op de klant terwijl de deadline nadert.
  if (d != null && d <= 2 && AT_CLIENT.includes(input.status)) {
    factors.push(`Deadline over ${d} werkdag(en), wacht op klant`);
  }
  // Klant reageert al lang niet.
  if (input.daysAtClient != null && input.daysAtClient > 4 && AT_CLIENT.includes(input.status)) {
    factors.push(`${input.daysAtClient} werkdagen geen klantfeedback`);
  }
  // Editor zit boven capaciteit.
  if (input.editorOverloaded) {
    factors.push("Editor is overbelast");
  }

  if (factors.length === 0) return { level: "groen", factors };
  return { level: "oranje", factors };
}
