"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { clients, productionDays, scripts as scriptsTable, scriptReviewComments, scriptReviewPageApprovals, scriptReviewThreads, scriptReviewVersions, scriptReviews, users } from "@/db/schema";
import { assertClientAccess, ForbiddenError, requirePermission, requirePortal } from "@/server/auth/context";
import { auditLog, recordActivity } from "@/server/audit";
import { clearByDedupe, notify } from "@/server/notifications";
import { portalEmailHtml, sendEmail } from "@/server/email";
import { env } from "@/lib/env";
import { getFeedbackDays } from "@/server/portal-settings";
import { addWorkingDays } from "@/lib/workdays";
import { assertReviewAccess, ensureVersionPages, getReviewApproval } from "@/server/script-review";
import { carryOverPages } from "@/lib/script-approval";
import { syncScriptingTasks } from "@/server/scripting-tasks";
import { createScriptUploadTarget } from "@/server/scripts/script-storage";
import { ensureCaptionsForShoot } from "@/server/captions/run";
import { ensureBriefingForShoot } from "@/server/briefing/run";

/** Uiterste feedbackmoment: N werkdagen vanaf nu (eind van die dag). */
async function scriptFeedbackDeadline(): Promise<Date> {
  const { scripts } = await getFeedbackDays();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
  const day = addWorkingDays(today, Math.max(1, scripts));
  return new Date(`${day}T17:00:00`);
}

export type ActionResult = { ok: boolean; message?: string; reviewId?: string; round?: "open" | "approved" | "feedback" };

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

/**
 * Houdt de interne scriptingstatus van de opname gelijk met wat de klant doet,
 * zodat niemand dat handmatig hoeft bij te werken:
 *  - scripts verstuurd → "Controle bij klant" (taak van de schrijver sluit);
 *  - klant stelt wijzigingen voor → "Feedback verwerken" (taak "Scripts aanpassen");
 *  - klant keurt alles goed → "Final voor opname" (taak sluit).
 * Faalt stil: de klantactie zelf mag hier nooit op mislukken.
 */
async function syncDayScriptingStatus(productionDayId: string, status: "scripts_bij_klant" | "feedback_jarno" | "final"): Promise<void> {
  try {
    const [d] = await db.select({ prev: productionDays.scriptingStatus }).from(productionDays).where(eq(productionDays.id, productionDayId)).limit(1);
    if (!d || d.prev === status) return;
    await db.update(productionDays).set({ scriptingStatus: status, updatedAt: new Date() }).where(eq(productionDays.id, productionDayId));
    if (d.prev === "controle_jarno") await clearByDedupe(`scripting_controle:${productionDayId}`);
    await syncScriptingTasks([productionDayId]);
    revalidatePath("/scripting");
  } catch (error) {
    console.error("[script-review] scriptingstatus bijwerken mislukt", productionDayId, error);
  }
}

/** Id van een bepaalde versie van een review. */
async function versionIdOf(reviewId: string, versionNumber: number): Promise<string | null> {
  const [v] = await db
    .select({ id: scriptReviewVersions.id })
    .from(scriptReviewVersions)
    .where(and(eq(scriptReviewVersions.reviewId, reviewId), eq(scriptReviewVersions.versionNumber, versionNumber)))
    .limit(1);
  return v?.id ?? null;
}

/**
 * Neemt goedkeuringen van ongewijzigde scripts over naar een nieuwe versie (zelfde
 * aantal pagina's, geen opmerking in de vorige versie). Zo hoeft de klant alleen
 * de aangepaste scripts opnieuw te bekijken.
 */
