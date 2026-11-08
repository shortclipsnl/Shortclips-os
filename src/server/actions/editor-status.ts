"use server";

import { revalidatePath } from "next/cache";
import { requireViewer } from "@/server/auth/context";
import { answerStatusCheck } from "@/server/editor-status-checks";
import { isEditorProgressStatus } from "@/lib/editor-status-check";
import { clearByDedupe } from "@/server/notifications";

/**
 * Editor geeft met één klik zijn status door op een statuscheck. Alleen de editor
 * van de check zelf (gecontroleerd in answerStatusCheck). De bijbehorende melding
 * verdwijnt, en de Editing-pagina van het team toont direct de nieuwe stand.
 */
export async function submitEditorStatus(
  checkId: string,
  status: string,
  note?: string | null,
): Promise<{ ok: boolean; message?: string }> {
  const viewer = await requireViewer();
  if (!isEditorProgressStatus(status)) return { ok: false, message: "Kies een van de drie statussen." };
  const res = await answerStatusCheck(viewer.id, checkId, status, note ?? null);
  if (!res.ok) return res;
  for (const id of res.checkIds) await clearByDedupe(`editor_status_check:${id}`).catch(() => {});
  revalidatePath("/dashboard");
  revalidatePath("/videos");
  return { ok: true };
}
