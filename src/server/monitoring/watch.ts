import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { appSettings, notifications, users } from "@/db/schema";
import { logError } from "@/server/audit";
import { clearByDedupe } from "@/server/notifications";
import { metricool } from "@/server/integrations/metricool";
import { runCalendarSync } from "@/server/jobs/calendar-sync";
import { syncFrameLibrary } from "@/server/jobs/frameio-library";
import { pullMetricoolMetrics } from "@/server/jobs/metricool-sync";
import { runLeadImapSync } from "@/server/jobs/leads-imap-sync";
import { runPandaDocSync } from "@/server/jobs/pandadoc-sync";
import { processDriveChanges } from "@/server/jobs/drive-sync";
import {
  amsterdamParts,
  digestContent,
  digestDue,
  isRecurring,
  pruneHistory,
  recordRecovery,
  recoveryDue,
  stepIncidents,
  worstLevel,
  type Incident,
  type MonitorLevel,
  type Observation,
} from "@/lib/monitoring-rules";
import { runChecks, type IntegrationCheck, type ProcessCheck } from "./checks";
import { sendAlertMail } from "./mailer";

/**
 * De bewakingsronde (elk kwartier via Vercel Cron, dus ook als niemand is
 * ingelogd):
 *
 *  1. alle koppelingen en gegevensstromen meten;
 *  2. waar het veilig kan zelf herstellen (sync opnieuw starten), met oplopende
 *     wachttijd en nooit terwijl dezelfde sync al loopt;
 *  3. incidenten bijhouden (open, terugkerend, opgelost);
 *  4. alleen de beheerder melden, en alleen als het nodig is;
 *  5. één keer per dag een overzicht, maar alleen als er iets was.
 *
 * Alle synchronisaties die hier opnieuw gestart worden zijn idempotent (upsert
 * op externe id's), dus een herhaalpoging maakt nooit dubbele afspraken,
 * bestanden of video's aan.
 */

const STATE_KEY = "monitoring.state";
const LOCK_KEY = "monitoring.lock";
const RUN_BUDGET_MS = 200_000;

export type MonitorState = {
  open: Record<string, Incident>;
  history: Incident[];
  lastRunAt: string | null;
  lastLevel: MonitorLevel;
  lastDigestDay: string | null;
};

const EMPTY: MonitorState = { open: {}, history: [], lastRunAt: null, lastLevel: "ok", lastDigestDay: null };

export async function readMonitorState(): Promise<MonitorState> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, STATE_KEY)).limit(1);
  return { ...EMPTY, ...((row?.value as Partial<MonitorState>) ?? {}) };
}

async function writeMonitorState(state: MonitorState): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key: STATE_KEY, value: state, category: "monitoring", description: "Koppelingsbewaking: open incidenten en historie" })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: state, updatedAt: new Date() } });
}

/** Voorkomt dat twee bewakingsrondes (cron + knop) tegelijk draaien. */
async function acquireLock(owner: string, ms: number): Promise<boolean> {
  const until = new Date(Date.now() + ms).toISOString();
  const r = await db.execute(sql`
    insert into app_settings (key, value, category)
    values (${LOCK_KEY}, ${JSON.stringify({ until, owner })}::jsonb, 'monitoring')
    on conflict (key) do update set value = excluded.value, updated_at = now()
    where coalesce((app_settings.value->>'until')::timestamptz, 'epoch') < now()
    returning id`);
  const rows = ((r as { rows?: unknown[] }).rows ?? (r as unknown as unknown[])) as unknown[];
  return rows.length > 0;
}

async function releaseLock(owner: string): Promise<void> {
  await db.execute(sql`
    update app_settings set value = jsonb_set(value, '{until}', to_jsonb(now()::text))
    where key = ${LOCK_KEY} and value->>'owner' = ${owner}`);
}

/** Herstelacties die de bewaking zelf mag uitvoeren. Allemaal idempotent. */
const RECOVERY: Record<string, () => Promise<{ ok?: boolean } | unknown>> = {
  "calendar.sync": () => runCalendarSync(),
  "frameio.sync_library": () => syncFrameLibrary(),
  "metricool.pull_metrics": () => pullMetricoolMetrics(undefined, metricool, 7),
  "leads.sync_mailbox": () => runLeadImapSync(),
  "pandadoc.sync": () => runPandaDocSync(),
  "drive.sync_changes": () => processDriveChanges({ trigger: "monitor", budgetMs: 90_000 }),
};

function toObservation(c: IntegrationCheck): Observation {
  return { key: c.key, name: c.name, level: c.level, summary: c.summary, action: c.action, needsHuman: c.needsHuman, retryable: c.retryable && !!c.recoveryJob, core: c.core };
}

export type WatchResult = {
  ok: boolean;
  skipped?: "locked";
  level: MonitorLevel;
  recoveries: Array<{ key: string; job: string; ok: boolean }>;
  opened: string[];
  resolved: string[];
  criticalSent: string[];
  digestSent: boolean;
};

