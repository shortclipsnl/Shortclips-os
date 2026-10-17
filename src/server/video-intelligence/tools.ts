import "server-only";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const req = createRequire(import.meta.url);

/**
 * Pad naar de ffmpeg/ffprobe-binary. Voorkeur: expliciete env, dan de
 * meegeleverde static-pakketten (project-scoped, geen systeeminstallatie), dan
 * "ffmpeg"/"ffprobe" op het PATH. We valideren met existsSync en vallen terug op
 * de bekende node_modules-locatie, zodat het ook binnen de Next-bundel werkt.
 */
export function ffmpegBin(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    const p = req("ffmpeg-static") as string | null;
    if (p && existsSync(p)) return p;
  } catch { /* pakket niet aanwezig */ }
  const guess = path.join(process.cwd(), "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  if (existsSync(guess)) return guess;
  return "ffmpeg";
}

export function ffprobeBin(): string {
  if (process.env.FFPROBE_PATH) return process.env.FFPROBE_PATH;
  try {
    const p = (req("ffprobe-static") as { path?: string }).path;
    if (p && existsSync(p)) return p;
  } catch { /* pakket niet aanwezig */ }
  const guess = path.join(process.cwd(), "node_modules", "ffprobe-static", "bin", process.platform, process.arch, process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
  if (existsSync(guess)) return guess;
  return "ffprobe";
}

/** yt-dlp: env, dan ~/.local/bin (uv tool), dan PATH. */
export function ytdlpBin(): string {
  if (process.env.YTDLP_PATH) return process.env.YTDLP_PATH;
  const home = process.env.HOME ?? "";
  const local = path.join(home, ".local", "bin", "yt-dlp");
  if (home && existsSync(local)) return local;
  return "yt-dlp";
}

/** Python uit de transcriptie-venv (.venv-vi), of null als die er niet is. */
export function whisperPython(): string | null {
  const p = path.join(process.cwd(), ".venv-vi", "bin", "python");
  return existsSync(p) ? p : null;
}

/** Het transcriptie-script. */
export function whisperScript(): string {
  return path.join(process.cwd(), "scripts", "vi_transcribe.py");
}

/** Het OCR-script (zelfde venv als transcriptie). */
export function ocrScript(): string {
  return path.join(process.cwd(), "scripts", "vi_ocr.py");
}

/**
 * Detectie en uitvoering van externe binaries (ffmpeg/ffprobe/yt-dlp/whisper).
 * Alles is optioneel: ontbreekt een tool, dan wordt de bijbehorende stap
 * eerlijk overgeslagen (status "skipped" met reden) — nooit nepdata.
 */

export type RunResult = { code: number; stdout: string; stderr: string };

/** Voert een commando uit en verzamelt stdout/stderr. Faalt niet bij non-zero exit. */
export function run(cmd: string, args: string[], opts: { cwd?: string; timeoutMs?: number; input?: string } = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: opts.cwd });
    let stdout = "";
    let stderr = "";
    const timeout = opts.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGKILL");
          resolve({ code: 124, stdout, stderr: stderr + "\n[timeout]" });
        }, opts.timeoutMs)
      : null;
    child.stdout?.on("data", (d) => (stdout += d.toString()));
    child.stderr?.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      if (timeout) clearTimeout(timeout);
      // ENOENT → binary niet geïnstalleerd.
      resolve({ code: 127, stdout, stderr: String((err as NodeJS.ErrnoException).message ?? err) });
    });
    child.on("close", (code) => {
      if (timeout) clearTimeout(timeout);
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}

const availability = new Map<string, boolean>();

/** Is een binary beschikbaar? Gecachet per proces. */
export async function hasTool(cmd: string, versionArg = "-version"): Promise<boolean> {
  if (availability.has(cmd)) return availability.get(cmd)!;
  const res = await run(cmd, [versionArg], { timeoutMs: 5000 });
  const ok = res.code !== 127;
  availability.set(cmd, ok);
  return ok;
}

/** Is een Python-pakket importeerbaar in de venv? Gecachet. */
async function venvHas(pkg: string, cacheKey: string): Promise<boolean> {
  if (availability.has(cacheKey)) return availability.get(cacheKey)!;
  const py = whisperPython();
  let ok = false;
  if (py) {
    const res = await run(py, ["-c", `import ${pkg}`], { timeoutMs: 20000 });
    ok = res.code === 0;
  }
  availability.set(cacheKey, ok);
  return ok;
}

export const tools = {
  ffmpeg: () => hasTool(ffmpegBin(), "-version"),
  ffprobe: () => hasTool(ffprobeBin(), "-version"),
  ytdlp: () => hasTool(ytdlpBin(), "--version"),
  whisper: () => venvHas("faster_whisper", "__whisper"),
  ocr: () => venvHas("rapidocr_onnxruntime", "__ocr"),
};
