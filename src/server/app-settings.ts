import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { appSettings } from "@/db/schema";

/** Booleaanse app-instelling lezen (default als de sleutel ontbreekt). */
export async function getBoolSetting(key: string, fallback: boolean): Promise<boolean> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key)).limit(1);
  if (!row) return fallback;
  const v = row.value as { enabled?: boolean } | boolean;
  if (typeof v === "boolean") return v;
  return typeof v?.enabled === "boolean" ? v.enabled : fallback;
}

/** Numerieke app-instelling lezen (default als de sleutel ontbreekt of ongeldig is). */
export async function getNumberSetting(key: string, fallback: number): Promise<number> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key)).limit(1);
  if (!row) return fallback;
  const v = row.value as { value?: unknown } | number;
  const n = typeof v === "number" ? v : typeof v?.value === "number" ? v.value : Number((v as { value?: unknown })?.value);
  return Number.isFinite(n) ? n : fallback;
}

/** Numerieke app-instelling zetten. */
export async function setNumberSetting(
  key: string,
  value: number,
  opts: { category?: string; description?: string; updatedById?: string } = {},
): Promise<void> {
  await db
    .insert(appSettings)
    .values({
      key,
      value: { value },
      category: opts.category ?? "general",
      description: opts.description ?? null,
      updatedById: opts.updatedById ?? null,
    })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: { value }, updatedById: opts.updatedById ?? null, updatedAt: new Date() },
    });
}

/** Booleaanse app-instelling zetten. */
export async function setBoolSetting(
  key: string,
  enabled: boolean,
  opts: { category?: string; description?: string; updatedById?: string } = {},
): Promise<void> {
  await db
    .insert(appSettings)
    .values({
      key,
      value: { enabled },
      category: opts.category ?? "general",
      description: opts.description ?? null,
      updatedById: opts.updatedById ?? null,
    })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: { enabled }, updatedById: opts.updatedById ?? null, updatedAt: new Date() },
    });
}
