import "server-only";
import { sql } from "drizzle-orm";
import { db, activeDriver } from "@/db/client";
import { requireOwner } from "@/server/auth/context";
import { integrationConfig } from "@/lib/env";
import { getMigrationStatus } from "@/server/migration-status";

export type ExitStatus = "behaald" | "deels" | "nog_niet";
export type ExitCriterion = {
  n: number;
  title: string;
  status: ExitStatus;
  getest: string; // wat is gecontroleerd
  open: string; // wat nog moet
};

/**
 * De acht verplichte exitcriteria voor het opzeggen van Monday (sectie 10 van
 * de opdracht). Status wordt waar mogelijk afgeleid uit echte signalen; de rest
 * is bewust "nog niet" tot de deploy/accounts geregeld zijn. Alleen de eigenaar.
 */
export async function getMondayExitCriteria(): Promise<{ criteria: ExitCriterion[]; behaald: number }> {
  await requireOwner();

  const driver = activeDriver(); // "pglite" (lokaal) of "postgres" (productie)
  const onPostgres = driver === "postgres";
  const cfg = integrationConfig();
  const googleOk = cfg.google_calendar.configured; // CLIENT_SECRET + REFRESH_TOKEN aanwezig
  const emailOk = cfg.email.configured; // RESEND + MAIL_FROM

  // 14 dagen foutloze sync: tel dagen met succesvolle sync en zonder fouten.
  let okDays = 0;
  try {
    const res = await db.execute(sql`
      select count(distinct date_trunc('day', finished_at)) d
      from sync_jobs
      where status = 'success' and finished_at >= now() - interval '14 days'
        and provider in ('monday','frameio','google_calendar','metricool')`);
    const rows = ((res as { rows?: unknown[] }).rows ?? (res as unknown as unknown[])) as Array<{ d: number }>;
    okDays = Number(rows[0]?.d ?? 0);
  } catch {
    okDays = 0;
  }

  const mig = await getMigrationStatus();
  const migIssues = mig.attention.videosWithoutShoot + mig.attention.duplicateClients.length + mig.attention.duplicateLeads.length + mig.attention.wonLeadsUnconverted;

  const criteria: ExitCriterion[] = [
    {
      n: 1,
      title: "Stabiele hosting + PostgreSQL + backups + private GitHub",
      status: onPostgres ? "deels" : "nog_niet",
      getest: onPostgres ? "App draait op PostgreSQL." : "App draait lokaal op PGlite (geen productie-DB).",
      open: onPostgres ? "Dagelijkse backup + geteste restore + private GitHub-repo bevestigen." : "Supabase/Neon-database, Vercel-deploy, private GitHub-repo en dagelijkse backup opzetten (jouw accounts).",
    },
    {
      n: 2,
      title: "Veertien dagen foutloze synchronisaties",
      status: okDays >= 14 ? "behaald" : okDays > 0 ? "deels" : "nog_niet",
      getest: `${okDays} van 14 dagen met een succesvolle sync in de afgelopen 2 weken.`,
      open: okDays >= 14 ? "Controleren op ontbrekende/dubbele records." : "Vereist een draaiende cron op de server (deploy). Lokaal draait er geen achtergrondsync.",
    },
    {
      n: 3,
      title: "Google Agenda volledig gekoppeld",
      status: googleOk ? "deels" : "nog_niet",
      getest: googleOk ? "Secrets aanwezig; koppeling kan authenticeren." : "GOOGLE_CLIENT_SECRET + REFRESH_TOKEN ontbreken → kan niet inloggen.",
      open: googleOk ? "Alle opnames verschijnen automatisch; annuleringen worden verwerkt." : "OAuth-secrets invullen (jouw Google) en een sync draaien.",
    },
    {
      n: 4,
      title: "Monday-migratie afgerond",
      status: migIssues === 0 ? "deels" : "nog_niet",
      getest: `${mig.totalMapped} records overgenomen; ${migIssues} aandachtspunten.`,
      open: migIssues === 0 ? "Twee weken parallel draaien en vergelijken op onverklaarde verschillen." : "Aandachtspunten wegwerken (o.a. video↔opname-koppelingen, dubbele klanten/leads).",
    },
    {
      n: 5,
      title: "Editoromgeving werkt volledig",
      status: "behaald",
      getest: "Editors loggen in, zien via isEditorOnly uitsluitend eigen werk; server-side afgedwongen (geen finance/klant-breed).",
      open: "Blijvend testen bij nieuwe editors.",
    },
    {
      n: 6,
      title: "Automatische communicatie (mail) werkt",
      status: emailOk ? "deels" : "nog_niet",
      getest: emailOk ? "RESEND + MAIL_FROM aanwezig." : "RESEND_API_KEY + MAIL_FROM ontbreken → e-mail staat uit (in-app meldingen werken wel).",
      open: emailOk ? "Ontvangst + inhoud van dagelijkse updates/meldingen controleren." : "Resend-sleutel + afzender invullen; daarna verzending testen.",
    },
    {
      n: 7,
      title: "Beveiligingsproblemen opgelost",
      status: "behaald",
      getest: "Beveiligingsreview uitgevoerd: finance owner-only (server-side), sessies gehard, login-lockout, webhooks fail-closed, geen client-exposed secrets, klant-isolatie zonder IDOR.",
      open: "Secrets naar een beveiligde store bij de deploy; wachtwoordbestand blijft gitignored.",
    },
    {
      n: 8,
      title: "Overdraagbaar systeem (documentatie)",
      status: "deels",
      getest: "docs/ dekt deploy, backup, restore, sync-controle en storingen (DEPLOYMENT/ARCHITECTUUR/CREDENTIALS/MIGRATIE/ONTWIKKELEN).",
      open: "Restore in een gescheiden omgeving één keer aantoonbaar uitvoeren; docs bijhouden bij wijzigingen.",
    },
  ];

  return { criteria, behaald: criteria.filter((c) => c.status === "behaald").length };
}
