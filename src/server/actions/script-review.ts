"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { clients, productionDays, scriptReviewComments, scriptReviewThreads, scriptReviewVersions, scriptReviews, users } from "@/db/schema";
import { assertClientAccess, ForbiddenError, requirePermission, requirePortal } from "@/server/auth/context";
import { auditLog, recordActivity } from "@/server/audit";
import { notify } from "@/server/notifications";
import { portalEmailHtml, sendEmail } from "@/server/email";
import { env } from "@/lib/env";
import { assertReviewAccess } from "@/server/script-review";

export type ActionResult = { ok: boolean; message?: string; reviewId?: string };

const MAX_PDF_BYTES = 15 * 1024 * 1024; // 15 MB
const appUrl = env.APP_URL.replace(/\/$/, "");

/** Portaalgebruikers (klantaccounts) van een klant — ontvangers van meldingen. */
async function portalUserIds(clientId: string): Promise<{ ids: string[]; emails: string[] }> {
  const rows = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(and(eq(users.clientId, clientId), eq(users.primaryRole, "client"), eq(users.status, "active"), isNull(users.deletedAt)));
  return { ids: rows.map((r) => r.id), emails: rows.map((r) => r.email).filter(Boolean) };
}

/** De verantwoordelijke medewerker (coördinator) + diens e-mail, voor meldingen. */
async function clientStaff(clientId: string): Promise<{ coordinatorId: string | null; coordinatorEmail: string | null; clientName: string }> {
  const [c] = await db
    .select({ name: clients.name, coordinatorId: clients.coordinatorId, coordinatorEmail: users.email })
    .from(clients)
    .leftJoin(users, eq(users.id, clients.coordinatorId))
    .where(eq(clients.id, clientId))
    .limit(1);
  return { coordinatorId: c?.coordinatorId ?? null, coordinatorEmail: c?.coordinatorEmail ?? null, clientName: c?.name ?? "de klant" };
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d).toLocaleDateString("nl-NL", { day: "numeric", month: "long" });
}

/* ------------------------------------------------------------ intern */

const sendSchema = z.object({
  clientId: z.string().uuid(),
  productionDayId: z.string().uuid(),
  fileName: z.string().min(1).max(255),
  contentType: z.string().max(100),
  base64: z.string().min(1),
  title: z.string().trim().max(240).optional(),
});

/**
 * Intern: stuurt een script-PDF ter controle naar de klant. Maakt (of hergebruikt)
 * het reviewdocument voor de opnamesessie, voegt de PDF als nieuwe versie toe,
 * zet de status op "klaar voor controle" en brengt de klant op de hoogte (in-app
 * + e-mail). Eén handeling voor de medewerker.
 */
