import { z } from "zod";

/**
 * Alle configuratie op één plek, met duidelijke fouten wanneer iets ontbreekt.
 * Secrets komen uitsluitend uit environment variables — nooit uit de database
 * en nooit uit de client-bundle.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),

  // --- Database ---
  DATABASE_DRIVER: z.enum(["pglite", "postgres"]).optional(),
  DATABASE_URL: z.string().optional(),
  PGLITE_DATA_DIR: z.string().optional(),

  // --- Sessies ---
  // Minimaal 32 tekens. In productie verplicht; lokaal valt hij terug op een
  // vaste ontwikkelwaarde zodat je meteen kunt starten.
  SESSION_SECRET: z.string().min(32).optional(),

  // --- Monday.com ---
  MONDAY_API_TOKEN: z.string().optional(),
  MONDAY_WEBHOOK_SECRET: z.string().optional(),
  MONDAY_API_VERSION: z.string().default("2026-07"),

  // --- Frame.io (V4 via Adobe IMS) ---
  // Twee manieren om te verbinden:
  //  1. Server-to-Server (Adobe Developer Console): CLIENT_ID + CLIENT_SECRET,
  //     die de app zelf omwisselt voor een kortlevend access-token.
  //  2. Legacy developer token (oudere Frame.io-accounts): FRAMEIO_TOKEN direct.
  FRAMEIO_TOKEN: z.string().optional(),
  FRAMEIO_CLIENT_ID: z.string().optional(),
  FRAMEIO_CLIENT_SECRET: z.string().optional(),
  // Voor de Web App-flow (gebruiker logt één keer in met Adobe): refresh-token
  // waarmee de app zelf access-tokens vernieuwt.
  FRAMEIO_REFRESH_TOKEN: z.string().optional(),
  FRAMEIO_ACCOUNT_ID: z.string().optional(),
  FRAMEIO_WEBHOOK_SECRET: z.string().optional(),
  // Standaard Adobe IMS-tokenendpoint; alleen zetten als Adobe een ander geeft.
  FRAMEIO_IMS_URL: z.string().default("https://ims-na1.adobelogin.com/ims/token/v3"),

  // --- Google Drive ---
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REFRESH_TOKEN: z.string().optional(),
  GOOGLE_DRIVE_ROOT_FOLDER_ID: z.string().optional(),

  // --- Google Agenda ---
  // Hergebruikt dezelfde Google-OAuth (CLIENT_ID/SECRET/REFRESH_TOKEN). De
  // refresh-token moet dan ook de scope calendar.readonly hebben. Optioneel:
  // een komma-gescheiden lijst van agenda-id's die gesynchroniseerd worden.
  // Leeg = alle agenda's waar het account toegang toe heeft.
  GOOGLE_CALENDAR_IDS: z.string().optional(),

  // --- Social statistieken ---
  AYRSHARE_API_KEY: z.string().optional(),
  // Metricool: één user-token (X-Mc-Auth) voor het hele account. De user-id en
  // de merk-id's (blogId) worden automatisch uit /settings/brands gehaald.
  METRICOOL_USER_TOKEN: z.string().optional(),

  // --- AI ---
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default("claude-sonnet-5"),

  // --- Achtergrondtaken ---
  CRON_SECRET: z.string().optional(),

  // --- E-mail (klantnotificaties) ---
  // Resend als verzender. Zonder sleutel blijft e-mail slapend: notificaties
  // worden wél in het portaal gezet, maar er gaat geen mail uit.
  RESEND_API_KEY: z.string().optional(),
  // Afzender, bijv. "ShortClips <portal@shortclips.nl>". Domein moet in Resend
  // geverifieerd zijn.
  MAIL_FROM: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(`Ongeldige omgevingsvariabelen:\n${details}`);
}

export const env = parsed.data;

export const isProduction = env.NODE_ENV === "production";

/**
 * Sessiegeheim. In productie is een expliciet geheim verplicht: zonder dat
 * zouden sessies na een herstart of op een tweede server ongeldig zijn, en
 * zou het geheim raadbaar worden.
 */
export function sessionSecret(): string {
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  if (isProduction) {
    throw new Error(
      "SESSION_SECRET ontbreekt. Genereer er één met: openssl rand -base64 48",
    );
  }
  return "shortclips-os-development-secret-do-not-use-in-production";
}

/** Welke integraties zijn technisch geconfigureerd? Voedt de health-pagina. */
export function integrationConfig() {
  return {
    monday: {
      configured: Boolean(env.MONDAY_API_TOKEN),
      required: ["MONDAY_API_TOKEN"],
      optional: ["MONDAY_WEBHOOK_SECRET"],
    },
    frameio: {
      // Web App: client-id + secret + refresh-token. Of een legacy token.
      // (Server-to-Server zou met alleen id+secret kunnen, maar dit account
      // biedt alleen Web App; dan is de refresh-token nodig.)
      configured: Boolean(
        (env.FRAMEIO_CLIENT_ID && env.FRAMEIO_CLIENT_SECRET && env.FRAMEIO_REFRESH_TOKEN) ||
          env.FRAMEIO_TOKEN,
      ),
      required: [
        "FRAMEIO_CLIENT_ID",
        "FRAMEIO_CLIENT_SECRET",
        "FRAMEIO_REFRESH_TOKEN",
        "FRAMEIO_ACCOUNT_ID",
      ],
      optional: ["FRAMEIO_TOKEN", "FRAMEIO_WEBHOOK_SECRET"],
    },
    google_drive: {
      configured: Boolean(
        env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REFRESH_TOKEN,
      ),
      required: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"],
      optional: ["GOOGLE_DRIVE_ROOT_FOLDER_ID"],
    },
    google_calendar: {
      // Hergebruikt dezelfde Google-OAuth als Drive; vereist wél de
      // calendar.readonly-scope op de refresh-token.
      configured: Boolean(
        env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REFRESH_TOKEN,
      ),
      required: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"],
      optional: ["GOOGLE_CALENDAR_IDS"],
    },
    ayrshare: {
      configured: Boolean(env.AYRSHARE_API_KEY),
      required: ["AYRSHARE_API_KEY"],
      optional: [],
    },
    metricool: { configured: false, required: [], optional: [] },
    email: {
      configured: Boolean(env.RESEND_API_KEY && env.MAIL_FROM),
      required: ["RESEND_API_KEY", "MAIL_FROM"],
      optional: [],
    },
  } as const;
}