async function carryOverApprovals(reviewId: string, prevVersion: number, newVersion: number): Promise<void> {
  try {
    const [prevId, newId] = await Promise.all([versionIdOf(reviewId, prevVersion), versionIdOf(reviewId, newVersion)]);
    if (!prevId || !newId) return;
    const [prev, next] = await Promise.all([ensureVersionPages(prevId), ensureVersionPages(newId)]);
    const [approved, comments] = await Promise.all([
      db.select({ page: scriptReviewPageApprovals.pageNumber, by: scriptReviewPageApprovals.approvedById, name: scriptReviewPageApprovals.approvedByName, at: scriptReviewPageApprovals.approvedAt })
        .from(scriptReviewPageApprovals)
        .where(and(eq(scriptReviewPageApprovals.reviewId, reviewId), eq(scriptReviewPageApprovals.versionNumber, prevVersion))),
      db.select({ page: scriptReviewThreads.pageNumber })
        .from(scriptReviewThreads)
        .where(and(eq(scriptReviewThreads.reviewId, reviewId), eq(scriptReviewThreads.versionNumber, prevVersion), eq(scriptReviewThreads.visibility, "client"), isNull(scriptReviewThreads.deletedAt))),
    ]);
    const keep = carryOverPages({
      prevPageCount: prev?.pageCount ?? null,
      newPageCount: next?.pageCount ?? null,
      prevApprovedPages: approved.map((a) => a.page),
      prevCommentPages: comments.map((c) => c.page).filter((p): p is number => p != null),
    });
    if (keep.length === 0) return;
    const byPage = new Map(approved.map((a) => [a.page, a]));
    await db.insert(scriptReviewPageApprovals).values(keep.map((page) => ({
      reviewId, versionNumber: newVersion, pageNumber: page,
      approvedById: byPage.get(page)?.by ?? null, approvedByName: byPage.get(page)?.name ?? null,
      approvedAt: byPage.get(page)?.at ?? new Date(), carriedOver: true,
    }))).onConflictDoNothing();
  } catch (error) {
    console.error("[script-review] goedkeuringen overnemen mislukt", reviewId, error);
  }
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

    if (herzien) await carryOverApprovals(reviewId, versionNumber - 1, versionNumber);
    await syncDayScriptingStatus(productionDayId, "scripts_bij_klant");

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

    // Automatisch captions (bij)maken voor deze opname op basis van de nieuwe
    // scriptcontrole-PDF — draait na de response, zonder de verstuur-actie te
    // vertragen. Faalt stil; de cron-inhaalronde pakt het anders alsnog op.
    after(async () => {
      try { await ensureCaptionsForShoot(productionDayId); } catch { /* cron vangt dit op */ }
      try { await ensureBriefingForShoot(productionDayId); } catch { /* cron vangt dit op */ }
    });
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

/** Gedeeld: een klantopmerking OPSLAAN (algemeen of op een pagina/positie).
 *  Plaatsen alleen = opslaan + tonen; de review-status verandert en het team
 *  krijgt pas bericht wanneer de klant op "Feedback doorgeven" klikt (zie
 *  submitScriptReviewFeedback). Zo plaatst de klant rustig meerdere opmerkingen
 *  zonder dat elk puntje een losse melding oplevert. */
async function createClientComment(
  viewer: Awaited<ReturnType<typeof requirePortal>>,
  input: z.infer<typeof commentSchema>,
): Promise<ActionResult & { versionNumber?: number }> {
  const { reviewId, body, pageNumber, posX, posY } = input;
  const [review] = await db
    .select({ id: scriptReviews.id, clientId: scriptReviews.clientId, currentVersion: scriptReviews.currentVersion, status: scriptReviews.status })
    .from(scriptReviews)
    .where(and(eq(scriptReviews.id, reviewId), eq(scriptReviews.clientId, viewer.clientId!), isNull(scriptReviews.deletedAt)))
    .limit(1);
  if (!review) return { ok: false, message: "Dit script is niet gevonden." };
  if (review.status === "goedgekeurd") return { ok: false, message: "Dit script is al goedgekeurd." };

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

  revalidatePath(`/portal/scripts/${reviewId}`);
  revalidatePath(`/scriptcontrole/${reviewId}`);
  return { ok: true, versionNumber: review.currentVersion };
}

/** Klant: opmerking opslaan (algemeen of op een plek/zin in de PDF). Verandert de
 *  status NIET en stuurt geen melding — dat gebeurt zodra de ronde rond is (zie
 *  finalizeRoundIfHandled) of bij "Wijzigingen nu doorsturen". */
export async function addScriptReviewComment(input: { reviewId: string; body: string; pageNumber?: number; posX?: number; posY?: number }): Promise<ActionResult> {
  try {
    const viewer = await requirePortal();
    const parsed = commentSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Controleer je opmerking." };
    const res = await createClientComment(viewer, parsed.data);
    if (!res.ok) return res;
    // Opmerking op een script dat al akkoord was? Dan geldt die goedkeuring niet meer.
    if (parsed.data.pageNumber && res.versionNumber) {
      await db.delete(scriptReviewPageApprovals).where(and(
        eq(scriptReviewPageApprovals.reviewId, parsed.data.reviewId),
        eq(scriptReviewPageApprovals.versionNumber, res.versionNumber),
        eq(scriptReviewPageApprovals.pageNumber, parsed.data.pageNumber),
      ));
    }
    const round = await finalizeRoundIfHandled(viewer, parsed.data.reviewId);
    revalidatePortalReview(parsed.data.reviewId);
    return { ok: true, round };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

type PortalViewer = Awaited<ReturnType<typeof requirePortal>>;
type ReviewRow = { id: string; clientId: string; productionDayId: string; currentVersion: number; status: string };

async function loadPortalReview(viewer: PortalViewer, reviewId: string): Promise<ReviewRow | null> {
  const [review] = await db
    .select({ id: scriptReviews.id, clientId: scriptReviews.clientId, productionDayId: scriptReviews.productionDayId, currentVersion: scriptReviews.currentVersion, status: scriptReviews.status })
    .from(scriptReviews)
    .where(and(eq(scriptReviews.id, reviewId), eq(scriptReviews.clientId, viewer.clientId!), isNull(scriptReviews.deletedAt)))
    .limit(1);
  return review ?? null;
}

function revalidatePortalReview(reviewId: string) {
  revalidatePath(`/portal/scripts/${reviewId}`);
  revalidatePath("/portal/scripts");
  revalidatePath("/portal");
  revalidatePath(`/scriptcontrole/${reviewId}`);
  revalidatePath("/scripting");
}

/** Aantal klantopmerkingen op de huidige versie. */
async function clientCommentCount(reviewId: string, versionNumber: number): Promise<number> {
  const [{ cnt }] = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(scriptReviewThreads)
    .where(and(eq(scriptReviewThreads.reviewId, reviewId), eq(scriptReviewThreads.versionNumber, versionNumber), eq(scriptReviewThreads.visibility, "client"), isNull(scriptReviewThreads.deletedAt)));
  return Number(cnt ?? 0);
}

/** Zet de review op "feedback gegeven" en stuurt het team één melding per versie. */
async function markFeedbackGiven(review: ReviewRow, cnt: number): Promise<void> {
  await db.update(scriptReviews).set({ status: "feedback_gegeven", updatedAt: new Date() })
    .where(and(eq(scriptReviews.id, review.id), sql`${scriptReviews.status} <> 'goedgekeurd'`));
  await recordActivity({ clientId: review.clientId, type: "script_review.feedback", title: "Klant stelde wijzigingen voor in de scripts", isClientVisible: false });
  const staff = await clientStaff(review.clientId);
  await notify({
    roles: ["owner"],
    userIds: staff.coordinatorId ? [staff.coordinatorId] : undefined,
    clientId: review.clientId,
    level: "warning",
    type: "script_review_feedback",
    title: `${staff.clientName} stelde wijzigingen voor in de scripts`,
    body: `${cnt} opmerking${cnt === 1 ? "" : "en"} op versie ${review.currentVersion}. Bekijk en verwerk ze.`,
    href: `/scriptcontrole/${review.id}`,
    entityType: "script_review",
    entityId: review.id,
    dedupeKey: `script_review_feedback:${review.id}:v${review.currentVersion}`,
  });
  await syncDayScriptingStatus(review.productionDayId, "feedback_jarno");
}

/** Definitieve goedkeuring van de hele review (deze versie). Eén keer, ook bij dubbel klikken. */
async function markApproved(viewer: PortalViewer, review: ReviewRow): Promise<void> {
  const updated = await db
    .update(scriptReviews)
    .set({ status: "goedgekeurd", approvedAt: new Date(), approvedById: viewer.id, approvedVersion: review.currentVersion, updatedAt: new Date() })
    .where(and(eq(scriptReviews.id, review.id), sql`${scriptReviews.status} <> 'goedgekeurd'`))
    .returning({ id: scriptReviews.id });
  if (updated.length === 0) return; // al goedgekeurd (bijv. tweede klik of tweede tabblad)

  await auditLog({ viewer, action: "script_review.approved", entityType: "script_review", entityId: review.id, clientId: review.clientId, changes: { version: review.currentVersion } });
  await recordActivity({ clientId: review.clientId, type: "script_review.approved_by_client", title: "Scripts goedgekeurd door de klant", isClientVisible: true });

  const staff = await clientStaff(review.clientId);
  await notify({
    roles: ["owner"],
    userIds: staff.coordinatorId ? [staff.coordinatorId] : undefined,
    clientId: review.clientId,
    level: "success",
    type: "script_review_approved",
    title: `${staff.clientName} keurde alle scripts goed`,
    body: `Versie ${review.currentVersion} is goedgekeurd. De scripting staat op Final voor opname.`,
    href: `/scriptcontrole/${review.id}`,
    entityType: "script_review",
    entityId: review.id,
    dedupeKey: `script_review_approved:${review.id}:v${review.currentVersion}`,
  });
  // Openstaande feedbackmelding van deze versie is hiermee achterhaald.
  await clearByDedupe(`script_review_feedback:${review.id}:v${review.currentVersion}`);
  await syncDayScriptingStatus(review.productionDayId, "final");
}

export type RoundOutcome = "open" | "approved" | "feedback";

/**
 * Rondt de beoordelingsronde automatisch af zodra elk script behandeld is:
 * alles goedgekeurd → review goedgekeurd; anders (minstens één wijziging) →
 * feedback naar het team, in één melding. Nog open scripts → niets.
 */
async function finalizeRoundIfHandled(viewer: PortalViewer, reviewId: string): Promise<RoundOutcome> {
  const review = await loadPortalReview(viewer, reviewId);
  if (!review || review.status === "goedgekeurd") return review ? "approved" : "open";
  const versionId = await versionIdOf(reviewId, review.currentVersion);
  const { summary } = await getReviewApproval(reviewId, review.currentVersion, versionId);
  if (!summary.allHandled) return "open";
  if (summary.allApproved) {
    await markApproved(viewer, review);
    return "approved";
  }
  if (review.status !== "feedback_gegeven" && review.status !== "wordt_aangepast") {
    await markFeedbackGiven(review, await clientCommentCount(reviewId, review.currentVersion));
  }
  return "feedback";
}

const pageSchema = z.object({ reviewId: z.string().uuid(), pageNumber: z.number().int().positive() });

/** Controleert of een pagina een script is in de huidige versie. */
async function isScriptPage(reviewId: string, versionNumber: number, pageNumber: number): Promise<boolean> {
  const id = await versionIdOf(reviewId, versionNumber);
  if (!id) return false;
  const info = await ensureVersionPages(id);
  return !!info && pageNumber >= info.from && pageNumber <= info.to;
}

/** Klant: keurt één script goed. Dubbel klikken heeft geen effect. */
export async function approveScriptPage(input: { reviewId: string; pageNumber: number }): Promise<ActionResult & { round?: RoundOutcome }> {
  try {
    const viewer = await requirePortal();
    const parsed = pageSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "Onbekend script." };
    const review = await loadPortalReview(viewer, parsed.data.reviewId);
    if (!review) return { ok: false, message: "Dit script is niet gevonden." };
    if (review.status === "goedgekeurd") return { ok: true, round: "approved" };
    if (!(await isScriptPage(review.id, review.currentVersion, parsed.data.pageNumber))) return { ok: false, message: "Onbekend script." };

    await db.insert(scriptReviewPageApprovals).values({
      reviewId: review.id, versionNumber: review.currentVersion, pageNumber: parsed.data.pageNumber,
      approvedById: viewer.id, approvedByName: viewer.fullName,
    }).onConflictDoNothing();
    await auditLog({ viewer, action: "script_review.page_approved", entityType: "script_review", entityId: review.id, clientId: review.clientId, changes: { version: review.currentVersion, page: parsed.data.pageNumber } });

    const round = await finalizeRoundIfHandled(viewer, review.id);
    revalidatePortalReview(review.id);
    return { ok: true, round };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Klant: goedkeuring van één script terugdraaien (zolang de ronde nog loopt). */
export async function undoScriptPageApproval(input: { reviewId: string; pageNumber: number }): Promise<ActionResult> {
  try {
    const viewer = await requirePortal();
    const parsed = pageSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "Onbekend script." };
    const review = await loadPortalReview(viewer, parsed.data.reviewId);
    if (!review) return { ok: false, message: "Dit script is niet gevonden." };
    if (review.status === "goedgekeurd") return { ok: false, message: "De scripts zijn al definitief goedgekeurd. Neem contact op als er toch iets moet veranderen." };
    await db.delete(scriptReviewPageApprovals).where(and(
      eq(scriptReviewPageApprovals.reviewId, review.id),
      eq(scriptReviewPageApprovals.versionNumber, review.currentVersion),
      eq(scriptReviewPageApprovals.pageNumber, parsed.data.pageNumber),
    ));
    revalidatePortalReview(review.id);
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/**
 * Klant: alle scripts die nog open staan in één keer goedkeuren. Alleen te
 * gebruiken nadat de klant alle scripts in beeld heeft gehad (de knop wordt pas
 * dan actief). Scripts met een voorgestelde wijziging blijven ongemoeid.
 */
export async function approveRemainingScripts(reviewId: string): Promise<ActionResult & { round?: RoundOutcome }> {
  try {
    const viewer = await requirePortal();
    const id = z.string().uuid().parse(reviewId);
    const review = await loadPortalReview(viewer, id);
    if (!review) return { ok: false, message: "Dit script is niet gevonden." };
    if (review.status === "goedgekeurd") return { ok: true, round: "approved" };

    const versionId = await versionIdOf(id, review.currentVersion);
    const { scripts } = await getReviewApproval(id, review.currentVersion, versionId);
    const open = scripts.filter((s) => s.state === "todo" || s.state === "revised").map((s) => s.page);
    if (scripts.length === 0) {
      // Pagina's niet te bepalen (afwijkende PDF): het hele document goedkeuren.
      await markApproved(viewer, review);
      revalidatePortalReview(id);
      return { ok: true, round: "approved" };
    }
    if (open.length > 0) {
      await db.insert(scriptReviewPageApprovals).values(open.map((pageNumber) => ({
        reviewId: id, versionNumber: review.currentVersion, pageNumber, approvedById: viewer.id, approvedByName: viewer.fullName,
      }))).onConflictDoNothing();
      await auditLog({ viewer, action: "script_review.pages_approved", entityType: "script_review", entityId: id, clientId: review.clientId, changes: { version: review.currentVersion, pages: open } });
    }
    const round = await finalizeRoundIfHandled(viewer, id);
    revalidatePortalReview(id);
    return { ok: true, round };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/**
 * Klant: "Wijzigingen nu doorsturen" — voor als de klant de voorgestelde
 * wijzigingen al wil versturen terwijl nog niet elk script beoordeeld is.
 * Optioneel met een algemene notitie. Eén melding naar het team.
 */
export async function submitScriptReviewFeedback(input: { reviewId: string; note?: string }): Promise<ActionResult> {
  try {
    const viewer = await requirePortal();
    const reviewId = z.string().uuid().parse(input.reviewId);
    const review = await loadPortalReview(viewer, reviewId);
    if (!review) return { ok: false, message: "Dit script is niet gevonden." };
    if (review.status === "goedgekeurd") return { ok: false, message: "Dit script is al goedgekeurd." };

    const note = input.note?.trim().slice(0, 4000);
    if (note) {
      const [t] = await db.insert(scriptReviewThreads).values({
        reviewId, versionNumber: review.currentVersion, pageNumber: null,
        visibility: "client", createdById: viewer.id, authorName: viewer.fullName,
      }).returning({ id: scriptReviewThreads.id });
      if (t) await db.insert(scriptReviewComments).values({ threadId: t.id, body: note, authorUserId: viewer.id, authorName: viewer.fullName, isInternal: false });
    }

    const cnt = await clientCommentCount(reviewId, review.currentVersion);
    if (cnt === 0) return { ok: false, message: "Beschrijf eerst welke wijziging je wilt voorstellen." };

    await markFeedbackGiven(review, cnt);
    revalidatePortalReview(reviewId);
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}

/**
 * Klant: keurt de scripts in één keer goed. Gebruikt als de scriptpagina's niet
 * te bepalen zijn; anders gelijk aan "alle resterende scripts goedkeuren".
 */
export async function approveScriptReview(reviewId: string): Promise<ActionResult> {
  return approveRemainingScripts(reviewId);
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

    await carryOverApprovals(reviewId, versionNumber - 1, versionNumber);
    await syncDayScriptingStatus(review.productionDayId, "scripts_bij_klant");

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

    // Nieuwe scriptversie → captions bijwerken (behoudt handmatig bewerkte).
    after(async () => {
      try { await ensureCaptionsForShoot(review.productionDayId); } catch { /* cron vangt dit op */ }
      try { await ensureBriefingForShoot(review.productionDayId); } catch { /* cron vangt dit op */ }
    });
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
