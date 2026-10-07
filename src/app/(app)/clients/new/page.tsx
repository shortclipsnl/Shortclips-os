import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireInternal } from "@/server/auth/context";
import { listAssignableUsers } from "@/server/clients";
import { Card, PageHeader } from "@/components/ui";
import { ClientForm } from "../_form";

export const metadata: Metadata = { title: "Nieuwe klant" };
export const dynamic = "force-dynamic";

const EMPTY = {
  name: "",
  sector: "",
  website: "",
  legalName: "",
  logoUrl: "",
  color: "",
  status: "active",
  coordinatorId: "",
  videographerId: "",
  monthlyVideoQuota: "0",
  monthlyRevenue: "",
  startedOn: "",
  notes: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
};

export default async function NewClientPage() {
  const viewer = await requireInternal();
  if (!viewer.permissions.has("clients:write")) redirect("/clients");
  const users = await listAssignableUsers();

  return (
    <div className="mx-auto max-w-[900px]">
      <PageHeader title="Nieuwe klant" description="Maak een klant aan. Die verschijnt direct in het klantenoverzicht." />
      <Card>
        <ClientForm
          mode="create"
          initial={EMPTY}
          users={users}
          canSeeFinance={viewer.permissions.has("finance:read")}
          canDelete={false}
        />
      </Card>
    </div>
  );
}
