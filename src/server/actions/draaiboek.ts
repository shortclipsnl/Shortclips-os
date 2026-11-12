"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { draaiboekNotes, draaiboeken, productionDays } from "@/db/schema";
import { assertClientAccess, ForbiddenError, requireInternal } from "@/server/auth/context";
import { auditLog } from "@/server/audit";
import { notify } from "@/server/notifications";
import { runJsonPrompt } from "@/server/ai/client";
import { assertCanManageDraaiboek, assertCanRecord } from "@/server/draaiboek/service";
import { sessionProgress, type DraaiboekContent, type DraaiboekProgress } from "@/server/draaiboek/types";

export type DraaiboekActionResult = { ok: boolean; message?: string };

const dayId = z.string().uuid();

function revalidate(productionDayId: string) {
  revalidatePath("/scripting");
  revalidatePath("/draaiboek");
  revalidatePath(`/draaiboek/${productionDayId}`);
  revalidatePath(`/draaiboek/${productionDayId}/controle`);
}

async function guard<T>(fn: () => Promise<T>): Promise<T | DraaiboekActionResult> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    if (error instanceof z.ZodError) return { ok: false, message: "Controleer de invoer." };
    throw error;
  }
}

/** Draaiboek (opnieuw) genereren uit de script-PDF van de sessie. */
export async function generateDraaiboekAction(productionDayId: string): Promise<DraaiboekActionResult> {
  return guard(async () => {
    const viewer = await requireInternal();
    assertCanManageDraaiboek(viewer);
    const id = dayId.parse(productionDayId);
    const [day] = await db.select({ clientId: productionDays.clientId }).from(productionDays).where(eq(productionDays.id, id)).limit(1);
    if (!day) return { ok: false, message: "Onbekende opname." };
    assertClientAccess(viewer, day.clientId);
    const { generateDraaiboek } = await import("@/server/draaiboek/generate");
    const res = await generateDraaiboek(id);
    revalidate(id);
    if (res.ok) {
      await auditLog({ viewer, action: "draaiboek.generated", entityType: "production_day", entityId: id, clientId: day.clientId }).catch(() => undefined);
      return { ok: true, message: "Draaiboek gemaakt. Controleer het en verstuur het daarna." };
    }
    if (res.reason === "drive_unreachable")
      return { ok: false, message: "De script-PDF staat in Google Drive, maar kon niet worden opgehaald. Controleer de Google Drive-koppeling via Instellingen > Koppelingen en probeer het daarna opnieuw." };
    if (res.reason === "no_pdf") return { ok: false, message: "Er is nog geen script-PDF gekoppeld aan deze opname. Koppel eerst de script-PDF." };
    return { ok: false, message: res.message ?? "Het draaiboek kon niet worden gemaakt." };
  }) as Promise<DraaiboekActionResult>;
}

const partSchema = z.object({ tekst: z.string().max(20000), aanwijzingen: z.array(z.string().trim().min(1).max(200)).max(8) });
const contentSchema = z.object({
  v: z.literal(1),
  warnings: z.array(z.string()).max(50),
  videos: z
    .array(
      z.object({
        key: z.string().min(1).max(40),
        nr: z.number().int().min(1).max(99),
        titel: z.string().trim().min(1).max(300),
        hook: partSchema,
        middenstuk: partSchema,
        cta: partSchema,
        broll: z.array(z.string().trim().min(1).max(200)).max(20),
      }),
    )
    .min(1)
    .max(60),
});

/** Aanpassingen uit de controlestap opslaan (blijft concept tot versturen). */
export async function saveDraaiboekAction(productionDayId: string, content: DraaiboekContent): Promise<DraaiboekActionResult> {
  return guard(async () => {
    const viewer = await requireInternal();
    assertCanManageDraaiboek(viewer);
    const id = dayId.parse(productionDayId);
    const data = contentSchema.parse(content) as DraaiboekContent;
    const [d] = await db.select({ id: draaiboeken.id, clientId: draaiboeken.clientId, status: draaiboeken.status }).from(draaiboeken).where(and(eq(draaiboeken.productionDayId, id), isNull(draaiboeken.deletedAt))).limit(1);
    if (!d) return { ok: false, message: "Er is nog geen draaiboek voor deze opname." };
    assertClientAccess(viewer, d.clientId);
    await db.update(draaiboeken).set({ content: data, updatedAt: new Date() }).where(eq(draaiboeken.id, d.id));
    revalidate(id);
    return { ok: true, message: d.status === "concept" ? "Opgeslagen als concept." : "Wijzigingen opgeslagen. De videograaf ziet ze direct." };
  }) as Promise<DraaiboekActionResult>;
}

