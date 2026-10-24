import type { Metadata } from "next";
import { Users, FolderOpen, AlarmClock, Trophy, XCircle } from "lucide-react";
import { requireOwner } from "@/server/auth/context";
import { listLeads } from "@/server/leads";
import { PageHeader, Stat } from "@/components/ui";
import { LeadsBoard, QuickAddLead } from "./leads-ui";

export const metadata: Metadata = { title: "Leads" };
export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  await requireOwner();
  const { rows, summary, segments, sources } = await listLeads();

  return (
    <div className="mx-auto max-w-[1300px]">
      <PageHeader title="Leads" description="Alle leads en offertes. Wijzig de status en opvolgdatum direct in de lijst." />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Totaal" value={String(summary.total)} icon={<Users />} />
        <Stat label="Open" value={String(summary.open)} hint="lead/offerte/onderhandeling" tone="info" icon={<FolderOpen />} />
        <Stat label="Te laat op te volgen" value={String(summary.overdue)} tone={summary.overdue > 0 ? "bad" : "good"} icon={<AlarmClock />} emphasis={summary.overdue > 0} hint={summary.overdue > 0 ? "direct opvolgen" : undefined} />
        <Stat label="Gewonnen" value={String(summary.won)} tone="good" icon={<Trophy />} />
        <Stat label="Verloren" value={String(summary.lost)} tone="warn" icon={<XCircle />} />
      </div>

      <QuickAddLead />
      <LeadsBoard rows={rows} segments={segments} sources={sources} />
    </div>
  );
}
