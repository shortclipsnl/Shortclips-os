import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  videoAnalyses,
  videoAnalysisSteps,
  videoShots,
  videoEditingMetrics,
  videoTranscripts,
  videoHooks,
  videoStructure,
  aiOutputs,
} from "@/db/schema";
import { aiConfigured, runJsonPrompt } from "@/server/ai/client";
import { tools, run, ffmpegBin, whisperPython, whisperScript, ocrScript } from "./tools";
import { confirmUpload, downloadFromUrl } from "./ingest";
import { probe, detectSceneCuts, shotsFromCuts, grabFrame, editingMetrics, type Shot } from "./ffmpeg";
import { speechStats } from "./metrics";
import { analysisDir, framesDir, toStoreRelative } from "./paths";

/**
 * De verwerkingspijplijn voor één video-analyse. Draait in-proces (fire-and-
 * forget vanuit de server action) en werkt per stap een rij in
 * `video_analysis_steps` bij. Stappen waarvoor een tool/sleutel ontbreekt worden
 * eerlijk "skipped" — nooit nepdata. Herstartbaar: al voltooide stappen worden
 * overgeslagen.
 */

type StepName = "download" | "probe" | "shots" | "editing" | "ocr" | "transcribe" | "vision" | "insights";
export const PIPELINE_STEPS: StepName[] = ["download", "probe", "shots", "editing", "ocr", "transcribe", "vision", "insights"];

type StepStatus = "done" | "skipped" | "failed";

async function setStep(analysisId: string, step: StepName, status: "running" | StepStatus, detail?: string) {
  const now = new Date();
  await db
    .insert(videoAnalysisSteps)
    .values({
      analysisId,
      step,
      status,
      detail: detail ?? null,
      startedAt: status === "running" ? now : undefined,
      finishedAt: status === "running" ? undefined : now,
    })
    .onConflictDoUpdate({
      target: [videoAnalysisSteps.analysisId, videoAnalysisSteps.step],
      set: {
        status,
        detail: detail ?? null,
        ...(status === "running" ? { startedAt: now } : { finishedAt: now }),
        updatedAt: now,
      },
    });
}

