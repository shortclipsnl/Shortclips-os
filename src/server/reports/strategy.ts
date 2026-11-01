import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { clientStrategyProfiles } from "@/db/schema";

/** De doelstellingen die een klant met organische short video kan nastreven. */
export const GOAL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "bekendheid", label: "Meer naamsbekendheid" },
  { value: "bereik", label: "Meer bereik" },
  { value: "volgers", label: "Meer volgers" },
  { value: "sollicitanten", label: "Meer sollicitanten" },
  { value: "websitebezoek", label: "Meer websitebezoek" },
  { value: "aanvragen", label: "Meer aanvragen" },
  { value: "verkoop", label: "Meer verkoop" },
  { value: "vertrouwen", label: "Vertrouwen opbouwen" },
  { value: "werkgeverschap", label: "Sterker werkgeversmerk" },
];

export function goalLabel(value: string | null | undefined): string {
  if (!value) return "";
  return GOAL_OPTIONS.find((g) => g.value === value)?.label ?? value;
}

export type StrategyProfile = {
  primaryGoal: string | null;
  secondaryGoals: string[];
  strategyNote: string;
};

export const EMPTY_STRATEGY: StrategyProfile = { primaryGoal: null, secondaryGoals: [], strategyNote: "" };

export async function loadStrategyProfile(clientId: string): Promise<StrategyProfile> {
  const [row] = await db
    .select({ primaryGoal: clientStrategyProfiles.primaryGoal, secondaryGoals: clientStrategyProfiles.secondaryGoals, strategyNote: clientStrategyProfiles.strategyNote })
    .from(clientStrategyProfiles)
    .where(eq(clientStrategyProfiles.clientId, clientId))
    .limit(1);
  if (!row) return { ...EMPTY_STRATEGY };
  return {
    primaryGoal: row.primaryGoal ?? null,
    secondaryGoals: Array.isArray(row.secondaryGoals) ? (row.secondaryGoals as string[]) : [],
    strategyNote: row.strategyNote ?? "",
  };
}

export async function saveStrategyProfile(input: {
  clientId: string;
  primaryGoal: string | null;
  secondaryGoals: string[];
  strategyNote: string;
  updatedById?: string | null;
}): Promise<void> {
  const now = new Date();
  const values = {
    primaryGoal: input.primaryGoal,
    secondaryGoals: input.secondaryGoals as unknown as Record<string, unknown>,
    strategyNote: input.strategyNote,
    updatedById: input.updatedById ?? null,
    updatedAt: now,
  };
  await db
    .insert(clientStrategyProfiles)
    .values({ clientId: input.clientId, ...values })
    .onConflictDoUpdate({ target: clientStrategyProfiles.clientId, set: values });
}

export function strategyToText(p: StrategyProfile): string {
  const lines: string[] = [];
  if (p.primaryGoal) lines.push(`Primaire doelstelling: ${goalLabel(p.primaryGoal)}`);
  if (p.secondaryGoals.length) lines.push(`Secundaire doelstellingen: ${p.secondaryGoals.map(goalLabel).join(", ")}`);
  if (p.strategyNote.trim()) lines.push(`Strategie: ${p.strategyNote.trim()}`);
  return lines.join("\n");
}