/** Goedkeuren en versturen naar de videograaf. */
export async function approveAndSendDraaiboekAction(productionDayId: string, content: DraaiboekContent, videographerId: string): Promise<DraaiboekActionResult> {
  return guard(async () => {
    const viewer = await requireInternal();
    assertCanManageDraaiboek(viewer);
    const id = dayId.parse(productionDayId);
    const toId = z.string().uuid().parse(videographerId);
    const data = contentSchema.parse(content) as DraaiboekContent;
    const [d] = await db
      .select({ id: draaiboeken.id, clientId: draaiboeken.clientId, dayVideographer: productionDays.videographerId, title: productionDays.title, scheduledOn: productionDays.scheduledOn })
      .from(draaiboeken)
      .innerJoin(productionDays, eq(productionDays.id, draaiboeken.productionDayId))
      .where(and(eq(draaiboeken.productionDayId, id), isNull(draaiboeken.deletedAt)))
      .limit(1);
    if (!d) return { ok: false, message: "Er is nog geen draaiboek voor deze opname." };
    assertClientAccess(viewer, d.clientId);
    const now = new Date();
    await db
      .update(draaiboeken)
      .set({ content: data, status: "verstuurd", sentToId: toId, sentById: viewer.id, sentAt: now, finishedAt: null, updatedAt: now })
      .where(eq(draaiboeken.id, d.id));
    // Opname zonder videograaf: de ontvanger wordt de videograaf van de opname.
    if (!d.dayVideographer) await db.update(productionDays).set({ videographerId: toId, updatedAt: now }).where(eq(productionDays.id, id));
    await notify({
      userIds: [toId],
      clientId: d.clientId,
      type: "draaiboek_verstuurd",
      level: "info",
      title: "Nieuw draaiboek klaar",
      body: `${d.title} (${new Date(`${d.scheduledOn}T12:00:00`).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" })})`,
      href: `/draaiboek/${id}`,
      entityType: "production_day",
      entityId: id,
      dedupeKey: `draaiboek-verstuurd-${id}-${now.toISOString().slice(0, 16)}`,
    }).catch(() => undefined);
    await auditLog({ viewer, action: "draaiboek.sent", entityType: "production_day", entityId: id, clientId: d.clientId, changes: { sentToId: toId } }).catch(() => undefined);
    revalidate(id);
    return { ok: true, message: "Goedgekeurd en verstuurd." };
  }) as Promise<DraaiboekActionResult>;
}

/** Onderdeel van een video afvinken of terugzetten. */
export async function setDraaiboekPartAction(productionDayId: string, videoKey: string, part: string, done: boolean): Promise<DraaiboekActionResult> {
  return guard(async () => {
    const viewer = await requireInternal();
    const id = dayId.parse(productionDayId);
    const key = z.string().min(1).max(40).parse(videoKey);
    const p = z.enum(["hook", "middenstuk", "cta", "broll"]).parse(part);
    const d = await assertCanRecord(viewer, id);
    if (!d.content.videos.some((v) => v.key === key)) return { ok: false, message: "Onbekende video." };
    // Alleen dit ene vinkje wijzigen (jsonb), zodat twee telefoons elkaar niet overschrijven.
    if (done) {
      await db.execute(
        sql`update draaiboeken set progress = jsonb_set(progress, ${`{${key}}`}::text[], coalesce(progress->${key}, '{}'::jsonb) || jsonb_build_object(${p}::text, true), true), updated_at = now() where id = ${d.id}`,
      );
    } else {
      await db.execute(sql`update draaiboeken set progress = jsonb_set(progress, ${`{${key}}`}::text[], coalesce(progress->${key}, '{}'::jsonb) - ${p}::text, true), updated_at = now() where id = ${d.id}`);
    }
    revalidatePath(`/draaiboek/${id}`);
    return { ok: true };
  }) as Promise<DraaiboekActionResult>;
}

const noteSchema = z.object({
  productionDayId: z.string().uuid(),
  videoKey: z.string().min(1).max(40),
  kind: z.enum(["notitie", "blokkade"]),
  text: z.string().trim().max(4000).optional().nullable(),
  audioBase64: z.string().max(14_000_000).optional().nullable(),
  audioMime: z.string().max(60).optional().nullable(),
  durationSec: z.number().int().min(0).max(1800).optional().nullable(),
});

