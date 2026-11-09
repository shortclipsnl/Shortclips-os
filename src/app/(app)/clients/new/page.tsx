import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireInternal } from "@/server/auth/context";
import { listAssignableUsers, listClientSectors } from "@/server/clients";
import { PageHeader } from "@/components/ui";
import { ClientForm } from "../_form";

export const metadata: Metadata = { title: "Nieuwe klant" };
export const dynamic = "force-dynamic";

const EMPTY = {
  name: "",
  sector: "",
  website: "",
  legalName: "",
  logoUrl: "",
  description: "",
  color: "",
  status: "active",
  coordinatorId: "",
  videographerId: "",
  monthlyVideoQuota: "0",
  contentFocus: "",
  monthlyRevenue: "",
  startedOn: "",
  notes: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  weHandlePosting: "ja",
  contractMonths: "",
};

export default async function NewClientPage() {
  const viewer = await requireInternal();
  if (!viewer.permissions.has("clients:write")) redirect("/clients");
  const [users, sectors] = await Promise.all([listAssignableUsers(), listClientSectors()]);
  // Nieuwe klant start standaard vandaag.
  const initial = { ...EMPTY, startedOn: new Date().toISOString().slice(0, 10) };

  return (
    <div className="mx-auto max-w-[1200px] pb-6">
      <PageHeader title="Nieuwe klant" description="Maak een klant aan. Die verschijnt direct in het klantenoverzicht." />
      <ClientForm
          mode="create"
          initial={initial}
          users={users}
          sectors={sectors}
          canSeeFinance={viewer.permissions.has("finance:read")}
          canDelete={false}
        />
    </div>
  );
}