/** Start/hervat de volledige pijplijn voor een analyse. Nooit throw naar de caller. */
export async function runPipeline(analysisId: string): Promise<void> {
  try {
    const [a] = await db.select().from(videoAnalyses).where(eq(videoAnalyses.id, analysisId)).limit(1);
    if (!a) return;

    await db.update(videoAnalyses).set({ status: "processing", error: null, updatedAt: new Date() }).where(eq(videoAnalyses.id, analysisId));

    // 1) DOWNLOAD / bron bevestigen
    await setStep(analysisId, "download", "running");
    let mediaPath = a.mediaPath ?? "";
    if (a.sourceType === "platform_url") {
      const res = await downloadFromUrl(analysisId, a.sourceUrl ?? "");
      if (!res.ok) {
        await setStep(analysisId, "download", "failed", res.reason);
        await db.update(videoAnalyses).set({ status: "failed", error: res.reason, updatedAt: new Date() }).where(eq(videoAnalyses.id, analysisId));
        return;
      }
      mediaPath = res.mediaPath;
      await db.update(videoAnalyses).set({
        mediaPath: toStoreRelative(res.mediaPath),
        caption: a.caption ?? res.caption,
        externalPostId: a.externalPostId ?? res.externalPostId,
        fileSizeBytes: res.fileSizeBytes,
        updatedAt: new Date(),
      }).where(eq(videoAnalyses.id, analysisId));
      await setStep(analysisId, "download", "done");
    } else {
      // upload: mediaPath staat relatief in de DB
      const abs = mediaPath ? path.join(analysisDir(analysisId), path.basename(mediaPath)) : "";
      const res = await confirmUpload(analysisId, abs);
      if (!res.ok) {
        await setStep(analysisId, "download", "failed", res.reason);
        await db.update(videoAnalyses).set({ status: "failed", error: res.reason, updatedAt: new Date() }).where(eq(videoAnalyses.id, analysisId));
        return;
      }
      mediaPath = res.mediaPath;
      await setStep(analysisId, "download", "done");
    }

    const haveFfmpeg = await tools.ffmpeg();
    const haveFfprobe = await tools.ffprobe();

    // 2) PROBE
    let durationMs = a.durationMs ?? 0;
    if (!haveFfprobe) {
      await setStep(analysisId, "probe", "skipped", "ffprobe niet geïnstalleerd (brew install ffmpeg)");
    } else {
      await setStep(analysisId, "probe", "running");
      const p = await probe(mediaPath);
      if (!p) {
        await setStep(analysisId, "probe", "failed", "ffprobe kon het bestand niet lezen.");
      } else {
        durationMs = p.durationMs;
        // hoofd-thumbnail
        let thumbRel: string | null = null;
        if (haveFfmpeg) {
          const t = await grabFrame(mediaPath, analysisId, Math.min(1000, Math.floor(durationMs / 2)), "thumb.jpg");
          if (t) thumbRel = toStoreRelative(t);
        }
        await db.update(videoAnalyses).set({
          durationMs: p.durationMs, width: p.width, height: p.height, fps: p.fps, aspectRatio: p.aspectRatio,
          ...(thumbRel ? { thumbnailPath: thumbRel } : {}),
          updatedAt: new Date(),
        }).where(eq(videoAnalyses.id, analysisId));
        await setStep(analysisId, "probe", "done");
      }
    }

    // 3) SHOTS
    let shots: Shot[] = [];
    if (!haveFfmpeg) {
      await setStep(analysisId, "shots", "skipped", "ffmpeg niet geïnstalleerd (brew install ffmpeg)");
    } else if (durationMs <= 0) {
      await setStep(analysisId, "shots", "skipped", "Duur onbekend (probe mislukt).");
    } else {
      await setStep(analysisId, "shots", "running");
      const cuts = await detectSceneCuts(mediaPath);
      shots = shotsFromCuts(cuts, durationMs);
      await db.delete(videoShots).where(eq(videoShots.analysisId, analysisId));
      for (const s of shots) {
        const mid = Math.floor((s.startMs + s.endMs) / 2);
        const frame = await grabFrame(mediaPath, analysisId, mid, `shot_${s.idx}.jpg`);
        await db.insert(videoShots).values({
          analysisId, idx: s.idx, startMs: s.startMs, endMs: s.endMs,
          thumbnailPath: frame ? toStoreRelative(frame) : null,
        });
      }
      await setStep(analysisId, "shots", "done", `${shots.length} shots gedetecteerd`);
    }

    // 4) EDITING
    if (shots.length === 0) {
      await setStep(analysisId, "editing", "skipped", "Geen shots beschikbaar.");
    } else {
      await setStep(analysisId, "editing", "running");
      const m = editingMetrics(shots, durationMs);
      await db.insert(videoEditingMetrics).values({ analysisId, ...m })
        .onConflictDoUpdate({ target: videoEditingMetrics.analysisId, set: { ...m, updatedAt: new Date() } });
      await setStep(analysisId, "editing", "done");
    }

    // 4b) OCR — teksten in beeld (gated op rapidocr)
    if (!(await tools.ocr())) {
      await setStep(analysisId, "ocr", "skipped", "OCR niet beschikbaar (rapidocr).");
    } else if (shots.length === 0) {
      await setStep(analysisId, "ocr", "skipped", "Geen frames voor OCR.");
    } else {
      await setStep(analysisId, "ocr", "running");
      const r = await ocrShots(analysisId, shots);
      await setStep(analysisId, "ocr", r.status, r.detail);
    }

    // 5) TRANSCRIBE (gated op whisper + ffmpeg)
    const haveWhisper = await tools.whisper();
    if (!haveWhisper) {
      await setStep(analysisId, "transcribe", "skipped", "Whisper niet geïnstalleerd — transcriptie nog niet beschikbaar.");
    } else if (!haveFfmpeg) {
      await setStep(analysisId, "transcribe", "skipped", "ffmpeg nodig voor audio-extractie.");
    } else {
      await setStep(analysisId, "transcribe", "running");
      const ok = await transcribe(analysisId, mediaPath, durationMs);
      await setStep(analysisId, "transcribe", ok.status, ok.detail);
    }

    // 6) VISION (gated op ANTHROPIC_API_KEY)
    if (!aiConfigured()) {
      await setStep(analysisId, "vision", "skipped", "ANTHROPIC_API_KEY ontbreekt — visuele AI-duiding nog niet beschikbaar.");
    } else if (shots.length === 0) {
      await setStep(analysisId, "vision", "skipped", "Geen shots/frames om te duiden.");
    } else {
      await setStep(analysisId, "vision", "running");
      const r = await visionAnalyse(analysisId);
      await setStep(analysisId, "vision", r.status, r.detail);
    }

    // 7) INSIGHTS (gated op ANTHROPIC_API_KEY)
    if (!aiConfigured()) {
      await setStep(analysisId, "insights", "skipped", "ANTHROPIC_API_KEY ontbreekt — AI-conclusies nog niet beschikbaar.");
    } else {
      await setStep(analysisId, "insights", "running");
      const r = await generateVideoInsights(analysisId);
      await setStep(analysisId, "insights", r.status, r.detail);
    }

    await finalizeStatus(analysisId);
  } catch (err) {
    await db.update(videoAnalyses).set({ status: "failed", error: String(err), updatedAt: new Date() }).where(eq(videoAnalyses.id, analysisId)).catch(() => {});
  }
}

