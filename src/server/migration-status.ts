import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { requireInternal } from "@/server/auth/context";

const rows = <T,>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];
const one = <T,>(r: unknown): T => (rows<T>(r)[0] ?? ({} as T));
const num = (v: unknown) => Number((v as { n?: number })?.n ?? 0);

/**
 * Controleoverzicht van de Monday-migratie: hoeveel records zijn overgenomen,
 * hoeveel zijn gekoppeld, en wat vraagt nog aandacht. Geen wijzigingen — puur
 * lezen. Zo is te zien of Monday veilig kan worden opgezegd.
 */
export async function getMigrationStatus() {
  await requireInternal();

  const [mapRes, clientInt, entityRes, unlinked, suggests, dupClients, dupLeads, wonUnconverted, jobsRes] = await Promise.all([
    db.execute(sql`select entity_type, count(*)::int n, max(last_synced_at) last from monday_mappings group by entity_type`),
    db.execute(sql`select count(*)::int n, max(last_synced_at) last from client_integrations where provider = 'monday'`),
    db.execute(sql`
      select
        (select count(*)::int from clients where deleted_at is null) clients,
        (select count(*)::int from deliverables where deleted_at is null) deliverables,
        (select count(*)::int from production_days where deleted_at is null) production_days,
        (select count(*)::int from contracts where deleted_at is null) contracts,
        (select count(*)::int from leave_requests) leave_requests,
        (select count(*)::int from sales_leads where deleted_at is null) sales_leads,
        (select count(*)::int from client_contacts where deleted_at is null) client_contacts`),
    db.execute(sql`select count(*)::int n from deliverables where deleted_at is null and production_day_id is null`),
    db.execute(sql`select count(*)::int n from deliverables where deleted_at is null and production_day_id is null and suggested_production_day_id is not null and link_reviewed = false`),
    db.execute(sql`select lower(name) nm, count(*)::int n from clients where deleted_at is null group by lower(name) having count(*) > 1 order by n desc`),
    db.execute(sql`select lower(email) em, count(*)::int n from sales_leads where deleted_at is null and email is not null and email <> '' group by lower(email) having count(*) > 1 order by n desc`),
    db.execute(sql`select count(*)::int n from sales_leads where deleted_at is null and status = 'gewonnen' and converted_client_id is null`),
    db.execute(sql`
      select job_type, status, items_created, items_updated, items_failed, finished_at, error
      from sync_jobs where provider = 'monday' order by finished_at desc nulls last limit 10`),
  ]);

  const mapByEntity = new Map(rows<{ entity_type: string; n: number; last: string | null }>(mapRes).map((r) => [r.entity_type, r]));
  const ci = one<{ n: number; last: string | null }>(clientInt);
  const ent = one<Record<string, number>>(entityRes);
  const m = (e: string) => mapByEntity.get(e)?.n ?? 0;

  // Per Monday-bord: hoeveel items overgenomen + laatste sync.
  const boards = [
    { board: "HOOFDBOARD → Klanten", mapped: Number(ci.n), last: ci.last, target: "clients" },
    { board: "CONTACTPERSOON KLANT → Contacten", mapped: Number(ent.client_contacts ?? 0), last: null as string | null, target: "client_contacts", note: "handmatig + import" },
    { board: "LEADS 2026 DASHBOARD → Leads", mapped: m("sales_lead"), last: mapByEntity.get("sales_lead")?.last ?? null, target: "sales_leads" },
    { board: "EDITING DASHBOARD → Video's", mapped: m("editing_item"), last: mapByEntity.get("editing_item")?.last ?? null, target: "deliverables" },
    { board: "CONTRACT DUUR → Contracten", mapped: m("contract"), last: mapByEntity.get("contract")?.last ?? null, target: "contracts" },
    { board: "PROJECT PLANNING → Opnames", mapped: m("production_day"), last: mapByEntity.get("production_day")?.last ?? null, target: "production_days" },
    { board: "VAKANTIES PLANNEN → Verlof", mapped: m("leave_request"), last: mapByEntity.get("leave_request")?.last ?? null, target: "leave_requests" },
  ];

  // Dekking per app-entiteit.
  const coverage = [
    { entity: "Klanten", total: Number(ent.clients ?? 0), fromMonday: Number(ci.n) },
    { entity: "Video's", total: Number(ent.deliverables ?? 0), fromMonday: m("editing_item") },
    { entity: "Opnamedagen", total: Number(ent.production_days ?? 0), fromMonday: m("production_day") },
    { entity: "Contracten", total: Number(ent.contracts ?? 0), fromMonday: m("contract") },
    { entity: "Leads", total: Number(ent.sales_leads ?? 0), fromMonday: m("sales_lead") },
    { entity: "Verlof", total: Number(ent.leave_requests ?? 0), fromMonday: m("leave_request") },
  ];

  const attention = {
    videosWithoutShoot: num(one(unlinked)),
    openSuggestions: num(one(suggests)),
    duplicateClients: rows<{ nm: string; n: number }>(dupClients),
    duplicateLeads: rows<{ em: string; n: number }>(dupLeads),
    wonLeadsUnconverted: num(one(wonUnconverted)),
  };

  const jobs = rows<Record<string, unknown>>(jobsRes).map((j) => ({
    jobType: String(j.job_type),
    status: String(j.status),
    created: Number(j.items_created ?? 0),
    updated: Number(j.items_updated ?? 0),
    failed: Number(j.items_failed ?? 0),
    finishedAt: j.finished_at as string | null,
    error: (j.error as string | null) ?? null,
  }));

  const totalMapped = boards.reduce((a, b) => a + b.mapped, 0);
  return { boards, coverage, attention, jobs, totalMapped };
}
