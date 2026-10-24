import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { integrationConnections } from "@/db/schema";
import { integrationConfig } from "@/lib/env";
import { frameio } from "./frameio";
import { drive } from "./drive";
import { googleCalendar } from "./google-calendar";
import { gmail } from "./gmail";
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
        key: "FRAMEIO_CLIENT_ID",
        label: "Client-ID (OAuth Web App)",
        where:
          "developer.adobe.com/console → project → Add API → Frame.io → OAuth Web App → Client ID",
        scopes: "redirect-URI: https://localhost:5859/callback",
      },
      {
        key: "FRAMEIO_CLIENT_SECRET",
        label: "Client secret (OAuth Web App)",
        where: "Zelfde scherm als het Client-ID (Retrieve client secret)",
      },
      {
        key: "FRAMEIO_REFRESH_TOKEN",
        label: "Refresh-token",
        where: "Eenmalig via de Adobe-toestemmingsflow: npm run frameio:token",
      },
      {
        key: "FRAMEIO_ACCOUNT_ID",
        label: "Account-ID",
        where: "Zichtbaar in de URL van je Frame.io-omgeving (?a=…) of via GET /v4/me",
      },
      {
        key: "FRAMEIO_TOKEN",
        label: "Legacy developer token (alleen oudere accounts, i.p.v. bovenstaande)",
        where: "developer.frame.io → Developer Tokens",
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
    provider: "google_calendar",
    name: "Google Agenda",
    description:
      "De actuele planning van ShortClips. Leest afspraken — opnamedagen, scriptbesprekingen, evaluaties en publicaties — en koppelt ze aan de juiste klant.",
    purpose: [
      "Eerstvolgende opnamedag en aankomende afspraken per klant tonen",
      "Scriptbesprekingen en evaluatiegesprekken automatisch bijhouden",
      "Afspraken zonder herkenbare klant markeren voor controle, nooit gokken",
    ],
    required: [
      {
        key: "GOOGLE_CLIENT_ID",
        label: "OAuth client-ID (zelfde als Google Drive)",
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
        label: "Refresh-token mét Agenda-scope",
        where:
          "Eenmalig via de OAuth-consent flow met access_type=offline en prompt=consent",
        scopes:
          "https://www.googleapis.com/auth/calendar.readonly (naast de Drive-scope)",
      },
      {
        key: "GOOGLE_CALENDAR_IDS",
        label: "Agenda-id's (optioneel, komma-gescheiden)",
        where:
          "Google Agenda → agenda-instellingen → Agenda-id. Leeg = alle agenda's waar het account toegang toe heeft.",
      },
    ],
    test: () => googleCalendar.testConnection(),
  },
  {
    provider: "gmail",
    name: "Gmail (leads)",
    description:
      "Leest het label \"Leads - Shortclips\" uit de mailbox en zet nieuwe contactformulier-mails automatisch om in leads op de Leads-pagina. Twee keer per dag en via de knop 'Nu synchroniseren'.",
    purpose: [
      "Contactformulier-aanvragen van de website automatisch als lead toevoegen",
      "Dubbele import voorkomen via de unieke Message-ID",
      "Nieuwe leads toewijzen aan de eigenaar met status 'Nieuw'",
    ],
    required: [
      {
        key: "GOOGLE_CLIENT_ID",
        label: "OAuth client-ID (zelfde als Google Drive/Agenda)",
        where: "console.cloud.google.com → APIs & Services → Credentials → OAuth client ID",
      },
      {
        key: "GOOGLE_CLIENT_SECRET",
        label: "OAuth client secret",
        where: "Zelfde scherm als het client-ID",
      },
      {
        key: "GOOGLE_REFRESH_TOKEN",
        label: "Refresh-token mét Gmail-scope",
        where: "Eenmalig via de OAuth-consent flow (access_type=offline, prompt=consent)",
        scopes: "https://www.googleapis.com/auth/gmail.readonly (naast de Drive/Agenda-scopes)",
      },
      {
        key: "GMAIL_LEADS_LABEL",
        label: "Labelnaam (optioneel)",
        where: "Standaard \"Leads - Shortclips\". Pas aan als het label anders heet.",
      },
    ],
    test: () => gmail.testConnection(),
  },
  {
    provider: "metricool",
    name: "Metricool",
    description:
      "Levert socialmediastatistieken (weergaven, bereik, interacties, volgers) per klant en platform. Voorlopig de bron voor klantresultaten; de datalaag (daily_metrics) is brononafhankelijk, zodat later rechtstreekse platformkoppelingen kunnen worden toegevoegd.",
    purpose: [
      "Dagelijkse cijfers per klant en platform ophalen (Instagram, TikTok, Facebook)",
      "Volgersgroei, bereik en interacties bijhouden voor rapportages",
    ],
    required: [
      {
        key: "METRICOOL_USER_TOKEN",
        label: "User token",
        where: "Metricool → Instellingen → API/Integraties",
      },
    ],
    test: async () => {
      const { metricool } = await import("./metricool");
      if (!metricool.isConfigured) return { ok: false, message: "Nog niet ingesteld: METRICOOL_USER_TOKEN ontbreekt." };
      try {
        const brands = await metricool.listBrands();
        return { ok: true, message: `Verbonden. ${brands.length} merken beschikbaar.` };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : "Verbinding met Metricool mislukt." };
      }
    },
  },
];