async function finalizeStatus(analysisId: string) {
  const steps = await db.select().from(videoAnalysisSteps).where(eq(videoAnalysisSteps.analysisId, analysisId));
  const by = new Map<string, string>(steps.map((s) => [s.step, s.status]));
  const failedCore = by.get("download") === "failed" || by.get("probe") === "failed";
  const anyFailed = steps.some((s) => s.status === "failed");
  const anySkipped = steps.some((s) => s.status === "skipped");
  const aiSkipped = ["transcribe", "vision", "insights"].some((s) => by.get(s) === "skipped");
  const measurableDone = by.get("probe") === "done" && by.get("shots") === "done";

  let status: "failed" | "complete" | "needs_ai" | "partial";
  if (failedCore) status = "failed";
  else if (!anyFailed && !anySkipped) status = "complete";
  else if (measurableDone && aiSkipped && !anyFailed) status = "needs_ai";
  else status = "partial";

  await db.update(videoAnalyses).set({ status, updatedAt: new Date() }).where(eq(videoAnalyses.id, analysisId));
}

/* ---------------- Transcriptie (faster-whisper via venv) ---------------- */
async function transcribe(analysisId: string, mediaPath: string, durationMs: number): Promise<{ status: StepStatus; detail?: string }> {
  const dir = analysisDir(analysisId);
  const wav = path.join(dir, "audio.wav");
  const extract = await run(ffmpegBin(), ["-y", "-i", mediaPath, "-vn", "-ac", "1", "-ar", "16000", wav], { timeoutMs: 60000 });
  if (extract.code !== 0) return { status: "failed", detail: "Audio-extractie mislukt." };

  const py = whisperPython();
  if (!py) return { status: "skipped", detail: "faster-whisper niet geïnstalleerd." };
  const outJson = path.join(dir, "audio.json");
  // Eerste run downloadt het model (eenmalig); daarna gecachet.
  const res = await run(py, [whisperScript(), wav, outJson, "nl"], { timeoutMs: 900000 });
  if (res.code !== 0) {
    return { status: "failed", detail: `Transcriptie mislukt: ${res.stderr.split("\n").filter(Boolean).slice(-1)[0] ?? res.code}` };
  }

  try {
    const json = JSON.parse(await readFile(path.join(dir, "audio.json"), "utf8")) as {
      text?: string; language?: string;
      segments?: Array<{ start: number; end: number; text: string; words?: Array<{ word: string; start: number; end: number }> }>;
    };
    const words: Array<{ w: string; start: number; end: number }> = [];
    for (const seg of json.segments ?? []) {
      for (const w of seg.words ?? []) words.push({ w: w.word.trim(), start: Math.round(w.start * 1000), end: Math.round(w.end * 1000) });
    }
    const stats = speechStats(words, durationMs);
    const firstSentenceMs = json.segments?.[0] ? Math.round(json.segments[0].end * 1000) : null;
    const row = {
      language: json.language ?? "nl", fullText: json.text ?? "",
      words, segments: json.segments ?? [],
      wpm: stats.wpm, firstWordMs: stats.firstWordMs, firstSentenceMs,
      words3s: stats.words3s, words5s: stats.words5s, words10s: stats.words10s,
    };
    await db.insert(videoTranscripts).values({ analysisId, ...row })
      .onConflictDoUpdate({ target: videoTranscripts.analysisId, set: { ...row, updatedAt: new Date() } });
    return { status: "done", detail: `${words.length} woorden` };
  } catch {
    return { status: "failed", detail: "Kon Whisper-uitvoer niet lezen." };
  }
}

