/**
 * Actief of niet actief, zoals editors het zien. De bron is altijd de status in
 * het centrale klantenbeheer (clients.status), live gelezen: zet Team Shortclips
 * een klant op gepauzeerd of gestopt, dan is hij in elk editorportaal direct
 * "niet actief". Er wordt niets gekopieerd, dus er kan niets uit sync raken.
 */
const ACTIVE = new Set(["active", "onboarding"]);

export function isActiveClientStatus(status: string | null | undefined): boolean {
  return !!status && ACTIVE.has(status);
}

export type ClientActivity = "actief" | "niet_actief";

export function clientActivity(status: string | null | undefined): ClientActivity {
  return isActiveClientStatus(status) ? "actief" : "niet_actief";
}
