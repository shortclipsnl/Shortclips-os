import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireInternal } from "@/server/auth/context";
import { getClientForEdit, listAssignableUsers } from "@/server/clients";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { ClientForm } from "../../_form";
import { IntegrationToggles } from "../../_integrations";

export const metadata: Metadata = { title: "Klant bewerken" };
export const dynamic = "force-dynamic";

export default async function EditClientPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const viewer = await requireInternal();
  if (!viewer.permissions.has("clients:write")) redirect(`/clients/${slug}`);

  const [{ client, contact, integrations }, users] = await Promise.all([
    getClientForEdit(viewer, slug),
    listAssignableUsers(),
  ]);

  const initial = {
    name: client.name,
    sector: client.sector ?? "",
    website: client.website ?? "",
    legalName: client.legalName ?? "",
    logoUrl: client.logoUrl ?? "",
    description: client.description ?? "",
    color: client.color ?? "",
    status: client.status,
    coordinatorId: client.coordinatorId ?? "",
    videographerId: client.videographerId ?? "",
    monthlyVideoQuota: String(client.monthlyVideoQuota ?? 0),
    monthlyRevenue: client.monthlyRevenue ?? "",
    startedOn: client.startedOn ?? "",
    notes: client.notes ?? "",
    contactName: contact?.fullName ?? "",
    contactEmail: contact?.email ?? "",
    contactPhone: contact?.phone ?? "",
  };

  return (
    <div className="mx-auto max-w-[900px]">
      <PageHeader title={`${client.name} bewerken`} description="Pas gegevens aan, wijzig de status of verwijder de klant." />
      <Card>
        <ClientForm
          mode="edit"
          slug={slug}
          initial={initial}
          users={users}
          canSeeFinance={viewer.permissions.has("finance:read")}
          canDelete={viewer.permissions.has("clients:delete")}
        />
      </Card>

      <div className="mt-5">
        <Card>
          <CardHeader title="Koppelingen" subtitle="Bronnen die aan deze klant hangen (Monday, Frame.io, agenda, …)." />
          <div className="mt-3">
            <IntegrationToggles slug={slug} integrations={integrations} />
          </div>
        </Card>
      </div>
    </div>
  );
}
