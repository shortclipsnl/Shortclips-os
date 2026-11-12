import "server-only";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { contentResearchProfiles, files } from "@/db/schema";
import { drive } from "@/server/integrations/drive";
import { learnedFeedbackText } from "@/server/scripts/script-feedback";
import { gatherFeedbackContext } from "@/server/script-control";
import {
  cleanScriptText,
  hasStyle,
  normalizeStyle,
  pickStyleFiles,
  styleFingerprint,
  type ScriptFileKind,
  type StyleProfile,
} from "./style-core";
import type { ScriptDoc } from "./style-ai";
import type { PostAnalysis } from "./post-performance";
import { buildStyleProfile, videoEvidenceText } from "./style-ai";

export { videoEvidenceText };

/**
 * Stijlprofiel per klant uit de ECHTE Shortclips-scripts in Google Drive.
 *
 * Het profiel wordt alleen opnieuw gemaakt als de scriptbestanden veranderen
 * (vingerafdruk) of na 30 dagen. Zo kost het nauwelijks extra: één AI-aanroep
 * per klant per nieuwe opnamesessie.
 */

const MAX_FILES = 8;
const MAX_TOTAL_CHARS = 48_000;
const REFRESH_DAYS = 30;

export type StyleSource = { name: string; modifiedAt: string | null; chars: number };

export type StoredStyle = {
  profile: StyleProfile | null;
  sources: StyleSource[];
  fingerprint: string | null;
  updatedAt: Date | null;
  notes: string;
};

export async function loadStoredStyle(clientId: string): Promise<StoredStyle> {
  const [row] = await db
    .select({
      style: contentResearchProfiles.style,
      sources: contentResearchProfiles.styleSources,
      fingerprint: contentResearchProfiles.styleFingerprint,
      updatedAt: contentResearchProfiles.styleUpdatedAt,
      notes: contentResearchProfiles.styleNotes,
    })
    .from(contentResearchProfiles)
    .where(eq(contentResearchProfiles.clientId, clientId))
    .limit(1);
  const profile = row?.style ? normalizeStyle(row.style) : null;
  return {
    profile: hasStyle(profile) ? profile : null,
    sources: Array.isArray(row?.sources) ? (row!.sources as StyleSource[]) : [],
    fingerprint: row?.fingerprint ?? null,
    updatedAt: row?.updatedAt ?? null,
    notes: row?.notes ?? "",
  };
}

/** Kandidaat-scriptbestanden van een klant uit de gesynchroniseerde Drive-map. */
async function scriptFileRows(clientId: string) {
  const rows = await db
    .select({
      externalId: files.externalId,
      name: files.name,
      mimeType: files.mimeType,
      sizeBytes: files.sizeBytes,
      modifiedAt: files.modifiedAt,
    })
    .from(files)
    .where(and(
      eq(files.clientId, clientId),
      eq(files.isFolder, false),
      isNull(files.deletedAt),
      or(
        eq(files.category, "Scripts"),
        sql`lower(${files.path}) like '%script%'`,
        sql`lower(${files.name}) like '%script%'`,
      ),
    ))
    .orderBy(desc(files.modifiedAt))
    .limit(200);
  return pickStyleFiles(rows.map((r) => ({ ...r, sizeBytes: r.sizeBytes == null ? null : Number(r.sizeBytes) })), MAX_FILES);
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const { loadPdfjs } = await import("@/server/briefing/pdfjs-server");
  const pdfjs = await loadPdfjs();
  // Zelfde instellingen als de bestaande script-PDF-lezer (werkt op Vercel).
  const doc = await pdfjs.getDocument({ data: bytes.slice(), disableFontFace: true, isEvalSupported: false, useSystemFonts: false }).promise;
  const parts: string[] = [];
  try {
    for (let i = 1; i <= Math.min(doc.numPages, 40); i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      parts.push(content.items.map((it) => {
        const x = it as { str?: string; hasEOL?: boolean };
        return (x.str ?? "") + (x.hasEOL ? "\n" : " ");
      }).join(""));
    }
  } finally {
    await doc.destroy();
  }
  return parts.join("\n");
}

/** Leest de tekst van één scriptbestand. Faalt stil (bestand overslaan). */
async function readScriptFile(f: { externalId: string | null; kind: ScriptFileKind; sizeBytes: number | null; name: string }, errors: string[]): Promise<string> {
  if (!f.externalId) return "";
  let step = "downloaden";
  try {
    if (f.kind === "gdoc") return await drive.exportText(f.externalId);
    if (f.sizeBytes && f.sizeBytes > 15 * 1024 * 1024) return "";
    const bytes = await drive.downloadBytes(f.externalId);
    step = "uitlezen";
    if (f.kind === "pdf") return await pdfText(bytes);
    const { extractDocxText } = await import("@/server/ai/docx");
    return await extractDocxText(Buffer.from(bytes).toString("base64"));
  } catch (e) {
    const msg = `${f.name} (${step}): ${e instanceof Error ? e.message : String(e)}`.slice(0, 300);
    errors.push(msg);
    console.error("[content-research/stijl]", msg);
    return "";
  }
}


