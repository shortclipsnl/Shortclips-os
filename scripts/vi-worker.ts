/**
 * Video Intelligence verwerk-server (worker).
 *
 * Draait op een altijd-aan machine MET de zware tools (ffmpeg, yt-dlp en de
 * .venv-vi met faster-whisper + rapidocr) en verbonden met dezelfde database +
 * opslag als de online hub. De online hub (Vercel) kan dat zware werk niet
 * draaien; die zet een analyse alleen in de wachtrij (status "queued"). Deze
 * worker pakt die jobs op en draait de bestaande pijplijn `runPipeline`, die
 * zelf de status bijwerkt en elke stap vult.
 *
 * Gebruik:
 *   npm run vi:worker            → blijft draaien en pollt de wachtrij
 *   npm run vi:worker -- --once  → verwerkt wat er klaarstaat en stopt (test/cron)
 *
 * Env (op de verwerk-server, gelijk aan productie):
 *   DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_VI_BUCKET,
 *   ANTHROPIC_API_KEY, evt. FFMPEG_PATH/FFPROBE_PATH/YTDLP_PATH.
 * Zie docs/VIDEO-INTELLIGENCE-WORKER.md voor de volledige opzet.
 */
import { sql } from "drizzle-orm";
import { db, rawClient } from "../src/db/client";
import { runPipeline } from "../src/server/video-intelligence/pipeline";
import { canRunHeavyPipeline } from "../src/server/video-intelligence/tools";

const ONCE = process.argv.includes("--once");
const INTERVAL_MS = Number(process.env.VI_WORKER_INTERVAL_MS ?? 5000);
const STALE_MIN = Number(process.env.VI_WORKER_STALE_MIN ?? 30);

let stopping = false;

function log(msg: string) {
  console.log(`[vi-worker ${new Date().toISOString()}] ${msg}`);
}

/**
 * Claimt atomisch één job: een "queued" analyse, of een "processing" analyse die
 * te lang stil ligt (worker is eerder gecrasht). FOR UPDATE SKIP LOCKED zorgt dat
 * meerdere workers nooit dezelfde job pakken. Geeft het id terug, of null.
 */
async function claimNext(): Promise<string | null> {
  const res = await db.execute(sql`
    update video_analyses set status = 'processing', updated_at = now()
    where id = (
      select id from video_analyses
      where status = 'queued'
         or (status = 'processing' and updated_at < now() - (${STALE_MIN} || ' minutes')::interval)
      order by created_at
      limit 1
      for update skip locked
    )
    returning id
  `);
  const rows = ((res as unknown as { rows?: Array<{ id: string }> }).rows ?? (res as unknown as Array<{ id: string }>));
  return rows[0]?.id ?? null;
}

/** DB netjes afsluiten (Pool heeft .end, PGlite .close) — best effort. */
async function closeDb() {
  const raw = rawClient() as { end?: () => Promise<unknown>; close?: () => Promise<unknown> };
  try { await raw.end?.(); } catch { /* ignore */ }
  try { await raw.close?.(); } catch { /* ignore */ }
}

async function processAll(): Promise<number> {
  let done = 0;
  while (!stopping) {
    let id: string | null = null;
    try {
      id = await claimNext();
    } catch (e) {
      log(`Kon geen job claimen: ${String(e)}`);
      return done;
    }
    if (!id) break; // wachtrij leeg
    log(`Job ${id} opgepakt → verwerken…`);
    const t0 = Date.now();
    try {
      await runPipeline(id);
      log(`Job ${id} klaar in ${Math.round((Date.now() - t0) / 1000)}s`);
    } catch (e) {
      // runPipeline schrijft fouten zelf naar video_analyses.error; hier alleen loggen.
      log(`Job ${id} fout: ${String(e)}`);
    }
    done++;
  }
  return done;
}

async function main() {
  // Zonder de zware tools heeft een worker geen zin — dan verwerkt hij niets zinnigs.
  if (!(await canRunHeavyPipeline())) {
    log("WAARSCHUWING: geen van de zware tools (Whisper/OCR/yt-dlp) gevonden in deze omgeving.");
    log("Installeer ze eerst — zie docs/VIDEO-INTELLIGENCE-WORKER.md. De worker stopt.");
    await closeDb();
    process.exit(1);
  }

  const driver = process.env.DATABASE_URL ? "postgres (DATABASE_URL)" : "pglite (lokaal .data)";
  log(`Gestart. Database: ${driver}. Modus: ${ONCE ? "één keer" : `lus (elke ${INTERVAL_MS}ms)`}.`);

  if (ONCE) {
    const n = await processAll();
    log(`Klaar — ${n} job(s) verwerkt.`);
    await closeDb();
    process.exit(0);
  }

  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    log("Stoppen aangevraagd — rond huidige job af…");
    setTimeout(() => process.exit(0), 100);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (!stopping) {
    const n = await processAll();
    if (n === 0 && !stopping) await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
