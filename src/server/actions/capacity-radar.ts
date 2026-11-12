"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { capacityParams, capacityPeople, users } from "@/db/schema";
import { requireOwner, ForbiddenError } from "@/server/auth/context";

export type RadarActionResult = { ok: boolean; message?: string };

const capSchema = z.object({
  userId: z.string().uuid(),
  kind: z.enum(["video", "edit"]),
  // Editors: video's per week. Videografen: dagen per week. Leeg = onbekend.
  value: z.coerce.number().min(0).max(60).nullable(),
});

/**
 * Capaciteit van één persoon vastleggen vanuit de capaciteitsradar (alleen de
 * eigenaar). Schrijft naar de bestaande capaciteitstabel: editors als
 * shorts per 4 weken, videografen als werkdagen per week. Bestaat er nog geen
 * regel voor deze persoon, dan wordt die aangemaakt of aan een regel met
 * dezelfde naam gekoppeld.
 */
export async function setRadarCapacity(input: z.input<typeof capSchema>): Promise<RadarActionResult> {
  try {
    await requireOwner();
    const parsed = capSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "Ongeldige waarde." };
    const { userId, kind, value } = parsed.data;

    const [user] = await db.select({ name: users.fullName }).from(users).where(eq(users.id, userId)).limit(1);
    if (!user) return { ok: false, message: "Persoon niet gevonden." };
    const first = user.name.trim().split(/\s+/)[0] ?? user.name;

    let [row] = await db.select().from(capacityPeople).where(eq(capacityPeople.userId, userId)).limit(1);
    if (!row) {
      [row] = await db.select().from(capacityPeople).where(and(isNull(capacityPeople.userId), eq(capacityPeople.name, first))).limit(1);
      if (row) await db.update(capacityPeople).set({ userId }).where(eq(capacityPeople.id, row.id));
    }

    const patch =
      kind === "edit"
        ? {
            unit: "shorts_4w",
            limitGreen: value == null ? null : (value * 4 * 0.8).toFixed(2),
            limitOrange: value == null ? null : (value * 4).toFixed(2),
            limitMax: value == null ? null : (value * 4).toFixed(2),
          }
        : { unit: "opnames_4w", workdaysPerWeek: value == null ? null : value.toFixed(1) };

    if (row) {
      await db.update(capacityPeople).set(patch).where(eq(capacityPeople.id, row.id));
    } else {
      await db.insert(capacityPeople).values({
        userId,
        name: first,
        employment: "freelance",
        role: kind === "edit" ? "Editor" : "Videograaf",
        ...patch,
      });
    }
    revalidatePath("/capaciteit");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    return { ok: false, message: "Opslaan mislukt." };
  }
}

const paramSchema = z.object({
  green: z.coerce.number().min(10).max(150),
  red: z.coerce.number().min(10).max(200),
  avgShoot: z.coerce.number().min(1).max(12),
  extraShoot: z.coerce.number().min(0).max(5),
});

/** Kleurgrenzen en rekenaannames van de radar (alleen de eigenaar). */
export async function setRadarSettings(input: z.input<typeof paramSchema>): Promise<RadarActionResult> {
  try {
    await requireOwner();
    const parsed = paramSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "Ongeldige waarde." };
    const p = parsed.data;
    if (p.red < p.green) return { ok: false, message: "Rood moet hoger liggen dan groen." };
    const rows: { key: string; label: string; value: number; unit: string }[] = [
      { key: "radar_green", label: "Capaciteitsradar: groen tot", value: p.green, unit: "%" },
      { key: "radar_red", label: "Capaciteitsradar: rood boven", value: p.red, unit: "%" },
      { key: "radar_avg_shoot", label: "Capaciteitsradar: gemiddelde opname incl. reistijd", value: p.avgShoot, unit: "uur" },
      { key: "radar_extra_shoot", label: "Capaciteitsradar: op- en afbouw per opname", value: p.extraShoot, unit: "uur" },
    ];
    for (const r of rows) {
      await db
        .insert(capacityParams)
        .values({ key: r.key, label: r.label, value: r.value.toFixed(4), unit: r.unit, confidence: "Bevestigd" })
        .onConflictDoUpdate({ target: capacityParams.key, set: { value: r.value.toFixed(4) } });
    }
    revalidatePath("/capaciteit");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    return { ok: false, message: "Opslaan mislukt." };
  }
}
