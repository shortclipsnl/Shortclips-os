"use server";

import { requireInternal } from "@/server/auth/context";
import { getActiveAiTasks, type ActiveAiTasks } from "@/server/ai-tasks";

/** Pollbare status van de lopende AI-taken voor de header-indicator. */
export async function fetchActiveAiTasks(): Promise<ActiveAiTasks> {
  const viewer = await requireInternal();
  return getActiveAiTasks(viewer);
}
