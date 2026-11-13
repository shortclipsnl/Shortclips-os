import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { drive } from "@/server/integrations/drive";
import { googleCalendar } from "@/server/integrations/google-calendar";
import { frameio } from "@/server/integrations/frameio";
import { metricool } from "@/server/integrations/metricool";
import { imapLeads } from "@/server/integrations/imap-leads";
import { readGoogleConnection } from "@/server/integrations/google-connection";
import { getDriveStatus } from "@/server/integrations/drive-status";
import { pandadocConfigured } from "@/server/quotes/pandadoc-client";
import { mailChannel } from "./mailer";
import {
  daytimeFreshness,
  levelFromAge,
  redact,
  worstLevel,
  type MonitorLevel,
  type Observation,
} from "@/lib/monitoring-rules";

/**
 * De metingen van de Koppelingsbewaking. Kijkt niet alleen of een verbinding
 * bestaat, maar vooral of er aantoonbaar verse gegevens binnenkomen: een
 * bereikbare koppeling die niets meer synchroniseert is hier oranje of rood.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;

export type IntegrationCheck = Observation & {
  /** Laatste geslaagde synchronisatie. */
  lastSuccessAt: Date | null;
  /** Tot wanneer de gegevens zelf aantoonbaar actueel zijn. */
  dataFreshAt: Date | null;
  dataLabel: string | null;
  /** Herstelactie die de bewaking zelf mag uitvoeren. */
  recoveryJob: string | null;
  /** Detailpagina voor de beheerder. */
  href: string;
};

export type ProcessCheck = {
  key: string;
  name: string;
  level: MonitorLevel;
  summary: string;
  dependsOn: string[];
  dataFreshAt: Date | null;
};

type JobRow = {
  job_type: string;
  last_ok: string | null;
  last_run: string | null;
  errs_since_ok: number;
  last_error: string | null;
  running_since: string | null;
};

function rows<T>(r: unknown): T[] {
  return ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];
}

const d = (v: string | Date | null | undefined): Date | null => (v ? new Date(v) : null);

/** Per jobtype: laatste geslaagde run, laatste run, fouten sinds laatste succes en de laatste fout. */
export async function jobStats(): Promise<Map<string, JobRow>> {
  const result = await db.execute(sql`
    with recent as (
      select job_type, status, started_at, finished_at, error
      from sync_jobs
      where started_at >= now() - interval '14 days'
    ), ok as (
      select job_type, max(finished_at) last_ok from recent
      where status in ('success', 'partial') group by job_type
    )
    select r.job_type,
           ok.last_ok,
           max(r.started_at) last_run,
           count(*) filter (where r.status = 'error' and (ok.last_ok is null or r.started_at > ok.last_ok))::int errs_since_ok,
           (array_agg(r.error order by r.started_at desc) filter (where r.status = 'error'))[1] last_error,
           max(r.started_at) filter (where r.status = 'running' and r.started_at > now() - interval '15 minutes') running_since
    from recent r left join ok on ok.job_type = r.job_type
    group by r.job_type, ok.last_ok`);
  return new Map(rows<JobRow>(result).map((r) => [r.job_type, r]));
}

async function lastJobLog(jobType: string): Promise<Array<{ level: string; message: string }>> {
  const r = await db.execute(sql`
    select log from sync_jobs where job_type = ${jobType} and status in ('success','partial','error')
    order by started_at desc limit 1`);
  const row = rows<{ log: Array<{ level: string; message: string }> | null }>(r)[0];
  return row?.log ?? [];
}

async function dataMarkers() {
  const r = await db.execute(sql`
    select (select max(measured_on) from daily_metrics) metrics_day,
           (select max(synced_at) from calendar_events) calendar_at,
           (select max(updated_at) from frame_assets) frame_at,
           (select max(finished_at) from sync_jobs) any_job_at`);
  const row = rows<{ metrics_day: string | null; calendar_at: string | null; frame_at: string | null; any_job_at: string | null }>(r)[0];
  return {
    metricsDay: d(row?.metrics_day),
    calendarAt: d(row?.calendar_at),
    frameAt: d(row?.frame_at),
    anyJobAt: d(row?.any_job_at),
  };
}

