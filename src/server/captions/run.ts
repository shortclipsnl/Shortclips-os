import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { captionItems, captionSets, clients, productionDays } from "@/db/schema";
import { recordActivity } from "@/server/audit";
import { notify } from "@/server/notifications";
import { generateCaptionsForPdf, shootReviewPdf } from "@/server/captions/generate";

/** Een "bezig"-set ouder dan dit wordt als vastgelopen beschouwd (opnieuw oppakken). */
const STALE_RUNNING_MIN = 10;

export type EnsureResult =
  | { ok: true; status: "generated" | "updated"; count: number }
  | { ok: false; reason: "no_pdf" | "unchanged" | "in_progress" | "cancelled" | "not_found" | "error"; message?: string };

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("nl-NL", { day: "numeric", month: "long" });
}

/**
 * Zorgt dat de captions voor één opname actueel zijn op basis van de
 * scriptcontrole-PDF. Draait als systeem (geen ingelogde gebruiker) — de
 * aanroeper (trigger/cron) is al geautoriseerd.
 *
 * - Geen review-PDF → niets doen.
 * - PDF ongewijzigd (zelfde hash) en niet `force` → niets doen (geen AI-kosten).
 * - Anders: genereer captions. Handmatig bewerkte captions blijven staan en
 *   krijgen bij een nieuwe versie de markering "nieuwere versie beschikbaar".
 */
export async function ensureCaptionsForShoot(
  productionDayId: string,
  opts: { force?: boolean } = {},
): Promise<EnsureResult> {
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
    .select({
      id: captionSets.id,
      status: captionSets.status,
      sourceHash: captionSets.sourceHash,
      startedAt: captionSets.startedAt,
    })
    .from(captionSets)
    .where(and(eq(captionSets.productionDayId, productionDayId), isNull(captionSets.deletedAt)))
    .limit(1);

  const isRegeneration = Boolean(existing);

  if (existing && !opts.force) {
    // Ongewijzigde PDF → niets doen (bespaart AI-kosten).
    if (existing.sourceHash === pdf.hash && existing.status !== "mislukt" && existing.status !== "bezig") {
      return { ok: false, reason: "unchanged" };
    }
    // Draait al (en niet vastgelopen) → niet dubbel starten.
    if (existing.status === "bezig" && existing.startedAt) {
      const ageMin = (Date.now() - existing.startedAt.getTime()) / 60000;
      if (ageMin < STALE_RUNNING_MIN) return { ok: false, reason: "in_progress" };
    }
  }

  // Set klaarzetten op "bezig" (aanmaken of hergebruiken). Uniek op opname.
  const now = new Date();
  const [set] = await db
    .insert(captionSets)
    .values({ productionDayId, clientId: day.clientId, status: "bezig", startedAt: now })
    .onConflictDoUpdate({
      target: captionSets.productionDayId,
      set: { status: "bezig", startedAt: now, deletedAt: null, updatedAt: now },
    })
    .returning({ id: captionSets.id });
  const setId = set!.id;

  // Genereren (kan tientallen seconden duren).
  const res = await generateCaptionsForPdf({ clientId: day.clientId, pdfBase64: pdf.pdfBase64 });
  if (!res.ok) {
    await db
      .update(captionSets)
      .set({ status: "mislukt", errorMessage: res.error.slice(0, 500), startedAt: null, updatedAt: new Date() })
      .where(eq(captionSets.id, setId));
    return { ok: false, reason: "error", message: res.error };
  }
  const data = res.data;
  if (data.length === 0) {
    await db
      .update(captionSets)
      .set({ status: "mislukt", errorMessage: "Geen captions herkend in de PDF.", startedAt: null, updatedAt: new Date() })
      .where(eq(captionSets.id, setId));
    return { ok: false, reason: "error", message: "Geen captions herkend in de PDF." };
  }

  // Bestaande captions ophalen om handmatige bewerkingen te behouden.
  const prior = await db
    .select()
    .from(captionItems)
    .where(eq(captionItems.captionSetId, setId))
    .orderBy(asc(captionItems.position));
  const priorByPos = new Map(prior.map((p) => [p.position, p]));

  for (let i = 0; i < data.length; i++) {
    const nd = data[i]!;
    const old = priorByPos.get(i);
    if (old?.isEdited) {
      // Handmatig bewerkt → caption behouden, maar markeren dat het script is gewijzigd.
      await db
        .update(captionItems)
        .set({ staleFromNewVersion: true, hook: nd.hook, updatedAt: new Date() })
        .where(eq(captionItems.id, old.id));
    } else if (old) {
      await db
        .update(captionItems)
        .set({
          shortTitle: nd.shortTitle,
          hook: nd.hook,
          caption: nd.caption,
          hashtags: nd.hashtags,
          status: "gegenereerd",
          isEdited: false,
          staleFromNewVersion: false,
          updatedAt: new Date(),
        })
        .where(eq(captionItems.id, old.id));
    } else {
      await db.insert(captionItems).values({
        captionSetId: setId,
        position: i,
        shortTitle: nd.shortTitle,
        hook: nd.hook,
        caption: nd.caption,
        hashtags: nd.hashtags,
        status: "gegenereerd",
      });
    }
  }
  // Overtollige oude items (PDF heeft nu minder shorts): niet-bewerkte weg,
  // bewerkte behouden maar markeren als verouderd.
  const surplus = prior.filter((p) => p.position >= data.length);
  for (const p of surplus) {
    if (p.isEdited) {
      await db.update(captionItems).set({ staleFromNewVersion: true, updatedAt: new Date() }).where(eq(captionItems.id, p.id));
    } else {
      await db.delete(captionItems).where(eq(captionItems.id, p.id));
    }
  }

  const finalStatus = isRegeneration ? "bijgewerkt_script" : "klaar_controle";
  await db
    .update(captionSets)
    .set({
      status: finalStatus,
      sourceHash: pdf.hash,
      sourceReviewVersionId: pdf.reviewVersionId,
      generatedAt: new Date(),
      startedAt: null,
      errorMessage: null,
      // Een nieuwe generatie zet een eerdere "gecontroleerd" terug — er valt
      // opnieuw iets te controleren.
      checkedById: null,
      checkedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(captionSets.id, setId));

  // Team op de hoogte brengen dat er captions klaarstaan om te controleren.
  const dateLabel = fmtDate(day.scheduledOn);
  await notify({
    roles: ["owner"],
    userIds: day.coordinatorId ? [day.coordinatorId] : undefined,
    clientId: day.clientId,
    level: "info",
    type: "captions_ready",
    title: isRegeneration ? "Captions bijgewerkt (nieuw script)" : "Captions klaar om te controleren",
    body: `${data.length} caption${data.length === 1 ? "" : "s"} voor de opname van ${day.clientName}${dateLabel ? ` (${dateLabel})` : ""} staan klaar.`,
    href: `/ai/caption/opname/${productionDayId}`,
    entityType: "caption_set",
    entityId: setId,
    dedupeKey: `captions_review:${productionDayId}`,
  }).catch(() => undefined);
  await recordActivity({
    clientId: day.clientId,
    type: "captions.generated",
    title: isRegeneration ? "Captions bijgewerkt na nieuw script" : "Captions automatisch gegenereerd",
    isClientVisible: false,
  }).catch(() => undefined);

  return { ok: true, status: isRegeneration ? "updated" : "generated", count: data.length };
}
