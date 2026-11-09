import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clientExitInterviews, contracts, users } from "@/db/schema";
import { EMPTY_EXIT_INTERVIEW, type ExitAction, type ExitInterviewData } from "@/lib/exit-interview";

export type ExitInterviewView = {
  data: ExitInterviewData;
  exists: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
};

/** Het exitgesprek van één klant, of een leeg formulier met de contracteinddatum alvast ingevuld. */
export async function getExitInterview(clientId: string): Promise<ExitInterviewView> {
  const [row] = await db
    .select({ i: clientExitInterviews, updatedBy: users.fullName })
    .from(clientExitInterviews)
    .leftJoin(users, eq(users.id, clientExitInterviews.updatedById))
    .where(eq(clientExitInterviews.clientId, clientId))
    .limit(1);

  if (!row) {
    const [k] = await db
      .select({ endsOn: contracts.endsOn })
      .from(contracts)
      .where(and(eq(contracts.clientId, clientId), isNull(contracts.deletedAt)))
      .orderBy(desc(contracts.endsOn))
      .limit(1);
    return { data: { ...EMPTY_EXIT_INTERVIEW, endDate: k?.endsOn ?? null }, exists: false, updatedAt: null, updatedBy: null };
  }

  const i = row.i;
  return {
    exists: true,
    updatedAt: i.updatedAt.toISOString(),
    updatedBy: row.updatedBy?.trim().split(/\s+/)[0] ?? null,
    data: {
      interviewDate: i.interviewDate, conductedById: i.conductedById, endDate: i.endDate,
      answers: (i.answers ?? {}) as ExitInterviewData["answers"],
      scoreResults: i.scoreResults, scoreCollaboration: i.scoreCollaboration, scoreValue: i.scoreValue,
      primaryReason: i.primaryReason, secondaryReason: i.secondaryReason, otherReason: i.otherReason,
      quote: i.quote, interpretation: i.interpretation,
      cause: i.cause as ExitInterviewData["cause"], preventable: i.preventable as ExitInterviewData["preventable"],
      lesson: i.lesson, actions: (i.actions ?? []) as ExitAction[],
      futurePossible: i.futurePossible as ExitInterviewData["futurePossible"], followUpOn: i.followUpOn,
    },
  };
}
