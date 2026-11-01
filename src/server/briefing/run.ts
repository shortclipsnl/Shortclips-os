import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { briefingSets, clients, deliverables, productionDays, scripts } from "@/db/schema";
import { recordActivity } from "@/server/audit";
import { notify } from "@/server/notifications";
import { shootReviewPdf } from "@/server/captions/generate";
import { generateBriefingForPdf } from "@/server/briefing/generate";

const STALE_RUNNING_MIN = 10;

export type EnsureBriefingResult =
  | { ok: true; status: "generated" | "updated" }
  | { ok: false; reason: "no_pdf" | "unchanged" | "in_progress" | "cancelled" | "not_found" | "error"; message?: string };

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("nl-NL", { day: "numeric", month: "long" });
}

/**
 * Zorgt dat de editor-briefing voor één opname actueel is op basis van de
 * scriptcontrole-PDF. Draait als systeem. Spiegel van `ensureCaptionsForShoot`.
 */
export async function ensureBriefingForShoot(
  productionDayId: string,
  opts: { force?: boolean } = {},
): Promise<EnsureBriefingResult> {
  const [day] = await db
    .select({
      id: productionDays.id,
      clientId: productionDays.clientId,
      status: productionDays.status,
      scheduledOn: productionDays.scheduledOn,
      clientName: clients.name,
      coordinatorId: clients.coordinatorId,
    })
    .from(productionDays)
    .innerJoin(clients, eq(clients.id, productionDays.clientId))
    .where(and(eq(productionDays.id, productionDayId), isNull(productionDays.deletedAt)))
    .limit(1);
  if (!day) return { ok: false, reason: "not_found" };
  if (day.status === "cancelled") return { ok: false, reason: "cancelled" };

  const pdf = await shootReviewPdf(productionDayId);
  if (!pdf) return { ok: false, reason: "no_pdf" };

  const [existing] = await db
    .select({ id: briefingSets.id, status: briefingSets.status, sourceHash: briefingSets.sourceHash, startedAt: briefingSets.startedAt })
    .from(briefingSets)
    .where(and(eq(briefingSets.productionDayId, productionDayId), isNull(briefingSets.deletedAt)))
    .limit(1);

  const isRegeneration = Boolean(existing);

  if (existing && !opts.force) {
    if (existing.sourceHash === pdf.hash && existing.status !== "mislukt" && existing.status !== "bezig") {
      return { ok: false, reason: "unchanged" };
    }
    if (existing.status === "bezig" && existing.startedAt) {
      const ageMin = (Date.now() - existing.startedAt.getTime()) / 60000;
      if (ageMin < STALE_RUNNING_MIN) return { ok: false, reason: "in_progress" };
    }
  }

  const now = new Date();
  const [set] = await db
    .insert(briefingSets)
    .values({ productionDayId, clientId: day.clientId, status: "bezig", startedAt: now })
    .onConflictDoUpdate({
      target: briefingSets.productionDayId,
      set: { status: "bezig", startedAt: now, deletedAt: null, updatedAt: now },
    })
    .returning({ id: briefingSets.id });
  const setId = set!.id;

  // Titels van de video's/scripts van deze opname — zodat de briefing de echte
  // titels gebruikt (nodig voor de koppeling short↔video per editor).
  const scriptRows = await db
    .select({ title: scripts.title })
    .from(scripts)
    .where(and(eq(scripts.productionDayId, productionDayId), isNull(scripts.deletedAt)))
    .orderBy(asc(scripts.createdAt));
  const videos = scriptRows.map((s) => ({ title: s.title })).filter((v) => v.title);

  const res = await generateBriefingForPdf({ clientId: day.clientId, pdfBase64: pdf.pdfBase64, videos });
  if (!res.ok) {
    await db
      .update(briefingSets)
      .set({ status: "mislukt", errorMessage: res.error.slice(0, 500), startedAt: null, updatedAt: new Date() })
      .where(eq(briefingSets.id, setId));
    return { ok: false, reason: "error", message: res.error };
  }

  const finalStatus = isRegeneration ? "bijgewerkt_script" : "klaar";
  await db
    .update(briefingSets)
    .set({
      status: finalStatus,
      content: res.data as unknown as Record<string, unknown>,
      sourceHash: pdf.hash,
      sourceReviewVersionId: pdf.reviewVersionId,
      generatedAt: new Date(),
      startedAt: null,
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(briefingSets.id, setId));

  // Op de hoogte brengen: coördinator/eigenaar + de toegewezen editor(s).
  const editorRows = await db
    .selectDistinct({ editorId: deliverables.editorId })
    .from(deliverables)
    .where(and(eq(deliverables.productionDayId, productionDayId), isNull(deliverables.deletedAt)));
  const editorIds = editorRows.map((e) => e.editorId).filter((x): x is string => !!x);
  const userIds = [day.coordinatorId, ...editorIds].filter((x): x is string => !!x);

  const dateLabel = fmtDate(day.scheduledOn);
  await notify({
    roles: ["owner"],
    userIds: userIds.length ? userIds : undefined,
    clientId: day.clientId,
    level: "info",
    type: "briefing_ready",
    title: isRegeneration ? "Editor-briefing bijgewerkt (nieuw script)" : "Editor-briefing klaar",
    body: `De compacte editor-briefing voor de opname van ${day.clientName}${dateLabel ? ` (${dateLabel})` : ""} staat klaar.`,
    href: `/productions/${productionDayId}`,
    entityType: "briefing_set",
    entityId: setId,
    dedupeKey: `briefing_ready:${productionDayId}`,
  }).catch(() => undefined);
  await recordActivity({
    clientId: day.clientId,
    type: "briefing.generated",
    title: isRegeneration ? "Editor-briefing bijgewerkt na nieuw script" : "Editor-briefing automatisch gegenereerd",
    isClientVisible: false,
  }).catch(() => undefined);

  return { ok: true, status: isRegeneration ? "updated" : "generated" };
}
