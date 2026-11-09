import "server-only";
import { and, eq, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { driveMappings, syncJobs } from "@/db/schema";
import { drive } from "./drive";
import { mergeGoogleConfig, mergeGoogleTokenMeta, readGoogleConnection } from "./google-connection";
import { ACCOUNT_ENTITY, ACCOUNT_FOLDER } from "@/server/jobs/drive-sync";
import { notifyTechnical } from "@/server/notification-digest";

/**
 * Gezondheid van de Google Drive-koppeling, in drie niveaus:
 *
 *  1. Tijdelijke storing → wordt binnen de run al herhaald (backoff). Geen
 *     melding, geen zichtbaar effect.
 *  2. Structureel probleem (meerdere runs achter elkaar mislukt, of al een
 *     half uur geen geslaagde sync) → "Aandacht nodig" op de statuspagina; de
 *     sync blijft het automatisch proberen. Geen melding.
 *  3. Verbinding echt verbroken (toestemming ingetrokken/verlopen, of 6 uur
 *     niets gelukt) → één melding aan Jarno met oorzaak en actie. Dezelfde
 *     melding komt niet opnieuw zolang de toestand niet verandert.
 */

export type DriveConnectionState = "actief" | "aandacht" | "verbroken" | "niet_ingesteld";
export type DriveSyncState = "actueel" | "bezig" | "fout";

export type DriveStatus = {
  connection: DriveConnectionState;
  sync: DriveSyncState;
  lastSuccessAt: Date | null;
  lastCheckAt: Date | null;
  /** null = kon niet bepaald worden; `more` = er zijn er meer dan getoond. */
  pending: { count: number; more: boolean } | null;
  failed24h: number;
  consecutiveFailures: number;
  account: string | null;
  foldersTotal: number;
  foldersNotVerified: number;
  reason: string | null;
  action: string | null;
  canReconnect: boolean;
};

const ATTENTION_AFTER_MS = 30 * 60_000;
const BROKEN_AFTER_MS = 6 * 60 * 60_000;

function rows<T>(r: unknown): T[] {
  return ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];
}

