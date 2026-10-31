/**
 * Shortclips AI Editor — verwerk-server (worker).
 *
 * Draait op een altijd-aan machine met ffmpeg en de Python-omgeving
 * (.venv-vi met faster-whisper + Pillow), verbonden met dezelfde database en
 * opslag als de online hub. De hub zet jobs in ai_editor_jobs; deze worker
 * voert ze uit (analyseren, monteren, renderen, QC, export).
 *
 *   npm run ai-editor:worker            → blijft draaien en pollt de wachtrij
 *   npm run ai-editor:worker -- --once  → verwerkt wat klaarstaat en stopt
 *
 * Zie docs/AI-EDITOR.md voor de inrichting.
 */
import { rawClient } from "../src/db/client";
import { canRunAiEditor, runJob } from "../src/server/ai-editor/pipeline";
import { claimNextJob } from "../src/server/ai-editor/queue";

const ONCE = process.argv.includes("--once");
const INTERVAL_MS = Number(process.env.AI_EDITOR_WORKER_INTERVAL_MS ?? 4000);
let stopping = false;

function log(msg: string) {
  console.log(`[ai-editor-worker ${new Date().toISOString()}] ${msg}`);
}

async function closeDb() {
  const raw = rawClient() as { end?: () => Promise<unknown>; close?: () => Promise<unknown> };
  try { await raw.end?.(); } catch { /* ignore */ }
  try { await raw.close?.(); } catch { /* ignore */ }
}

async function processAll(): Promise<number> {
  let done = 0;
  while (!stopping) {
    const id = await claimNextJob().catch((e) => { log(`Claimen mislukt: ${String(e)}`); return null; });
    if (!id) break;
    const t0 = Date.now();
    log(`Job ${id} opgepakt`);
    try {
      await runJob(id);
      log(`Job ${id} klaar in ${Math.round((Date.now() - t0) / 1000)} s`);
    } catch (e) {
      log(`Job ${id} mislukt: ${e instanceof Error ? e.message : String(e)}`);
    }
    done++;
  }
  return done;
}

async function main() {
  if (!(await canRunAiEditor())) {
    log("De Python-omgeving (.venv-vi met faster-whisper en Pillow) ontbreekt. Zie docs/AI-EDITOR.md. De worker stopt.");
    await closeDb();
    process.exit(1);
  }
  log(`Gestart. Database: ${process.env.DATABASE_URL ? "postgres" : "pglite (lokaal)"}. Modus: ${ONCE ? "één keer" : `lus (${INTERVAL_MS} ms)`}.`);
  if (ONCE) {
    const n = await processAll();
    log(`Klaar: ${n} job(s).`);
    await closeDb();
    process.exit(0);
  }
  const stop = () => { if (!stopping) { stopping = true; log("Stoppen…"); setTimeout(() => process.exit(0), 100); } };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  while (!stopping) {
    const n = await processAll();
    if (!n && !stopping) await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
