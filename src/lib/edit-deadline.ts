import { addWorkingDays, subWorkingDays } from "./workdays";

/**
 * Twee deadlines rond een video:
 *
 *  - KLANTDEADLINE  = opname + 14 werkdagen. Dit is wat de klant krijgt en staat
 *    opgeslagen als `deliverables.dueOn`.
 *  - INTERNE DEADLINE = opname + 7 werkdagen. De datum waarop de editor de eerste
 *    versie klaar moet hebben. Die zien editors overal, zodat de klantdeadline
 *    geen vals gevoel van "nog veel tijd" geeft.
 */
export const EDITOR_LEAD_DAYS = 7; // interne eerste versie
export const CLIENT_LEAD_DAYS = 14; // klantoplevering

/** Statussen waarin de eerste versie nog niet is opgeleverd — hiervoor geldt de
 *  interne deadline (opname + 7 werkdagen). */
const FIRST_VERSION_PENDING = new Set(["recorded", "footage_upload", "awaiting_editor", "editing", "editor_revision"]);

export function isFirstVersionPending(status: string): boolean {
  return FIRST_VERSION_PENDING.has(status);
}

/**
 * De interne deadline (opname + 7 werkdagen). Bij voorkeur uit de opnamedatum;
 * is die er niet, dan afgeleid uit de klantdeadline (die is opname + 14, dus
 * intern = klantdeadline − 7 werkdagen). Geen van beide → null.
 */
export function internalDeadline(
  shootOn: string | null | undefined,
  dueOn: string | null | undefined,
  holidays?: ReadonlySet<string>,
): string | null {
  if (shootOn) return addWorkingDays(shootOn, EDITOR_LEAD_DAYS, holidays);
  if (dueOn) return subWorkingDays(dueOn, CLIENT_LEAD_DAYS - EDITOR_LEAD_DAYS, holidays);
  return null;
}
