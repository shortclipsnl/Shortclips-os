"use server";

import { requireInternal } from "@/server/auth/context";
import { recordActivity } from "@/server/audit";

/**
 * Beslissingshulp: leg een zoekopdracht vast die niets opleverde. Zo ziet de
 * eigenaar welke woorden het team gebruikt en welke situaties nog ontbreken.
 * Geen klant gekoppeld, dus het komt nooit op een klanttijdlijn of in het portaal.
 */
export async function logZoekZonderResultaat(zoekopdracht: string, rol: string): Promise<void> {
  const viewer = await requireInternal();
  const q = String(zoekopdracht ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (q.length < 3) return;
  await recordActivity({
    clientId: null,
    type: "beslissingshulp.zoek_geen_resultaat",
    entityType: "beslissingshulp",
    title: q,
    metadata: { rol: ["cc", "vg", "bi"].includes(rol) ? rol : "onbekend" },
    actor: { id: viewer.id, fullName: viewer.fullName },
    isClientVisible: false,
  });
}
