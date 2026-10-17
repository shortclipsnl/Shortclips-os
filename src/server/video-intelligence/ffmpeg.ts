import "server-only";
import path from "node:path";
import { run, ffmpegBin, ffprobeBin } from "./tools";
import { framesDir } from "./paths";

/**
 * Meetbare video-analyse met ffmpeg/ffprobe — werkt zonder AI-sleutels en levert
 * echte data: duur/resolutie, shotgrenzen (scene-detectie), thumbnails per shot
 * en montagemetrieken. Deze functies gaan ervan uit dat de binaries bestaan
 * (de pijplijn controleert dat vooraf).
 */

export type Probe = { durationMs: number; width: number | null; height: number | null; fps: number | null; aspectRatio: string | null };

export async function probe(mediaPath: string): Promise<Probe | null> {
  const res = await run(ffprobeBin(), [
    "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", mediaPath,
  ], { timeoutMs: 30000 });
  if (res.code !== 0) return null;
  let data: { format?: { duration?: string }; streams?: Array<Record<string, unknown>> };
  try {
    data = JSON.parse(res.stdout);
  } catch {
    return null;
  }
  const v = (data.streams ?? []).find((s) => s.codec_type === "video");
  const durationSec = Number(data.format?.duration ?? (v?.duration as string) ?? 0);
  const width = v?.width ? Number(v.width) : null;
  const height = v?.height ? Number(v.height) : null;
  let fps: number | null = null;
  const rate = (v?.avg_frame_rate as string) || (v?.r_frame_rate as string) || "";
  if (rate.includes("/")) {
    const [n, d] = rate.split("/").map(Number);
    if (n && d) fps = Math.round(n / d);
  }
  const aspectRatio =
    (v?.display_aspect_ratio as string) ||
    (width && height ? `${width}:${height}` : null);
  return { durationMs: Math.round(durationSec * 1000), width, height, fps, aspectRatio };
}

/** Scene-grens-detectie → shotgrenzen in ms (exclusief start/eind). */
export async function detectSceneCuts(mediaPath: string, threshold = 0.3): Promise<number[]> {
  const res = await run(ffmpegBin(), [
    "-i", mediaPath,
    "-filter:v", `select='gt(scene,${threshold})',showinfo`,
    "-f", "null", "-",
  ], { timeoutMs: 120000 });
  // showinfo schrijft naar stderr: "... pts_time:2.345 ..."
  const cuts: number[] = [];
  const re = /pts_time:([0-9.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(res.stderr)) !== null) {
    const ms = Math.round(Number(m[1]) * 1000);
    if (Number.isFinite(ms)) cuts.push(ms);
  }
  return [...new Set(cuts)].sort((a, b) => a - b);
}

export type Shot = { idx: number; startMs: number; endMs: number };

/** Bouwt shots uit scene-grenzen + totale duur. */
export function shotsFromCuts(cuts: number[], durationMs: number): Shot[] {
  const bounds = [0, ...cuts.filter((c) => c > 150 && c < durationMs - 150), durationMs];
  const uniq = [...new Set(bounds)].sort((a, b) => a - b);
  const shots: Shot[] = [];
  for (let i = 0; i < uniq.length - 1; i++) {
    shots.push({ idx: i, startMs: uniq[i]!, endMs: uniq[i + 1]! });
  }
  return shots.length > 0 ? shots : [{ idx: 0, startMs: 0, endMs: durationMs }];
}

/** Pakt één frame op tijdstip t (ms) als JPEG. Geeft het bestandspad terug of null. */
export async function grabFrame(mediaPath: string, analysisId: string, tMs: number, name: string): Promise<string | null> {
  const out = path.join(framesDir(analysisId), name);
  const res = await run(ffmpegBin(), [
    "-y", "-ss", (tMs / 1000).toFixed(2), "-i", mediaPath,
    "-frames:v", "1", "-q:v", "3", out,
  ], { timeoutMs: 20000 });
  return res.code === 0 ? out : null;
}

export type EditingMetrics = {
  totalShots: number;
  avgShotMs: number;
  minShotMs: number;
  maxShotMs: number;
  cutsPer10s: number;
  tempoHookMs: number;
  tempoMiddleMs: number;
  tempoEndMs: number;
};

/** Montagemetrieken uit shots + duur. */
export function editingMetrics(shots: Shot[], durationMs: number): EditingMetrics {
  const lengths = shots.map((s) => s.endMs - s.startMs);
  const total = shots.length;
  const sum = lengths.reduce((a, b) => a + b, 0);
  const avg = total > 0 ? Math.round(sum / total) : 0;
  const cutsPer10s = durationMs > 0 ? Math.round(((total - 1) / durationMs) * 10000) : 0;
  // Gemiddelde shotlengte per derde van de video.
  const third = durationMs / 3;
  const avgIn = (from: number, to: number) => {
    const within = shots.filter((s) => s.startMs >= from && s.startMs < to).map((s) => s.endMs - s.startMs);
    return within.length ? Math.round(within.reduce((a, b) => a + b, 0) / within.length) : 0;
  };
  return {
    totalShots: total,
    avgShotMs: avg,
    minShotMs: lengths.length ? Math.min(...lengths) : 0,
    maxShotMs: lengths.length ? Math.max(...lengths) : 0,
    cutsPer10s,
    tempoHookMs: avgIn(0, third),
    tempoMiddleMs: avgIn(third, 2 * third),
    tempoEndMs: avgIn(2 * third, durationMs + 1),
  };
}
