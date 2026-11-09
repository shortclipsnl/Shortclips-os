"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { clientExitInterviews, clients } from "@/db/schema";
import { assertClientAccess, requireTeamMember } from "@/server/auth/context";
import { EXIT_REASONS } from "@/lib/exit-interview";

export type ActionResult = { ok: boolean; message?: string };

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const score = z.number().int().min(1).max(10).nullable();
const tri = z.enum(["ja", "misschien", "nee"]).nullable();
const txt = (max: number) => z.string().trim().max(max).nullable().transform((v) => (v ? v : null));

const schema = z.object({
  clientId: z.string().uuid(),
  interviewDate: day,
  conductedById: z.string().uuid().nullable(),
  endDate: day,
  answers: z.partialRecord(z.enum(["q1", "q2", "q3", "q4", "q5", "q6", "q7"]), z.string().max(4000)),
  scoreResults: score,
  scoreCollaboration: score,
  scoreValue: score,
  primaryReason: z.enum(EXIT_REASONS).nullable(),
  secondaryReason: z.enum(EXIT_REASONS).nullable(),
  otherReason: txt(240),
  quote: txt(4000),
  interpretation: txt(4000),
  cause: z.enum(["shortclips", "klant", "beide"]).nullable(),
  preventable: tri,
  lesson: txt(2000),
  actions: z.array(z.object({
    action: z.string().trim().max(500),
    ownerId: z.string().uuid().nullable(),
    dueOn: day,
  })).max(10),
  futurePossible: tri,
  followUpOn: day,
});

export type SaveExitInterviewInput = z.input<typeof schema>;

/** Exitgesprek opslaan (aanmaken of bijwerken; één per klant). */
export async function saveExitInterview(input: SaveExitInterviewInput): Promise<ActionResult> {
  try {
    const viewer = await requireTeamMember();
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Controleer de invoer." };
    const d = parsed.data;
    assertClientAccess(viewer, d.clientId);
    if (d.secondaryReason && d.secondaryReason === d.primaryReason) {
      return { ok: false, message: "De secundaire reden moet anders zijn dan de primaire reden." };
    }

    const [client] = await db.select({ id: clients.id, slug: clients.slug }).from(clients)
      .where(and(eq(clients.id, d.clientId), isNull(clients.deletedAt))).limit(1);
    if (!client) return { ok: false, message: "Klant niet gevonden." };

    const answers = Object.fromEntries(Object.entries(d.answers).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
    const usesOther = d.primaryReason === "anders" || d.secondaryReason === "anders";
    const values = {
      interviewDate: d.interviewDate, conductedById: d.conductedById, endDate: d.endDate, answers,
      scoreResults: d.scoreResults, scoreCollaboration: d.scoreCollaboration, scoreValue: d.scoreValue,
      primaryReason: d.primaryReason, secondaryReason: d.secondaryReason, otherReason: usesOther ? d.otherReason : null,
      quote: d.quote, interpretation: d.interpretation, cause: d.cause, preventable: d.preventable, lesson: d.lesson,
      actions: d.actions.filter((a) => a.action),
      futurePossible: d.futurePossible, followUpOn: d.futurePossible === "nee" ? null : d.followUpOn,
      updatedById: viewer.id,
    };

    await db.insert(clientExitInterviews)
      .values({ clientId: client.id, ...values, createdById: viewer.id })
      .onConflictDoUpdate({ target: clientExitInterviews.clientId, set: { ...values, updatedAt: sql`now()` } });

    revalidatePath(`/clients/${client.slug}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Opslaan mislukt." };
  }
}
