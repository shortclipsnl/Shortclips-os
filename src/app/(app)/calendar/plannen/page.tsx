import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clients } from "@/db/schema";
import { requireInternal } from "@/server/auth/context";
import { aiConfigured } from "@/server/ai/client";
import { PageHeader } from "@/components/ui";
import { AutoPlanner } from "./auto-planner";

export const metadata: Metadata = { title: "Automatisch plannen" };
export const dynamic = "force-dynamic";

export default async function AutoPlanPage() {
  const viewer = await requireInternal();
  const rows = await db
    .select({ id: clients.id, name: clients.name, quota: clients.monthlyVideoQuota })
    .from(clients)
    .where(and(isNull(clients.deletedAt), eq(clients.status, "active")))
    .orderBy(asc(clients.name));
  // Publicatieritme per week afgeleid uit het maandelijkse shorts-quotum (±4,33 weken/maand).
  const activeClients = rows.map((c) => ({
    id: c.id,
    name: c.name,
    weeklyTarget: c.quota > 0 ? Math.max(1, Math.min(5, Math.round(c.quota / 4.33))) : 0,
  }));

  return (
    <div className="mx-auto max-w-[1000px]">
      <Link href="/calendar" className="text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">← Contentplanning</Link>
      <PageHeader
        title="Automatisch plannen vanuit scripts"
        description="Upload een scriptdocument, laat de AI de videotitels herkennen en plan ze automatisch op werkdagen."
      />
      <AutoPlanner clients={activeClients} aiReady={aiConfigured()} />
    </div>
  );
}
