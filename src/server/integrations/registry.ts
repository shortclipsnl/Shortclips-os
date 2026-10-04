import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { integrationConnections } from "@/db/schema";
import { integrationConfig } from "@/lib/env";
import { monday } from "./monday";
import { frameio } from "./frameio";
import { drive } from "./drive";
import type { ConnectionTest, Provider } from "./types";

/**
 * Overzicht van alle koppelingen: welke credentials zijn nodig, waar haal je ze,
 * en werkt de verbinding op dit moment. Dit voedt de instellingenpagina en de
 * setup-wizard.
 */
export type IntegrationSpec = {
  provider: Provider;
  name: string;
  description: string;
  /** Wat ShortClips OS met deze koppeling doet. */
  purpose: string[];
  required: Array<{
    key: string;
    label: string;
    where: string;
    scopes?: string;
  }>;
  webhookPath?: string;
  test: () => Promise<ConnectionTest>;
};

export const INTEGRATION_SPECS: IntegrationSpec[] = [
  {
    provider: "monday",
    name: "Monday.com",
    description:
      "Bestaande operationele planning. ShortClips OS leest boards, groepen, items en statussen, en kan later ook terugschrijven.",
    purpose: [
      "Klanten en projecten importeren",
      "Taken, deadlines en verantwoordelijken overnemen",
      "Statuswijzigingen ontvangen via webhooks",
    ],
    required: [
      {
        key: "MONDAY_API_TOKEN",
        label: "Persoonlijk API-token",
        where:
          "monday.com → klik op je avatar rechtsboven → Developers → My access tokens",
        scopes: "boards:read, boards:write, users:read, updates:read, webhooks:write",
      },
      {
        key: "MONDAY_WEBHOOK_SECRET",
        label: "Webhook-secret (optioneel)",
        where: "Wordt door Monday meegegeven bij het aanmaken van een webhook",
      },
    ],
    webhookPath: "/api/webhooks/monday",
    test: () => monday.testConnection(),
  },
  {
    provider: "frameio",
    name: "Frame.io",
    description:
      "Blijft de bron voor videobestanden, versies en getimede opmerkingen. ShortClips OS haalt die op en koppelt ze aan de juiste video.",
    purpose: [
      "Projecten en assets koppelen aan video's",
      "Versies en getimede opmerkingen binnenhalen",
      "Goedkeuringen automatisch doorzetten naar de pipeline",
    ],
    required: [
      {
        key: "FRAMEIO_TOKEN",
        label: "Bearer-token (server-to-server OAuth of developer token)",
        where: "developer.frame.io → maak een app aan → genereer een token",
        scopes: "lezen op projects, folders, files en comments",
      },
      {
        key: "FRAMEIO_ACCOUNT_ID",
        label: "Account-ID",
        where: "Zichtbaar in de URL van je Frame.io-omgeving of via GET /v4/me",
      },
      {
        key: "FRAMEIO_WEBHOOK_SECRET",
        label: "Webhook-secret",
        where: "Wordt getoond zodra je een webhook aanmaakt",
      },
    ],
    webhookPath: "/api/webhooks/frameio",
    test: () => frameio.testConnection(),
  },
  {
    provider: "google_drive",
    name: "Google Drive",
    description:
      "Blijft de opslag voor documenten, scripts, ruwe beelden en rapportages. ShortClips OS bewaart alleen de metadata, zodat zoeken snel blijft.",
    purpose: [
      "Klantmappen koppelen en doorzoekbaar maken",
      "Bestanden tonen op de klantpagina zonder te dupliceren",
      "Wijzigingen incrementeel bijhouden",
    ],
    required: [
      {
        key: "GOOGLE_CLIENT_ID",
        label: "OAuth client-ID",
        where:
          "console.cloud.google.com → APIs & Services → Credentials → OAuth client ID (type: Web application)",
      },
      {
        key: "GOOGLE_CLIENT_SECRET",
        label: "OAuth client secret",
        where: "Zelfde scherm als het client-ID",
      },
      {
        key: "GOOGLE_REFRESH_TOKEN",
        label: "Refresh-token",
        where:
          "Eenmalig via de OAuth-consent flow met access_type=offline en prompt=consent",
        scopes: "https://www.googleapis.com/auth/drive.readonly",
      },
      {
        key: "GOOGLE_DRIVE_ROOT_FOLDER_ID",
        label: "Hoofdmap-ID (optioneel)",
        where: "Het laatste deel van de URL van de map in Drive",
      },
    ],
    webhookPath: "/api/webhooks/drive",
    test: () => drive.testConnection(),
  },
  {
    provider: "ayrshare",
    name: "Ayrshare",
    description:
      "Levert social statistieken van Instagram, TikTok, YouTube, Facebook en LinkedIn via één koppeling.",
    purpose: [
      "Dagelijkse cijfers per publicatie ophalen",
      "Volgersgroei en bereik bijhouden",
    ],
    required: [
      {
        key: "AYRSHARE_API_KEY",
        label: "API-sleutel",
        where: "app.ayrshare.com → Dashboard → API Key",
      },
    ],
    test: async () => ({
      ok: Boolean(integrationConfig().ayrshare.configured),
      message: integrationConfig().ayrshare.configured
        ? "Sleutel aanwezig. De eerste synchronisatie bevestigt of hij werkt."
        : "Nog niet ingesteld: AYRSHARE_API_KEY ontbreekt.",
    }),
  },
];

export function specFor(provider: Provider): IntegrationSpec | undefined {
  return INTEGRATION_SPECS.find((s) => s.provider === provider);
}

/** Status van alle koppelingen, voor de health-pagina. */
export async function integrationHealth() {
  const rows = await db.select().from(integrationConnections);
  const config = integrationConfig();

  return INTEGRATION_SPECS.map((spec) => {
    const row = rows.find((r) => r.provider === spec.provider);
    const configured =
      (config as Record<string, { configured: boolean }>)[spec.provider]?.configured ?? false;

    return {
      spec,
      configured,
      status: !configured ? "not_configured" : (row?.status ?? "not_configured"),
      lastSyncAt: row?.lastSyncAt ?? null,
      lastWebhookAt: row?.lastWebhookAt ?? null,
      lastCheckedAt: row?.lastCheckedAt ?? null,
      lastErrorAt: row?.lastErrorAt ?? null,
      lastErrorMessage: row?.lastErrorMessage ?? null,
      itemsSynced: row?.itemsSynced ?? 0,
      errorCount: row?.errorCount ?? 0,
      missing: spec.required
        .filter((r) => !process.env[r.key])
        .map((r) => r.key),
    };
  });
}

/** Uitkomst van een verbindingstest wegschrijven. */
export async function recordTest(provider: Provider, result: ConnectionTest) {
  await db
    .update(integrationConnections)
    .set({
      status: result.ok ? "connected" : "error",
      lastCheckedAt: new Date(),
      lastErrorAt: result.ok ? null : new Date(),
      lastErrorMessage: result.ok ? null : result.message,
      updatedAt: new Date(),
    })
    .where(eq(integrationConnections.provider, provider));
}

export { monday, frameio, drive };
