import "server-only";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "@/db/client";
import { adEditFeedback, adEditProjects, adEditSources, adStyleAssets, adStyleProfiles, adStyleReferences, aiEditorJobs } from "@/db/schema";
import { drive } from "@/server/integrations/drive";
import { run, whisperPython } from "@/server/video-intelligence/tools";
import { aiAvailable, aiCostCents, callClaude } from "./ai";
import { applyOps, feedbackPrompt, parseAiOps, parseFeedbackRules, type ApplyContext, type FeedbackOp } from "./feedback";
import { matchGrade } from "./grade";
import { colorStats, detectLog, extractAudioWav, loudness, meanVolume, mediaDuration, probe, sceneCuts, silences, type Probe } from "./media";
import { deriveTimeline, stableHash, type EditPlan, type PlanSegment, type Word } from "./plan";
import { aiPlanningPrompt, applyAiSuggestions, draftPlan, parseAiSuggestions, segmentsFromTakes, type PlannerSource } from "./planner";
import { runQc } from "./qc";
import { geometry, renderPlan, type ExportFormat, type RenderSource } from "./render";
import { activeStore, ensureDir, fetchToLocal, localSize, putLocalFile, workDir, type Store } from "./storage";
import { normalizeStyleConfig, type StyleConfig } from "./style-profile";
import { cutTake, type Take } from "./takes";
import { env } from "@/lib/env";

/**
 * De verwerkingspijplijn van de AI Editor. Wordt uitgevoerd door de
 * verwerk-server (scripts/ai-editor-worker.ts) — of inline op een machine met
 * de tools (lokaal). Elke fase schrijft voortgang naar het project, zodat het
 * portaal live kan meekijken.
 */

export type StoredPlan = {
  plan: EditPlan;
  pool: Record<number, Take[]>;
  sentences: string[];
  hasScript: boolean;
  warnings: string[];
  /** Brongegevens die de render nodig heeft (rollen, LUT-keuze). */
  sources: Array<{ id: string; filename: string; role: "speaker" | "broll"; durationS: number; lutAssetId: string | null; logProfile: string | null; generic: boolean }>;
};

export type Costs = {
  aiCents: number;
  aiInputTokens: number;
  aiOutputTokens: number;
  renderSeconds: number;
  renderCents: number;
  storageBytes: number;
  storageCentsPerMonth: number;
  transcribeSeconds: number;
  renders: number;
  totalCents: number;
};

const ROOT = /* turbopackIgnore: true */ process.cwd();
const FONT_DIR = path.join(ROOT, "assets", "ai-editor", "fonts");
const OVERLAY_SCRIPT = path.join(ROOT, "scripts", "ai_editor_overlays.py");
const TRANSCRIBE_SCRIPT = path.join(ROOT, "scripts", "ai_editor_transcribe.py");

async function setPhase(projectId: string, phase: string, progress: number) {
  await db.update(adEditProjects).set({ phase, progress, updatedAt: new Date() }).where(eq(adEditProjects.id, projectId));
}

function pythonBin(): string {
  const p = whisperPython();
  if (!p) throw new Error("De Python-omgeving (.venv-vi) ontbreekt. Zie docs/AI-EDITOR.md.");
  return p;
}

export async function activeStyle(): Promise<{ id: string; version: number; config: StyleConfig } | null> {
  const [row] = await db.select().from(adStyleProfiles).where(eq(adStyleProfiles.isActive, true)).orderBy(desc(adStyleProfiles.version)).limit(1);
  if (!row) return null;
  return { id: row.id, version: row.version, config: normalizeStyleConfig(row.config) };
}

async function styleFor(projectStyleId: string | null): Promise<StyleConfig> {
  if (projectStyleId) {
    const [row] = await db.select().from(adStyleProfiles).where(eq(adStyleProfiles.id, projectStyleId)).limit(1);
    if (row) return normalizeStyleConfig(row.config);
  }
  const act = await activeStyle();
  if (!act) throw new Error("Er is nog geen montageprofiel. Open Stijlbeheer om het Shortclips Ads Style-profiel aan te maken.");
  return act.config;
}

function emptyCosts(): Costs {
  return { aiCents: 0, aiInputTokens: 0, aiOutputTokens: 0, renderSeconds: 0, renderCents: 0, storageBytes: 0, storageCentsPerMonth: 0, transcribeSeconds: 0, renders: 0, totalCents: 0 };
}

function finalizeCosts(c: Costs): Costs {
  c.renderCents = Math.round((c.renderSeconds / 3600) * env.AI_EDITOR_RENDER_CENTS_PER_HOUR * 100) / 100;
  c.storageCentsPerMonth = Math.round((c.storageBytes / 1e9) * env.AI_EDITOR_STORAGE_CENTS_PER_GB_MONTH * 100) / 100;
  c.totalCents = Math.round((c.aiCents + c.renderCents + c.storageCentsPerMonth) * 100) / 100;
  return c;
}

/* ------------------------------------------------------------------ */
/* Bronnen ophalen en analyseren                                      */
/* ------------------------------------------------------------------ */

type LocalSource = { row: typeof adEditSources.$inferSelect; local: string; probe: Probe };