/** Uitgelezen scripts, nieuwste eerst, binnen het tekstbudget. */
export async function readClientScripts(clientId: string): Promise<{ docs: ScriptDoc[]; fingerprint: string; picked: number; errors: string[] }> {
  const picked = await scriptFileRows(clientId);
  const fingerprint = styleFingerprint(picked);
  const errors: string[] = [];
  if (!drive.isConfigured) return { docs: [], fingerprint, picked: picked.length, errors: ["Google Drive is niet gekoppeld."] };
  const docs: ScriptDoc[] = [];
  let total = 0;
  for (const f of picked) {
    if (total >= MAX_TOTAL_CHARS) break;
    const text = cleanScriptText(await readScriptFile(f, errors), Math.min(12_000, MAX_TOTAL_CHARS - total));
    if (text.length < 200) continue;
    total += text.length;
    docs.push({
      name: f.name,
      modifiedAt: f.modifiedAt ? (f.modifiedAt instanceof Date ? f.modifiedAt.toISOString() : String(f.modifiedAt)).slice(0, 10) : null,
      text,
    });
  }
  return { docs, fingerprint, picked: picked.length, errors };
}

function feedbackToText(f: Awaited<ReturnType<typeof gatherFeedbackContext>> | null): string {
  if (!f) return "";
  const parts: string[] = [];
  if (f.afspraken) parts.push(`Afspraken: ${f.afspraken}`);
  if (f.recenteScriptfeedback.length) parts.push(`Op scripts:\n- ${f.recenteScriptfeedback.join("\n- ")}`);
  if (f.recenteKlantopmerkingen.length) parts.push(`Op video's:\n- ${f.recenteKlantopmerkingen.join("\n- ")}`);
  return parts.join("\n");
}

/**
 * Zorgt dat het stijlprofiel actueel is. Maakt het alleen opnieuw als de
 * scriptbestanden of de teamcorrecties veranderden, of na 30 dagen.
 */
export async function ensureStyleProfile(
  clientId: string,
  clientName: string,
  opts: { force?: boolean; videoAnalysis?: PostAnalysis | null } = {},
): Promise<{ ok: boolean; changed: boolean; profile: StyleProfile | null; scripts: number; error?: string; diagnose?: { gekozen: number; gelezen: number; fouten: string[] } }> {
  const stored = await loadStoredStyle(clientId);
  const picked = await scriptFileRows(clientId);
  const fingerprint = styleFingerprint(picked, stored.notes);
  const fresh = stored.updatedAt && Date.now() - stored.updatedAt.getTime() < REFRESH_DAYS * 86_400_000;
  if (!opts.force && stored.profile && stored.fingerprint === fingerprint && fresh) {
    return { ok: true, changed: false, profile: stored.profile, scripts: stored.sources.length };
  }

  const { docs, picked: gekozen, errors } = await readClientScripts(clientId);
  const diagnose = { gekozen, gelezen: docs.length, fouten: errors.slice(0, 5) };
  if (docs.length === 0) {
    // Geen leesbare scripts: bestaand profiel houden, niets verzinnen.
    return { ok: true, changed: false, profile: stored.profile, scripts: 0, diagnose };
  }
  const [rulesOrg, feedback] = await Promise.all([
    learnedFeedbackText(clientId, "organisch").catch(() => ""),
    gatherFeedbackContext(clientId).catch(() => null),
  ]);
  const res = await buildStyleProfile({
    clientName,
    docs,
    learnedRules: rulesOrg,
    feedback: feedbackToText(feedback),
    videoText: videoEvidenceText(opts.videoAnalysis ?? null),
    teamNotes: stored.notes,
  });
  if (!res.ok) return { ok: false, changed: false, profile: stored.profile, scripts: docs.length, error: res.error, diagnose };

  const sources: StyleSource[] = docs.map((d) => ({ name: d.name, modifiedAt: d.modifiedAt, chars: d.text.length }));
  const now = new Date();
  await db
    .insert(contentResearchProfiles)
    .values({ clientId, style: res.profile as unknown as Record<string, unknown>, styleSources: sources as unknown as Record<string, unknown>, styleFingerprint: fingerprint, styleUpdatedAt: now })
    .onConflictDoUpdate({
      target: contentResearchProfiles.clientId,
      set: { style: res.profile as unknown as Record<string, unknown>, styleSources: sources as unknown as Record<string, unknown>, styleFingerprint: fingerprint, styleUpdatedAt: now, updatedAt: now },
    });
  return { ok: true, changed: true, profile: res.profile, scripts: docs.length, diagnose };
}

/** Teamcorrecties op de stijl opslaan; het profiel wordt bij de volgende ronde ververst. */
export async function saveStyleNotes(clientId: string, notes: string, userId?: string | null): Promise<void> {
  const now = new Date();
  await db
    .insert(contentResearchProfiles)
    .values({ clientId, styleNotes: notes, updatedById: userId ?? null })
    .onConflictDoUpdate({ target: contentResearchProfiles.clientId, set: { styleNotes: notes, updatedById: userId ?? null, updatedAt: now } });
}
