"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { clients, productionDays, scripts as scriptsTable, scriptReviewComments, scriptReviewThreads, scriptReviewVersions, scriptReviews, users } from "@/db/schema";
import { assertClientAccess, ForbiddenError, requirePermission, requirePortal } from "@/server/auth/context";
import { auditLog, recordActivity } from "@/server/audit";
import { notify } from "@/server/notifications";
import { portalEmailHtml, sendEmail } from "@/server/email";
import { env } from "@/lib/env";
import { getFeedbackDays } from "@/server/portal-settings";
import { addWorkingDays } from "@/lib/workdays";
import { assertReviewAccess } from "@/server/script-review";
import { createScriptUploadTarget } from "@/server/scripts/script-storage";

/** Uiterste feedbackmoment: N werkdagen vanaf nu (eind van die dag). */
async function scriptFeedbackDeadline(): Promise<Date> {
  const { scripts } = await getFeedbackDays();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
  const day = addWorkingDays(today, Math.max(1, scripts));
  return new Date(`${day}T17:00:00`);
}

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
  /** Kleine PDF's: base64 via de server-action. */
  base64: z.string().min(1).optional(),
  /** Grote PDF's: direct naar Supabase geüpload, hier alleen de opslagsleutel. */
  storagePath: z.string().min(1).max(500).optional(),
  sizeBytes: z.number().int().positive().optional(),
  title: z.string().trim().max(240).optional(),
}).refine((v) => Boolean(v.base64 || v.storagePath), { message: "Geen bestand ontvangen." });

const uploadUrlSchema = z.object({ clientId: z.string().uuid(), productionDayId: z.string().uuid() });

/**
 * Intern: maakt een ondertekende upload-URL waarmee de browser een script-PDF
 * rechtstreeks naar de opslag zet (langs de 4,5MB-limiet van server-actions).
 * Geeft null terug als er geen opslag is ingesteld — dan valt de UI terug op
 * base64 via sendScriptForReview.
 */