async function localSources(projectId: string): Promise<LocalSource[]> {
  const rows = await db.select().from(adEditSources).where(eq(adEditSources.projectId, projectId)).orderBy(asc(adEditSources.createdAt));
  const dir = await ensureDir(path.join(workDir(projectId), "sources"));
  const out: LocalSource[] = [];
  for (const row of rows) {
    if (row.status === "uploading") continue;
    const ext = path.extname(row.filename) || ".mp4";
    const dest = path.join(/* turbopackIgnore: true */ dir, `${row.id}${ext}`);
    let local: string;
    if (row.origin === "drive" && row.driveFileId) {
      if ((await localSize(dest)) === 0) await drive.downloadToFile(row.driveFileId, dest);
      local = dest;
    } else {
      if (!row.mediaPath || !row.mediaStore) throw new Error(`Bestand ${row.filename} is niet (volledig) geüpload.`);
      local = await fetchToLocal(row.mediaStore as Store, row.mediaPath, dest);
    }
    const p = (row.probe as Probe | null) ?? (await probe(local));
    out.push({ row, local, probe: p });
  }
  return out;
}

async function transcribe(local: string, wavDir: string, id: string, script: string | null): Promise<{ words: Word[]; model: string; seconds: number }> {
  const t0 = Date.now();
  const wav = path.join(wavDir, `${id}.wav`);
  await extractAudioWav(local, wav);
  const out = path.join(wavDir, `${id}.json`);
  const args = [TRANSCRIBE_SCRIPT, wav, out, "nl", env.AI_EDITOR_WHISPER_MODEL];
  const pf = path.join(wavDir, `${id}.prompt.txt`);
  await writeFile(pf, (script ?? "").slice(0, 800));
  args.push(script ? pf : "");
  // Spraakdelen tussen stiltes: elk deel apart transcriberen (zie het script).
  const clipsFile = path.join(wavDir, `${id}.clips.json`);
  const clips = await speechClips(wav);
  await writeFile(clipsFile, JSON.stringify(clips));
  args.push(clips.length > 1 ? clipsFile : "");
  const res = await run(pythonBin(), args, { timeoutMs: 90 * 60_000 });
  if (res.code !== 0) throw new Error(`Transcriptie mislukt: ${res.stderr.slice(-400)}`);
  const j = JSON.parse(await readFile(out, "utf8")) as { words: Word[]; model: string };
  return { words: j.words, model: j.model, seconds: Math.round((Date.now() - t0) / 1000) };
}

/**
 * Spraakdelen op basis van stiltes. De drempel volgt het opnameniveau (een
 * rustige studio en een rumoerig kantoor hebben een andere ruisvloer).
 */
async function speechClips(wav: string): Promise<Array<[number, number]>> {
  const dur = await mediaDuration(wav);
  if (!dur) return [];
  const mean = await meanVolume(wav, 0, dur);
  const thr = Math.max(-50, Math.min(-30, (mean ?? -30) - 12));
  const sil = await silences(wav, thr, 0.4);
  const clips: Array<[number, number]> = [];
  let cur = 0;
  for (const s of sil) {
    if (s.start - cur > 0.08) clips.push([Math.max(0, cur - 0.12), Math.min(dur, s.start + 0.12)]);
    cur = s.end;
  }
  if (dur - cur > 0.1) clips.push([Math.max(0, cur - 0.12), dur]);
  return clips.map(([a, b]) => [Math.round(a * 1000) / 1000, Math.round(b * 1000) / 1000]);
}

type SourceAnalysis = {
  speechRatio: number;
  wordCount: number;
  role: "speaker" | "broll";
  roleOverride?: "speaker" | "broll" | null;
  color: Awaited<ReturnType<typeof colorStats>>;
  log: { isLog: boolean; profile: string | null; reason: string };
  loudnessLufs: number | null;
};

async function analyzeSources(projectId: string, script: string | null, costs: Costs): Promise<LocalSource[]> {
  const list = await localSources(projectId);
  const wavDir = await ensureDir(path.join(workDir(projectId), "audio"));
  let i = 0;
  for (const s of list) {
    i++;
    await setPhase(projectId, `Analyseren: ${s.row.filename} (${i}/${list.length})`, 5 + Math.round((i / list.length) * 30));
    const p = s.probe;
    const key = `v3:${s.row.sizeBytes ?? 0}:${s.row.filename}:${env.AI_EDITOR_WHISPER_MODEL}:${script ? stableHash(script) : "noscript"}`;
    let transcript = s.row.transcript as { words: Word[]; model: string } | null;
    if (!transcript || s.row.analysisKey !== key) {
      // Hergebruik: dezelfde bron is eerder (in een ander project) al getranscribeerd.
      const [prev] = await db.select({ transcript: adEditSources.transcript }).from(adEditSources)
        .where(and(eq(adEditSources.analysisKey, key))).limit(1);
      if (prev?.transcript) {
        transcript = prev.transcript as { words: Word[]; model: string };
      } else if (p.hasAudio) {
        const t = await transcribe(s.local, wavDir, s.row.id, script);
        costs.transcribeSeconds += t.seconds;
        transcript = { words: t.words, model: t.model };
      } else {
        transcript = { words: [], model: "geen audio" };
      }
    }
    const words = transcript.words;
    const speechS = words.reduce((a, w) => a + Math.max(0, w.e - w.s), 0);
    const speechRatio = p.durationS > 0 ? speechS / p.durationS : 0;
    const prevAnalysis = (s.row.analysis ?? {}) as Partial<SourceAnalysis>;
    const color = prevAnalysis.color ?? (await colorStats(s.local, { startS: Math.min(1, p.durationS / 4), durS: Math.max(1, Math.min(20, p.durationS - 1)), samples: 6 }));
    const log = detectLog(p, color ?? null);
    const ln = prevAnalysis.loudnessLufs !== undefined ? prevAnalysis.loudnessLufs : p.hasAudio ? (await loudness(s.local))?.integrated ?? null : null;
    const autoRole: "speaker" | "broll" = words.length >= 8 && speechRatio > 0.2 ? "speaker" : "broll";
    const analysis: SourceAnalysis = {
      speechRatio: Math.round(speechRatio * 100) / 100,
      wordCount: words.length,
      role: prevAnalysis.roleOverride ?? autoRole,
      roleOverride: prevAnalysis.roleOverride ?? null,
      color,
      log,
      loudnessLufs: ln,
    };
    await db.update(adEditSources).set({
      probe: p, transcript, analysis, analysisKey: key, status: "analyzed", durationMs: Math.round(p.durationS * 1000), updatedAt: new Date(),
    }).where(eq(adEditSources.id, s.row.id));
    s.row = { ...s.row, probe: p, transcript, analysis, analysisKey: key };
    costs.storageBytes += s.row.sizeBytes ?? (await localSize(s.local));
  }
  return list;
}

