import "server-only";
import { and, asc, gte, isNull, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { productionDays } from "@/db/schema";
import { ensureBriefingForShoot } from "@/server/briefing/run";
import { runJob } from "@/server/jobs/runner";
import { notInactiveClient } from "@/server/client-activity";

// Volledig gekwalificeerd: Drizzle schrijft kolommen in sql-subqueries als kaal "id",
// waardoor ze binnen de subquery naar de verkeerde tabel wezen (geen enkele kandidaat).
const PD_ID = sql.raw(`"production_days"."id"`);
const PD_CLIENT = sql.raw(`"production_days"."client_id"`);

const STALE_RUNNING_MIN = 10;
const MAX_PER_RUN = 12;
/** De cron-functie mag 300 s duren; ruim daaronder stoppen. */
const TIME_BUDGET_MS = Number(process.env.BRIEFING_TIME_BUDGET_MS) || 200_000;
/** Ook opnames die al geweest zijn krijgen nog een briefing (de editor start ná de opname). */
const DAYS_BACK = 21;
const DAYS_FORWARD = 60;

const isoDay = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

/**
 * Automatische editor-briefings. Draait elk uur en maakt of vernieuwt de
 * briefing voor elke opname (3 weken terug t/m 2 maanden vooruit) waaraan een
 * script-PDF hangt — uit het klantportaal (scriptcontrole) óf de gekoppelde
 * PDF uit Google Drive (de normale werkwijze). Kandidaat als er nog geen
 * briefing is, de vorige mislukte, of het script daarna is bijgewerkt.
 * Ook als de Editing Guide van de klant is vervangen (nieuwe highlights) of de
 * briefing nog in het oude formaat staat. Ongewijzigde opnames worden
 * overgeslagen. De scripts zelf kosten geen AI: die komen letterlijk uit de PDF.
 */
export async function runBriefingAutoGenerate(): Promise<{
  scanned: number;
  processed: number;
  generated: number;
  failed: number;
}> {
  const rows = await db
    .select({
      productionDayId: productionDays.id,
      scheduledOn: productionDays.scheduledOn,
      clientName: sql<string>`(select c.name from clients c where c.id = ${PD_CLIENT})`,
      // Laatste wijziging van de bron: nieuwste scriptcontrole-versie of Drive-koppeling.
      sourceAt: sql<Date | null>`greatest(
        (select max(v.created_at) from script_review_versions v
           join script_reviews r on r.id = v.review_id
          where r.production_day_id = ${PD_ID} and r.deleted_at is null),
        (select max(coalesce(s.confirmed_at, s.matched_at)) from shoot_script_sources s
          where s.production_day_id = ${PD_ID} and s.status = 'gekoppeld')
      )`,
      setStatus: sql<string | null>`(select b.status from briefing_sets b where b.production_day_id = ${PD_ID} and b.deleted_at is null limit 1)`,
      setGeneratedAt: sql<Date | null>`(select b.generated_at from briefing_sets b where b.production_day_id = ${PD_ID} and b.deleted_at is null limit 1)`,
      setStartedAt: sql<Date | null>`(select b.started_at from briefing_sets b where b.production_day_id = ${PD_ID} and b.deleted_at is null limit 1)`,
      // Oude briefing (v1) of highlights die nog niet gelukt zijn → opnieuw.
      setOutdated: sql<boolean>`coalesce((select (b.content->>'v') is distinct from '2' or (b.content->'scriptPages') is null or ((b.content->'guide'->>'error') is not null and b.generated_at < now() - interval '6 hours') from briefing_sets b where b.production_day_id = ${PD_ID} and b.deleted_at is null limit 1), false)`,
      // Laatste wijziging van de Editing Guide van de klant.
      guideAt: sql<Date | null>`(select max(d.created_at) from client_documents d where d.client_id = ${PD_CLIENT} and d.kind = 'editing_guide' and d.deleted_at is null)`,
    })
    .from(productionDays)
    .where(and(
      isNull(productionDays.deletedAt),
      ne(productionDays.status, "cancelled"),
      gte(productionDays.scheduledOn, isoDay(-DAYS_BACK)),
      lte(productionDays.scheduledOn, isoDay(DAYS_FORWARD)),
      notInactiveClient(productionDays.clientId),
    ))
    .orderBy(asc(productionDays.scheduledOn))
    .limit(500);

  const ts = (v: Date | string | null) => (v ? new Date(v).getTime() : 0);
  const candidates = rows.filter((r) => {
    if (!r.sourceAt) return false; // nog geen script-PDF: niets om uit te maken
    if (r.setStatus === "bezig" && r.setStartedAt && (Date.now() - ts(r.setStartedAt)) / 60000 < STALE_RUNNING_MIN) return false;
    if (!r.setStatus || r.setStatus === "mislukt") return true;
    if (r.setOutdated) return true;
    // Script of Editing Guide bijgewerkt na de laatste briefing.
    return ts(r.sourceAt) > ts(r.setGeneratedAt) || ts(r.guideAt) > ts(r.setGeneratedAt);
  });

  // Eerst wat het dichtst bij is: net geweest of binnenkort.
  const today = isoDay(0);
  candidates.sort((a, b) => Math.abs(Date.parse(String(a.scheduledOn)) - Date.parse(today)) - Math.abs(Date.parse(String(b.scheduledOn)) - Date.parse(today)));

  let processed = 0;
  let generated = 0;
  let failed = 0;
  const started = Date.now();
  // Elke run vastleggen (Integraties), zodat zichtbaar is wat er gebeurt of misgaat.
  await runJob("system", "briefing.auto_generate", { candidates: candidates.length }, async (ctx) => {
    for (const c of candidates.slice(0, MAX_PER_RUN)) {
      // Ruim binnen de maximale looptijd van de functie blijven; de rest volgt volgend uur.
      if (Date.now() - started > TIME_BUDGET_MS) {
        ctx.log(`Tijdslimiet bereikt; ${candidates.length - processed} opname(s) volgen in de volgende ronde.`);
        break;
      }
      processed++;
      ctx.counters.processed++;
      try {
        const res = await ensureBriefingForShoot(c.productionDayId);
        if (res.ok) {
          generated++;
          ctx.counters.created++;
          ctx.log(`${c.clientName} (${String(c.scheduledOn).slice(0, 10)}): ${res.status === "updated" ? "bijgewerkt" : "aangemaakt"}`);
        } else if (res.reason === "error") {
          failed++;
          ctx.counters.failed++;
          ctx.log(`${c.clientName} (${String(c.scheduledOn).slice(0, 10)}): ${res.message ?? "mislukt"}`, "warn");
        }
      } catch (e) {
        failed++;
        ctx.counters.failed++;
        ctx.log(`${c.clientName} (${String(c.scheduledOn).slice(0, 10)}): ${e instanceof Error ? e.message.slice(0, 200) : "onbekende fout"}`, "error");
      }
    }
  }, { notify: false }).catch(() => undefined);

  return { scanned: rows.length, processed, generated, failed };
}
