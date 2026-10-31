import "server-only";
import { existsSync } from "node:fs";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { ffmpegBin, run } from "@/server/video-intelligence/tools";
import { deriveTimeline, stableHash, type EditPlan, type Timeline } from "./plan";
import type { StyleConfig } from "./style-profile";
import { gradeFilter, inputTransformFilter } from "./grade";
import { loudness } from "./media";

/**
 * De render. Leest het montageplan en maakt er een echte video van met ffmpeg:
 *
 * 1. Elk spraaksegment en elke b-roll-clip wordt los gerenderd uit het
 *    ORIGINELE bronbestand (niets vooraf gecomprimeerd): bijsnijden naar 9:16,
 *    zoom, kleurconversie en grade. Segmenten worden gecachet op een hash van
 *    hun invoer; bij feedback worden alleen gewijzigde segmenten opnieuw gemaakt.
 * 2. Samenvoegen (concat, zonder hercodering) tot de basisvideo.
 * 3. Compositie: b-roll, ondertitels, kaarten, muziek (met ducking) en
 *    geluidseffecten in één pass; de video wordt hier één keer definitief
 *    gecodeerd.
 * 4. Audio-mastering: twee-pass loudnorm naar het profiel (-16,5 LUFS, -1 dBTP),
 *    video wordt gekopieerd.
 *
 * Preview = halve resolutie en snelle instellingen; definitief = volle
 * kwaliteit. Andere formaten (4:5, 1:1) gebruiken dezelfde opbouw met een
 * andere uitsnede en meegeschaalde posities.
 */

export type RenderSource = {
  id: string;
  localPath: string;
  hasAudio: boolean;
  width: number;
  height: number;
  /** Pad naar de LUT voor de technische conversie, indien gekozen. */
  lutPath: string | null;
};

export type ExportFormat = "9x16" | "4x5" | "1x1";
export type Quality = "preview" | "final";

export type Geometry = { W: number; H: number; captionCenterY: number; cardBottomY: number; scale: number };

export function geometry(style: StyleConfig, format: ExportFormat, quality: Quality): Geometry {
  const baseW = style.export.width;
  const baseH = style.export.height;
  const H = format === "9x16" ? baseH : format === "4x5" ? Math.round((baseW * 5) / 4) : baseW;
  const factor = quality === "preview" ? 0.5 : 1;
  // Posities schalen mee met de hoogte, met een minimum-afstand tot de onderrand.
  const capRatio = style.captions.centerYPx / baseH;
  const cardRatio = style.cards.bottomYPx / baseH;
  const even = (x: number) => Math.round(x / 2) * 2;
  return {
    W: even(baseW * factor),
    H: even(H * factor),
    captionCenterY: Math.round(H * (format === "9x16" ? capRatio : 0.82) * factor),
    cardBottomY: Math.round(H * (format === "9x16" ? cardRatio : 0.74) * factor),
    scale: factor,
  };
}

export type RenderStats = { segmentsRendered: number; segmentsReused: number; renderSeconds: number };

export type RenderResult = { file: string; timeline: Timeline; stats: RenderStats; overlayManifest: OverlayManifest; log: string[] };

type OverlayManifest = {
  captions: Record<string, { file: string; x: number; y: number; w: number; h: number }>;
  cards: Record<string, { states: Array<{ state: number; file: string }>; x: number; y: number; w: number; h: number; fullscreen: boolean }>;
};

const FPS_DEFAULT = 25;

function cropFilter(src: RenderSource, W: number, H: number): string {
  const target = W / H;
  const aspect = src.width / Math.max(1, src.height);
  // Hoge/brede bron naar het doelformaat bijsnijden (midden).
  if (Math.abs(aspect - target) < 0.01) return "";
  if (aspect > target) return `crop=trunc(ih*${target.toFixed(5)}/2)*2:ih`;
  return `crop=iw:trunc(iw/${target.toFixed(5)}/2)*2`;
}