export async function getDriveStatus(options: { peekPending?: boolean } = {}): Promise<DriveStatus> {
  const now = Date.now();
  const conn = await readGoogleConnection();
  const [cursor] = await db
    .select()
    .from(driveMappings)
    .where(and(eq(driveMappings.entityType, ACCOUNT_ENTITY), eq(driveMappings.folderId, ACCOUNT_FOLDER)))
    .limit(1);

  const [folderStats] = rows<{ total: number; unverified: number }>(
    await db.execute(sql`
      select count(*)::int total,
             count(*) filter (where last_full_sync_at is null or last_full_sync_at < now() - interval '48 hours')::int unverified
      from drive_mappings where entity_type = 'client' and entity_id is not null`),
  );
  const [failed] = rows<{ n: number }>(
    await db.execute(sql`
      select count(*)::int n from sync_jobs
      where provider = 'google_drive' and status = 'error' and started_at >= now() - interval '24 hours'`),
  );

  const lastSuccessAt = conn?.lastSyncAt ?? null;
  const lastCheckAt = conn?.lastCheckedAt ?? null;
  const consecutiveFailures = conn?.errorCount ?? 0;
  const authState = conn?.tokenMeta.authState;
  const running = Boolean(cursor?.leaseUntil && cursor.leaseUntil.getTime() > now);

  let pending: DriveStatus["pending"] = null;
  if (options.peekPending && cursor?.pageToken && drive.isConfigured && authState !== "reauth_required") {
    try {
      const page = await Promise.race([
        drive.changes(cursor.pageToken),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000)),
      ]);
      pending = { count: page.changes.length, more: Boolean(page.nextPageToken) };
    } catch {
      pending = null;
    }
  }

  const age = lastSuccessAt ? now - lastSuccessAt.getTime() : Infinity;
  let connection: DriveConnectionState = "actief";
  let reason: string | null = null;
  let action: string | null = null;
  let canReconnect = false;

  if (!drive.isConfigured) {
    connection = "niet_ingesteld";
    reason = "De Google-gegevens ontbreken in de serverconfiguratie.";
    action = "Vul GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET en GOOGLE_REFRESH_TOKEN in bij Vercel.";
  } else if (authState === "reauth_required") {
    connection = "verbroken";
    reason = "Google heeft de toestemming ingetrokken of laten verlopen.";
    action = "Klik op 'Opnieuw verbinden' en log in met het zakelijke Google-account.";
    canReconnect = true;
  } else if (authState === "config_error") {
    connection = "verbroken";
    reason = conn?.tokenMeta.authMessage ?? "De OAuth-configuratie bij Google klopt niet.";
    action = "Controleer client-ID en secret in Google Cloud en Vercel.";
  } else if (age > BROKEN_AFTER_MS) {
    connection = "verbroken";
    reason = lastSuccessAt
      ? `Al meer dan 6 uur geen geslaagde synchronisatie. Laatste fout: ${conn?.lastErrorMessage ?? "onbekend"}.`
      : "Er is nog geen geslaagde synchronisatie geweest.";
    action = "Start een handmatige synchronisatie. Lukt dat niet, gebruik 'Opnieuw verbinden'.";
    canReconnect = true;
  } else if (consecutiveFailures >= 3 || age > ATTENTION_AFTER_MS) {
    connection = "aandacht";
    reason = `De laatste ${consecutiveFailures || "paar"} pogingen zijn mislukt; het systeem probeert het automatisch opnieuw.`;
  } else if ((folderStats?.unverified ?? 0) > 0 && (folderStats?.total ?? 0) > 0) {
    // Feed werkt, maar het vangnet loopt achter: geen storing, wel zichtbaar.
    reason = null;
  }

  const sync: DriveSyncState = running
    ? "bezig"
    : consecutiveFailures > 0 || connection === "verbroken"
      ? "fout"
      : "actueel";

  return {
    connection,
    sync,
    lastSuccessAt,
    lastCheckAt,
    pending,
    failed24h: failed?.n ?? 0,
    consecutiveFailures,
    account: conn?.tokenMeta.accountEmail ?? null,
    foldersTotal: folderStats?.total ?? 0,
    foldersNotVerified: folderStats?.unverified ?? 0,
    reason,
    action,
    canReconnect,
  };
}

/**
 * Bewakingsronde (elke 15 minuten):
 *  - sluit runs af die door een servertime-out nooit zijn afgerond;
 *  - legt het gekoppelde account vast voor de statuspagina;
 *  - meldt een échte verbreking één keer (niveau 3).
 */
export async function runDriveHealthCheck() {
  // Runs die langer dan 15 minuten op 'running' staan zijn afgebroken.
  const aborted = await db
    .update(syncJobs)
    .set({ status: "error", finishedAt: new Date(), error: "Afgebroken: de server stopte de run (time-out)." })
    .where(
      and(
        eq(syncJobs.status, "running"),
        isNotNull(syncJobs.startedAt),
        lt(syncJobs.startedAt, new Date(Date.now() - 15 * 60_000)),
      ),
    )
    .returning({ id: syncJobs.id });

  if (drive.isConfigured) {
    const conn = await readGoogleConnection();
    if (conn?.tokenMeta.authState !== "reauth_required") {
      try {
        const about = await drive.about();
        if (about.emailAddress && about.emailAddress !== conn?.tokenMeta.accountEmail) {
          await mergeGoogleTokenMeta({ accountEmail: about.emailAddress });
        }
      } catch {
        // De status hieronder pakt een echte storing op.
      }
    }
  }

  const status = await getDriveStatus();
  const conn = await readGoogleConnection();
  const alerted = conn?.config.alertedState;
  let notified = false;

  if (status.connection === "verbroken" && alerted !== "verbroken") {
    await notifyTechnical(`Google Drive is niet verbonden. ${status.reason ?? ""} Actie: ${status.action ?? "controleer de koppeling"}`.trim(), "critical");
    await mergeGoogleConfig({ alertedState: "verbroken", alertedAt: new Date().toISOString() });
    notified = true;
  } else if (status.connection === "actief" && alerted) {
    // Hersteld: volgende verbreking mag weer gemeld worden.
    await mergeGoogleConfig({ alertedState: null, alertedAt: null });
  }

  return { ok: true, connection: status.connection, abortedJobs: aborted.length, notified };
}
