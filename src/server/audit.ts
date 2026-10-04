import "server-only";
import { headers } from "next/headers";
import { db } from "@/db/client";
import { activityEvents, auditLogs, errorLogs } from "@/db/schema";
import type { Viewer } from "./auth/context";

/** Velden die nooit in een log terecht mogen komen. */
const REDACTED = [
  "password",
  "passwordHash",
  "password_hash",
  "token",
  "tokenHash",
  "secret",
  "apiKey",
  "refreshToken",
];

function sanitize(input: unknown): unknown {
  if (input === null || typeof input !== "object") return input;
  if (Array.isArray(input)) return input.map(sanitize);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    out[key] = REDACTED.some((r) => key.toLowerCase().includes(r.toLowerCase()))
      ? "[verborgen]"
      : sanitize(value);
  }
  return out;
}

async function requestMeta() {
  try {
    const h = await headers();
    return {
      ip:
        h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        h.get("x-real-ip") ??
        null,
      userAgent: h.get("user-agent"),
    };
  } catch {
    return { ip: null, userAgent: null };
  }
}

export async function auditLog(params: {
  viewer?: Viewer | null;
  action: string;
  entityType?: string;
  entityId?: string | null;
  clientId?: string | null;
  changes?: Record<string, unknown>;
  outcome?: "allow" | "deny";
}): Promise<void> {
  const meta = await requestMeta();
  await db.insert(auditLogs).values({
    actorUserId: params.viewer?.id ?? null,
    actorEmail: params.viewer?.email ?? null,
    action: params.action,
    entityType: params.entityType ?? null,
    entityId: params.entityId ?? null,
    clientId: params.clientId ?? null,
    changes: (sanitize(params.changes ?? {}) ?? {}) as Record<string, unknown>,
    ipAddress: meta.ip,
    userAgent: meta.userAgent,
    outcome: params.outcome ?? "allow",
  });
}

/**
 * Zet een gebeurtenis op de klanttijdlijn. Bewust apart van de audit log:
 * audit is voor beveiliging en herleidbaarheid, de tijdlijn is voor het team
 * en (waar toegestaan) de klant.
 */
export async function recordActivity(params: {
  clientId: string | null;
  type: string;
  title: string;
  body?: string | null;
  entityType?: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  actor?: { id: string; fullName: string } | null;
  isClientVisible?: boolean;
  occurredAt?: Date;
}): Promise<void> {
  await db.insert(activityEvents).values({
    clientId: params.clientId,
    type: params.type,
    title: params.title,
    body: params.body ?? null,
    entityType: params.entityType ?? null,
    entityId: params.entityId ?? null,
    metadata: (params.metadata ?? {}) as Record<string, unknown>,
    actorUserId: params.actor?.id ?? null,
    actorName: params.actor?.fullName ?? null,
    isClientVisible: params.isClientVisible ?? false,
    occurredAt: params.occurredAt ?? new Date(),
  });
}

export async function logError(params: {
  category: "application" | "integration" | "auth" | "sync" | "user" | "job";
  source?: string;
  error: unknown;
  context?: Record<string, unknown>;
  userId?: string | null;
}): Promise<void> {
  const err = params.error;
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : null;
  try {
    await db.insert(errorLogs).values({
      category: params.category,
      source: params.source ?? null,
      message,
      stack: stack ?? null,
      context: (sanitize(params.context ?? {}) ?? {}) as Record<string, unknown>,
      userId: params.userId ?? null,
    });
  } catch {
    // Als loggen zelf faalt mag dat de gebruiker nooit raken.
    console.error("[shortclips-os] kon fout niet loggen:", message);
  }
}