/** Korte samenvatting alleen als een lange spraaknotitie daar duidelijker van wordt. */
async function summarize(text: string): Promise<string | null> {
  const words = text.trim().split(/\s+/).length;
  if (words < 35) return null;
  try {
    const res = await runJsonPrompt<{ samenvatting?: unknown }>({
      system:
        "Je vat een ingesproken notitie van een videograaf tijdens een opname samen in één korte, feitelijke zin in het Nederlands (maximaal 20 woorden). Voeg niets toe dat niet gezegd is. Antwoord als JSON: {\"samenvatting\":\"...\"}",
      user: text,
      maxTokens: 400,
    });
    const s = res.ok && typeof res.data?.samenvatting === "string" ? res.data.samenvatting.trim() : "";
    return s && s.split(/\s+/).length < words / 2 ? s : null;
  } catch {
    return null;
  }
}

/** Notitie of blokkade bij een video: getypt en/of ingesproken (audio blijft bewaard). */
export async function addDraaiboekNoteAction(input: z.input<typeof noteSchema>): Promise<DraaiboekActionResult> {
  return guard(async () => {
    const viewer = await requireInternal();
    const data = noteSchema.parse(input);
    const d = await assertCanRecord(viewer, data.productionDayId);
    if (!d.content.videos.some((v) => v.key === data.videoKey)) return { ok: false, message: "Onbekende video." };
    const text = data.text?.trim() || null;
    const audio = data.audioBase64 ? Buffer.from(data.audioBase64, "base64") : null;
    if (!text && !audio) return { ok: false, message: "De notitie is leeg." };
    const summary = text && audio ? await summarize(text) : null;
    await db.insert(draaiboekNotes).values({
      draaiboekId: d.id,
      videoKey: data.videoKey,
      kind: data.kind,
      text,
      summary,
      audio,
      audioMime: audio ? (data.audioMime ?? "audio/webm") : null,
      durationSec: data.durationSec ?? null,
      createdById: viewer.id,
    });
    revalidatePath(`/draaiboek/${data.productionDayId}`);
    return { ok: true, message: data.kind === "blokkade" ? "Blokkade vastgelegd." : "Notitie opgeslagen." };
  }) as Promise<DraaiboekActionResult>;
}

/** Notitie verwijderen (eigen notitie of Team Shortclips). */
export async function deleteDraaiboekNoteAction(productionDayId: string, noteId: string): Promise<DraaiboekActionResult> {
  return guard(async () => {
    const viewer = await requireInternal();
    const d = await assertCanRecord(viewer, dayId.parse(productionDayId));
    const [n] = await db.select({ id: draaiboekNotes.id, by: draaiboekNotes.createdById }).from(draaiboekNotes).where(and(eq(draaiboekNotes.id, z.string().uuid().parse(noteId)), eq(draaiboekNotes.draaiboekId, d.id))).limit(1);
    if (!n) return { ok: false, message: "Notitie niet gevonden." };
    if (n.by !== viewer.id) {
      try {
        assertCanManageDraaiboek(viewer);
      } catch {
        return { ok: false, message: "Je kunt alleen je eigen notities verwijderen." };
      }
    }
    await db.update(draaiboekNotes).set({ deletedAt: new Date() }).where(eq(draaiboekNotes.id, n.id));
    revalidatePath(`/draaiboek/${productionDayId}`);
    return { ok: true };
  }) as Promise<DraaiboekActionResult>;
}

/** Opnamesessie afronden. Met open onderdelen alleen na bevestiging, als "afgerond met open punten". */
export async function finishDraaiboekAction(productionDayId: string, note: string | null): Promise<DraaiboekActionResult> {
  return guard(async () => {
    const viewer = await requireInternal();
    const id = dayId.parse(productionDayId);
    const d = await assertCanRecord(viewer, id);
    const [row] = await db.select({ progress: draaiboeken.progress }).from(draaiboeken).where(eq(draaiboeken.id, d.id)).limit(1);
    const p = sessionProgress(d.content, (row?.progress ?? {}) as DraaiboekProgress);
    const open = p.total - p.done;
    const now = new Date();
    await db
      .update(draaiboeken)
      .set({ status: open > 0 ? "afgerond_open" : "afgerond", finishedAt: now, finishNote: note?.trim().slice(0, 2000) || null, updatedAt: now })
      .where(eq(draaiboeken.id, d.id));
    await auditLog({ viewer, action: "draaiboek.finished", entityType: "production_day", entityId: id, clientId: d.clientId, changes: { open } }).catch(() => undefined);
    revalidate(id);
    return { ok: true, message: open > 0 ? `Afgerond met ${open} open onderde${open === 1 ? "el" : "len"}.` : "Opnamesessie afgerond." };
  }) as Promise<DraaiboekActionResult>;
}
