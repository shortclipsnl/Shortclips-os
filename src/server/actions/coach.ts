"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/server/auth/context";
import { maakAvond, maakOchtend, maakWeek } from "@/server/coach/engine";
import { getDag, mergeDag } from "@/server/coach/store";
import { amsDate } from "@/server/coach/time";
import type { Actie } from "@/server/coach/types";

/** Coach: alle acties alleen voor de eigenaar; elke actie controleert dat zelf. */

export type CoachActionState = { ok: boolean; message?: string };

const fout = (e: unknown): CoachActionState => ({ ok: false, message: e instanceof Error ? e.message : "Er ging iets mis." });

export async function ochtendNu(_prev: CoachActionState): Promise<CoachActionState> {
  await requireOwner();
  try {
    await maakOchtend(amsDate());
    revalidatePath("/coach");
    return { ok: true, message: "Ochtendcontrole staat klaar." };
  } catch (e) {
    return fout(e);
  }
}

const optNum = z.union([z.coerce.number().int().min(0).max(200), z.literal("")]).optional().transform((v) => (v === "" || v == null ? null : v));
const avondSchema = z.object({
  gedaan: z.string().trim().min(3, "Vul in wat je vandaag hebt gedaan.").max(4000),
  uitkomsten: z.string().trim().max(4000).default(""),
  salesgesprekken: optNum,
  offertesOpgevolgd: optNum,
  verspild: z.string().trim().max(2000).default(""),
});

export async function avondIndienen(_prev: CoachActionState, form: FormData): Promise<CoachActionState> {
  await requireOwner();
  const parsed = avondSchema.safeParse({
    gedaan: form.get("gedaan") ?? "",
    uitkomsten: form.get("uitkomsten") ?? "",
    salesgesprekken: form.get("salesgesprekken") ?? "",
    offertesOpgevolgd: form.get("offertesOpgevolgd") ?? "",
    verspild: form.get("verspild") ?? "",
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Controleer je invoer." };
  try {
    const a = await maakAvond(amsDate(), { ...parsed.data, ingevuldOp: new Date().toISOString() });
    revalidatePath("/coach");
    return { ok: true, message: `Je dag is beoordeeld: ${a.gewogen.toLocaleString("nl-NL")}.` };
  } catch (e) {
    return fout(e);
  }
}

export async function weekNu(_prev: CoachActionState): Promise<CoachActionState> {
  await requireOwner();
  try {
    const w = await maakWeek(amsDate());
    revalidatePath("/coach");
    return { ok: true, message: `Weekrapport ${w.id} staat klaar.` };
  } catch (e) {
    return fout(e);
  }
}

const STATUSSEN = ["open", "gehaald", "deels", "niet"] as const;

export async function zetActieStatus(datum: string, index: number, status: string): Promise<void> {
  await requireOwner();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum) || !STATUSSEN.includes(status as (typeof STATUSSEN)[number])) return;
  const dag = await getDag(datum);
  if (!dag?.ochtend?.acties?.[index]) return;
  const acties: Actie[] = dag.ochtend.acties.map((a, i) => (i === index ? { ...a, status: status as Actie["status"] } : a));
  await mergeDag(datum, { ochtend: { ...dag.ochtend, acties } });
  revalidatePath("/coach");
}
