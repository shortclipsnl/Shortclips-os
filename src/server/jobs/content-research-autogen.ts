import "server-only";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, contentResearchRuns } from "@/db/schema";
import { runContentResearchForClient } from "@/server/content-research/run";

// Elk onderzoek duurt enkele minuten (web-onderzoek + Opus). Op Vercel geldt een
// maxDuration per aanroep, dus per run doen we er weinig; de cron draait maandag­
// ochtend vaak genoeg om alle actieve klanten te dekken (de 7-dagen-skip voorkomt
// dubbel werk).
const MAX_PER_RUN = 2;
const MIN_DAYS_BETWEEN = 6;

/**
 * Wekelijkse inhaalronde: verzamelt automatisch nieuwe inspiratie voor actieve
 * klanten. Slaat klanten over die een lopend onderzoek hebben of die < 7 dagen
 * geleden al onderzocht zijn (geen onnodig dubbel onderzoek / AI-kosten).
 */
export async function runContentResearchWeekly(): Promise<{ scanned: number; started: number; failed: number }> {
  const active = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(isNull(clients.deletedAt), inArray(clients.status, ["active", "onboarding"])))
    .limit(500);

  const cutoff = Date.now() - MIN_DAYS_BETWEEN * 24 * 60 * 60 * 1000;
  let started = 0;
  let failed = 0;

  for (const c of active) {
    if (started >= MAX_PER_RUN) break;

    const [last] = await db
      .select({ status: contentResearchRuns.status, createdAt: contentResearchRuns.createdAt })
      .from(contentResearchRuns)
      .where(and(eq(contentResearchRuns.clientId, c.id), isNull(contentResearchRuns.deletedAt)))
      .orderBy(desc(contentResearchRuns.createdAt))
      .limit(1);

    if (last?.status === "bezig") continue;
    if (last && last.createdAt.getTime() > cutoff) continue; // recent genoeg

    try {
      const res = await runContentResearchForClient(c.id, { triggeredById: null });
      if (res.ok) started++;
      else if (res.reason === "error") failed++;
    } catch {
      failed++;
    }
  }

  return { scanned: active.length, started, failed };
}
