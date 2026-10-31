import "server-only";
import { canRunAiEditor, runJob } from "./pipeline";
import { claimNextJob } from "./queue";

/**
 * Lokaal (of op een verwerk-server die ook de hub draait) worden jobs direct
 * na het klaarzetten uitgevoerd. Op Vercel ontbreken de tools; dan blijft de
 * job in de wachtrij en pakt de aparte worker hem op. Eén lokale runner
 * tegelijk, omdat PGlite maar één schrijver toestaat.
 */
let running = false;

export async function kickInline(): Promise<void> {
  if (running || process.env.VERCEL) return;
  if (!(await canRunAiEditor())) return;
  running = true;
  try {
    for (;;) {
      const id = await claimNextJob();
      if (!id) break;
      try { await runJob(id); } catch { /* fout staat op de job en het project */ }
    }
  } finally {
    running = false;
  }
}
