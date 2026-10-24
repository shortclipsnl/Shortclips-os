import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { tasks, users } from "@/db/schema";
import { aiConfigured, runPrompt } from "@/server/ai/client";
import { computeHealthTasks, getContentHealth, getOverloadedPeople, type HealthTask } from "@/server/content-health";
import { notify } from "@/server/notifications";
import { runJob } from "./runner";

/** Maandag van de huidige week (YYYY-MM-DD) — voor wekelijkse dedupe. */
function mondayIso(): string {
  const d = new Date();
  const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (utc.getUTCDay() + 6) % 7;
  utc.setUTCDate(utc.getUTCDate() - dow);
  return utc.toISOString().slice(0, 10);
}

/**
 * Optioneel: AI scherpt het verbetervoorstel aan met één concrete, klant-
 * specifieke tip. Gated op de AI-sleutel — zonder sleutel blijft het
 * deterministische voorstel staan (nooit blokkerend, nooit verzonnen cijfers).
 */
async function aiTip(task: HealthTask): Promise<string | null> {
  if (!aiConfigured()) return null;
  const res = await runPrompt({
    system:
      "Je bent een ervaren content-strateeg bij een Nederlands short-videobureau. Geef één concrete, direct uitvoerbare verbetertip (max 2 zinnen) voor de verantwoordelijke. Nederlands, zakelijk, geen opsomming, geen cijfers verzinnen.",
    user: `Klant: ${task.clientName}\nProbleem: ${task.titel}\nOorzaak: ${task.oorzaak}\nHuidig voorstel: ${task.voorstel}\n\nGeef één scherpere, concrete tip.`,
    maxTokens: 220,
  }).catch(() => null);
  return res && res.ok ? res.text.trim().slice(0, 400) : null;
}

/**
 * Automatische contentgezondheidscheck: beoordeelt alle actieve klanten, zet de
 * urgente aandachtspunten om in taken voor de verantwoordelijke coördinator
 * (gededupliceerd per klant/pijler/week) en meldt overbelaste medewerkers aan de
 * eigenaar. Volledig idempotent: bestaande open taken en recente meldingen worden
 * niet dubbel aangemaakt. Draait nachtelijk.
 */
export async function runContentHealthSignals() {
  return runJob("monday", "content_health.signals", {}, async (ctx) => {
    const week = mondayIso();
    const overview = await getContentHealth(true);
    ctx.counters.processed = overview.rows.length;

    // Terugvaloptie voor de toewijzing: een actieve projectcoördinator.
    const [fallbackCoord] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.primaryRole, "project_coordinator"), eq(users.status, "active"), isNull(users.deletedAt)))
      .orderBy(asc(users.fullName))
      .limit(1);

    // 1) Taken uit de urgente aandachtspunten (alleen "actie").
    const healthTasks = computeHealthTasks(overview, week);
    for (const t of healthTasks) {
      const assigneeId = t.coordinatorId ?? fallbackCoord?.id ?? null;
      const tip = await aiTip(t);
      const description =
        `Probleem: ${t.oorzaak}\n\nVoorstel: ${t.voorstel}` +
        (tip ? `\n\nAI-tip: ${tip}` : "") +
        `\n\n(Automatisch uit de contentgezondheidscheck.)`;
      const inserted = await db
        .insert(tasks)
        .values({
          clientId: t.clientId,
          title: t.titel.slice(0, 240),
          description,
          priority: t.priority,
          status: "todo",
          assigneeId,
          dueOn: week,
          entityType: "content_health",
          entityId: t.clientId,
          source: "automation",
          dedupeKey: t.dedupeKey,
        })
        .onConflictDoNothing()
        .returning({ id: tasks.id });
      if (inserted[0]) ctx.counters.created++;
    }

    // 2) Overbelaste medewerkers → melding aan de eigenaar (hulp herverdelen).
    const overloaded = await getOverloadedPeople(true);
    for (const p of overloaded.filter((x) => x.level === "kritiek")) {
      const sent = await notify({
        roles: ["owner"],
        level: "warning",
        type: "team_overload",
        title: `${p.name} is overbelast`,
        body: p.reasons.join(" ").slice(0, 300),
        href: "/capaciteit",
        entityType: "user",
        entityId: p.userId,
        dedupeKey: `team_overload:${p.userId}:${week}`,
      });
      if (sent > 0) ctx.counters.updated++;
    }

    ctx.log(
      `${overview.rows.length} klanten beoordeeld (${overview.counts.rood} rood, ${overview.counts.oranje} oranje), ` +
        `${ctx.counters.created} taken aangemaakt, ${overloaded.length} overbelaste medewerker(s), ${ctx.counters.updated} melding(en).`,
    );
  });
}
