import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { requireOwner } from "@/server/auth/context";
import { listLeads } from "@/server/leads";
import { db } from "@/db/client";
import { integrationConnections } from "@/db/schema";
import { imapLeads } from "@/server/integrations/imap-leads";
import { PageHeader } from "@/components/ui";
import { LeadsBoard, QuickAddLead } from "./leads-ui";
import { SyncLeadsButton } from "./sync-button";

export const metadata: Metadata = { title: "Leads" };
export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  await requireOwner();
  const { rows, sources } = await listLeads();
  const [conn] = await db
    .select({ lastSyncAt: integrationConnections.lastSyncAt })
    .from(integrationConnections)
    .where(eq(integrationConnections.provider, "gmail"))
    .limit(1);
  const lastSyncAt = conn?.lastSyncAt ? new Date(conn.lastSyncAt).toISOString() : null;

  return (
    <div className="mx-auto max-w-[1300px]">
      <PageHeader
        title="Leads"
        description="Alle leads en offertes. Wijzig de status en opvolgdatum direct in de lijst. Nieuwe aanvragen via het contactformulier komen automatisch binnen."
      />

      <SyncLeadsButton lastSyncAt={lastSyncAt} configured={imapLeads.isConfigured} />

      <QuickAddLead />
      <LeadsBoard rows={rows} sources={sources} />
    </div>
  );
}
