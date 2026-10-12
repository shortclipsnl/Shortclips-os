"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ilike, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, tasks, users } from "@/db/schema";
import { requireInternal, requirePermission, ForbiddenError } from "@/server/auth/context";
import { generateClientInsights } from "@/server/insights";

export type ActionResult = { ok: boolean; message?: string };

function wrap<T>(fn: () => Promise<T>) {
  return fn().catch((e) => {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message } as ActionResult;
    throw e;
  });
}

/** AI-resultatenanalyse voor een klant genereren (gated op de Anthropic-sleutel). */
export async function generateInsights(slug: string, days = 90): Promise<ActionResult> {
  return wrap(async () => {
    await requireInternal();
    const res = await generateClientInsights(slug, days);
    revalidatePath(`/analytics/${slug}`);
    if (res.ok) return { ok: true };
    if (res.reason === "no_provider") return { ok: false, message: "AI-koppeling staat uit (ANTHROPIC_API_KEY ontbreekt)." };
    if (res.reason === "no_data") return { ok: false, message: res.message };
    return { ok: false, message: res.message ?? "Analyse mislukt." };
  });
}

/** Een verbeterpunt doorzetten als taak naar een Content Creative (Milou/Jiska). */
export async function recommendationToTask(
  slug: string,
  rec: { titel: string; waarom: string; wat: string; hoeMeten: string },
): Promise<ActionResult> {
  return wrap(async () => {
    await requirePermission("tasks:write");
    const [client] = await db.select({ id: clients.id }).from(clients).where(and(eq(clients.slug, slug), isNull(clients.deletedAt))).limit(1);
    if (!client) return { ok: false, message: "Klant niet gevonden." };

    // Content Creative zoeken (Milou bij voorkeur, anders Jiska).
    const [creative] =
      (await db.select({ id: users.id }).from(users).where(and(ilike(users.fullName, "%milou%"), eq(users.status, "active"), isNull(users.deletedAt))).limit(1)).length
        ? await db.select({ id: users.id }).from(users).where(and(ilike(users.fullName, "%milou%"), eq(users.status, "active"), isNull(users.deletedAt))).limit(1)
        : await db.select({ id: users.id }).from(users).where(and(ilike(users.fullName, "%jiska%"), eq(users.status, "active"), isNull(users.deletedAt))).limit(1);

    await db.insert(tasks).values({
      clientId: client.id,
      title: `Verbeterpunt: ${rec.titel}`.slice(0, 240),
      description: `Waarom: ${rec.waarom}\n\nWat aanpassen: ${rec.wat}\n\nHoe meten: ${rec.hoeMeten}`,
      priority: "normal",
      status: "todo",
      assigneeId: creative?.id ?? null,
      entityType: "ai_insight",
    });

    revalidatePath("/tasks");
    revalidatePath(`/analytics/${slug}`);
    return { ok: true };
  });
}
