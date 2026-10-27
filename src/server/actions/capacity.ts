"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { capacityPeople } from "@/db/schema";
import { requireOwner, ForbiddenError } from "@/server/auth/context";

export type ActionResult = { ok: boolean; message?: string };

const schema = z.object({
  id: z.string().uuid(),
  // Lege invoer = grens wissen (null). Anders een positief getal.
  limitGreen: z.coerce.number().positive().max(100000).nullable(),
  limitOrange: z.coerce.number().positive().max(100000).nullable(),
  limitMax: z.coerce.number().positive().max(100000).nullable(),
});

/**
 * Capaciteitsgrenzen (groen/oranje/plafond) van één persoon aanpassen. Alleen de
 * eigenaar; hiermee stel je de werkelijke capaciteit realistisch in zodat de
 * weergave niet onnodig rood kleurt. De belasting zelf blijft automatisch
 * berekend — alleen de grenzen zijn handmatig.
 */
export async function updateCapacityLimits(input: z.input<typeof schema>): Promise<ActionResult> {
  try {
    await requireOwner();
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Ongeldige waarden." };
    const { id, limitGreen, limitOrange, limitMax } = parsed.data;

    // Oplopend houden waar ingevuld: groen ≤ oranje ≤ plafond.
    if (limitGreen !== null && limitOrange !== null && limitOrange < limitGreen) return { ok: false, message: "Oranje grens mag niet lager zijn dan groen." };
    if (limitOrange !== null && limitMax !== null && limitMax < limitOrange) return { ok: false, message: "Plafond mag niet lager zijn dan oranje." };
    if (limitGreen !== null && limitMax !== null && limitMax < limitGreen) return { ok: false, message: "Plafond mag niet lager zijn dan groen." };

    await db
      .update(capacityPeople)
      .set({
        limitGreen: limitGreen === null ? null : limitGreen.toFixed(2),
        limitOrange: limitOrange === null ? null : limitOrange.toFixed(2),
        limitMax: limitMax === null ? null : limitMax.toFixed(2),
      })
      .where(eq(capacityPeople.id, id));

    revalidatePath("/capaciteit");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}