/* ---------------- OCR — teksten in beeld (rapidocr op shot-frames) ---------------- */
async function ocrShots(analysisId: string, shots: Shot[]): Promise<{ status: StepStatus; detail?: string }> {
  const py = whisperPython();
  if (!py) return { status: "skipped", detail: "OCR-venv ontbreekt." };
  const fdir = framesDir(analysisId);
  const imgs = shots.map((s) => path.join(fdir, `shot_${s.idx}.jpg`));
  const outJson = path.join(analysisDir(analysisId), "ocr.json");
  const res = await run(py, [ocrScript(), outJson, ...imgs], { timeoutMs: 300000 });
  if (res.code !== 0) return { status: "failed", detail: "OCR mislukt." };

  try {
    const data = JSON.parse(await readFile(outJson, "utf8")) as { frames: Array<{ image: string; text: string }> };
    const overlays: Array<{ appearMs: number; text: string; shot: number }> = [];
    for (const fr of data.frames) {
      const m = fr.image.match(/shot_(\d+)\.jpg/);
      if (!m) continue;
      const idx = Number(m[1]);
      const text = (fr.text || "").trim();
      if (!text) continue;
      await db.update(videoShots).set({ textOnScreen: text, updatedAt: new Date() })
        .where(and(eq(videoShots.analysisId, analysisId), eq(videoShots.idx, idx)));
      overlays.push({ appearMs: shots.find((s) => s.idx === idx)?.startMs ?? 0, text, shot: idx });
    }
    if (overlays.length) {
      overlays.sort((a, b) => a.appearMs - b.appearMs);
      await db.update(videoAnalyses).set({ overlays, updatedAt: new Date() }).where(eq(videoAnalyses.id, analysisId));
    }
    return { status: "done", detail: overlays.length ? `tekst in ${overlays.length} shot(s)` : "geen tekst gevonden" };
  } catch {
    return { status: "failed", detail: "Kon OCR-uitvoer niet lezen." };
  }
}

/* ---------------- Visuele duiding (Claude op frames) ---------------- */
type VisionJson = {
  shots?: Array<{ idx: number; shotType?: string; description?: string; motion?: string; transition?: string; textOnScreen?: string }>;
  hook?: { startMs?: number; endMs?: number; hookText?: string; types?: string[]; form?: string[]; elements?: string[] };
  structure?: Array<{ part: string; startMs: number; endMs: number; summary: string }>;
  overlays?: Array<{ appearMs: number; text: string; kind?: string }>;
};

