import "server-only";
import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import { clients, deliverables, productionDays } from "@/db/schema";
import { requireInternal } from "@/server/auth/context";

export type LinkSuggestion = {
  id: string;
  title: string;
  status: string;
  dueOn: string | null;
  clientName: string;
  confidence: string | null;
  suggestedShootOn: string | null;
  suggestedShootTitle: string | null;
};

/** Open koppelsuggesties (video → opnamedag) voor het controleoverzicht. */
export async function listLinkSuggestions() {
  await requireInternal();
  const shoot = alias(productionDays, "suggested_shoot");

  const rows = await db
    .select({
      id: deliverables.id,
      title: deliverables.title,
      status: deliverables.status,
      dueOn: deliverables.dueOn,
      clientName: clients.name,
      confidence: deliverables.linkConfidence,
      suggestedShootOn: shoot.scheduledOn,
      suggestedShootTitle: shoot.title,
    })
    .from(deliverables)
    .innerJoin(clients, eq(clients.id, deliverables.clientId))
    .leftJoin(shoot, eq(shoot.id, deliverables.suggestedProductionDayId))
    .where(
      and(
        isNull(deliverables.deletedAt),
        isNull(deliverables.productionDayId),
        isNotNull(deliverables.suggestedProductionDayId),
        eq(deliverables.linkReviewed, false),
      ),
    )
    .orderBy(asc(clients.name), desc(deliverables.linkConfidence));

  // Samenvatting voor de kopcijfers.
  const linkedRes = await db.execute(sql`
    select
      count(*) filter (where production_day_id is not null)::int linked,
      count(*) filter (where production_day_id is null and link_reviewed = false and suggested_production_day_id is not null)::int open,
      count(*) filter (where deleted_at is null)::int total
    from deliverables where deleted_at is null
  `);
  const sum = ((linkedRes as { rows?: unknown[] }).rows?.[0] ?? {}) as { linked: number; open: number; total: number };

  return { rows: rows as LinkSuggestion[], summary: sum };
}
