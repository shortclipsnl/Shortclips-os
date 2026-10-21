import "server-only";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Lokale opslag voor Video Intelligence. Fase 1 bewaart bron + frames op schijf
 * onder .data/ (gitignored, net als PGlite). Bij productie verhuist dit naar
 * objectopslag (zie plan, infra-fase).
 */
export const VI_STORE_ROOT = path.join(process.cwd(), ".data", "video-intelligence");

export function analysisDir(id: string): string {
  return path.join(VI_STORE_ROOT, id);
}

export function framesDir(id: string): string {
  return path.join(analysisDir(id), "frames");
}

/** Maakt de map voor een analyse aan (incl. frames). */
export async function ensureAnalysisDir(id: string): Promise<string> {
  const dir = analysisDir(id);
  await mkdir(framesDir(id), { recursive: true });
  return dir;
}

/** Zet een absoluut pad om naar een pad relatief aan de store (voor opslag in de DB). */
export function toStoreRelative(absPath: string): string {
  return path.relative(VI_STORE_ROOT, absPath);
}

/** Zet een in de DB opgeslagen relatief pad terug om naar absoluut. */
export function fromStoreRelative(rel: string): string {
  return path.join(VI_STORE_ROOT, rel);
}

/**
 * Schrijfbare werkmap voor ffmpeg-scratch (frames, audio), altijd onder /tmp.
 * Werkt zowel lokaal als op Vercel, waar alleen /tmp beschrijfbaar is. De inhoud
 * is tijdelijk: thumbnails worden na verwerking in de database bewaard.
 */
export function workDir(id: string): string {
  return path.join(os.tmpdir(), "shortclips-vi", id);
}

export function workFramesDir(id: string): string {
  return path.join(workDir(id), "frames");
}

export async function ensureWorkDir(id: string): Promise<string> {
  const dir = workDir(id);
  await mkdir(workFramesDir(id), { recursive: true });
  return dir;
}