/* ------------------------------------------------------------------ */
/* Stijlbestanden                                                     */
/* ------------------------------------------------------------------ */

async function assetLocal(id: string | null, projectId: string): Promise<{ path: string; name: string } | null> {
  if (!id) return null;
  const [a] = await db.select().from(adStyleAssets).where(eq(adStyleAssets.id, id)).limit(1);
  if (!a?.mediaPath || !a.mediaStore) return null;
  const dest = path.join(workDir(projectId), "assets", `${a.id}${path.extname(a.name) || ""}`);
  await ensureDir(path.dirname(dest));
  return { path: await fetchToLocal(a.mediaStore as Store, a.mediaPath, dest), name: a.name };
}

async function pickMusic(): Promise<string | null> {
  const [m] = await db.select({ id: adStyleAssets.id }).from(adStyleAssets)
    .where(and(eq(adStyleAssets.kind, "music"), eq(adStyleAssets.isActive, true), isNull(adStyleAssets.deletedAt)))
    .orderBy(desc(adStyleAssets.createdAt)).limit(1);
  return m?.id ?? null;
}

async function pickLut(profile: string | null): Promise<string | null> {
  const luts = await db.select().from(adStyleAssets)
    .where(and(eq(adStyleAssets.kind, "lut"), eq(adStyleAssets.isActive, true), isNull(adStyleAssets.deletedAt)));
  if (!luts.length) return null;
  const exact = profile ? luts.find((l) => (l.matchProfile ?? "").toLowerCase() === profile) : null;
  return (exact ?? luts.find((l) => !l.matchProfile || l.matchProfile === "default"))?.id ?? null;
}

/* ------------------------------------------------------------------ */
/* Kleur                                                              */
/* ------------------------------------------------------------------ */

async function computeGrades(projectId: string, plan: EditPlan, list: LocalSource[], stored: StoredPlan, style: StyleConfig): Promise<Record<string, string | null>> {
  const lutPaths: Record<string, string | null> = {};
  const g = geometry(style, "9x16", "preview");
  for (const src of stored.sources) {
    const ls = list.find((l) => l.row.id === src.id)!;
    const lut = src.lutAssetId ? await assetLocal(src.lutAssetId, projectId) : null;
    lutPaths[src.id] = lut?.path ?? null;
    const transform = src.lutAssetId && lut ? `lut:${src.lutAssetId}` : src.generic ? "generic_log" : "none";
    const used = plan.segments.filter((s) => s.sourceId === src.id);
    const startS = used.length ? Math.min(...used.map((s) => s.inS)) : Math.min(1, src.durationS / 4);
    const endS = used.length ? Math.max(...used.map((s) => s.outS)) : Math.min(src.durationS, startS + 10);
    const aspect = ls.probe.width / Math.max(1, ls.probe.height);
    const target = g.W / g.H;
    const crop = Math.abs(aspect - target) < 0.01 ? null : aspect > target ? `crop=trunc(ih*${target.toFixed(5)}/2)*2:ih` : `crop=iw:trunc(iw/${target.toFixed(5)}/2)*2`;
    const tf = transform === "generic_log" ? (await import("./grade")).GENERIC_LOG_CURVE : transform.startsWith("lut:") && lut ? `lut3d=file='${lut.path}'` : null;
    const baseVf = [tf, crop].filter(Boolean).join(",");
    const before = await colorStats(ls.local, { startS, durS: Math.max(0.5, endS - startS), samples: 6, vf: baseVf || undefined, cropTop: 0.6 });
    if (!before) continue;
    const res = await matchGrade({ file: ls.local, startS, durS: Math.max(0.5, endS - startS), baseVf, stats: before, style, inputTransform: transform });
    plan.grades[src.id] = res.grade;
  }
  return lutPaths;
}

/* ------------------------------------------------------------------ */
/* Ankers herstellen na het herbouwen van segmenten                   */
/* ------------------------------------------------------------------ */

