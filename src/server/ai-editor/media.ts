import "server-only";
import { ffmpegBin, ffprobeBin, run } from "@/server/video-intelligence/tools";

/**
 * Metingen op videobestanden met ffmpeg/ffprobe: technische gegevens,
 * kleurstatistiek, luidheid, stiltes, zwarte beelden en cuts.
 */

export type Probe = {
  durationS: number;
  width: number;
  height: number;
  fps: number;
  rotation: number;
  pixFmt: string | null;
  colorTransfer: string | null;
  colorPrimaries: string | null;
  bitDepth: number;
  hasAudio: boolean;
  codec: string | null;
  /** Camera-/profielmetadata uit de tags (o.a. Sony, Panasonic, Canon, Apple). */
  tags: Record<string, string>;
};

export async function probe(file: string): Promise<Probe> {
  const res = await run(ffprobeBin(), ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { timeoutMs: 60_000 });
  if (res.code !== 0) throw new Error(`ffprobe mislukt: ${res.stderr.slice(0, 300)}`);
  const j = JSON.parse(res.stdout) as {
    format?: { duration?: string; tags?: Record<string, string> };
    streams?: Array<Record<string, unknown> & { codec_type?: string; tags?: Record<string, string>; side_data_list?: Array<Record<string, unknown>> }>;
  };
  const v = j.streams?.find((s) => s.codec_type === "video");
  const a = j.streams?.find((s) => s.codec_type === "audio");
  if (!v) throw new Error("Geen videospoor gevonden.");
  const [num, den] = String(v.avg_frame_rate ?? v.r_frame_rate ?? "25/1").split("/").map(Number);
  const fps = den ? num / den : num;
  let rotation = Number(v.tags?.rotate ?? 0);
  const rot = v.side_data_list?.find((d) => d.rotation !== undefined);
  if (rot) rotation = Number(rot.rotation);
  const pix = (v.pix_fmt as string) ?? null;
  const bitDepth = pix && /10|12/.test(pix) ? (pix.includes("12") ? 12 : 10) : 8;
  return {
    durationS: Number(j.format?.duration ?? v.duration ?? 0),
    width: Number(v.width ?? 0),
    height: Number(v.height ?? 0),
    fps: Number.isFinite(fps) && fps > 0 ? fps : 25,
    rotation: ((rotation % 360) + 360) % 360,
    pixFmt: pix,
    colorTransfer: (v.color_transfer as string) ?? null,
    colorPrimaries: (v.color_primaries as string) ?? null,
    bitDepth,
    hasAudio: Boolean(a),
    codec: (v.codec_name as string) ?? null,
    tags: { ...(j.format?.tags ?? {}), ...(v.tags ?? {}) },
  };
}

/** Duur van een (audio)bestand in seconden. */
export async function mediaDuration(file: string): Promise<number> {
  const res = await run(ffprobeBin(), ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { timeoutMs: 30_000 });
  const d = Number(res.stdout.trim());
  return Number.isFinite(d) ? d : 0;
}

/** 16 kHz mono WAV voor de transcriptie. */
export async function extractAudioWav(file: string, out: string): Promise<void> {
  const res = await run(ffmpegBin(), ["-y", "-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", out], { timeoutMs: 20 * 60_000 });
  if (res.code !== 0) throw new Error(`Audio uitpakken mislukt: ${res.stderr.slice(0, 300)}`);
}

export type ColorStats = {
  luma: number;
  p2: number;
  p98: number;
  saturation: number;
  warmth: number;
  tint: number;
  r: number;
  g: number;
  b: number;
  lumaStd: number;
};

/**
 * Kleurstatistiek over een aantal frames (op klein formaat). Dezelfde meting
 * wordt gebruikt voor de referenties, de bronnen en de render, zodat de
 * doelwaarden in het profiel één-op-één vergelijkbaar zijn.
 */
export async function colorStats(file: string, opts: { startS?: number; durS?: number; samples?: number; vf?: string; cropTop?: number } = {}): Promise<ColorStats | null> {
  const samples = opts.samples ?? 6;
  const dur = opts.durS ?? 10;
  const fps = Math.max(0.2, samples / Math.max(0.5, dur));
  const W = 96;
  const H = 170;
  const chain = [opts.vf, `fps=${fps.toFixed(3)}`, opts.cropTop ? `crop=iw:ih*${opts.cropTop}:0:0` : null, `scale=${W}:${H}:flags=area`, "format=rgb24"].filter(Boolean).join(",");
  const args = ["-v", "error"];
  if (opts.startS) args.push("-ss", String(opts.startS));
  args.push("-t", String(dur), "-i", file, "-frames:v", String(samples), "-vf", chain, "-f", "rawvideo", "-");
  const res = await runBinary(ffmpegBin(), args);
  if (!res || res.length < W * H * 3) return null;
  return statsFromRgb(res);
}

export function statsFromRgb(buf: Buffer): ColorStats {
  const n = Math.floor(buf.length / 3);
  let sy = 0, sy2 = 0, ss = 0, sr = 0, sg = 0, sb = 0;
  const hist = new Array(256).fill(0);
  for (let i = 0; i < n; i++) {
    const r = buf[i * 3], g = buf[i * 3 + 1], b = buf[i * 3 + 2];
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    sy += y; sy2 += y * y; ss += mx > 0 ? (mx - mn) / mx : 0;
    sr += r; sg += g; sb += b;
    hist[Math.min(255, Math.round(y))]++;
  }
  const pct = (p: number) => {
    let acc = 0;
    const target = n * p;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= target) return v; }
    return 255;
  };
  const luma = sy / n;
  const r = sr / n, g = sg / n, b = sb / n;
  return {
    luma: round1(luma),
    p2: pct(0.02),
    p98: pct(0.98),
    saturation: Math.round((ss / n) * 1000) / 1000,
    warmth: round1(r - b),
    tint: round1(g - (r + b) / 2),
    r: round1(r), g: round1(g), b: round1(b),
    lumaStd: round1(Math.sqrt(Math.max(0, sy2 / n - luma * luma))),
  };
}

