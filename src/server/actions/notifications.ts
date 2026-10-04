"use server";

import { revalidatePath } from "next/cache";
import { requireViewer } from "@/server/auth/context";
import { markRead } from "@/server/notifications";

export async function markAllRead(): Promise<{ ok: boolean }> {
  const viewer = await requireViewer();
  await markRead(viewer.id);
  revalidatePath("/notifications");
  return { ok: true };
}