export function reanchor(oldPlan: EditPlan, newPlan: EditPlan): void {
  const find = (segId: string, wordIdx: number): { segmentId: string; wordIdx: number } | null => {
    const oldSeg = oldPlan.segments.find((s) => s.id === segId);
    if (!oldSeg) return null;
    const w = oldSeg.words[Math.min(wordIdx, oldSeg.words.length - 1)];
    for (const s of newPlan.segments) {
      const idx = s.words.findIndex((x) => s.sourceId === oldSeg.sourceId && Math.abs(x.s - (w?.s ?? -1)) < 0.02);
      if (idx >= 0) return { segmentId: s.id, wordIdx: idx };
    }
    // Andere take: zelfde zin, zelfde woord.
    for (const s of newPlan.segments.filter((x) => x.sentenceIdx === oldSeg.sentenceIdx)) {
      const idx = s.words.findIndex((x) => x.w.toLowerCase() === (w?.w ?? "").toLowerCase());
      if (idx >= 0) return { segmentId: s.id, wordIdx: idx };
    }
    const first = newPlan.segments.find((x) => x.sentenceIdx === oldSeg.sentenceIdx);
    return first ? { segmentId: first.id, wordIdx: 0 } : null;
  };
  newPlan.cards = newPlan.cards.flatMap((c) => {
    const start = find(c.start.segmentId, c.start.wordIdx);
    if (!start) return [];
    const items = c.items.map((it) => ({ ...it, anchor: find(it.anchor.segmentId, it.anchor.wordIdx) ?? start }));
    const end = c.end ? find(c.end.segmentId, c.end.wordIdx) : null;
    return [{ ...c, start, items, end: end ? { ...end, after: c.end?.after } : undefined }];
  });
  newPlan.broll = newPlan.broll.flatMap((b) => {
    const a = find(b.anchorSegmentId, 0);
    return a ? [{ ...b, anchorSegmentId: a.segmentId }] : [];
  });
}

