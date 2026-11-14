import "server-only";
import { desc, like } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { coachDocs } from "@/db/schema";
import type { CoachDag, CoachWeek } from "./types";

export async function getDoc<T>(path: string): Promise<T | null> {
  const [row] = await db.select({ data: coachDocs.data }).from(coachDocs).where(eq(coachDocs.path, path)).limit(1);
  return (row?.data as T) ?? null;
}

export async function putDoc(path: string, data: unknown): Promise<void> {
  await db
    .insert(coachDocs)
    .values({ path, data, updatedAt: new Date() })
    .onConflictDoUpdate({ target: coachDocs.path, set: { data, updatedAt: new Date() } });
}

export const getDag = (iso: string) => getDoc<CoachDag>(`dag/${iso}`);
export const getWeek = (id: string) => getDoc<CoachWeek>(`week/${id}`);

export async function mergeDag(iso: string, patch: Partial<CoachDag>): Promise<CoachDag> {
  const current = (await getDag(iso)) ?? { datum: iso };
  const next = { ...current, ...patch, datum: iso } as CoachDag;
  await putDoc(`dag/${iso}`, next);
  return next;
}

/** Laatste n dagdocumenten, nieuwste eerst. */
export async function recenteDagen(n: number): Promise<CoachDag[]> {
  const rows = await db
    .select({ data: coachDocs.data })
    .from(coachDocs)
    .where(like(coachDocs.path, "dag/%"))
    .orderBy(desc(coachDocs.path))
    .limit(n);
  return rows.map((r) => r.data as CoachDag);
}

export async function recenteWeken(n: number): Promise<CoachWeek[]> {
  const rows = await db
    .select({ data: coachDocs.data })
    .from(coachDocs)
    .where(like(coachDocs.path, "week/%"))
    .orderBy(desc(coachDocs.path))
    .limit(n);
  return rows.map((r) => r.data as CoachWeek);
}