async function visionAnalyse(analysisId: string): Promise<{ status: StepStatus; detail?: string }> {
  const shots = await db.select().from(videoShots).where(eq(videoShots.analysisId, analysisId)).orderBy(videoShots.idx);
  const [tr] = await db.select().from(videoTranscripts).where(eq(videoTranscripts.analysisId, analysisId)).limit(1);
  // Max ~8 frames meesturen (kosten/beperkingen).
  const sampled = sample(shots, 8);
  const images: Array<{ base64: string; mediaType: "image/jpeg" }> = [];
  for (const s of sampled) {
    if (!s.thumbnailPath) continue;
    try {
      const buf = await readFile(path.join(framesDir(analysisId), path.basename(s.thumbnailPath)));
      images.push({ base64: buf.toString("base64"), mediaType: "image/jpeg" });
    } catch { /* frame ontbreekt */ }
  }
  if (images.length === 0) return { status: "skipped", detail: "Geen frames beschikbaar om te duiden." };

  const shotList = sampled.map((s) => `shot ${s.idx}: ${Math.round(s.startMs / 1000)}–${Math.round(s.endMs / 1000)}s`).join("\n");
  const res = await runJsonPrompt<VisionJson>({
    system: "Je bent een video-analist voor short-form content. Beschrijf uitsluitend wat feitelijk zichtbaar/hoorbaar is. Geef alleen geldige JSON terug, geen omliggende tekst. Verzin niets; laat velden weg als je het niet kunt zien.",
    user: `Analyseer deze short video aan de hand van ${images.length} frames (op volgorde) en het transcript.\n\nShots:\n${shotList}\n\nTranscript:\n${tr?.fullText ?? "(geen transcript beschikbaar)"}\n\nGeef JSON met: shots[] ({idx, shotType, description, motion, transition, textOnScreen}), hook ({startMs,endMs,hookText,types[],form[],elements[]}), structure[] ({part,startMs,endMs,summary}), overlays[] ({appearMs,text,kind}). shotType uit: close_up, medium, wide, detail, product, b_roll, talking_head, pov, interview, drone, handheld, static.`,
    images,
    maxTokens: 4000,
  });
  if (!res.ok) return { status: "failed", detail: res.error ?? "AI-duiding mislukt." };
  const data = res.data;

  // Shotbeschrijvingen terugschrijven.
  for (const vs of data.shots ?? []) {
    await db.update(videoShots).set({
      shotType: vs.shotType ?? null, description: vs.description ?? null,
      motion: vs.motion ?? null, transition: vs.transition ?? null, textOnScreen: vs.textOnScreen ?? null,
      updatedAt: new Date(),
    }).where(and(eq(videoShots.analysisId, analysisId), eq(videoShots.idx, vs.idx)));
  }
  if (data.hook) {
    const h = data.hook;
    await db.insert(videoHooks).values({
      analysisId, startMs: h.startMs ?? null, endMs: h.endMs ?? null, hookText: h.hookText ?? null,
      types: h.types ?? [], form: h.form ?? [], elements: h.elements ?? [],
      firstWord: tr?.words && Array.isArray(tr.words) && (tr.words as Array<{ w: string }>)[0]?.w ? (tr.words as Array<{ w: string }>)[0]!.w : null,
      timeToFirstWordMs: tr?.firstWordMs ?? null,
      shotCount: (data.shots ?? []).filter((s) => (h.endMs ?? 0) > 0 && (s.idx ?? 0) >= 0).length || null,
    }).onConflictDoUpdate({
      target: videoHooks.analysisId,
      set: { startMs: h.startMs ?? null, endMs: h.endMs ?? null, hookText: h.hookText ?? null, types: h.types ?? [], form: h.form ?? [], elements: h.elements ?? [], updatedAt: new Date() },
    });
  }
  if (data.structure) {
    await db.insert(videoStructure).values({ analysisId, segments: data.structure })
      .onConflictDoUpdate({ target: videoStructure.analysisId, set: { segments: data.structure, updatedAt: new Date() } });
  }
  if (data.overlays) {
    await db.update(videoAnalyses).set({ overlays: data.overlays, updatedAt: new Date() }).where(eq(videoAnalyses.id, analysisId));
  }
  return { status: "done", detail: `${(data.shots ?? []).length} shots geduid` };
}

