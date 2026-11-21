import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { canManageQuotes, isOwner, requireLeadsAccess } from "@/server/auth/context";
import { listLeadMailAttention, listLeads } from "@/server/leads";
import { listLeadPhases } from "@/server/lead-journey";
import { getQuotesByLead } from "@/server/quotes";
import { db } from "@/db/client";
import { integrationConnections } from "@/db/schema";
import { imapLeads } from "@/server/integrations/imap-leads";
import { PageHeader } from "@/components/ui";
import { LeadsBoard, QuickAddLead } from "./leads-ui";
import { SyncLeadsButton } from "./sync-button";
import { LeadMailAttention } from "./mail-attention";

export const metadata: Metadata = { title: "Leads" };
export const dynamic = "force-dynamic";

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ lead?: string }> }) {
  const viewer = await requireLeadsAccess();
  const owner = isOwner(viewer);
  const { lead: focusId } = await searchParams;
  const [{ rows, sources }, quoteMap, mailAttention] = await Promise.all([listLeads(), getQuotesByLead(), listLeadMailAttention()]);
  const quotes = Object.fromEntries(quoteMap);
  const phases = await listLeadPhases(
    rows.map((r) => ({ id: r.id, status: r.status })),
    Object.fromEntries([...quoteMap].map(([k, v]) => [k, { status: v.status, sentAt: v.sentAt }])),
  );
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
        description="Alle leads en offertes. Offertes uit PandaDoc worden automatisch gekoppeld; bij een ondertekende offerte gaat de lead op Gewonnen. Nieuwe aanvragen via het contactformulier komen automatisch binnen."
      />

      <SyncLeadsButton lastSyncAt={lastSyncAt} configured={imapLeads.isConfigured} />

      <LeadMailAttention review={mailAttention.review} recent={mailAttention.recent} canResolve />

      <QuickAddLead />
      <LeadsBoard rows={rows} sources={sources} quotes={quotes} phases={phases} focusId={focusId ?? null} showAmounts={owner} canOpenQuotes={canManageQuotes(viewer)} />
    </div>
  );
}