const round1 = (x: number) => Math.round(x * 10) / 10;

function runBinary(cmd: string, args: string[]): Promise<Buffer | null> {
  return new Promise((resolve) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { spawn } = require("node:child_process") as typeof import("node:child_process");
    const child = spawn(cmd, args);
    const chunks: Buffer[] = [];
    child.stdout.on("data", (d: Buffer) => chunks.push(d));
    child.on("error", () => resolve(null));
    child.on("close", (code) => resolve(code === 0 ? Buffer.concat(chunks) : null));
  });
}

export type Loudness = { integrated: number; range: number; truePeak: number };

export async function loudness(file: string): Promise<Loudness | null> {
  const res = await run(ffmpegBin(), ["-hide_banner", "-nostats", "-i", file, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"], { timeoutMs: 10 * 60_000 });
  const summary = res.stderr.split("Summary:").pop() ?? "";
  const I = summary.match(/I:\s+(-?[\d.]+) LUFS/);
  const LRA = summary.match(/LRA:\s+(-?[\d.]+) LU/);
  const TP = summary.match(/Peak:\s+(-?[\d.]+) dBFS/);
  if (!I) return null;
  return { integrated: Number(I[1]), range: LRA ? Number(LRA[1]) : 0, truePeak: TP ? Number(TP[1]) : 0 };
}

/** Stiltes (s) in de audio. */
export async function silences(file: string, noiseDb = -40, minS = 0.25): Promise<Array<{ start: number; end: number }>> {
  const res = await run(ffmpegBin(), ["-hide_banner", "-nostats", "-i", file, "-vn", "-af", `silencedetect=n=${noiseDb}dB:d=${minS}`, "-f", "null", "-"], { timeoutMs: 10 * 60_000 });
  const out: Array<{ start: number; end: number }> = [];
  let start: number | null = null;
  for (const line of res.stderr.split("\n")) {
    const s = line.match(/silence_start: (-?[\d.]+)/);
    const e = line.match(/silence_end: (-?[\d.]+)/);
    if (s) start = Number(s[1]);
    if (e && start != null) { out.push({ start, end: Number(e[1]) }); start = null; }
  }
  return out;
}

/** Zwarte beelden. */
export async function blackFrames(file: string): Promise<Array<{ start: number; end: number }>> {
  const res = await run(ffmpegBin(), ["-hide_banner", "-nostats", "-i", file, "-an", "-vf", "blackdetect=d=0.08:pix_th=0.06", "-f", "null", "-"], { timeoutMs: 10 * 60_000 });
  return [...res.stderr.matchAll(/black_start:(-?[\d.]+) black_end:(-?[\d.]+)/g)].map((m) => ({ start: Number(m[1]), end: Number(m[2]) }));
}

/** Cuts via scènedetectie (voor referentieanalyse). */
export async function sceneCuts(file: string, threshold = 0.25): Promise<number[]> {
  const res = await run(ffmpegBin(), ["-hide_banner", "-nostats", "-i", file, "-an", "-vf", `select='gt(scene,${threshold})',showinfo`, "-f", "null", "-"], { timeoutMs: 10 * 60_000 });
  return [...res.stderr.matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1]));
}

/** Gemiddeld volume (dB) van een tijdvenster. */
export async function meanVolume(file: string, startS: number, durS: number): Promise<number | null> {
  const res = await run(ffmpegBin(), ["-hide_banner", "-nostats", "-ss", String(startS), "-t", String(durS), "-i", file, "-vn", "-af", "volumedetect", "-f", "null", "-"], { timeoutMs: 120_000 });
  const m = res.stderr.match(/mean_volume: (-?[\d.]+) dB/);
  return m ? Number(m[1]) : null;
}

/**
 * Log-detectie. Betrouwbaar via metadata waar die er is (HLG/PQ, Sony
 * S-Log/S-Gamut in de tags, Panasonic V-Log, Canon C-Log), anders via de
 * beeldstatistiek: log-beelden zijn vlak (weinig contrast, lage verzadiging,
 * opgetilde zwarten).
 */
export function detectLog(p: Probe, stats: ColorStats | null): { isLog: boolean; profile: string | null; reason: string } {
  const tagText = Object.entries(p.tags).map(([k, v]) => `${k}=${v}`).join(" ").toLowerCase();
  const known: Array<[RegExp, string]> = [
    [/s-?log3|slog3/, "slog3"], [/s-?log2|slog2/, "slog2"], [/v-?log/, "vlog"], [/c-?log ?3|clog3/, "clog3"], [/c-?log/, "clog"],
    [/f-?log2/, "flog2"], [/f-?log/, "flog"], [/n-?log/, "nlog"], [/apple ?log/, "applelog"], [/log-?c|logc/, "logc"],
  ];
  for (const [re, name] of known) if (re.test(tagText)) return { isLog: true, profile: name, reason: `metadata (${name})` };
  if (p.colorTransfer === "arib-std-b67") return { isLog: true, profile: "hlg", reason: "HLG-transfer in metadata" };
  if (p.colorTransfer === "smpte2084") return { isLog: true, profile: "pq", reason: "PQ/HDR-transfer in metadata" };
  if (stats && stats.lumaStd < 42 && stats.saturation < 0.24 && stats.p2 > 14) {
    return { isLog: true, profile: null, reason: "vlak beeld (lage contrast/verzadiging, opgetilde zwarten)" };
  }
  return { isLog: false, profile: null, reason: "standaard Rec.709" };
}