function zoomScale(W: number, H: number, from: number, to: number, dur: number): string {
  if (Math.abs(from - 1) < 0.001 && Math.abs(to - 1) < 0.001) return `scale=${W}:${H}:flags=lanczos`;
  const z = Math.abs(to - from) < 0.0005 ? `${from}` : `(${from}+(${(to - from).toFixed(4)})*min(t/${dur.toFixed(3)}\\,1))`;
  return `scale=w='trunc(${W}*${z}/2)*2':h='trunc(${H}*${z}/2)*2':eval=frame:flags=lanczos,crop=${W}:${H}`;
}

async function ff(args: string[], log: string[], timeoutMs = 60 * 60_000): Promise<void> {
  const res = await run(ffmpegBin(), ["-hide_banner", "-y", "-v", "error", ...args], { timeoutMs });
  if (res.code !== 0) {
    log.push(res.stderr.slice(-1500));
    throw new Error(`ffmpeg mislukt: ${res.stderr.split("\n").filter(Boolean).slice(-3).join(" | ").slice(0, 400)}`);
  }
}

export async function renderPlan(opts: {
  plan: EditPlan;
  style: StyleConfig;
  sources: Record<string, RenderSource>;
  musicPath: string | null;
  musicLufs: number | null;
  workDir: string;
  quality: Quality;
  format?: ExportFormat;
  fontDir: string;
  overlayScript: string;
  python: string;
  outFile: string;
}): Promise<RenderResult> {
  const t0 = Date.now();
  const log: string[] = [];
  const { plan, style, quality } = opts;
  const format = opts.format ?? "9x16";
  const g = geometry(style, format, quality);
  const fps = style.export.fps || FPS_DEFAULT;
  const timeline = deriveTimeline(plan, style.captions, fps);
  const final = quality === "final";
  const stats: RenderStats = { segmentsRendered: 0, segmentsReused: 0, renderSeconds: 0 };
  const segDir = path.join(opts.workDir, "segments");
  await run("mkdir", ["-p", segDir]);

  const vEnc = final
    ? ["-c:v", "libx264", "-preset", "veryfast", "-crf", "12", "-pix_fmt", "yuv420p"]
    : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p"];

  /* ---------------- 1. Segmenten ---------------- */
  const segFiles: string[] = [];
  for (const seg of timeline.segments) {
    const src = opts.sources[seg.sourceId];
    if (!src) throw new Error(`Bron ${seg.sourceId} ontbreekt.`);
    const grade = plan.grades[seg.sourceId];
    const key = stableHash({ v: 3, src: src.localPath, in: seg.inS, dur: seg.durS, zoom: seg.zoom, grade, adj: plan.gradeAdjust, so: seg.gradeOffset ?? null, W: g.W, H: g.H, fps, final, lut: src.lutPath });
    const file = path.join(segDir, `s_${key}.mov`);
    segFiles.push(file);
    if (existsSync(file)) { stats.segmentsReused++; continue; }
    const vf = [
      grade ? inputTransformFilter(grade.inputTransform, src.lutPath) : null,
      cropFilter(src, g.W, g.H),
      zoomScale(g.W, g.H, seg.zoom.from, seg.zoom.to, seg.durS),
      grade ? gradeFilter(grade, plan.gradeAdjust, seg.gradeOffset, style) : null,
      `fps=${fps}`,
      "setsar=1",
      "format=yuv420p",
    ].filter(Boolean).join(",");
    const frames = Math.max(1, Math.round(seg.durS * fps));
    const fade = Math.min(0.012, seg.durS / 4);
    const args = ["-ss", seg.inS.toFixed(3), "-i", src.localPath];
    if (!src.hasAudio) args.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
    args.push(
      "-t", seg.durS.toFixed(3),
      "-map", "0:v:0", "-map", src.hasAudio ? "0:a:0" : "1:a:0",
      "-vf", vf,
      "-af", `aresample=48000,aformat=sample_fmts=s16:channel_layouts=stereo,apad,atrim=0:${seg.durS.toFixed(3)},afade=t=in:d=${fade.toFixed(3)},afade=t=out:st=${(seg.durS - fade).toFixed(3)}:d=${fade.toFixed(3)}`,
      "-frames:v", String(frames),
      ...vEnc, "-c:a", "pcm_s16le", "-ar", "48000", file + ".tmp.mov",
    );
    await ff(args, log);
    await rename(file + ".tmp.mov", file);
    stats.segmentsRendered++;
  }

  /* ---------------- 1b. B-roll ---------------- */
  const brollFiles: Array<{ file: string; atS: number; durS: number }> = [];
  for (const b of timeline.broll) {
    const src = opts.sources[b.sourceId];
    if (!src) continue;
    const grade = plan.grades[b.sourceId];
    const key = stableHash({ v: 3, b: src.localPath, in: b.inS, dur: b.durS, grade, adj: plan.gradeAdjust, W: g.W, H: g.H, fps, final, lut: src.lutPath });
    const file = path.join(segDir, `b_${key}.mov`);
    brollFiles.push({ file, atS: b.atS, durS: b.durS });
    if (existsSync(file)) { stats.segmentsReused++; continue; }
    const vf = [
      grade ? inputTransformFilter(grade.inputTransform, src.lutPath) : null,
      cropFilter(src, g.W, g.H),
      zoomScale(g.W, g.H, 1.0, 1.05, b.durS),
      grade ? gradeFilter(grade, plan.gradeAdjust, undefined, style) : null,
      `fps=${fps}`, "setsar=1", "format=yuv420p",
    ].filter(Boolean).join(",");
    await ff(["-ss", b.inS.toFixed(3), "-i", src.localPath, "-t", b.durS.toFixed(3), "-an", "-vf", vf, "-frames:v", String(Math.max(1, Math.round(b.durS * fps))), ...vEnc, file + ".tmp.mov"], log);
    await rename(file + ".tmp.mov", file);
    stats.segmentsRendered++;
  }

  /* ---------------- 2. Concat ---------------- */
  const list = path.join(opts.workDir, `concat_${quality}_${format}.txt`);
  await writeFile(list, segFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
  const base = path.join(opts.workDir, `base_${quality}_${format}.mov`);
  await ff(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", base], log);

  /* ---------------- 3. Grafische lagen (PNG) ---------------- */
  const ovDir = path.join(opts.workDir, `overlays_${quality}_${format}_${stableHash({ c: timeline.captions.map((c) => c.text), k: timeline.cards.map((c) => [c.template, c.title, c.items.map((i) => [i.text, i.pill]), c.value, c.label, c.sublabel, c.button]), s: plan.captionScale, o: plan.captionOffsetY, g })}`);
  const specPath = path.join(ovDir, "spec.json");
  const manifestPath = path.join(ovDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    await run("mkdir", ["-p", ovDir]);
    const scaledCaptions = { ...style.captions, sizePx: style.captions.sizePx * g.scale, paddingXPx: style.captions.paddingXPx * g.scale, boxHeightPx: style.captions.boxHeightPx * g.scale, boxRadiusPx: style.captions.boxRadiusPx * g.scale, centerYPx: g.captionCenterY };
    // Kaartmaten blijven op 1080-basis; het script schaalt ze met "scale".
    const scaledCards = { ...style.cards, bottomYPx: g.cardBottomY };
    await writeFile(specPath, JSON.stringify({
      width: g.W,
      height: g.H,
      fontDir: opts.fontDir,
      captions: timeline.captions.map((c, i) => ({ id: `c${i}`, text: c.text })),
      cards: timeline.cards.map((c) => ({ id: c.id, template: c.template, title: c.title, items: c.items.map((i) => ({ text: i.text, pill: i.pill, pillTone: i.pillTone })), value: c.value, label: c.label, sublabel: c.sublabel, button: c.button })),
      style: { captions: scaledCaptions, cards: { ...scaledCards, scale: g.scale } },
      captionScale: plan.captionScale,
      captionOffsetY: Math.round(plan.captionOffsetY * g.scale),
    }));
    const res = await run(opts.python, [opts.overlayScript, specPath, ovDir], { timeoutMs: 10 * 60_000 });
    if (res.code !== 0) throw new Error(`Grafische lagen renderen mislukt: ${res.stderr.slice(-400)}`);
  }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as OverlayManifest;

  /* ---------------- 4. Compositie ---------------- */
  const inputs: string[] = ["-i", base];
  const filters: string[] = [];
  let idx = 1;
  let vLabel = "[0:v]";
  let n = 0;
  const next = () => `[v${++n}]`;

  for (const b of brollFiles) {
    inputs.push("-i", b.file);
    const lbl = `[br${idx}]`;
    filters.push(`[${idx}:v]setpts=PTS-STARTPTS+${b.atS.toFixed(3)}/TB${lbl}`);
    const out = next();
    filters.push(`${vLabel}${lbl}overlay=eof_action=pass:enable='between(t,${b.atS.toFixed(3)},${(b.atS + b.durS - 0.001).toFixed(3)})'${out}`);
    vLabel = out;
    idx++;
  }

  // Kaarten: per toestand een venster; eerste toestand komt binnen met een
  // korte fade + schuif, de laatste gaat er met een fade uit.
  for (const card of timeline.cards) {
    const m = manifest.cards[card.id];
    if (!m) continue;
    const states = m.states;
    const times = stateTimes(card, states.map((s) => s.state));
    for (let k = 0; k < states.length; k++) {
      const s0 = times[k];
      const s1 = k + 1 < states.length ? times[k + 1] : card.endS;
      if (s1 - s0 < 0.04) continue;
      const dur = s1 - s0;
      inputs.push("-loop", "1", "-framerate", String(fps), "-t", (dur + 0.1).toFixed(3), "-i", states[k].file);
      const lbl = `[k${idx}]`;
      const fx: string[] = ["format=rgba"];
      if (k === 0) fx.push(`fade=t=in:st=0:d=0.16:alpha=1`);
      if (k === states.length - 1) fx.push(`fade=t=out:st=${Math.max(0, dur - 0.14).toFixed(3)}:d=0.14:alpha=1`);
      fx.push(`setpts=PTS-STARTPTS+${s0.toFixed(3)}/TB`);
      filters.push(`[${idx}:v]${fx.join(",")}${lbl}`);
      const yExpr = k === 0 && !m.fullscreen ? `'${m.y}+${Math.round(36 * g.scale)}*max(0\\,1-(t-${s0.toFixed(3)})/0.18)'` : `${m.y}`;
      const out = next();
      filters.push(`${vLabel}${lbl}overlay=x=${m.x}:y=${yExpr}:eof_action=pass:enable='between(t,${s0.toFixed(3)},${(s1 - 0.001).toFixed(3)})'${out}`);
      vLabel = out;
      idx++;
    }
  }

  // Ondertitels: hard aan/uit op de woordtijden.
  timeline.captions.forEach((c, i) => {
    const m = manifest.captions[`c${i}`];
    if (!m) return;
    inputs.push("-i", m.file);
    const out = next();
    filters.push(`${vLabel}[${idx}:v]overlay=x=${m.x}:y=${m.y}:enable='between(t,${c.startS.toFixed(3)},${(c.endS - 0.001).toFixed(3)})'${out}`);
    vLabel = out;
    idx++;
  });
  filters.push(`${vLabel}format=yuv420p[vout]`);

  // Audio: stem → filter/compressie; muziek → onder de stem met ducking; sfx.
  const a = style.audio;
  const voiceChain = ["highpass=f=75", a.denoise ? "afftdn=nr=8:nf=-42" : null, "acompressor=threshold=-22dB:ratio=3:attack=5:release=90:makeup=2", "aformat=sample_fmts=fltp:channel_layouts=stereo"].filter(Boolean).join(",");
  filters.push(`[0:a]${voiceChain}[voice]`);
  const mixIn: string[] = [];
  const D = timeline.durationS;
  if (opts.musicPath && plan.music.assetId && a.music) {
    inputs.push("-stream_loop", "-1", "-i", opts.musicPath);
    const baseLufs = (await loudness(base))?.integrated ?? -20;
    const gainDb = (baseLufs - a.musicBelowVoiceDb) - (opts.musicLufs ?? -14) + plan.music.gainDb;
    filters.push(`[voice]asplit=2[voice1][vsc]`);
    filters.push(`[${idx}:a]atrim=0:${D.toFixed(3)},asetpts=PTS-STARTPTS,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=${gainDb.toFixed(2)}dB,afade=t=in:d=0.4,afade=t=out:st=${Math.max(0, D - 0.8).toFixed(3)}:d=0.8[mus]`);
    filters.push(`[mus][vsc]sidechaincompress=threshold=0.03:ratio=4:attack=20:release=300[musd]`);
    mixIn.push("[voice1]", "[musd]");
    idx++;
  } else {
    mixIn.push("[voice]");
  }
  timeline.sfx.forEach((s, i) => {
    const src = s.kind === "pop"
      ? `aevalsrc='0.7*sin(2*PI*(700+900*exp(-t*45))*t)*exp(-t*30)':d=0.16:s=48000`
      : `anoisesrc=d=0.32:c=pink:a=0.6:r=48000,bandpass=f=1600:width_type=o:w=2.5,afade=t=in:d=0.18,afade=t=out:st=0.18:d=0.14`;
    const ms = Math.round(s.atS * 1000);
    filters.push(`${src},aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${a.sfxGainDb}dB,adelay=${ms}|${ms}[sfx${i}]`);
    mixIn.push(`[sfx${i}]`);
  });
  filters.push(`${mixIn.join("")}amix=inputs=${mixIn.length}:normalize=0:duration=first,atrim=0:${D.toFixed(3)}[aout]`);

  const comp = path.join(opts.workDir, `comp_${quality}_${format}.mov`);
  const finalV = final
    ? ["-c:v", "libx264", "-preset", "medium", "-crf", String(style.export.crf), "-profile:v", "high", "-level", "4.2", "-maxrate", `${style.export.maxBitrateKbps}k`, "-bufsize", `${style.export.maxBitrateKbps * 2}k`, "-pix_fmt", "yuv420p", "-g", String(fps * 2)]
    : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p", "-g", String(fps * 2)];
  const filterFile = path.join(opts.workDir, `filters_${quality}_${format}.txt`);
  await writeFile(filterFile, filters.join(";\n"));
  await ff([...inputs, "-filter_complex_script", filterFile, "-map", "[vout]", "-map", "[aout]", "-r", String(fps), ...finalV,
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-c:a", "pcm_s16le", "-t", D.toFixed(3), comp], log);

  /* ---------------- 5. Audio-mastering (2-pass loudnorm) ---------------- */
  const target = `I=${a.targetLufs}:TP=${a.truePeakDb}:LRA=7`;
  const m1 = await run(ffmpegBin(), ["-hide_banner", "-nostats", "-i", comp, "-vn", "-af", `loudnorm=${target}:print_format=json`, "-f", "null", "-"], { timeoutMs: 20 * 60_000 });
  const json = m1.stderr.slice(m1.stderr.lastIndexOf("{"), m1.stderr.lastIndexOf("}") + 1);
  let ln = `loudnorm=${target}`;
  try {
    const j = JSON.parse(json) as Record<string, string>;
    ln = `loudnorm=${target}:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`;
  } catch { /* dan dynamische modus */ }
  const tmpOut = opts.outFile + ".tmp.mp4";
  await ff(["-i", comp, "-map", "0:v", "-map", "0:a", "-c:v", "copy", "-af", `${ln},aresample=48000`, "-c:a", "aac", "-b:a", `${final ? style.export.audioBitrateKbps : 160}k`, "-ar", "48000", "-movflags", "+faststart", tmpOut], log);
  await rename(tmpOut, opts.outFile);
  await stat(opts.outFile);

  stats.renderSeconds = Math.round((Date.now() - t0) / 100) / 10;
  return { file: opts.outFile, timeline, stats, overlayManifest: manifest, log };
}

/** Tijdstippen waarop elke kaarttoestand begint. */
function stateTimes(card: Timeline["cards"][number], states: number[]): number[] {
  const it = card.itemTimes;
  return states.map((s, k) => {
    if (k === 0) return card.startS;
    if (card.template === "cta_form") return Math.max(card.startS + 0.3, it[0] ?? card.startS + 0.3);
    if (card.template === "process") return Math.max(card.startS, it[s - 1] ?? card.startS);
    return Math.max(card.startS, it[s - 1] ?? card.startS);
  }).map((t, k, arr) => (k > 0 && t < arr[k - 1] ? arr[k - 1] : t));
}