const AUTH_PROBLEM = /\b(401|403)\b|invalid_grant|toestemming|token .*(verlopen|ingetrokken|ongeldig)|unauthori[sz]ed|geweigerd/i;

function errorSummary(row: JobRow | undefined): string | null {
  if (!row?.last_error) return null;
  return redact(row.last_error.replace(/^Error:\s*/, ""));
}

/** Leesbare naam van een achtergrondtaak (voor het dashboard en de mail). */
const JOB_LABEL: Record<string, string> = {
  "awards.recompute": "Editor-awards",
  "pandadoc.sync": "PandaDoc-offertes",
  "reports.generate_drafts": "Maandrapportages",
  "reports.process_queue": "Rapportagewachtrij",
  "scripting.task_sync": "Scriptingtaken",
  "scripts.version_sync": "Scriptversies uit Drive",
  "captions.link_drive_scripts": "Captions koppelen aan scripts",
  "briefing.auto_generate": "Editorbriefings",
  "signals.daily": "Dagelijkse signalering",
  "content_health.signals": "Contentgezondheid",
  "retention.tasks": "Klantbehoud",
  "feedback.reminders": "Feedbackherinneringen",
  "editors.status_checks": "Statuscheck editors",
  "goals.recompute": "Doelen",
  "content.sync_from_videos": "Contentplanning uit video's",
  "content.auto_publish_due": "Automatisch publiceren",
  "publications.metricool_reconcile": "Publicaties via Metricool",
  "production.advance_phases": "Productiefases",
};

