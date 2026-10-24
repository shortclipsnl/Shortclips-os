/** Gedeelde vorm van alle externe koppelingen. */

export type Provider =
  | "monday"
  | "frameio"
  | "google_drive"
  | "google_calendar"
  | "gmail"
  | "ayrshare"
  | "metricool";

export class IntegrationError extends Error {
  constructor(
    public provider: Provider,
    message: string,
    public status?: number,
    public retryable = false,
    public detail?: unknown,
  ) {
    super(message);
    this.name = "IntegrationError";
  }

  /** Nette tekst voor de gebruiker; technische details blijven in de logs. */
  get userMessage(): string {
    if (this.status === 401 || this.status === 403) {
      return "De koppeling is geweigerd. Controleer of het token nog geldig is en de juiste rechten heeft.";
    }
    if (this.status === 429) {
      return "Het externe systeem heeft een limiet bereikt. De synchronisatie probeert het straks opnieuw.";
    }
    if (this.status && this.status >= 500) {
      return "Het externe systeem is tijdelijk niet bereikbaar.";
    }
    return "De koppeling kon de aanvraag niet uitvoeren.";
  }
}

export class MissingCredentialsError extends IntegrationError {
  constructor(provider: Provider, public required: string[]) {
    super(
      provider,
      `Ontbrekende configuratie: ${required.join(", ")}`,
      undefined,
      false,
    );
    this.name = "MissingCredentialsError";
  }

  get userMessage(): string {
    return `Deze koppeling is nog niet ingesteld. Vul ${this.required.join(", ")} in bij de omgevingsvariabelen.`;
  }
}

export type ConnectionTest = {
  ok: boolean;
  /** Korte, begrijpelijke uitleg voor op de instellingenpagina. */
  message: string;
  /** Technische details voor het logboek. */
  detail?: Record<string, unknown>;
};
