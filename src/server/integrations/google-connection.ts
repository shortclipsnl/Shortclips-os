import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { integrationConnections } from "@/db/schema";
import { env } from "@/lib/env";

/**
 * Opslag van de centrale Google-verbinding (Drive, Agenda en Gmail delen één
 * OAuth-toestemming van het zakelijke account). Alles staat op de rij
 * `integration_connections` met provider `google_drive`.
 *
 * Het refresh-token staat hier alleen VERSLEUTELD (AES-256-GCM, sleutel
 * afgeleid van SESSION_SECRET). Het wordt alleen gezet via de
 * herverbind-knop in het portaal of bij tokenrotatie door Google. Zonder
 * opgeslagen token valt de app terug op GOOGLE_REFRESH_TOKEN uit de omgeving.
 */

export type GoogleAuthState = "ok" | "reauth_required" | "config_error";

export type GoogleTokenMeta = {
  refreshTokenEnc?: string;
  refreshTokenSetAt?: string;
  refreshTokenSource?: "portal" | "rotation";
  accountEmail?: string;
  scopes?: string;
  lastRefreshAt?: string;
  authState?: GoogleAuthState;
  authStateSince?: string;
  authMessage?: string;
};

export type GoogleConnectionConfig = {
  /** Laatste status waarover de eigenaar een melding kreeg (dedupe). */
  alertedState?: string | null;
  alertedAt?: string | null;
};

const PROVIDER = "google_drive" as const;

/* ---------------- versleuteling ---------------- */

function encryptionKey(): Buffer {
  const secret = env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET ontbreekt; tokens kunnen niet veilig worden opgeslagen.");
  return Buffer.from(hkdfSync("sha256", secret, "shortclips-google", "refresh-token-v1", 32));
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

/** Geeft null als het niet te ontsleutelen is (bijv. na wisselen SESSION_SECRET). */
export function decryptSecret(blob: string | undefined | null): string | null {
  if (!blob) return null;
  const [v, iv, tag, ct] = blob.split(".");
  if (v !== "v1" || !iv || !tag || !ct) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/* ---------------- rij lezen / schrijven ---------------- */

/** Zorgt dat de verbindingsrij bestaat (in productie ontbrak die). */
export async function ensureConnectionRow(provider: typeof integrationConnections.$inferInsert.provider) {
  await db
    .insert(integrationConnections)
    .values({ provider, status: "not_configured" })
    .onConflictDoNothing({ target: integrationConnections.provider });
}

export async function readGoogleConnection(): Promise<{
  status: string;
  tokenMeta: GoogleTokenMeta;
  config: GoogleConnectionConfig;
  lastCheckedAt: Date | null;
  lastSyncAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorMessage: string | null;
  /** Aantal opeenvolgende mislukte Drive-runs. */
  errorCount: number;
} | null> {
  const [row] = await db
    .select()
    .from(integrationConnections)
    .where(eq(integrationConnections.provider, PROVIDER))
    .limit(1);
  if (!row) return null;
  return {
    status: row.status,
    tokenMeta: (row.tokenMeta ?? {}) as GoogleTokenMeta,
    config: (row.config ?? {}) as GoogleConnectionConfig,
    lastCheckedAt: row.lastCheckedAt,
    lastSyncAt: row.lastSyncAt,
    lastErrorAt: row.lastErrorAt,
    lastErrorMessage: row.lastErrorMessage,
    errorCount: row.errorCount,
  };
}

/** Voegt velden samen in token_meta (jsonb ||), zonder andere velden te wissen. */
export async function mergeGoogleTokenMeta(patch: Partial<GoogleTokenMeta>) {
  await ensureConnectionRow(PROVIDER);
  await db
    .update(integrationConnections)
    .set({
      tokenMeta: sql`${integrationConnections.tokenMeta} || ${JSON.stringify(patch)}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(integrationConnections.provider, PROVIDER));
}

export async function mergeGoogleConfig(patch: Partial<GoogleConnectionConfig>) {
  await ensureConnectionRow(PROVIDER);
  await db
    .update(integrationConnections)
    .set({
      config: sql`${integrationConnections.config} || ${JSON.stringify(patch)}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(integrationConnections.provider, PROVIDER));
}

export async function storedRefreshToken(): Promise<string | null> {
  const conn = await readGoogleConnection();
  return decryptSecret(conn?.tokenMeta.refreshTokenEnc);
}

export async function saveRefreshToken(
  refreshToken: string,
  source: "portal" | "rotation",
  extra: Partial<GoogleTokenMeta> = {},
) {
  await mergeGoogleTokenMeta({
    ...extra,
    refreshTokenEnc: encryptSecret(refreshToken),
    refreshTokenSetAt: new Date().toISOString(),
    refreshTokenSource: source,
  });
}

/** Legt de authenticatiestatus vast. Schrijft alleen bij een echte wijziging. */
export async function setGoogleAuthState(state: GoogleAuthState, message?: string) {
  const conn = await readGoogleConnection();
  const prev = conn?.tokenMeta.authState;
  if (prev === state && (conn?.tokenMeta.authMessage ?? undefined) === (message ?? undefined)) return;
  await mergeGoogleTokenMeta({
    authState: state,
    authStateSince: prev === state ? conn?.tokenMeta.authStateSince : new Date().toISOString(),
    authMessage: message,
  });
  if (state !== "ok") {
    await db
      .update(integrationConnections)
      .set({
        status: "disconnected",
        lastErrorAt: new Date(),
        lastErrorMessage: message ?? null,
        updatedAt: new Date(),
      })
      .where(eq(integrationConnections.provider, PROVIDER));
  }
}