export async function sendScriptForReview(input: z.infer<typeof sendSchema>): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("scripts:write");
    const parsed = sendSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Controleer de invoer." };
    const { clientId, productionDayId, fileName, contentType, base64, title } = parsed.data;
    assertClientAccess(viewer, clientId);

    const isPdf = contentType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");
    if (!isPdf) return { ok: false, message: "Alleen een PDF-bestand kan verstuurd worden." };
    const sizeBytes = Math.floor((base64.length * 3) / 4);
    if (sizeBytes === 0) return { ok: false, message: "Leeg bestand." };
    if (sizeBytes > MAX_PDF_BYTES) return { ok: false, message: "Het bestand is te groot (max 15 MB)." };

    // De opnamesessie moet van deze klant zijn.
    const [day] = await db
      .select({ id: productionDays.id, clientId: productionDays.clientId, scheduledOn: productionDays.scheduledOn })
      .from(productionDays)
      .where(and(eq(productionDays.id, productionDayId), isNull(productionDays.deletedAt)))
      .limit(1);
    if (!day || day.clientId !== clientId) return { ok: false, message: "Opnamesessie niet gevonden bij deze klant." };

    // Bestaand reviewdocument voor deze sessie? Dan een nieuwe versie + "opnieuw ter controle".
    const [existing] = await db
      .select({ id: scriptReviews.id, currentVersion: scriptReviews.currentVersion })
      .from(scriptReviews)
      .where(and(eq(scriptReviews.productionDayId, productionDayId), isNull(scriptReviews.deletedAt)))
      .limit(1);

    const reviewTitle = title?.trim() || `Scripts opname ${fmtDate(day.scheduledOn)}`;
    let reviewId: string;
    let versionNumber: number;
    let herzien = false;

    if (existing) {
      versionNumber = existing.currentVersion + 1;
      herzien = true;
      await db
        .update(scriptReviews)
        .set({ status: "opnieuw_controle", currentVersion: versionNumber, title: reviewTitle, updatedAt: new Date() })
        .where(eq(scriptReviews.id, existing.id));
      reviewId = existing.id;
    } else {
      versionNumber = 1;
      const [created] = await db
        .insert(scriptReviews)
        .values({ clientId, productionDayId, title: reviewTitle, status: "klaar_controle", currentVersion: 1, createdById: viewer.id })
        .returning({ id: scriptReviews.id });
      reviewId = created!.id;
    }

    await db.insert(scriptReviewVersions).values({
      reviewId, versionNumber, fileName: fileName.slice(0, 255), contentType: contentType || "application/pdf", sizeBytes, dataBase64: base64, uploadedById: viewer.id,
    });

    await auditLog({ viewer, action: "script_review.sent", entityType: "script_review", entityId: reviewId, clientId, changes: { version: versionNumber } });
    await recordActivity({ clientId, type: "script_review.sent", title: herzien ? "Aangepaste scripts klaargezet ter controle" : "Scripts klaargezet ter controle", isClientVisible: true });

    // Klant op de hoogte brengen (in-app + e-mail).
    const { ids, emails } = await portalUserIds(clientId);
    const staff = await clientStaff(clientId);
    const href = `/portal/scripts/${reviewId}`;
    const title2 = herzien ? "Aangepaste scripts staan klaar" : "Je scripts staan klaar om te bekijken";
    const body = `De scripts voor je opname van ${fmtDate(day.scheduledOn)} staan klaar. Bekijk ze en geef eenvoudig je feedback of keur ze goed.`;
    if (ids.length > 0) {
      await notify({
        userIds: ids,
        clientId,
        level: "info",
        type: "script_review_ready",
        title: title2,
        body,
        href,
        entityType: "script_review",
        entityId: reviewId,
        dedupeKey: `script_review_ready:${reviewId}:v${versionNumber}`,
      });
    }
    if (emails.length > 0) {
      await sendEmail({
        to: emails,
        subject: title2,
        text: `${body}\n\nBekijk de scripts: ${appUrl}${href}`,
        html: portalEmailHtml({ heading: title2, body, ctaLabel: "Bekijk de scripts", ctaUrl: `${appUrl}${href}` }),
        replyTo: staff.coordinatorEmail ?? undefined,
      }).catch(() => undefined);
    }

    revalidatePath("/scriptcontrole");
    revalidatePath("/portal/scripts");
    return { ok: true, reviewId };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/* ------------------------------------------------------------ portaal (klant) */

const feedbackSchema = z.object({
  reviewId: z.string().uuid(),
  body: z.string().trim().min(1, "Schrijf eerst je opmerking.").max(4000),
});

