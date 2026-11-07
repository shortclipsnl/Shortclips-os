import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { attentionStates, users } from "@/db/schema";
import { viewerForUser } from "@/server/auth/context";
import { getAttentionBoard } from "@/server/attention";
import { notify } from "@/server/notifications";
import { runRetentionEscalations } from "./retention";

/**
 * Persoonlijke meldingen voor aandachtspunten. Alleen voor punten die vandaag
 * moeten (prioriteit hoog), alleen naar de verantwoordelijke, en één keer per
 * punt. Punten voor deze week of later geven geen melding: die staan gewoon op
 * de pagina. Zo krijgt niet iedereen alles en blijft het belletje betekenisvol.
 */
export async function runAttentionNotify() {
  const [owner] = await db.select({ id: users.id }).from(users)
    .where(and(eq(users.primaryRole, "owner"), isNull(users.deletedAt))).limit(1);
  if (!owner) return { ok: false, error: "Geen eigenaar gevonden." };
  const viewer = await viewerForUser(owner.id);
  if (!viewer) return { ok: false, error: "Viewer niet op te bouwen." };

  const { items } = await getAttentionBoard(viewer, { trusted: true });
  // Klantbehoud: kritieke punten die niet worden opgepakt, één keer escaleren.
  const escalated = await runRetentionEscalations(items).catch(() => 0);
  const due = items.filter((i) => i.priority === "hoog" && i.status !== "klaar" && i.ownerId && !i.manual);
  if (!due.length) return { ok: true, sent: 0, escalated };

  const rows = await db.select({ key: attentionStates.signalKey, notifiedAt: attentionStates.notifiedAt })
    .from(attentionStates).where(inArray(attentionStates.signalKey, due.map((d) => d.key)));
  const already = new Set(rows.filter((r) => r.notifiedAt).map((r) => r.key));

  // Per persoon: tot 3 nieuwe punten elk een eigen melding, meer dan dat wordt
  // één samenvatting. Zo loopt het belletje nooit vol (ook niet bij de eerste run).
  const fresh = due.filter((i) => !already.has(i.key));
  const byOwner = new Map<string, typeof fresh>();
  for (const it of fresh) byOwner.set(it.ownerId!, [...(byOwner.get(it.ownerId!) ?? []), it]);

  let sent = 0;
  const today = new Date().toISOString().slice(0, 10);
  for (const [ownerId, list] of byOwner) {
    if (list.length <= 3) {
      for (const it of list) {
        sent += await notify({
          userIds: [ownerId], type: "attention_due", level: "warning",
          title: it.clientName ? `${it.clientName}: ${it.action}` : it.action,
          body: it.reason, href: "/kwaliteit", dedupeKey: `attention:${it.key}`,
        });
      }
    } else {
      const names = list.slice(0, 3).map((i) => i.clientName ?? i.action).join(", ");
      sent += await notify({
        userIds: [ownerId], type: "attention_due", level: "warning",
        title: `${list.length} aandachtspunten voor vandaag`,
        body: `O.a. ${names}. Open Aandachtspunten voor je lijst.`, href: "/kwaliteit",
        dedupeKey: `attention-digest:${ownerId}:${today}`,
      });
    }
    await db.update(attentionStates).set({ notifiedAt: new Date() })
      .where(inArray(attentionStates.signalKey, list.map((i) => i.key)));
  }
  return { ok: true, sent, escalated };
}
