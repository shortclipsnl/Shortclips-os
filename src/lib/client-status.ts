/**
 * Centrale klantstatus: één definitie van "actief" en "niet actief" voor het hele
 * portaal (pagina's, achtergrondjobs, meldingen, rapportages, editorportaal).
 *
 * De bron is altijd de status in het centrale klantenbeheer (clients.status),
 * live gelezen. Er wordt niets gekopieerd, dus er kan niets uit sync raken.
 *
 *  - Actief:      active, onboarding → reguliere klantprocessen draaien.
 *  - Niet actief: paused, churned (en verwijderde klanten) → geen nieuwe
 *                 operationele taken, controles, meldingen of rapportages.
 *  - Prospect:    nog geen klant; telt niet als actief, maar wordt ook niet
 *                 geblokkeerd voor sales (offertes e.d.).
 *
 * Server-code gebruikt de SQL-hulpen in `@/server/client-activity`; deze module
 * is ook veilig in client components.
 */
export const ACTIVE_CLIENT_STATUSES = ["active", "onboarding"] as const;
export const INACTIVE_CLIENT_STATUSES = ["paused", "churned"] as const;

const ACTIVE = new Set<string>(ACTIVE_CLIENT_STATUSES);
const INACTIVE = new Set<string>(INACTIVE_CLIENT_STATUSES);

/** Draait deze klant mee in de reguliere processen? */
export function isActiveClientStatus(status: string | null | undefined): boolean {
  return !!status && ACTIVE.has(status);
}

/** Is deze klant bewust op niet actief gezet (gepauzeerd of gestopt)? */
export function isInactiveClientStatus(status: string | null | undefined): boolean {
  return !!status && INACTIVE.has(status);
}

export type ClientActivity = "actief" | "niet_actief";

export function clientActivity(status: string | null | undefined): ClientActivity {
  return isActiveClientStatus(status) ? "actief" : "niet_actief";
}

/** Filter op operationele pagina's: standaard alleen actieve klanten. */
export type ClientStatusFilter = "actief" | "niet_actief" | "alle";

export const CLIENT_STATUS_FILTERS: { value: ClientStatusFilter; label: string }[] = [
  { value: "actief", label: "Actieve klanten" },
  { value: "niet_actief", label: "Niet actieve klanten" },
  { value: "alle", label: "Alle klanten" },
];

export function parseClientStatusFilter(value: string | string[] | null | undefined): ClientStatusFilter {
  const v = Array.isArray(value) ? value[0] : value;
  if (v === "niet_actief" || v === "niet-actief" || v === "inactief") return "niet_actief";
  return v === "alle" ? "alle" : "actief";
}

export function matchesClientStatusFilter(status: string | null | undefined, filter: ClientStatusFilter): boolean {
  if (filter === "alle") return true;
  if (filter === "actief") return isActiveClientStatus(status);
  return isInactiveClientStatus(status);
}
