import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, contentResearchRuns } from "@/db/schema";
import {
  STALE_MIN,
  creditBlockedRecently,
  runContentResearchJob,
  startContentResearchRun,
} from "@/server/content-research/run";
import { syncIdeaOutcomes } from "@/server/content-research/outcomes";

/** Minimaal 6 dagen tussen twee GESLAAGDE rondes per klant. */
const MIN_DAYS_BETWEEN = 6;

/**
 * Pakt precies één stuk werk op, zodat elke cron-aanroep ruim binnen de 5
 * minuten van Vercel blijft:
 *   1. een ronde die op fase 2 wacht of waarvan de hartslag stil is (time-out);
 *   2. anders (alleen in de wekelijkse modus) een nieuwe ronde voor de volgende
 *      actieve klant die nog niet aan de beurt was.
 */
async function advanceOne(opts: { startNew: boolean }): Promise<{ action: string; clientId?: string; ok?: boolean; reason?: string }> {
  // 1. Lopende rondes: oudste eerst. Een ronde die net zelf actief is (verse
  //    hartslag, fase 1) laten we met rust; een ronde die op fase 2 wacht of stil
  //    is gevallen, pakken we op.
  const open = await db
    .select({
      id: contentResearchRuns.id,
      clientId: contentResearchRuns.clientId,
      phase: contentResearchRuns.phase,
      briefing: sql<boolean>`${contentResearchRuns.briefing} is not null`,
      heartbeatAt: contentResearchRuns.heartbeatAt,
      startedAt: contentResearchRuns.startedAt,
      updatedAt: contentResearchRuns.updatedAt,
    })
    .from(contentResearchRuns)
    .where(and(eq(contentResearchRuns.status, "bezig"), isNull(contentResearchRuns.deletedAt)))
    .orderBy(asc(contentResearchRuns.createdAt))
    .limit(20);

  for (const r of open) {
    const last = r.heartbeatAt ?? r.startedAt ?? r.updatedAt;
    const idleMin = (Date.now() - last.getTime()) / 60000;
    const waitingForPhase2 = Boolean(r.briefing) && r.phase === "wacht";
    if (waitingForPhase2 || idleMin >= STALE_MIN) {
      // Claimen: alleen de aanroep die de hartslag als eerste verzet, gaat door.
      // Voorkomt dat cron, "advance" en de directe doorstart dezelfde fase dubbel doen.
      const claimed = await db
        .update(contentResearchRuns)
        .set({ heartbeatAt: new Date() })
        .where(and(
          eq(contentResearchRuns.id, r.id),
          eq(contentResearchRuns.status, "bezig"),
          r.heartbeatAt ? eq(contentResearchRuns.heartbeatAt, r.heartbeatAt) : isNull(contentResearchRuns.heartbeatAt),
        ))
        .returning({ id: contentResearchRuns.id });
      if (claimed.length === 0) continue;
      const res = await runContentResearchJob(r.id, { budgetMs: 250_000 });
      return { action: "hervat", clientId: r.clientId, ok: res.ok, reason: res.reason ?? res.phase };
    }
  }

  if (!opts.startNew) return { action: "niets" };
  if (open.length > 0) return { action: "wacht op lopende ronde" };
  if (await creditBlockedRecently()) return { action: "gestopt: AI-tegoed op" };

  // 2. Nieuwe ronde voor de eerstvolgende actieve klant.
  const active = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(isNull(clients.deletedAt), inArray(clients.status, ["active", "onboarding"])))
    .limit(500);
  const cutoff = Date.now() - MIN_DAYS_BETWEEN * 24 * 60 * 60 * 1000;

  for (const c of active) {
    // Alleen een GESLAAGDE ronde telt als "recent onderzocht". Voorheen blokkeerde
    // ook een mislukte ronde de klant een week lang.
    const [lastOk] = await db
      .select({ finishedAt: contentResearchRuns.finishedAt })
      .from(contentResearchRuns)
      .where(and(eq(contentResearchRuns.clientId, c.id), eq(contentResearchRuns.status, "klaar"), isNull(contentResearchRuns.deletedAt)))
      .orderBy(desc(contentResearchRuns.finishedAt))
      .limit(1);
    if (lastOk?.finishedAt && lastOk.finishedAt.getTime() > cutoff) continue;

    // Niet eindeloos opnieuw proberen: max. 2 mislukte pogingen per dag.
    const recentFails = await db
      .select({ createdAt: contentResearchRuns.createdAt })
      .from(contentResearchRuns)
      .where(and(eq(contentResearchRuns.clientId, c.id), eq(contentResearchRuns.status, "mislukt")))
      .orderBy(desc(contentResearchRuns.createdAt))
      .limit(2);
    if (recentFails.length >= 2 && recentFails.every((f) => Date.now() - f.createdAt.getTime() < 24 * 3600_000)) continue;

    const runId = await startContentResearchRun(c.id, null);
    const res = await runContentResearchJob(runId, { budgetMs: 250_000 });
    return { action: "gestart", clientId: c.id, ok: res.ok, reason: res.reason ?? res.phase };
  }
  return { action: "alle actieve klanten zijn deze week onderzocht" };
}

/** Maandagochtend, elke 5 minuten: de wekelijkse ronde voor alle actieve klanten. */
export async function runContentResearchWeekly() {
  const res = await advanceOne({ startNew: true });
  if (res.action.startsWith("alle actieve")) {
    // Klaar met de week: koppel meteen de resultaten van gepubliceerde ideeën.
    const outcomes = await syncIdeaOutcomes().catch(() => null);
    return { ...res, outcomes };
  }
  return res;
}

/** Overdag, elke 5 minuten: alleen lopende (handmatig gestarte) rondes afmaken. */
export async function runContentResearchAdvance() {
  return advanceOne({ startNew: false });
}