export async function runMonitorWatch(options: { force?: boolean; trigger?: string } = {}): Promise<WatchResult> {
  const owner = `${options.trigger ?? "cron"}:${Math.random().toString(36).slice(2, 10)}`;
  if (!(await acquireLock(owner, 4 * 60_000))) {
    return { ok: true, skipped: "locked", level: "ok", recoveries: [], opened: [], resolved: [], criticalSent: [], digestSent: false };
  }
  const started = Date.now();
  try {
    const state = await readMonitorState();
    const now = new Date();

    // 1. Meten.
    let { integrations } = await runChecks(now);
    const first = new Map(integrations.map((c) => [c.key, c]));

    // 2. Herstellen waar dat veilig kan.
    const recoveries: WatchResult["recoveries"] = [];
    for (const c of integrations) {
      if (Date.now() - started > RUN_BUDGET_MS) break;
      const obs = toObservation(c);
      if (!c.recoveryJob || !recoveryDue(state.open[c.key], obs, now, options.force)) continue;
      const runner = RECOVERY[c.recoveryJob];
      if (!runner) continue;
      if (await jobIsRunning(c.recoveryJob)) continue; // nooit dubbel synchroniseren
      let ok = false;
      try {
        const r = (await runner()) as { ok?: boolean } | undefined;
        ok = r?.ok !== false;
      } catch (error) {
        ok = false;
        await logError({ category: "integration", source: `monitor:recover:${c.recoveryJob}`, error }).catch(() => {});
      }
      recoveries.push({ key: c.key, job: c.recoveryJob, ok });
    }
    if (recoveries.length) ({ integrations } = await runChecks(new Date()));

    // 3. Incidenten bijwerken.
    const step = stepIncidents(state.open, integrations.map(toObservation), now);
    for (const r of recoveries) {
      if (step.open[r.key]) {
        step.open[r.key] = recordRecovery(step.open[r.key]!, r.ok, now);
        continue;
      }
      const done = step.resolved.find((x) => x.key === r.key);
      if (done) {
        Object.assign(done, recordRecovery(done, r.ok, now), { resolvedAt: now.toISOString() });
      } else if (r.ok && !state.open[r.key]) {
        // Ontstaan én opgelost in dezelfde ronde: klein probleem, wel in de historie.
        const c = first.get(r.key)!;
        step.resolved.push({
          ...recordRecovery(
            {
              key: c.key, name: c.name, level: c.level === "down" ? "down" : "warn", summary: c.summary, action: null,
              needsHuman: false, core: c.core, openedAt: now.toISOString(), lastSeenAt: now.toISOString(),
              recoveryAttempts: 0, lastRecoveryAt: null, lastRecoveryOk: null, nextRecoveryAt: null, criticalNotifiedAt: null,
            },
            true,
            now,
          ),
          resolvedAt: now.toISOString(),
          autoResolved: true,
        });
      }
    }

    // 4. Melden.
    const ownerIds = await ownerUserIds();
    const criticalSent: string[] = [];
    for (const inc of step.notifyCritical) {
      const recurring = isRecurring(inc.key, state.history, true, now);
      await inApp(ownerIds, {
        type: "integration_alert",
        level: "critical",
        title: `${inc.name} werkt niet`,
        body: [inc.summary, inc.action ? `Actie: ${inc.action}` : null].filter(Boolean).join("\n"),
        dedupeKey: alertKey(inc),
      });
      const mail = await sendAlertMail({
        subject: `Storing: ${inc.name} werkt niet`,
        heading: `${inc.name} werkt niet`,
        lines: [
          inc.summary,
          inc.needsHuman
            ? "Dit kan het portaal niet zelf herstellen."
            : `Het portaal heeft ${inc.recoveryAttempts || "meerdere keren"} geprobeerd dit zelf te herstellen, zonder resultaat.`,
          inc.action ? `Wat te doen: ${inc.action}` : "",
          recurring ? "Let op: dit probleem komt deze week vaker voor." : "",
        ].filter(Boolean),
      });
      if (!mail.ok) await logError({ category: "integration", source: "monitor:mail", error: new Error(mail.error ?? "mail mislukt") }).catch(() => {});
      criticalSent.push(inc.key);
    }
    for (const inc of step.notifyRecovered) {
      await clearByDedupe(alertKey(inc)).catch(() => {});
      await sendAlertMail({
        subject: `Hersteld: ${inc.name} werkt weer`,
        heading: `${inc.name} werkt weer`,
        lines: [`De storing die om ${fmt(inc.openedAt)} begon is opgelost. Gegevens worden weer bijgewerkt.`],
      });
    }

    // 5. Dagoverzicht (alleen als er iets was).
    const history = pruneHistory([...state.history, ...step.resolved], now);
    let digestSent = false;
    let lastDigestDay = state.lastDigestDay;
    if (digestDue(state.lastDigestDay, now)) {
      lastDigestDay = amsterdamParts(now).day;
      const content = digestContent(step.open, history, now);
      if (content) {
        const lagging = integrations.filter((c) => c.level === "warn").map((c) => `${c.name}: ${c.summary}`);
        const lines = [
          content.stillOpen.length
            ? `Nog open (${content.stillOpen.length}):\n${content.stillOpen.map((i) => `- ${i.name}: ${i.summary}${i.action ? ` Actie: ${i.action}` : ""}`).join("\n")}`
            : "Er staat niets meer open.",
          content.autoResolved.length
            ? `Automatisch opgelost (${content.autoResolved.length}):\n${content.autoResolved.map((i) => `- ${i.name} (${fmt(i.openedAt)}, ${i.recoveryAttempts} herstelpoging${i.recoveryAttempts === 1 ? "" : "en"})`).join("\n")}`
            : "",
          lagging.length ? `Synchronisaties die achterlopen:\n${lagging.map((l) => `- ${l}`).join("\n")}` : "",
        ].filter(Boolean);
        await inApp(ownerIds, {
          type: "integration_digest",
          level: content.stillOpen.length ? "warning" : "info",
          title: content.stillOpen.length ? `Koppelingen: ${content.stillOpen.length} punt(en) open` : "Koppelingen: alles weer in orde",
          body: lines.join("\n\n").slice(0, 2000),
          dedupeKey: `integration_digest:${lastDigestDay}`,
        });
        await sendAlertMail({
          subject: content.stillOpen.length
            ? `Dagoverzicht koppelingen: ${content.stillOpen.length} punt(en) open`
            : "Dagoverzicht koppelingen: alles weer in orde",
          heading: "Dagoverzicht koppelingen",
          lines,
        });
        digestSent = true;
      }
    }

    const level = worstLevel(integrations.filter((c) => c.key !== "mail").map((c) => c.level));
    await writeMonitorState({ open: step.open, history, lastRunAt: new Date().toISOString(), lastLevel: level, lastDigestDay });

    const opened = Object.keys(step.open).filter((k) => !state.open[k]);
    return { ok: true, level, recoveries, opened, resolved: step.resolved.map((r) => r.key), criticalSent, digestSent };
  } finally {
    await releaseLock(owner).catch(() => {});
  }
}