/** Klant: plaatst een (algemene) opmerking en zet de review op "feedback gegeven". */
export async function submitScriptReviewFeedback(input: z.infer<typeof feedbackSchema>): Promise<ActionResult> {
  try {
    const viewer = await requirePortal();
    const parsed = feedbackSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Controleer je opmerking." };
    const { reviewId, body } = parsed.data;

    const [review] = await db
      .select({ id: scriptReviews.id, clientId: scriptReviews.clientId, currentVersion: scriptReviews.currentVersion })
      .from(scriptReviews)
      .where(and(eq(scriptReviews.id, reviewId), eq(scriptReviews.clientId, viewer.clientId!), isNull(scriptReviews.deletedAt)))
      .limit(1);
    if (!review) return { ok: false, message: "Dit script is niet gevonden." };

    const [thread] = await db
      .insert(scriptReviewThreads)
      .values({ reviewId, versionNumber: review.currentVersion, pageNumber: null, visibility: "client", createdById: viewer.id, authorName: viewer.fullName })
      .returning({ id: scriptReviewThreads.id });
    await db.insert(scriptReviewComments).values({ threadId: thread!.id, body, authorUserId: viewer.id, authorName: viewer.fullName, isInternal: false });

    await db.update(scriptReviews).set({ status: "feedback_gegeven", updatedAt: new Date() }).where(eq(scriptReviews.id, reviewId));

    await recordActivity({ clientId: review.clientId, type: "script_review.feedback", title: "Klant gaf feedback op de scripts", isClientVisible: false });
    // De verantwoordelijke medewerker op de hoogte brengen.
    const staff = await clientStaff(review.clientId);
    await notify({
      roles: ["owner"],
      userIds: staff.coordinatorId ? [staff.coordinatorId] : undefined,
      clientId: review.clientId,
      level: "warning",
      type: "script_review_feedback",
      title: `${staff.clientName} gaf feedback op de scripts`,
      body: body.slice(0, 200),
      href: "/scriptcontrole",
      entityType: "script_review",
      entityId: reviewId,
      dedupeKey: `script_review_feedback:${reviewId}:${thread!.id}`,
    });

    revalidatePath(`/portal/scripts/${reviewId}`);
    revalidatePath("/portal/scripts");
    revalidatePath("/scriptcontrole");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Klant: keurt de scripts definitief goed (legt vast wie, wanneer en welke versie). */
export async function approveScriptReview(reviewId: string): Promise<ActionResult> {
  try {
    const viewer = await requirePortal();
    const [review] = await db
      .select({ id: scriptReviews.id, clientId: scriptReviews.clientId, currentVersion: scriptReviews.currentVersion, status: scriptReviews.status })
      .from(scriptReviews)
      .where(and(eq(scriptReviews.id, reviewId), eq(scriptReviews.clientId, viewer.clientId!), isNull(scriptReviews.deletedAt)))
      .limit(1);
    if (!review) return { ok: false, message: "Dit script is niet gevonden." };
    if (review.status === "goedgekeurd") return { ok: true };

    // Goedkeuring geldt expliciet voor DEZE versie — een latere versie reset dit.
    await db
      .update(scriptReviews)
      .set({ status: "goedgekeurd", approvedAt: new Date(), approvedById: viewer.id, approvedVersion: review.currentVersion, updatedAt: new Date() })
      .where(eq(scriptReviews.id, reviewId));

    await auditLog({ viewer, action: "script_review.approved", entityType: "script_review", entityId: reviewId, clientId: review.clientId, changes: { version: review.currentVersion } });
    await recordActivity({ clientId: review.clientId, type: "script_review.approved_by_client", title: "Scripts goedgekeurd door de klant", isClientVisible: true });

    const staff = await clientStaff(review.clientId);
    await notify({
      roles: ["owner"],
      userIds: staff.coordinatorId ? [staff.coordinatorId] : undefined,
      clientId: review.clientId,
      level: "success",
      type: "script_review_approved",
      title: `${staff.clientName} keurde de scripts goed`,
      body: `Versie ${review.currentVersion} is definitief goedgekeurd.`,
      href: "/scriptcontrole",
      entityType: "script_review",
      entityId: reviewId,
      dedupeKey: `script_review_approved:${reviewId}:v${review.currentVersion}`,
    });

    revalidatePath(`/portal/scripts/${reviewId}`);
    revalidatePath("/portal/scripts");
    revalidatePath("/scriptcontrole");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/* --------------------------------------------- intern: review verwijderen */

/** Intern: verwijdert (soft) een reviewdocument — bv. per ongeluk verstuurd. */
export async function deleteScriptReview(reviewId: string): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("scripts:write");
    const review = await assertReviewAccess(viewer, reviewId);
    if (!review) return { ok: false, message: "Niet gevonden." };
    await db.update(scriptReviews).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(scriptReviews.id, reviewId));
    await auditLog({ viewer, action: "script_review.deleted", entityType: "script_review", entityId: reviewId, clientId: review.clientId });
    revalidatePath("/scriptcontrole");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}
