import "server-only";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { run, tools, ytdlpBin, ffmpegBin } from "./tools";
import { analysisDir, ensureAnalysisDir } from "./paths";

/**
 * Bron ophalen voor een analyse.
 *
 * - upload: het bestand staat al op schijf (geschreven door de upload-route); we
 *   bevestigen alleen dat het er is.
 * - platform_url: downloaden met yt-dlp. LET OP: platform-voorwaarden/AVG en
 *   wisselende betrouwbaarheid (vooral Instagram). Lukt het niet, dan is upload
 *   de terugval.
 */

export type IngestResult =
  | { ok: true; mediaPath: string; caption: string | null; externalPostId: string | null; fileSizeBytes: number }
  | { ok: false; reason: string };

export async function downloadFromUrl(analysisId: string, url: string): Promise<IngestResult> {
  if (!(await tools.ytdlp())) {
    return { ok: false, reason: "yt-dlp niet geïnstalleerd (brew install yt-dlp)" };
  }
  const dir = await ensureAnalysisDir(analysisId);
  const outTpl = path.join(dir, "source.%(ext)s");
  const res = await run(
    ytdlpBin(),
    [
      "-f", "best[ext=mp4]/mp4/best",
      "--no-playlist",
      "--no-warnings",
      "--ffmpeg-location", ffmpegBin(),
      "--write-info-json",
      "-o", outTpl,
      url,
    ],
    { timeoutMs: 180000 },
  );
  if (res.code !== 0) {
    return { ok: false, reason: `Download mislukt: ${res.stderr.split("\n").filter(Boolean).slice(-1)[0] ?? res.code}` };
  }

  // Zoek het gedownloade mediabestand + de info-json.
  const files = await readdir(dir);
  const media = files.find((f) => /^source\.(mp4|mov|webm|mkv|m4v)$/i.test(f));
  if (!media) return { ok: false, reason: "Geen mediabestand gevonden na download." };
  const mediaPath = path.join(dir, media);
  const size = (await stat(mediaPath)).size;

  let caption: string | null = null;
  let externalPostId: string | null = null;
  const infoName = files.find((f) => f.endsWith(".info.json"));
  if (infoName) {
    try {
      const info = JSON.parse(await readFile(path.join(dir, infoName), "utf8")) as {
        description?: string; title?: string; id?: string;
      };
      caption = info.description ?? info.title ?? null;
      externalPostId = info.id ?? null;
    } catch {
      /* info-json optioneel */
    }
  }
  return { ok: true, mediaPath, caption, externalPostId, fileSizeBytes: size };
}

/** Bevestigt dat een geüpload bestand aanwezig is. */
export async function confirmUpload(analysisId: string, mediaPath: string): Promise<IngestResult> {
  try {
    const size = (await stat(mediaPath)).size;
    void analysisDir(analysisId);
    return { ok: true, mediaPath, caption: null, externalPostId: null, fileSizeBytes: size };
  } catch {
    return { ok: false, reason: "Geüpload bestand niet gevonden op schijf." };
  }
}