export async function runChecks(now = new Date()): Promise<{ integrations: IntegrationCheck[]; processes: ProcessCheck[] }> {
  const [jobs, markers, google, driveStatus, calLog, mail] = await Promise.all([
    jobStats(),
    dataMarkers(),
    readGoogleConnection().catch(() => null),
    getDriveStatus().catch(() => null),
    lastJobLog("calendar.sync").catch(() => []),
    mailChannel(),
  ]);
  const googleAuth = google?.tokenMeta.authState ?? "ok";
  const out: IntegrationCheck[] = [];

  // --- Google Drive: eigen, fijnmazige bewaking (drive-status) hergebruiken. ---
  {
    const s = driveStatus;
    const level: MonitorLevel = !s || s.connection === "niet_ingesteld"
      ? (drive.isConfigured ? "warn" : "off")
      : s.connection === "verbroken" ? "down" : s.connection === "aandacht" ? "warn" : "ok";
    const needsHuman = googleAuth !== "ok";
    out.push({
      key: "google_drive",
      name: "Google Drive",
      core: true,
      level,
      needsHuman,
      retryable: level !== "off" && !needsHuman,
      summary: level === "ok"
        ? "Wijzigingen in Drive komen binnen."
        : s?.reason ?? "De Drive-synchronisatie is niet actueel.",
      action: s?.action ?? (needsHuman ? "Verbind Google opnieuw via Instellingen > Koppelingen." : null),
      lastSuccessAt: s?.lastSuccessAt ?? null,
      dataFreshAt: s?.lastSuccessAt ?? null,
      dataLabel: "Scripts, documenten en klantmappen",
      recoveryJob: "drive.sync_changes",
      href: "/settings/integrations",
    });
  }

  // --- Google Agenda: elk uur. Ook gedeeltelijke uitval (één agenda) zichtbaar. ---
  {
    const row = jobs.get("calendar.sync");
    const configured = googleCalendar.isConfigured;
    const lastOk = d(row?.last_ok);
    let level: MonitorLevel = configured ? levelFromAge(lastOk, now, { warnAfterMs: 2.5 * HOUR, downAfterMs: 4 * HOUR }) : "off";
    const needsHuman = configured && (googleAuth !== "ok" || AUTH_PROBLEM.test(row?.last_error ?? ""));
    if (needsHuman && (row?.errs_since_ok ?? 0) > 0) level = "down";
    const skipped = calLog.filter((l) => /overgeslagen \(niet bereikbaar\)/.test(l.message));
    let summary = level === "ok" ? "Opnames en afspraken worden elk uur bijgewerkt." : `Laatste geslaagde synchronisatie ${ago(lastOk, now)}.`;
    let action: string | null = needsHuman ? "Verbind Google opnieuw via Instellingen > Koppelingen (log in met teamshortclips@gmail.com)." : null;
    if (level === "ok" && skipped.length > 0) {
      level = "warn";
      const names = skipped.map((l) => l.message.match(/Agenda "([^"]+)"/)?.[1] ?? "onbekend").map(shortCalendarName);
      summary = `${skipped.length} van de agenda's is niet bereikbaar (${names.join(", ")}). De rest synchroniseert gewoon.`;
      action = "Geef teamshortclips@gmail.com weer toegang tot deze agenda, of haal hem uit GOOGLE_CALENDAR_IDS in Vercel als hij niet meer nodig is.";
    }
    out.push({
      key: "google_calendar",
      name: "Google Agenda",
      core: true,
      level,
      needsHuman,
      retryable: configured && !needsHuman && skipped.length === 0,
      summary,
      action,
      lastSuccessAt: lastOk,
      dataFreshAt: markers.calendarAt,
      dataLabel: "Opnames, afspraken en scriptbesprekingen",
      recoveryJob: "calendar.sync",
      href: "/settings/integrations",
    });
  }

  // --- Frame.io: bibliotheek elke 2 uur overdag. ---
  {
    const row = jobs.get("frameio.sync_library");
    const configured = frameio.isConfigured;
    const lastOk = d(row?.last_ok);
    const fresh = daytimeFreshness(now, { warnAfterMs: 5 * HOUR, downAfterMs: 15 * HOUR }, { warnAfterMs: 14 * HOUR, downAfterMs: 26 * HOUR }, 8, 21);
    let level: MonitorLevel = configured ? levelFromAge(lastOk, now, fresh) : "off";
    const needsHuman = configured && (row?.errs_since_ok ?? 0) >= 2 && AUTH_PROBLEM.test(row?.last_error ?? "");
    if (needsHuman) level = "down";
    if (level === "ok" && (row?.errs_since_ok ?? 0) >= 2) level = "warn";
    out.push({
      key: "frameio",
      name: "Frame.io",
      core: true,
      level,
      needsHuman,
      retryable: configured && !needsHuman,
      summary: level === "ok"
        ? "Video's, versies en feedback komen binnen."
        : `Laatste geslaagde synchronisatie ${ago(lastOk, now)}.${errorSummary(row) ? ` Laatste fout: ${errorSummary(row)}` : ""}`,
      action: needsHuman ? "Verbind Frame.io opnieuw via Instellingen > Koppelingen." : null,
      lastSuccessAt: lastOk,
      dataFreshAt: markers.frameAt,
      dataLabel: "Video's in de bibliotheek en het klantportaal",
      recoveryJob: "frameio.sync_library",
      href: "/settings/integrations",
    });
  }

  // --- Metricool: statistieken dagelijks; publicaties vaker. ---
  {
    const row = jobs.get("metricool.pull_metrics");
    const configured = metricool.isConfigured;
    const lastOk = d(row?.last_ok);
    let level: MonitorLevel = configured ? levelFromAge(lastOk, now, { warnAfterMs: 30 * HOUR, downAfterMs: 54 * HOUR }) : "off";
    // Data zelf: statistieken horen tot hooguit eergisteren te lopen.
    const metricsAge = markers.metricsDay ? now.getTime() - markers.metricsDay.getTime() : Infinity;
    if (configured && level === "ok" && metricsAge > 3.5 * 24 * HOUR) level = "warn";
    const needsHuman = configured && AUTH_PROBLEM.test(row?.last_error ?? "") && (row?.errs_since_ok ?? 0) > 0;
    out.push({
      key: "metricool",
      name: "Metricool",
      core: false,
      level,
      needsHuman,
      retryable: configured && !needsHuman,
      summary: level === "ok"
        ? "Statistieken en publicaties worden bijgewerkt."
        : metricsAge > 3.5 * 24 * HOUR && lastOk
          ? `De synchronisatie draait, maar de nieuwste statistieken zijn van ${fmtDay(markers.metricsDay)}.`
          : `Laatste geslaagde synchronisatie ${ago(lastOk, now)}.`,
      action: needsHuman ? "Controleer METRICOOL_USER_TOKEN in Vercel." : null,
      lastSuccessAt: lastOk,
      dataFreshAt: markers.metricsDay,
      dataLabel: "Resultaten, maandrapportages en Contentgeheugen",
      recoveryJob: "metricool.pull_metrics",
      href: "/settings/integrations",
    });
  }

  // --- Leads-mailbox (IMAP info@): elk uur van 7 tot 20 uur. ---
  {
    const row = jobs.get("leads.sync_mailbox");
    const configured = imapLeads.isConfigured;
    const lastOk = d(row?.last_ok);
    const fresh = daytimeFreshness(now, { warnAfterMs: 3 * HOUR, downAfterMs: 8 * HOUR }, { warnAfterMs: 13 * HOUR, downAfterMs: 26 * HOUR }, 8, 21);
    const level: MonitorLevel = configured ? levelFromAge(lastOk, now, fresh) : "off";
    const needsHuman = configured && AUTH_PROBLEM.test(row?.last_error ?? "") && (row?.errs_since_ok ?? 0) > 0;
    out.push({
      key: "leads",
      name: "Leads-mailbox (info@)",
      core: false,
      level,
      needsHuman,
      retryable: configured && !needsHuman,
      summary: level === "ok" ? "Nieuwe aanvragen komen automatisch op de Leads-pagina." : `Laatste geslaagde controle ${ago(lastOk, now)}.`,
      action: needsHuman ? "Controleer het mailwachtwoord (IMAP_PASSWORD) in Vercel." : null,
      lastSuccessAt: lastOk,
      dataFreshAt: lastOk,
      dataLabel: "Leads",
      recoveryJob: "leads.sync_mailbox",
      href: "/settings/integrations",
    });
  }

  // --- PandaDoc: offertes, elk uur. ---
  {
    const row = jobs.get("pandadoc.sync");
    const configured = pandadocConfigured();
    const lastOk = d(row?.last_ok);
    const level: MonitorLevel = configured ? levelFromAge(lastOk, now, { warnAfterMs: 3 * HOUR, downAfterMs: 26 * HOUR }) : "off";
    out.push({
      key: "pandadoc",
      name: "PandaDoc",
      core: false,
      level,
      needsHuman: !configured || (level !== "ok" && AUTH_PROBLEM.test(row?.last_error ?? "")),
      retryable: configured,
      summary: !configured
        ? "Niet gekoppeld: de Offertepagina haalt nog niets uit PandaDoc op."
        : level === "ok" ? "Offertes en statussen worden elk uur bijgewerkt." : `Laatste geslaagde synchronisatie ${ago(lastOk, now)}.`,
      action: !configured ? "Maak in PandaDoc een API-sleutel (Settings > API) en zet die als PANDADOC_API_KEY in Vercel." : null,
      lastSuccessAt: lastOk,
      dataFreshAt: lastOk,
      dataLabel: "Offertes",
      recoveryJob: configured ? "pandadoc.sync" : null,
      href: "/offertes",
    });
  }

  // --- Achtergrondtaken: draait de planner nog, en welke interne taken falen? ---
  {
    const heartbeatLevel = levelFromAge(markers.anyJobAt, now, { warnAfterMs: 2 * HOUR, downAfterMs: 4 * HOUR });
    const failing = [...jobs.values()]
      .filter((j) => j.errs_since_ok >= 2 && j.last_run && now.getTime() - new Date(j.last_run).getTime() < 3 * 24 * HOUR)
      .filter((j) => JOB_LABEL[j.job_type] !== undefined || j.job_type.startsWith("reports.") || j.job_type.startsWith("signals."))
      .filter((j) => j.job_type !== "pandadoc.sync");
    const level: MonitorLevel = heartbeatLevel !== "ok" ? heartbeatLevel : failing.length ? "warn" : "ok";
    out.push({
      key: "jobs",
      name: "Achtergrondtaken",
      core: heartbeatLevel === "down",
      level,
      needsHuman: failing.length > 0 && heartbeatLevel === "ok",
      retryable: false,
      summary: heartbeatLevel !== "ok"
        ? `De geplande taken hebben ${ago(markers.anyJobAt, now)} voor het laatst gedraaid. Het portaal wordt dan niet meer bijgewerkt.`
        : failing.length
          ? `${failing.length} interne ${failing.length === 1 ? "taak mislukt" : "taken mislukken"} herhaaldelijk: ${failing.map((j) => JOB_LABEL[j.job_type] ?? j.job_type).join(", ")}.`
          : "Alle geplande taken draaien op schema.",
      action: heartbeatLevel !== "ok"
        ? "Controleer in Vercel of de Cron Jobs aanstaan en de laatste deploy gelukt is."
        : failing.length ? "Technisch probleem in de portaalcode: laat het nakijken (details in het logboek op Instellingen > Koppelingen)." : null,
      lastSuccessAt: markers.anyJobAt,
      dataFreshAt: markers.anyJobAt,
      dataLabel: "Taken, signalen en herinneringen",
      recoveryJob: null,
      href: "/settings/health",
    });
  }

  // --- Meldingskanaal zelf: anders merk je niet dat meldingen niet aankomen. ---
  {
    const level: MonitorLevel = !mail.configured ? "down" : mail.lastError && (!mail.lastOkAt || new Date(mail.lastErrorAt ?? 0) > new Date(mail.lastOkAt)) ? "warn" : "ok";
    out.push({
      key: "mail",
      name: "Meldingen per e-mail",
      core: false,
      level,
      needsHuman: level !== "ok",
      retryable: false,
      summary: !mail.configured
        ? "Geen mailserver ingesteld: storingen verschijnen alleen in het portaal."
        : level === "ok"
          ? `Kritieke meldingen gaan naar ${mail.recipientMasked}${mail.lastOkAt ? `, laatst verstuurd ${ago(new Date(mail.lastOkAt), now)}` : ""}.`
          : `Versturen naar ${mail.recipientMasked} mislukte: ${mail.lastError}`,
      action: level === "ok" ? null : "Controleer de mailinstellingen (SMTP_* of IMAP_* in Vercel) en stuur een testmelding.",
      lastSuccessAt: mail.lastOkAt ? new Date(mail.lastOkAt) : null,
      dataFreshAt: null,
      dataLabel: null,
      recoveryJob: null,
      href: "/settings/koppelingsbewaking",
    });
  }

  return { integrations: out, processes: processChecks(out, jobs, markers, now) };
}