export function specFor(provider: Provider): IntegrationSpec | undefined {
  return INTEGRATION_SPECS.find((s) => s.provider === provider);
}

/** Status van alle koppelingen, voor de health-pagina. */
/** Data ouder dan dit geldt als verouderd (een groen icoon is dan onvoldoende). */
const STALE_MS = 24 * 60 * 60 * 1000;

export type IntegrationHealthStatus = "not_configured" | "never_synced" | "stale" | "error" | "connected";

export async function integrationHealth() {
  const [rows, errorRows] = await Promise.all([
    db.select().from(integrationConnections),
    // Echte foutentelling uit de laatste 7 dagen (de runner vult errorCount niet).
    db.execute(sql`
      select provider, count(*) filter (where status = 'error')::int errors,
             max(finished_at) filter (where status = 'success') last_success
      from sync_jobs
      where finished_at >= now() - interval '7 days'
      group by provider`),
  ]);
  const errByProvider = new Map(
    (((errorRows as { rows?: unknown[] }).rows ?? (errorRows as unknown as unknown[])) as Array<{ provider: string; errors: number; last_success: string | null }>)
      .map((r) => [r.provider, r]),
  );
  const config = integrationConfig();
  const now = Date.now();

  return INTEGRATION_SPECS.map((spec) => {
    const row = rows.find((r) => r.provider === spec.provider);
    const configured =
      (config as Record<string, { configured: boolean }>)[spec.provider]?.configured ?? false;
    const err = errByProvider.get(spec.provider);
    const lastSuccessAt = err?.last_success ? new Date(err.last_success) : (row?.lastSyncAt ?? null);
    const ageMs = lastSuccessAt ? now - new Date(lastSuccessAt).getTime() : null;
    const stale = configured && ageMs !== null && ageMs > STALE_MS;

    // Afgeleide, eerlijke status: niet "connected" zolang de data verouderd is.
    const health: IntegrationHealthStatus = !configured
      ? "not_configured"
      : !lastSuccessAt
        ? "never_synced"
        : (row?.status === "error" || (err?.errors ?? 0) > 0) && stale
          ? "error"
          : stale
            ? "stale"
            : "connected";

    return {
      spec,
      configured,
      status: health,
      rawStatus: row?.status ?? "not_configured",
      stale,
      ageMs,
      lastSyncAt: row?.lastSyncAt ?? null,
      lastSuccessAt,
      lastWebhookAt: row?.lastWebhookAt ?? null,
      lastCheckedAt: row?.lastCheckedAt ?? null,
      lastErrorAt: row?.lastErrorAt ?? null,
      lastErrorMessage: row?.lastErrorMessage ?? null,
      itemsSynced: row?.itemsSynced ?? 0,
      errorCount: err?.errors ?? row?.errorCount ?? 0,
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

export { frameio, drive, googleCalendar };
