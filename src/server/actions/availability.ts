"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { requireInternal } from "@/server/auth/context";
import { describePeriod, type AvailabilityPeriod } from "@/lib/availability";

export type ActionResult = { ok: boolean; message?: string };
export type { AvailabilityPeriod };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Normaliseert en valideert de door de gebruiker opgegeven items. */
function sanitize(entries: unknown): AvailabilityPeriod[] {
  if (!Array.isArray(entries)) return [];
  const out: AvailabilityPeriod[] = [];
  for (const raw of entries.slice(0, 40)) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as Record<string, unknown>;
    const from = typeof e.from === "string" && ISO_DATE.test(e.from) ? e.from : null;
    let to = typeof e.to === "string" && ISO_DATE.test(e.to) ? e.to : null;
    // Einde vóór begin → negeren; gelijk aan begin → losse dag.
    if (from && to && to < from) to = null;
    const label = typeof e.label === "string" && e.label.trim() ? e.label.trim().slice(0, 80) : null;
    const note = typeof e.note === "string" ? e.note.trim().slice(0, 160) : "";
    // Een item moet óf een datum óf een omschrijving hebben; anders overslaan.
    if (!from && !label && !note) continue;
    out.push({ id: randomUUID(), from, to: from ? to : null, label: from ? null : label, note });
  }
  return out;
}

/** Afgeleide, leesbare tekst voor team-/capaciteitsoverzichten. Eén item per regel. */
function toNote(entries: AvailabilityPeriod[]): string {
  return entries
    .map((p) => {
      const periode = describePeriod(p);
      return p.note ? `${periode}: ${p.note}` : periode;
    })
    .join("\n")
    .slice(0, 500);
}

/**
 * Gestructureerde beschikbaarheid opslaan: per item een periode + wat er geldt.
 * Alleen voor jezelf. We bewaren de items (JSON) én leiden er een leesbare
 * tekst uit af in availabilityNote, zodat de team- en capaciteitsoverzichten
 * ongewijzigd blijven werken.
 */
export async function setMyAvailabilityPeriods(entries: AvailabilityPeriod[]): Promise<ActionResult> {
  const viewer = await requireInternal();
  const clean = sanitize(entries);
  await db
    .update(users)
    .set({ availabilityPeriods: clean, availabilityNote: toNote(clean) || null, updatedAt: new Date() })
    .where(eq(users.id, viewer.id));
  revalidatePath("/dashboard");
  revalidatePath("/team");
  revalidatePath("/capaciteit");
  return { ok: true };
}

/**
 * Oude, vrije beschikbaarheidsnotitie opslaan. Behouden voor compatibiliteit;
 * de nieuwe invoer loopt via setMyAvailabilityPeriods.
 */
export async function setMyAvailabilityNote(note: string): Promise<ActionResult> {
  const viewer = await requireInternal();
  const trimmed = note.trim().slice(0, 500);
  await db
    .update(users)
    .set({ availabilityNote: trimmed || null, updatedAt: new Date() })
    .where(eq(users.id, viewer.id));
  revalidatePath("/dashboard");
  return { ok: true };
}