/* ---------------- AI-conclusies → aiOutputs ---------------- */
async function generateVideoInsights(analysisId: string): Promise<{ status: StepStatus; detail?: string }> {
  const [a] = await db.select().from(videoAnalyses).where(eq(videoAnalyses.id, analysisId)).limit(1);
  if (!a) return { status: "failed", detail: "Analyse niet gevonden." };
  const [tr] = await db.select().from(videoTranscripts).where(eq(videoTranscripts.analysisId, analysisId)).limit(1);
  const [em] = await db.select().from(videoEditingMetrics).where(eq(videoEditingMetrics.analysisId, analysisId)).limit(1);
  const shots = await db.select().from(videoShots).where(eq(videoShots.analysisId, analysisId)).orderBy(videoShots.idx);

  // Per shot: tijd, uitgesproken tekst, tekst in beeld — zodat de AI per moment
  // kan onderbouwen (hoe hook/script/beeld/montage samenwerken).
  const words = (tr?.words as Array<{ w: string; start: number; end: number }>) ?? [];
  const perShot = shots.map((s) => ({
    idx: s.idx,
    t: `${Math.round(s.startMs / 1000)}-${Math.round(s.endMs / 1000)}s`,
    gesproken: words.filter((w) => w.start >= s.startMs && w.start < s.endMs).map((w) => w.w).join(" ").trim() || null,
    tekstInBeeld: s.textOnScreen ?? null,
    shotType: s.shotType ?? null,
  }));

  const facts = {
    durationMs: a.durationMs,
    metrics: a.metricsSnapshot,
    editing: em ?? null,
    speech: tr ? { wpm: tr.wpm, firstWordMs: tr.firstWordMs, words3s: tr.words3s, words5s: tr.words5s } : null,
    perShot,
  };
  const res = await runJsonPrompt<{ watWerkt?: string[]; watMinder?: string[]; verbeteringen?: string[]; onzekerheden?: string[]; verbeterdScript?: string; alternatieveHooks?: string[] }>({
    system: "Je bent script- en video-analist voor short-form content. Analyseer de hook, het middenstuk en de CTA en hoe beeld, gesproken tekst, shots en montage samenwerken. Onderbouw elke bewering met wat daadwerkelijk zichtbaar/hoorbaar is (verwijs naar tijdstippen/shots). Scheid bewezen observatie van creatieve verwachting; trek geen causale conclusies uit één video. Behoud bij een herschrijf het oorspronkelijke concept en de tone of voice. Geef uitsluitend geldige JSON terug.",
    user: `Gemeten gegevens + per-shot opbouw (JSON):\n${JSON.stringify(facts)}\n\nVolledig transcript:\n${tr?.fullText ?? "(geen transcript)"}\n\nGeef JSON met:\n{\n  "watWerkt": string[],            // wat gaat goed, met tijdstip/shot\n  "watMinder": string[],           // wat kan beter, met reden\n  "verbeteringen": string[],       // concrete, praktische aanpassingen\n  "onzekerheden": string[],        // ontbrekende data / aannames\n  "verbeterdScript": string,       // sterkere versie, zelfde concept + tone; benoem wat is aangepast\n  "alternatieveHooks": string[]    // 2-3 alternatieve hooks\n}\nAls er te weinig data is (bv. geen transcript), zet dat in onzekerheden en houd verbeterdScript leeg.`,
    maxTokens: 3000,
  });
  if (!res.ok) return { status: "failed", detail: res.error ?? "AI-conclusies mislukt." };
  await db.insert(aiOutputs).values({
    clientId: a.clientId,
    tool: "video_intelligence",
    title: a.title ?? "Video-analyse",
    inputSummary: `analyse ${analysisId}`,
    output: res.data as Record<string, unknown>,
    createdById: a.createdById ?? null,
  });
  return { status: "done" };
}

function sample<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr;
  const step = arr.length / n;
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)]!);
  return out;
}
