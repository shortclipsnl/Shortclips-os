import "server-only";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clientResearchRuns, clients } from "@/db/schema";
import { aiConfigured } from "@/server/ai/client";
import { STALE_MIN, researchCreditBlocked, runClientResearchJob, startClientResearch } from "@/server/client-research/run";
import { todayAmsterdam } from "@/lib/planning-deadline";

/** Een klant telt als "nieuw" tot zoveel dagen na het aanmaken. */
const NEW_CLIENT_DAYS = 14;

/**
 * Klantonderzoek op de achtergrond. Elke aanroep pakt precies één stuk werk op,
 * zodat hij ruim binnen de 5 minuten van Vercel blijft:
 *   1. een lopend onderzoek dat op zijn volgende fase wacht of is stilgevallen;
 *   2. anders een nulmeting voor een nieuwe klant die nog geen onderzoek heeft;
 *   3. anders een hercontrole voor een klant waarvan de 90 dagen om zijn.
 *
 * Bestaande klanten van vóór deze functie worden niet automatisch onderzocht:
 * daar start het team het onderzoek zelf, zodat er geen onverwachte AI-kosten
 * voor het hele klantenbestand ontstaan.
 */
export async function runClientResearchAdvance(): Promise<{ action: string; clientId?: string; ok?: boolean; reason?: string }> {
  const open = await db
    .select({
      id: clientResearchRuns.id,
      clientId: clientResearchRuns.clientId,
      phase: clientResearchRuns.phase,
      heartbeatAt: clientResearchRuns.heartbeatAt,
      startedAt: clientResearchRuns.startedAt,
      updatedAt: clientResearchRuns.updatedAt,
    })
    .from(clientResearchRuns)
    .where(and(eq(clientResearchRuns.status, "bezig"), isNull(clientResearchRuns.deletedAt)))
    .orderBy(asc(clientResearchRuns.createdAt))
    .limit(20);

  for (const r of open) {
    const last = r.heartbeatAt ?? r.startedAt ?? r.updatedAt;
    const idleMin = (Date.now() - last.getTime()) / 60000;
    if (!r.phase.startsWith("wacht_") && idleMin < STALE_MIN) continue;
    // Claimen: alleen de aanroep die de hartslag als eerste verzet, gaat door.
    const claimed = await db
      .update(clientResearchRuns)
      .set({ heartbeatAt: new Date() })
      .where(and(
        eq(clientResearchRuns.id, r.id),
        eq(clientResearchRuns.status, "bezig"),
        r.heartbeatAt ? eq(clientResearchRuns.heartbeatAt, r.heartbeatAt) : isNull(clientResearchRuns.heartbeatAt),
      ))
      .returning({ id: clientResearchRuns.id });
    if (claimed.length === 0) continue;
    const res = await runClientResearchJob(r.id, { budgetMs: 250_000 });
    return { action: "hervat", clientId: r.clientId, ok: res.ok, reason: res.reason ?? res.phase };
  }

  if (open.length > 0) return { action: "wacht op lopend onderzoek" };
  if (!aiConfigured()) return { action: "geen AI-sleutel" };
  if (await researchCreditBlocked()) return { action: "gestopt: AI-tegoed op" };

  // Laatste onderzoek per klant (welke status dan ook).
  const runs = await db
    .select({ clientId: clientResearchRuns.clientId, status: clientResearchRuns.status, nextCheckOn: clientResearchRuns.nextCheckOn })
    .from(clientResearchRuns)
    .where(isNull(clientResearchRuns.deletedAt))
    .orderBy(desc(clientResearchRuns.createdAt))
    .limit(5000);
  const byClient = new Map<string, { status: string; nextCheckOn: string | null }>();
  for (const r of runs) if (!byClient.has(r.clientId)) byClient.set(r.clientId, { status: r.status, nextCheckOn: r.nextCheckOn });

  const active = await db
    .select({ id: clients.id, createdAt: clients.createdAt })
    .from(clients)
    .where(and(isNull(clients.deletedAt), inArray(clients.status, ["active", "onboarding"])))
    .orderBy(asc(clients.createdAt))
    .limit(1000);

  // 2. Nieuwe klant zonder onderzoek.
  const newSince = Date.now() - NEW_CLIENT_DAYS * 24 * 3600_000;
  const fresh = active.find((c) => c.createdAt.getTime() >= newSince && !byClient.has(c.id));
  if (fresh) {
    const runId = await startClientResearch(fresh.id, null);
    const res = await runClientResearchJob(runId, { budgetMs: 250_000 });
    return { action: "nulmeting gestart", clientId: fresh.id, ok: res.ok, reason: res.reason ?? res.phase };
  }

  // 3. Hercontrole: het laatste onderzoek is goedgekeurd en de termijn is om.
  const today = todayAmsterdam();
  const due = active.find((c) => {
    const l = byClient.get(c.id);
    return l?.status === "goedgekeurd" && l.nextCheckOn !== null && String(l.nextCheckOn).slice(0, 10) <= today;
  });
  if (due) {
    const runId = await startClientResearch(due.id, null);
    const res = await runClientResearchJob(runId, { budgetMs: 250_000 });
    return { action: "hercontrole gestart", clientId: due.id, ok: res.ok, reason: res.reason ?? res.phase };
  }
  return { action: "niets" };
}