function processChecks(
  integrations: IntegrationCheck[],
  jobs: Map<string, JobRow>,
  markers: Awaited<ReturnType<typeof dataMarkers>>,
  now: Date,
): ProcessCheck[] {
  const by = new Map(integrations.map((i) => [i.key, i]));
  const lvl = (k: string): MonitorLevel => by.get(k)?.level ?? "ok";
  const jobLevel = (jobType: string, warnH: number, downH: number): MonitorLevel => {
    const row = jobs.get(jobType);
    if (!row) return "ok"; // nog nooit gedraaid in 14 dagen: geen bewijs van stilstand
    return levelFromAge(d(row.last_ok), now, { warnAfterMs: warnH * HOUR, downAfterMs: downH * HOUR });
  };
  const fresh = (date: Date | null, label: string) => (date ? `${label} t/m ${fmtDateTime(date)}` : `${label}: nog geen gegevens`);

  const list: Array<Omit<ProcessCheck, "level" | "summary"> & { levels: MonitorLevel[]; text: string }> = [
    {
      key: "opnameplanning",
      name: "Opnameplanning",
      dependsOn: ["Google Agenda"],
      dataFreshAt: markers.calendarAt,
      levels: [lvl("google_calendar")],
      text: fresh(markers.calendarAt, "Opnames uit de agenda bijgewerkt"),
    },
    {
      key: "scripting",
      name: "Scripting en scriptsynchronisatie",
      dependsOn: ["Google Drive"],
      dataFreshAt: by.get("google_drive")?.lastSuccessAt ?? null,
      levels: [lvl("google_drive"), jobLevel("scripts.version_sync", 14, 30)],
      text: fresh(by.get("google_drive")?.lastSuccessAt ?? null, "Scripts uit Drive bijgewerkt"),
    },
    {
      key: "editing",
      name: "Editing en Frame.io",
      dependsOn: ["Frame.io"],
      dataFreshAt: markers.frameAt,
      levels: [lvl("frameio")],
      text: fresh(markers.frameAt, "Video's bijgewerkt"),
    },
    {
      key: "contentplanning",
      name: "Contentplanning en publicatie",
      dependsOn: ["Metricool"],
      dataFreshAt: d(jobs.get("publications.metricool_reconcile")?.last_ok),
      levels: [lvl("metricool"), jobLevel("content.sync_from_videos", 30, 54)],
      text: fresh(d(jobs.get("publications.metricool_reconcile")?.last_ok) ?? d(jobs.get("content.sync_from_videos")?.last_ok), "Publicatiestatus bijgewerkt"),
    },
    {
      key: "klantportaal",
      name: "Klantportaal",
      dependsOn: ["Frame.io", "Google Drive", "Metricool"],
      dataFreshAt: markers.frameAt,
      levels: [lvl("frameio"), lvl("google_drive"), lvl("metricool")],
      text: "Video's, scripts en resultaten voor klanten",
    },
    {
      key: "resultaten",
      name: "Resultaten en maandrapportages",
      dependsOn: ["Metricool"],
      dataFreshAt: markers.metricsDay,
      levels: [lvl("metricool"), jobLevel("reports.generate_drafts", 30, 54)],
      text: markers.metricsDay ? `Statistieken t/m ${fmtDay(markers.metricsDay)}` : "Statistieken: nog geen gegevens",
    },
    {
      key: "taken",
      name: "Taken en interne workflows",
      dependsOn: ["Achtergrondtaken"],
      dataFreshAt: d(jobs.get("scripting.task_sync")?.last_ok),
      levels: [lvl("jobs") === "down" ? "down" : "ok", jobLevel("scripting.task_sync", 3, 8), jobLevel("signals.daily", 30, 54)],
      text: fresh(d(jobs.get("scripting.task_sync")?.last_ok), "Taken bijgewerkt"),
    },
  ];

  return list.map(({ levels, text, ...p }) => ({ ...p, level: worstLevel(levels), summary: text }));
}

// ---------------------------------------------------------------------------

function ago(date: Date | null, now: Date): string {
  if (!date) return "nooit";
  const mins = Math.round((now.getTime() - date.getTime()) / MIN);
  if (mins < 2) return "zojuist";
  if (mins < 90) return `${mins} minuten geleden`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h} uur geleden`;
  return `${Math.round(h / 24)} dagen geleden`;
}

function fmtDay(date: Date | null): string {
  if (!date) return "onbekend";
  return date.toLocaleDateString("nl-NL", { day: "numeric", month: "short", timeZone: "Europe/Amsterdam" });
}

function fmtDateTime(date: Date): string {
  return date.toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" });
}

function shortCalendarName(name: string): string {
  return /^[0-9a-f]{20,}/i.test(name) || name.includes("@group.calendar") ? `agenda ${name.slice(0, 8)}…` : `"${name}"`;
}