function applyContext(stored: StoredPlan, style: StyleConfig): ApplyContext {
  const tl = (p: EditPlan) => deriveTimeline(p, style.captions, style.export.fps);
  return {
    style,
    rebuildSegments: (takes) => segmentsFromTakes(takes, stored.pool, stored.sentences, stored.hasScript, style),
    reanchor,
    segmentAt: (p, atS) => tl(p).segments.find((s) => atS >= s.atS && atS < s.atS + s.durS)?.id ?? null,
    cardAt: (p, atS) => {
      const cards = tl(p).cards;
      const hit = cards.find((c) => atS >= c.startS - 0.5 && atS <= c.endS + 0.5);
      return hit?.id ?? null;
    },
    brollAt: (p, atS) => tl(p).broll.find((b) => atS >= b.atS - 0.5 && atS <= b.atS + b.durS + 0.5)?.id ?? null,
    retighten: (p, untilS, maxPauseS) => {
      const timeline = tl(p);
      const tighter = new Set(timeline.segments.filter((s) => untilS == null || s.atS < untilS).map((s) => s.sentenceIdx));
      const loose = { ...style, editing: { ...style.editing } };
      const tight = { ...style, editing: { ...style.editing, maxPauseS, tailHandleS: Math.min(style.editing.tailHandleS, 0.06), headHandleS: Math.min(style.editing.headHandleS, 0.03) } };
      const segs: PlanSegment[] = [];
      for (const choice of p.takes) {
        const take = stored.pool[choice.sentenceIdx]?.find((t) => t.takeId === choice.chosenTakeId);
        if (!take) continue;
        const st = tighter.has(choice.sentenceIdx) ? tight : loose;
        segs.push(...cutTake(take.words, take.sourceId, choice.sentenceIdx, { maxPauseS: st.editing.maxPauseS, headHandleS: st.editing.headHandleS, tailHandleS: st.editing.tailHandleS, fillers: st.editing.fillers }));
      }
      // Unieke ids na het herknippen.
      segs.forEach((s, i) => { s.id = `seg${i + 1}t${p.version}`; });
      if (segs[0]) segs[0].inS = Math.max(segs[0].inS, segs[0].words[0].s - 0.02);
      const last = segs[segs.length - 1];
      if (last) last.outS += style.editing.endTailS;
      // Zooms per zin overnemen.
      const zoomBySentence = new Map(p.segments.map((s) => [s.sentenceIdx, s.zoom]));
      segs.forEach((s) => { s.zoom = zoomBySentence.get(s.sentenceIdx) ?? { from: 1, to: 1 }; });
      return segs;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Renderen + QC                                                      */
/* ------------------------------------------------------------------ */

async function renderAndCheck(projectId: string, stored: StoredPlan, style: StyleConfig, list: LocalSource[], quality: "preview" | "final", format: ExportFormat, costs: Costs) {
  const wd = await ensureDir(workDir(projectId));
  const lutPaths: Record<string, string | null> = {};
  for (const s of stored.sources) lutPaths[s.id] = s.lutAssetId ? (await assetLocal(s.lutAssetId, projectId))?.path ?? null : null;
  const sources: Record<string, RenderSource> = {};
  for (const l of list) sources[l.row.id] = { id: l.row.id, localPath: l.local, hasAudio: l.probe.hasAudio, width: (l.probe.rotation % 180 ? l.probe.height : l.probe.width), height: (l.probe.rotation % 180 ? l.probe.width : l.probe.height), lutPath: lutPaths[l.row.id] ?? null };
  const music = stored.plan.music.assetId ? await assetLocal(stored.plan.music.assetId, projectId) : null;
  const musicLufs = music ? (await loudness(music.path))?.integrated ?? null : null;
  const outFile = path.join(wd, `${quality}-v${stored.plan.version}-${format}.mp4`);
  const res = await renderPlan({
    plan: stored.plan, style, sources, musicPath: music?.path ?? null, musicLufs, workDir: wd, quality, format,
    fontDir: FONT_DIR, overlayScript: OVERLAY_SCRIPT, python: pythonBin(), outFile,
  });
  costs.renderSeconds += res.stats.renderSeconds;
  costs.renders += 1;
  const missing = stored.plan.takes.filter((t) => !t.chosenTakeId && stored.hasScript).map((t) => t.sentenceText);
  const generic = stored.sources.filter((s) => s.generic && stored.plan.segments.some((x) => x.sourceId === s.id) && !s.lutAssetId).map((s) => s.filename);
  const qc = await runQc({
    file: res.file, plan: stored.plan, timeline: res.timeline, style, geometry: geometry(style, format, quality), manifest: res.overlayManifest,
    missingSentences: missing, usedGenericLog: generic, hasMusic: Boolean(music),
  });
  return { res, qc };
}

function explanation(stored: StoredPlan, render: { segmentsRendered: number; segmentsReused: number; renderSeconds: number }, timeline: ReturnType<typeof deriveTimeline>): string[] {
  const p = stored.plan;
  const lines = [...p.notes];
  const doubt = p.takes.filter((t) => t.needsUser).length;
  if (doubt) lines.push(`${doubt} zin(nen) met twee vergelijkbare takes: kies zelf welke je wilt gebruiken.`);
  lines.push(`Lengte ${timeline.durationS.toFixed(1)} s, ${timeline.segments.length} shots, ${timeline.captions.length} ondertitelblokken, ${timeline.cards.length} kaart(en), ${timeline.broll.length} b-rollmoment(en).`);
  const zooms = p.segments.filter((s) => s.zoom.from !== 1 || s.zoom.to !== 1).length;
  if (zooms) lines.push(`${zooms} shot(s) met zoom: punch-in bij jumpcuts binnen dezelfde opname, subtiele push-in op langere shots.`);
  const grades = Object.values(p.grades);
  if (grades.length) lines.push(`Kleur per bron gelijkgetrokken naar het profiel (witbalans, belichting, verzadiging), daarna de Shortclips-grade.`);
  if (stored.sources.some((s) => s.generic && !s.lutAssetId)) lines.push("Log-beelden herkend zonder camera-LUT: generieke conversie gebruikt (zie QC).");
  lines.push(p.music.assetId ? "Muziek uit de bibliotheek onder de stem, met ducking." : "Geen muziek (geen track in de muziekbibliotheek of uitgezet).");
  lines.push(`Render: ${render.segmentsRendered} onderdeel/onderdelen nieuw gerenderd, ${render.segmentsReused} hergebruikt, ${render.renderSeconds.toFixed(0)} s.`);
  return lines;
}

async function saveResult(projectId: string, stored: StoredPlan, out: Awaited<ReturnType<typeof renderAndCheck>>, costs: Costs, extraNotes: string[] = []) {
  const { res, qc } = out;
  const key = `${projectId}/preview-v${stored.plan.version}.mp4`;
  const put = await putLocalFile(res.file, key);
  costs.storageBytes += await localSize(res.file);
  const needsChoice = stored.plan.takes.some((t) => t.needsUser);
  await db.update(adEditProjects).set({
    plan: stored,
    planVersion: stored.plan.version,
    previewStore: put.store,
    previewPath: put.key,
    qc,
    explanation: [...extraNotes, ...explanation(stored, res.stats, res.timeline)],
    status: needsChoice ? "needs_choice" : "review",
    phase: qc.passed ? "Klaar voor controle" : "Klaar, met technische punten (zie QC)",
    progress: 100,
    error: null,
    costs: finalizeCosts(costs),
    updatedAt: new Date(),
  }).where(eq(adEditProjects.id, projectId));
}

/* ------------------------------------------------------------------ */
/* Jobs                                                               */
/* ------------------------------------------------------------------ */

export async function runGenerate(projectId: string): Promise<void> {
  const [project] = await db.select().from(adEditProjects).where(eq(adEditProjects.id, projectId)).limit(1);
  if (!project) throw new Error("Project niet gevonden.");
  const style = await styleFor(project.styleProfileId);
  const costs = { ...emptyCosts(), ...((project.costs ?? {}) as Partial<Costs>) };
  await db.update(adEditProjects).set({ status: "processing", error: null, updatedAt: new Date() }).where(eq(adEditProjects.id, projectId));

  await setPhase(projectId, "Bestanden ophalen", 3);
  const list = await analyzeSources(projectId, project.script, costs);
  if (!list.length) throw new Error("Er zijn nog geen bestanden geüpload.");

  await setPhase(projectId, "Montage plannen", 40);
  const prev = project.plan as StoredPlan | null;
  const userChoices: Record<number, string> = {};
  prev?.plan.takes.forEach((t) => { if (t.userChosen && t.chosenTakeId) userChoices[t.sentenceIdx] = t.chosenTakeId; });
  const plannerSources: PlannerSource[] = list.map((l, i) => {
    const a = l.row.analysis as SourceAnalysis;
    return { id: l.row.id, order: i, filename: l.row.filename, role: a.role, durationS: l.probe.durationS, words: (l.row.transcript as { words: Word[] }).words };
  });
  const musicId = style.audio.music ? await pickMusic() : null;
  const draft = draftPlan({ sources: plannerSources, script: project.script, style, musicAssetId: musicId, userTakeChoices: userChoices });
  draft.plan.version = (prev?.plan.version ?? 0) + 1;

  const extra: string[] = [];
  if (aiAvailable()) {
    await setPhase(projectId, "AI: kaarten en b-roll kiezen", 48);
    const brollSources = plannerSources.filter((s) => s.role === "broll");
    const prompt = aiPlanningPrompt(draft.plan, brollSources);
    const ai = await callClaude(prompt.system, prompt.user);
    if (ai.ok) {
      costs.aiInputTokens += ai.inputTokens;
      costs.aiOutputTokens += ai.outputTokens;
      costs.aiCents += aiCostCents(ai.inputTokens, ai.outputTokens);
      const sug = parseAiSuggestions(ai.text);
      if (sug) {
        const r = applyAiSuggestions(draft.plan, sug, brollSources, style);
        extra.push(...r.rejected);
      }
    } else extra.push("AI-laag niet beschikbaar; montage met vaste logica gemaakt.");
  } else {
    extra.push("Geen AI-sleutel ingesteld: kaarten (behalve de CTA) en b-roll-keuzes met vaste logica gemaakt.");
  }

  const sourcesInfo: StoredPlan["sources"] = [];
  for (const l of list) {
    const a = l.row.analysis as SourceAnalysis;
    const lut = a.log.isLog ? await pickLut(a.log.profile) : null;
    sourcesInfo.push({ id: l.row.id, filename: l.row.filename, role: a.role, durationS: l.probe.durationS, lutAssetId: lut, logProfile: a.log.profile, generic: a.log.isLog && !lut });
  }
  const stored: StoredPlan = { plan: draft.plan, pool: draft.takePool, sentences: draft.sentences, hasScript: Boolean(project.script?.trim()), warnings: draft.warnings, sources: sourcesInfo };

  await setPhase(projectId, "Kleur gelijktrekken", 55);
  await computeGrades(projectId, stored.plan, list, stored, style);

  await setPhase(projectId, "Preview renderen", 65);
  const out = await renderAndCheck(projectId, stored, style, list, "preview", "9x16", costs);
  await setPhase(projectId, "Kwaliteitscontrole", 95);
  await saveResult(projectId, stored, out, costs, [...draft.warnings, ...extra]);
}

/** Feedback of een take-wissel: plan aanpassen en alleen het nodige opnieuw renderen. */
export async function runRevise(projectId: string, feedbackId: string | null, payload: { takeChoice?: { sentenceIdx: number; takeId: string } } = {}): Promise<void> {
  const [project] = await db.select().from(adEditProjects).where(eq(adEditProjects.id, projectId)).limit(1);
  if (!project?.plan) throw new Error("Er is nog geen montage om aan te passen.");
  const style = await styleFor(project.styleProfileId);
  const stored = project.plan as StoredPlan;
  const costs = { ...emptyCosts(), ...((project.costs ?? {}) as Partial<Costs>) };
  await db.update(adEditProjects).set({ status: "processing", error: null, updatedAt: new Date() }).where(eq(adEditProjects.id, projectId));
  const ctx = applyContext(stored, style);
  const notes: string[] = [];
  let ops: FeedbackOp[] = [];
  let reply = "";

  if (payload.takeChoice) {
    const choice = stored.plan.takes.find((t) => t.sentenceIdx === payload.takeChoice!.sentenceIdx);
    if (!choice || !choice.options.some((o) => o.takeId === payload.takeChoice!.takeId)) throw new Error("Onbekende take.");
    const old = stored.plan;
    const next: EditPlan = JSON.parse(JSON.stringify(old));
    const c = next.takes.find((t) => t.sentenceIdx === payload.takeChoice!.sentenceIdx)!;
    c.chosenTakeId = payload.takeChoice.takeId;
    c.needsUser = false;
    c.userChosen = true;
    next.segments = ctx.rebuildSegments(next.takes);
    reanchor(old, next);
    next.version = old.version + 1;
    stored.plan = next;
    notes.push(`Zin ${c.sentenceIdx + 1}: take gewisseld op jouw keuze.`);
  }

  if (feedbackId) {
    const [fb] = await db.select().from(adEditFeedback).where(eq(adEditFeedback.id, feedbackId)).limit(1);
    if (!fb) throw new Error("Feedback niet gevonden.");
    await setPhase(projectId, "Feedback verwerken", 10);
    ops = parseFeedbackRules(fb.text);
    if (!ops.length && aiAvailable()) {
      const tl = deriveTimeline(stored.plan, style.captions, style.export.fps);
      const pr = feedbackPrompt(fb.text, stored.plan, { segments: tl.segments, cards: tl.cards });
      const ai = await callClaude(pr.system, pr.user, 800);
      if (ai.ok) {
        costs.aiInputTokens += ai.inputTokens;
        costs.aiOutputTokens += ai.outputTokens;
        costs.aiCents += aiCostCents(ai.inputTokens, ai.outputTokens);
        const parsed = parseAiOps(ai.text);
        if (parsed) { ops = parsed.ops; reply = parsed.reply; }
      }
    }
    if (!ops.length) {
      await db.update(adEditFeedback).set({ status: "not_understood", response: reply || "Deze feedback kan ik niet vertalen naar een montagewijziging. Probeer het concreter (bijv. \"zoom bij seconde 12 eruit\" of \"ondertiteling iets kleiner\").", updatedAt: new Date() }).where(eq(adEditFeedback.id, feedbackId));
      await db.update(adEditProjects).set({ status: stored.plan.takes.some((t) => t.needsUser) ? "needs_choice" : "review", phase: "Feedback niet toegepast", progress: 100, updatedAt: new Date() }).where(eq(adEditProjects.id, projectId));
      return;
    }
    const applied = applyOps(stored.plan, ops, ctx);
    stored.plan = applied.plan;
    notes.push(...applied.done.map((d) => `Feedback: ${d}`), ...applied.skipped.map((d) => `Niet toegepast: ${d}`));
    await db.update(adEditFeedback).set({ status: "applied", operations: ops, response: [reply, ...applied.done, ...applied.skipped].filter(Boolean).join(" "), appliedPlanVersion: stored.plan.version, updatedAt: new Date() }).where(eq(adEditFeedback.id, feedbackId));
  }

  const list = await localSources(projectId);
  await setPhase(projectId, "Preview bijwerken", 40);
  const out = await renderAndCheck(projectId, stored, style, list, "preview", "9x16", costs);
  await saveResult(projectId, stored, out, costs, notes);
}

/** Definitieve export uit de originele bestanden, in volle kwaliteit. */
export async function runExport(projectId: string, format: ExportFormat): Promise<void> {
  const [project] = await db.select().from(adEditProjects).where(eq(adEditProjects.id, projectId)).limit(1);
  if (!project?.plan) throw new Error("Er is nog geen montage.");
  const style = await styleFor(project.styleProfileId);
  const stored = project.plan as StoredPlan;
  if (stored.plan.takes.some((t) => t.needsUser)) throw new Error("Kies eerst de takes waarover getwijfeld wordt.");
  const costs = { ...emptyCosts(), ...((project.costs ?? {}) as Partial<Costs>) };
  const prevStatus = project.status;
  await db.update(adEditProjects).set({ status: "processing", phase: `Definitieve export (${format})`, progress: 10, error: null, updatedAt: new Date() }).where(eq(adEditProjects.id, projectId));
  const list = await localSources(projectId);
  const out = await renderAndCheck(projectId, stored, style, list, "final", format, costs);
  if (!out.qc.passed) {
    await db.update(adEditProjects).set({
      status: prevStatus === "exported" ? "exported" : "review",
      phase: "Export afgekeurd door de QC",
      progress: 100,
      qc: out.qc,
      error: `De definitieve export heeft technische fouten: ${out.qc.technical.map((t) => t.message).join(" ")}`,
      costs: finalizeCosts(costs),
      updatedAt: new Date(),
    }).where(eq(adEditProjects.id, projectId));
    return;
  }
  const key = `${projectId}/final-v${stored.plan.version}-${format}.mp4`;
  const put = await putLocalFile(out.res.file, key);
  costs.storageBytes += await localSize(out.res.file);
  await db.update(adEditProjects).set({
    finalStore: put.store, finalPath: put.key, finalFormat: format, qc: out.qc, status: "exported", phase: "Definitief geëxporteerd", progress: 100, costs: finalizeCosts(costs), updatedAt: new Date(),
  }).where(eq(adEditProjects.id, projectId));
}

/* ------------------------------------------------------------------ */
/* Stijlreferenties                                                   */
/* ------------------------------------------------------------------ */

export async function runAnalyzeReference(referenceId: string): Promise<void> {
  const [ref] = await db.select().from(adStyleReferences).where(eq(adStyleReferences.id, referenceId)).limit(1);
  if (!ref?.mediaPath || !ref.mediaStore) throw new Error("Referentie heeft geen bestand.");
  await db.update(adStyleReferences).set({ status: "processing", error: null, updatedAt: new Date() }).where(eq(adStyleReferences.id, referenceId));
  const dir = await ensureDir(path.join(workDir("references"), referenceId));
  const local = await fetchToLocal(ref.mediaStore as Store, ref.mediaPath, path.join(dir, "ref.mp4"));
  const p = await probe(local);
  const cuts = await sceneCuts(local, 0.25);
  const t = await transcribe(local, dir, "ref", null);
  const words = t.words;
  const shots = [0, ...cuts, p.durationS];
  const lens = shots.slice(1).map((x, i) => x - shots[i]).filter((x) => x > 0.05);
  const gaps = words.slice(1).map((w, i) => w.s - words[i].e);
  const color = await colorStats(local, { startS: 0, durS: p.durationS, samples: 12, cropTop: 0.6 });
  const ln = await loudness(local);
  // Muziekbed: niveau in de pauzes t.o.v. de stem.
  const gapWindows = words.slice(1).map((w, i) => ({ s: words[i].e + 0.03, e: w.s - 0.03 })).filter((g) => g.e - g.s > 0.15).slice(0, 8);
  const gapLevels: number[] = [];
  for (const g of gapWindows) { const v = await meanVolume(local, g.s, g.e - g.s); if (v != null) gapLevels.push(v); }
  const voice = await meanVolume(local, words[0]?.s ?? 0, Math.min(10, p.durationS));
  const sorted = [...lens].sort((a, b) => a - b);
  const measurements = {
    durationS: Math.round(p.durationS * 100) / 100,
    resolution: `${p.width}x${p.height}`,
    fps: Math.round(p.fps * 100) / 100,
    cuts: cuts.length,
    avgShotS: lens.length ? Math.round((lens.reduce((a, b) => a + b, 0) / lens.length) * 100) / 100 : null,
    medianShotS: sorted.length ? Math.round(sorted[Math.floor(sorted.length / 2)] * 100) / 100 : null,
    firstCutS: cuts[0] ?? null,
    words: words.length,
    wpm: words.length > 1 ? Math.round((words.length / (words[words.length - 1].e - words[0].s)) * 60) : null,
    firstWordS: words[0]?.s ?? null,
    maxPauseS: gaps.length ? Math.round(Math.max(...gaps) * 100) / 100 : null,
    pausesOver03: gaps.filter((g) => g > 0.3).length,
    color,
    lufs: ln?.integrated ?? null,
    lra: ln?.range ?? null,
    musicBelowVoiceDb: voice != null && gapLevels.length ? Math.round(voice - gapLevels.reduce((a, b) => a + b, 0) / gapLevels.length) : null,
    transcriptModel: t.model,
  };
  const active = await activeStyle();
  const proposal = active ? proposeFromMeasurements(active.config, measurements) : [];
  await db.update(adStyleReferences).set({ status: "analyzed", measurements, proposal, updatedAt: new Date() }).where(eq(adStyleReferences.id, referenceId));
}

export type ProposalItem = { path: string; label: string; current: number; proposed: number; reason: string };

/** Vergelijkt een referentie met het actieve profiel: welke waarden zijn interessant om over te nemen. */
export function proposeFromMeasurements(cfg: StyleConfig, m: Record<string, unknown>): ProposalItem[] {
  const out: ProposalItem[] = [];
  const num = (k: string) => (typeof m[k] === "number" ? (m[k] as number) : null);
  const color = m.color as { luma?: number; saturation?: number; warmth?: number } | null;
  const avg = num("avgShotS");
  if (avg && Math.abs(avg - cfg.editing.targetShotS) > 0.4) out.push({ path: "editing.targetShotS", label: "Gemiddelde shotlengte (s)", current: cfg.editing.targetShotS, proposed: avg, reason: "Ritme van deze referentie." });
  const fc = num("firstCutS");
  if (fc && fc < cfg.editing.firstCutBeforeS - 0.5) out.push({ path: "editing.firstCutBeforeS", label: "Eerste cut uiterlijk op (s)", current: cfg.editing.firstCutBeforeS, proposed: Math.round((fc + 0.3) * 10) / 10, reason: "Snellere opening in deze referentie." });
  if (color?.luma && Math.abs(color.luma - cfg.color.targetLuma) > 6) out.push({ path: "color.targetLuma", label: "Helderheid (0-255)", current: cfg.color.targetLuma, proposed: Math.round(color.luma), reason: "Gemeten gemiddelde helderheid." });
  if (color?.saturation && Math.abs(color.saturation - cfg.color.targetSaturation) > 0.05) out.push({ path: "color.targetSaturation", label: "Verzadiging", current: cfg.color.targetSaturation, proposed: Math.round(color.saturation * 100) / 100, reason: "Gemeten verzadiging." });
  if (color?.warmth != null && Math.abs(color.warmth - cfg.color.targetWarmth) > 3) out.push({ path: "color.targetWarmth", label: "Warmte (R-B)", current: cfg.color.targetWarmth, proposed: Math.round(color.warmth), reason: "Gemeten kleurtemperatuur." });
  const lufs = num("lufs");
  if (lufs && Math.abs(lufs - cfg.audio.targetLufs) > 1) out.push({ path: "audio.targetLufs", label: "Luidheid (LUFS)", current: cfg.audio.targetLufs, proposed: Math.round(lufs * 10) / 10, reason: "Gemeten integrale luidheid." });
  const mb = num("musicBelowVoiceDb");
  if (mb && mb > 6 && mb < 30 && Math.abs(mb - cfg.audio.musicBelowVoiceDb) > 3) out.push({ path: "audio.musicBelowVoiceDb", label: "Muziek onder de stem (dB)", current: cfg.audio.musicBelowVoiceDb, proposed: mb, reason: "Verschil tussen stem en pauzes." });
  return out;
}

/* ------------------------------------------------------------------ */
/* Wachtrij                                                           */
/* ------------------------------------------------------------------ */

export async function runJob(jobId: string): Promise<void> {
  const [job] = await db.select().from(aiEditorJobs).where(eq(aiEditorJobs.id, jobId)).limit(1);
  if (!job) return;
  const payload = (job.payload ?? {}) as { feedbackId?: string; format?: ExportFormat; takeChoice?: { sentenceIdx: number; takeId: string } };
  try {
    if (job.kind === "generate" && job.projectId) await runGenerate(job.projectId);
    else if (job.kind === "revise" && job.projectId) await runRevise(job.projectId, payload.feedbackId ?? null, { takeChoice: payload.takeChoice });
    else if (job.kind === "export" && job.projectId) await runExport(job.projectId, payload.format ?? "9x16");
    else if (job.kind === "analyze_reference" && job.referenceId) await runAnalyzeReference(job.referenceId);
    await db.update(aiEditorJobs).set({ status: "done", finishedAt: new Date(), updatedAt: new Date() }).where(eq(aiEditorJobs.id, jobId));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.update(aiEditorJobs).set({ status: "failed", error: msg.slice(0, 2000), finishedAt: new Date(), updatedAt: new Date() }).where(eq(aiEditorJobs.id, jobId));
    if (job.projectId) {
      const [p] = await db.select({ plan: adEditProjects.plan, previewPath: adEditProjects.previewPath }).from(adEditProjects).where(eq(adEditProjects.id, job.projectId)).limit(1);
      await db.update(adEditProjects).set({ status: p?.previewPath ? "review" : "failed", error: msg.slice(0, 2000), phase: "Mislukt", progress: 100, updatedAt: new Date() }).where(eq(adEditProjects.id, job.projectId));
      if (payload.feedbackId) await db.update(adEditFeedback).set({ status: "failed", response: msg.slice(0, 500), updatedAt: new Date() }).where(eq(adEditFeedback.id, payload.feedbackId));
    }
    if (job.referenceId) await db.update(adStyleReferences).set({ status: "failed", error: msg.slice(0, 2000), updatedAt: new Date() }).where(eq(adStyleReferences.id, job.referenceId));
    throw e;
  }
}

/** Kan deze machine het zware werk doen? (Python-omgeving met faster-whisper + Pillow.) */
export async function canRunAiEditor(): Promise<boolean> {
  const py = whisperPython();
  if (!py) return false;
  const res = await run(py, ["-c", "import faster_whisper, PIL"], { timeoutMs: 20_000 });
  return res.code === 0;
}

export { activeStore };
