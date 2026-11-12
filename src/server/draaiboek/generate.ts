import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { draaiboeken, productionDays, shootScriptSources } from "@/db/schema";
import { shootReviewPdf } from "@/server/captions/generate";
import { parseScriptPdf } from "@/server/briefing/script-pdf";
import { runJsonPrompt } from "@/server/ai/client";
import { buildDraaiboekContent, mergeHints } from "./build";
import { isDraaiboekContent, type DraaiboekContent, type DraaiboekProgress } from "./types";

const HINT_SYSTEM = `Je helpt een videograaf van Shortclips tijdens een opnamedag. Je krijgt per video de scripttekst (hook, middenstuk, call to action).
Geef per onderdeel hooguit twee korte shotaanwijzingen en per video hooguit vier B-roll-beelden die de montage echt nodig heeft.
Regels:
- Alleen wat logisch uit het script volgt. Verzin geen nieuwe scènes, personen of locaties.
- Nooit uitgesproken tekst, geen herhaling van de scripttekst.
- Kort en praktisch: maximaal 8 woorden per aanwijzing, gewone taal (bijv. "Close-up van het product in de hand").
- Richting geven, niet voorschrijven: de videograaf kiest zelf camerastandpunten en uitvoering. Laat een onderdeel leeg als er niets belangrijks is.
Antwoord uitsluitend met JSON: {"videos":[{"nr":1,"hook":[],"middenstuk":[],"cta":[],"broll":[]}]}`;

export type GenerateResult = { ok: true } | { ok: false; reason: "not_found" | "no_pdf" | "drive_unreachable" | "no_scripts" | "error"; message?: string };

/**
 * Bouwt (of herbouwt) het draaiboek van één opname uit de actuele script-PDF.
 * Scripttekst letterlijk uit de PDF; korte shotaanwijzingen en B-roll aangevuld
 * door AI als dat lukt (lukt het niet, dan blijft het draaiboek gewoon bruikbaar).
 * Een (her)generatie zet het draaiboek altijd terug op concept: eerst controleren.
 * Voortgang van video's die blijven bestaan blijft staan.
 */
export async function generateDraaiboek(productionDayId: string): Promise<GenerateResult> {
  const [day] = await db
    .select({ id: productionDays.id, clientId: productionDays.clientId })
    .from(productionDays)
    .where(and(eq(productionDays.id, productionDayId), isNull(productionDays.deletedAt)))
    .limit(1);
  if (!day) return { ok: false, reason: "not_found" };

  const pdf = await shootReviewPdf(productionDayId);
  if (!pdf) {
    // Wel een gekoppelde Drive-PDF, maar niet op te halen: meestal is de Google Drive-koppeling verlopen.
    const [linked] = await db
      .select({ id: shootScriptSources.productionDayId })
      .from(shootScriptSources)
      .where(and(eq(shootScriptSources.productionDayId, productionDayId), eq(shootScriptSources.status, "gekoppeld")))
      .limit(1);
    return { ok: false, reason: linked ? "drive_unreachable" : "no_pdf" };
  }

  let content: DraaiboekContent;
  try {
    const parsed = await parseScriptPdf(new Uint8Array(Buffer.from(pdf.pdfBase64, "base64")));
    content = buildDraaiboekContent(parsed);
  } catch (e) {
    return { ok: false, reason: "error", message: `De script-PDF kon niet worden gelezen (${e instanceof Error ? e.message.slice(0, 120) : "onbekende fout"}).` };
  }
  if (content.videos.length === 0) return { ok: false, reason: "no_scripts", message: content.warnings[0] };

  try {
    const user = content.videos
      .map((v) => `VIDEO ${v.nr}: ${v.titel}\nHOOK:\n${v.hook.tekst}\nMIDDENSTUK:\n${v.middenstuk.tekst}\nCALL TO ACTION:\n${v.cta.tekst}`)
      .join("\n\n---\n\n");
    const res = await runJsonPrompt<unknown>({ system: HINT_SYSTEM, user, maxTokens: 4000 });
    if (res.ok) content = mergeHints(content, res.data);
  } catch {
    // Aanwijzingen zijn een aanvulling; zonder AI blijft het draaiboek compleet.
  }

  const [existing] = await db
    .select({ id: draaiboeken.id, progress: draaiboeken.progress, content: draaiboeken.content })
    .from(draaiboeken)
    .where(eq(draaiboeken.productionDayId, productionDayId))
    .limit(1);
  const prevProgress = (existing?.progress ?? {}) as DraaiboekProgress;
  const prevContent = existing && isDraaiboekContent(existing.content) ? existing.content : null;
  // Voortgang alleen behouden voor video's met dezelfde titel op dezelfde plek.
  const progress: DraaiboekProgress = {};
  for (const v of content.videos) {
    const old = prevContent?.videos.find((x) => x.key === v.key);
    if (old && old.titel === v.titel && prevProgress[v.key]) progress[v.key] = prevProgress[v.key]!;
  }

  const now = new Date();
  await db
    .insert(draaiboeken)
    .values({
      productionDayId,
      clientId: day.clientId,
      status: "concept",
      sourceHash: pdf.hash,
      sourceFileName: pdf.fileName,
      content,
      progress,
      generatedAt: now,
    })
    .onConflictDoUpdate({
      target: draaiboeken.productionDayId,
      set: {
        status: "concept",
        sourceHash: pdf.hash,
        sourceFileName: pdf.fileName,
        content,
        progress,
        generatedAt: now,
        finishedAt: null,
        deletedAt: null,
        updatedAt: now,
      },
    });
  return { ok: true };
}