export async function createScriptPdfUploadUrl(input: z.infer<typeof uploadUrlSchema>): Promise<ActionResult & { uploadUrl?: string; key?: string; headers?: Record<string, string> }> {
  try {
    const viewer = await requirePermission("scripts:write");
    const parsed = uploadUrlSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "Controleer de invoer." };
    assertClientAccess(viewer, parsed.data.clientId);
    const [day] = await db
      .select({ clientId: productionDays.clientId })
      .from(productionDays)
      .where(and(eq(productionDays.id, parsed.data.productionDayId), isNull(productionDays.deletedAt)))
      .limit(1);
    if (!day || day.clientId !== parsed.data.clientId) return { ok: false, message: "Opnamesessie niet gevonden bij deze klant." };

    const target = await createScriptUploadTarget(parsed.data.clientId);
    if (!target) return { ok: true }; // geen opslag → UI gebruikt base64
    return { ok: true, uploadUrl: target.uploadUrl, key: target.key, headers: target.headers };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

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
    const { clientId, productionDayId, fileName, contentType, base64, storagePath, title } = parsed.data;
    assertClientAccess(viewer, clientId);

    const isPdf = contentType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");
    if (!isPdf) return { ok: false, message: "Alleen een PDF-bestand kan verstuurd worden." };
    const sizeBytes = base64 ? Math.floor((base64.length * 3) / 4) : (parsed.data.sizeBytes ?? 0);
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
    const feedbackDeadline = await scriptFeedbackDeadline();
    let reviewId: string;
    let versionNumber: number;
    let herzien = false;

    if (existing) {
      versionNumber = existing.currentVersion + 1;
      herzien = true;
      await db
        .update(scriptReviews)
        .set({ status: "opnieuw_controle", currentVersion: versionNumber, title: reviewTitle, feedbackDeadline, updatedAt: new Date() })
        .where(eq(scriptReviews.id, existing.id));
      reviewId = existing.id;
    } else {
      versionNumber = 1;
      const [created] = await db
        .insert(scriptReviews)
        .values({ clientId, productionDayId, title: reviewTitle, status: "klaar_controle", currentVersion: 1, feedbackDeadline, createdById: viewer.id })
        .returning({ id: scriptReviews.id });
      reviewId = created!.id;
    }

    await db.insert(scriptReviewVersions).values({
      reviewId, versionNumber, fileName: fileName.slice(0, 255), contentType: contentType || "application/pdf", sizeBytes,
      dataBase64: base64 ?? null, storagePath: storagePath ?? null, uploadedById: viewer.id,
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

/** Sjabloonpagina als PNG-bytes: lokaal van schijf, in productie via de eigen URL. */
async function loadScriptTemplateImage(n: number): Promise<Uint8Array> {
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    return new Uint8Array(await fs.readFile(path.join(process.cwd(), "public", "script-template", `slide${n}.png`)));
  } catch {
    /* val terug op fetch (serverless) */
  }
  const base = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : (process.env.APP_URL || "http://localhost:3000");
  const res = await fetch(`${base}/script-template/slide${n}.png`);
  if (!res.ok) throw new Error(`Sjabloonpagina ${n} kon niet worden geladen (HTTP ${res.status}).`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Zet een opgeslagen script om naar de tekst voor de PDF (hook → body → CTA). */
function scriptToPdfText(s: { hook: string | null; body: string | null; cta: string | null }): string {
  const parts: string[] = [];
  if (s.hook?.trim()) parts.push(`HOOK\n${s.hook.trim()}`);
  if (s.body?.trim()) parts.push(s.body.trim());
  if (s.cta?.trim()) parts.push(`CTA\n${s.cta.trim()}`);
  return parts.join("\n\n");
}

/**
 * Intern (één klik): bouwt automatisch een script-PDF in de Shortclips-huisstijl
 * uit de geschreven scripts van een opname en stuurt die meteen ter controle naar
 * de klant — zonder dat er handmatig een PDF geüpload hoeft te worden. Hergebruikt
 * dezelfde opmaak als de scriptgenerator-download en de bestaande verstuur-flow.
 */
export async function generateScriptPdfAndSend(input: { productionDayId: string; title?: string }): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("scripts:write");
    const productionDayId = z.string().uuid().parse(input.productionDayId);

    const [day] = await db
      .select({
        id: productionDays.id,
        clientId: productionDays.clientId,
        scheduledOn: productionDays.scheduledOn,
        clientName: clients.name,
      })
      .from(productionDays)
      .innerJoin(clients, eq(clients.id, productionDays.clientId))
      .where(and(eq(productionDays.id, productionDayId), isNull(productionDays.deletedAt)))
      .limit(1);
    if (!day) return { ok: false, message: "Opnamesessie niet gevonden." };
    assertClientAccess(viewer, day.clientId);

    const rows = await db
      .select({ title: scriptsTable.title, hook: scriptsTable.hook, body: scriptsTable.body, cta: scriptsTable.cta })
      .from(scriptsTable)
      .where(and(eq(scriptsTable.productionDayId, productionDayId), isNull(scriptsTable.deletedAt)))
      .orderBy(scriptsTable.createdAt);

    const items = rows
      .map((r) => ({ onderwerp: r.title, tekst: scriptToPdfText(r) }))
      .filter((s) => s.tekst.trim().length > 0);
    if (items.length === 0) {
      return { ok: false, message: "Er zijn nog geen uitgewerkte scripts voor deze opname om te versturen." };
    }

    const opnamedag = fmtLongDate(day.scheduledOn);
    const { buildScriptPdfBytes } = await import("@/lib/script-pdf");
    const bytes = await buildScriptPdfBytes(
      { klantnaam: day.clientName, opnamedag, scripts: items },
      loadScriptTemplateImage,
    );
    const base64 = Buffer.from(bytes).toString("base64");
    const safe = day.clientName.replace(/[^\p{L}\p{N} _-]/gu, "").trim() || "Shortclips";

    // Via de bestaande verstuur-flow: maakt/hergebruikt het reviewdocument, voegt
    // de versie toe en notificeert de klant (in-app + e-mail).
    return await sendScriptForReview({
      clientId: day.clientId,
      productionDayId,
      fileName: `Scripts - ${safe}${opnamedag ? ` - ${opnamedag}` : ""}.pdf`,
      contentType: "application/pdf",
      base64,
      title: input.title,
    });
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    const msg = (error as Error)?.message ?? "onbekende fout";
    return { ok: false, message: `Genereren mislukt: ${msg}` };
  }
}

/** Datum als "1 november 2026" voor de PDF-cover. */
function fmtLongDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
}

/* ------------------------------------------------------------ portaal (klant) */

const commentSchema = z.object({
  reviewId: z.string().uuid(),
  body: z.string().trim().min(1, "Schrijf eerst je opmerking.").max(4000),
  pageNumber: z.number().int().positive().optional(),
  posX: z.number().min(0).max(1).optional(),
  posY: z.number().min(0).max(1).optional(),
});

/** Gedeeld: een klantopmerking plaatsen (algemeen of op een pagina/positie),
 *  de review op "feedback gegeven" zetten en de medewerker op de hoogte brengen. */
async function createClientComment(viewer: Awaited<ReturnType<typeof requirePortal>>, input: z.infer<typeof commentSchema>): Promise<ActionResult> {
  const { reviewId, body, pageNumber, posX, posY } = input;
  const [review] = await db
    .select({ id: scriptReviews.id, clientId: scriptReviews.clientId, currentVersion: scriptReviews.currentVersion })
    .from(scriptReviews)
    .where(and(eq(scriptReviews.id, reviewId), eq(scriptReviews.clientId, viewer.clientId!), isNull(scriptReviews.deletedAt)))
    .limit(1);
  if (!review) return { ok: false, message: "Dit script is niet gevonden." };

  const [thread] = await db
    .insert(scriptReviewThreads)
    .values({
      reviewId, versionNumber: review.currentVersion,
      pageNumber: pageNumber ?? null,
      posX: posX != null ? String(posX) : null,
      posY: posY != null ? String(posY) : null,
      visibility: "client", createdById: viewer.id, authorName: viewer.fullName,
    })
    .returning({ id: scriptReviewThreads.id });
  await db.insert(scriptReviewComments).values({ threadId: thread!.id, body, authorUserId: viewer.id, authorName: viewer.fullName, isInternal: false });

  // Alleen terug naar "feedback gegeven" zolang de review nog niet is goedgekeurd.
  await db.update(scriptReviews).set({ status: "feedback_gegeven", updatedAt: new Date() })
    .where(and(eq(scriptReviews.id, reviewId), sql`${scriptReviews.status} <> 'goedgekeurd'`));

  await recordActivity({ clientId: review.clientId, type: "script_review.feedback", title: "Klant gaf feedback op de scripts", isClientVisible: false });
  const staff = await clientStaff(review.clientId);
  await notify({
    roles: ["owner"],
    userIds: staff.coordinatorId ? [staff.coordinatorId] : undefined,
    clientId: review.clientId,
    level: "warning",
    type: "script_review_feedback",
    title: `${staff.clientName} gaf feedback op de scripts`,
    body: `${pageNumber ? `Pagina ${pageNumber}: ` : ""}${body}`.slice(0, 200),
    href: `/scriptcontrole/${reviewId}`,
    entityType: "script_review",
    entityId: reviewId,
    dedupeKey: `script_review_feedback:${reviewId}:${thread!.id}`,
  });

  revalidatePath(`/portal/scripts/${reviewId}`);
  revalidatePath("/portal/scripts");
  revalidatePath(`/scriptcontrole/${reviewId}`);
  revalidatePath("/scriptcontrole");
  return { ok: true };
}

/** Klant: algemene opmerking over de hele PDF. */
export async function submitScriptReviewFeedback(input: { reviewId: string; body: string }): Promise<ActionResult> {
  try {
    const viewer = await requirePortal();
    const parsed = commentSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Controleer je opmerking." };
    return await createClientComment(viewer, parsed.data);
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Klant: opmerking op een specifieke plek in de PDF (pagina + positie). */
export async function addScriptReviewComment(input: { reviewId: string; body: string; pageNumber: number; posX: number; posY: number }): Promise<ActionResult> {
  try {
    const viewer = await requirePortal();
    const parsed = commentSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Controleer je opmerking." };
    return await createClientComment(viewer, parsed.data);
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

/* --------------------------------------- intern: feedback verwerken (Fase 3) */

/** Haalt review + opnamedatum op en controleert de klant-scope van de medewerker. */
async function loadReviewForStaff(viewer: Awaited<ReturnType<typeof requirePermission>>, reviewId: string) {
  const review = await assertReviewAccess(viewer, reviewId);
  if (!review) return null;
  const [day] = await db.select({ scheduledOn: productionDays.scheduledOn }).from(productionDays).where(eq(productionDays.id, review.productionDayId)).limit(1);
  return { ...review, scheduledOn: day?.scheduledOn ?? null };
}

const replySchema = z.object({
  threadId: z.string().uuid(),
  body: z.string().trim().min(1, "Schrijf eerst een reactie.").max(4000),
  /** true = interne notitie (niet zichtbaar voor de klant). */
  internal: z.boolean().optional(),
});

/** Intern: reageren op een opmerkingdraad (zichtbaar voor de klant of intern). */
export async function replyToScriptReviewThread(input: z.infer<typeof replySchema>): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("scripts:write");
    const parsed = replySchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Controleer je reactie." };
    const { threadId, body, internal } = parsed.data;

    const [thread] = await db
      .select({ id: scriptReviewThreads.id, reviewId: scriptReviewThreads.reviewId })
      .from(scriptReviewThreads)
      .where(and(eq(scriptReviewThreads.id, threadId), isNull(scriptReviewThreads.deletedAt)))
      .limit(1);
    if (!thread) return { ok: false, message: "Opmerking niet gevonden." };
    const review = await assertReviewAccess(viewer, thread.reviewId);
    if (!review) return { ok: false, message: "Niet gevonden." };

    await db.insert(scriptReviewComments).values({ threadId, body, authorUserId: viewer.id, authorName: viewer.fullName, isInternal: internal ?? false });
    revalidatePath(`/scriptcontrole/${thread.reviewId}`);
    revalidatePath(`/portal/scripts/${thread.reviewId}`);
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Intern: een opmerkingdraad als verwerkt (of weer open) markeren. */
export async function resolveScriptReviewThread(threadId: string, resolved = true): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("scripts:write");
    const [thread] = await db
      .select({ id: scriptReviewThreads.id, reviewId: scriptReviewThreads.reviewId })
      .from(scriptReviewThreads)
      .where(and(eq(scriptReviewThreads.id, threadId), isNull(scriptReviewThreads.deletedAt)))
      .limit(1);
    if (!thread) return { ok: false, message: "Opmerking niet gevonden." };
    const review = await assertReviewAccess(viewer, thread.reviewId);
    if (!review) return { ok: false, message: "Niet gevonden." };
    await db.update(scriptReviewThreads)
      .set({ isResolved: resolved, resolvedAt: resolved ? new Date() : null, resolvedById: resolved ? viewer.id : null, updatedAt: new Date() })
      .where(eq(scriptReviewThreads.id, threadId));
    revalidatePath(`/scriptcontrole/${thread.reviewId}`);
    revalidatePath(`/portal/scripts/${thread.reviewId}`);
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Intern: de review "in bewerking" nemen (status wordt aangepast). */
export async function setScriptReviewRevising(reviewId: string): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("scripts:write");
    const review = await assertReviewAccess(viewer, reviewId);
    if (!review) return { ok: false, message: "Niet gevonden." };
    await db.update(scriptReviews).set({ status: "wordt_aangepast", updatedAt: new Date() })
      .where(and(eq(scriptReviews.id, reviewId), sql`${scriptReviews.status} <> 'goedgekeurd'`));
    revalidatePath(`/scriptcontrole/${reviewId}`);
    revalidatePath("/scriptcontrole");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

const versionSchema = z.object({
  reviewId: z.string().uuid(),
  fileName: z.string().min(1).max(255),
  base64: z.string().min(1).optional(),
  storagePath: z.string().min(1).max(500).optional(),
  sizeBytes: z.number().int().positive().optional(),
  note: z.string().trim().max(500).optional(),
}).refine((v) => Boolean(v.base64 || v.storagePath), { message: "Geen bestand ontvangen." });

/** Upload-URL voor een nieuwe versie (grote PDF direct naar opslag). */
export async function createScriptVersionUploadUrl(reviewId: string): Promise<ActionResult & { uploadUrl?: string; key?: string; headers?: Record<string, string> }> {
  try {
    const viewer = await requirePermission("scripts:write");
    const review = await loadReviewForStaff(viewer, reviewId);
    if (!review) return { ok: false, message: "Niet gevonden." };
    const target = await createScriptUploadTarget(review.clientId);
    if (!target) return { ok: true };
    return { ok: true, uploadUrl: target.uploadUrl, key: target.key, headers: target.headers };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Intern: een nieuwe PDF-versie uploaden en opnieuw ter controle naar de klant. */
export async function uploadScriptReviewVersion(input: z.infer<typeof versionSchema>): Promise<ActionResult> {
  try {
    const viewer = await requirePermission("scripts:write");
    const parsed = versionSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Controleer de invoer." };
    const { reviewId, fileName, base64, storagePath, note } = parsed.data;

    const isPdf = fileName.toLowerCase().endsWith(".pdf");
    if (!isPdf) return { ok: false, message: "Alleen een PDF-bestand." };
    const sizeBytes = base64 ? Math.floor((base64.length * 3) / 4) : (parsed.data.sizeBytes ?? 0);
    if (sizeBytes === 0) return { ok: false, message: "Leeg bestand." };
    if (sizeBytes > MAX_PDF_BYTES) return { ok: false, message: "Het bestand is te groot (max 15 MB)." };

    const review = await loadReviewForStaff(viewer, reviewId);
    if (!review) return { ok: false, message: "Niet gevonden." };
    const versionNumber = review.currentVersion + 1;

    await db.insert(scriptReviewVersions).values({ reviewId, versionNumber, fileName: fileName.slice(0, 255), contentType: "application/pdf", sizeBytes, dataBase64: base64 ?? null, storagePath: storagePath ?? null, note: note ?? null, uploadedById: viewer.id });
    await db.update(scriptReviews).set({ status: "opnieuw_controle", currentVersion: versionNumber, feedbackDeadline: await scriptFeedbackDeadline(), updatedAt: new Date() }).where(eq(scriptReviews.id, reviewId));

    await auditLog({ viewer, action: "script_review.new_version", entityType: "script_review", entityId: reviewId, clientId: review.clientId, changes: { version: versionNumber } });
    await recordActivity({ clientId: review.clientId, type: "script_review.new_version", title: "Aangepaste scripts klaargezet ter controle", isClientVisible: true });

    // Klant op de hoogte brengen van de nieuwe versie.
    const { ids, emails } = await portalUserIds(review.clientId);
    const staff = await clientStaff(review.clientId);
    const href = `/portal/scripts/${reviewId}`;
    const heading = "Aangepaste scripts staan klaar";
    const body = review.scheduledOn
      ? `De aangepaste scripts voor je opname van ${fmtDate(review.scheduledOn)} staan klaar. Bekijk ze en geef je feedback of keur ze goed.`
      : "De aangepaste scripts staan klaar om te bekijken.";
    if (ids.length > 0) {
      await notify({ userIds: ids, clientId: review.clientId, level: "info", type: "script_review_ready", title: heading, body, href, entityType: "script_review", entityId: reviewId, dedupeKey: `script_review_ready:${reviewId}:v${versionNumber}` });
    }
    if (emails.length > 0) {
      await sendEmail({ to: emails, subject: heading, text: `${body}\n\nBekijk de scripts: ${appUrl}${href}`, html: portalEmailHtml({ heading, body, ctaLabel: "Bekijk de scripts", ctaUrl: `${appUrl}${href}` }), replyTo: staff.coordinatorEmail ?? undefined }).catch(() => undefined);
    }

    revalidatePath(`/scriptcontrole/${reviewId}`);
    revalidatePath("/scriptcontrole");
    revalidatePath(`/portal/scripts/${reviewId}`);
    return { ok: true, reviewId };
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