/** Status voor het dashboard: live metingen + incidentinformatie. */
export async function monitorOverview(now = new Date()): Promise<{
  integrations: Array<IntegrationCheck & { incident: Incident | null; recurring: boolean }>;
  processes: ProcessCheck[];
  state: MonitorState;
  level: MonitorLevel;
}> {
  const [{ integrations, processes }, state] = await Promise.all([runChecks(now), readMonitorState()]);
  return {
    integrations: integrations.map((c) => ({
      ...c,
      incident: state.open[c.key] ?? null,
      recurring: isRecurring(c.key, state.history, Boolean(state.open[c.key]), now),
    })),
    processes,
    state,
    level: worstLevel(integrations.filter((c) => c.key !== "mail").map((c) => c.level)),
  };
}

// ---------------------------------------------------------------------------

async function jobIsRunning(jobType: string): Promise<boolean> {
  const r = await db.execute(sql`
    select 1 from sync_jobs where job_type = ${jobType} and status = 'running'
      and started_at > now() - interval '15 minutes' limit 1`);
  return (((r as { rows?: unknown[] }).rows ?? (r as unknown as unknown[])) as unknown[]).length > 0;
}

async function ownerUserIds(): Promise<string[]> {
  const rows = await db.select({ id: users.id }).from(users)
    .where(and(eq(users.primaryRole, "owner"), eq(users.status, "active"), isNull(users.deletedAt)));
  return rows.map((r) => r.id);
}

/**
 * In-app melding uitsluitend voor de eigenaar(s). Bewust niet via notify():
 * die stuurt bij verlof ook naar de vervanger, en technische storingen horen
 * alleen bij de beheerder.
 */
async function inApp(
  userIds: string[],
  n: { type: string; level: "info" | "warning" | "critical"; title: string; body: string; dedupeKey: string },
): Promise<void> {
  if (!userIds.length) return;
  const existing = await db.select({ userId: notifications.userId }).from(notifications)
    .where(and(inArray(notifications.userId, userIds), eq(notifications.dedupeKey, n.dedupeKey)));
  const have = new Set(existing.map((e) => e.userId));
  const values = userIds.filter((id) => !have.has(id)).map((userId) => ({
    userId,
    type: n.type,
    level: n.level,
    title: n.title.slice(0, 240),
    body: n.body.slice(0, 2000),
    href: "/settings/koppelingsbewaking",
    dedupeKey: n.dedupeKey,
  }));
  if (values.length) await db.insert(notifications).values(values).onConflictDoNothing();
}

function alertKey(inc: Incident): string {
  return `integration_alert:${inc.key}:${inc.openedAt.slice(0, 16)}`;
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" });
}
