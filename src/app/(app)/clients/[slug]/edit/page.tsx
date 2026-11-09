import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireInternal } from "@/server/auth/context";
import { getClientForEdit, listAssignableUsers, listClientSectors } from "@/server/clients";
import Link from "next/link";
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

  const [{ client, contact, integrations, contract }, users, sectors] = await Promise.all([
    getClientForEdit(viewer, slug),
    listAssignableUsers(),
    listClientSectors(),
  ]);
  // Contractduur: vastgelegd aantal, anders afgeleid uit het lopende contract.
  const derivedMonths = contract?.startsOn && contract.endsOn
    ? Math.round((Date.parse(`${contract.endsOn}T00:00:00Z`) + 86400000 - Date.parse(`${contract.startsOn}T00:00:00Z`)) / (86400000 * 30.44))
    : null;
  const months = client.contractMonths ?? (derivedMonths && derivedMonths > 0 ? derivedMonths : null);

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
    contentFocus: client.contentFocus ?? "",
    monthlyRevenue: client.monthlyRevenue ?? "",
    startedOn: client.startedOn ?? contract?.startsOn ?? "",
    notes: client.notes ?? "",
    contactName: contact?.fullName ?? "",
    contactEmail: contact?.email ?? "",
    contactPhone: contact?.phone ?? "",
    weHandlePosting: client.weHandlePosting ? "ja" : "nee",
    contractMonths: months ? String(months) : "",
  };

  return (
    <div className="mx-auto max-w-[1200px] pb-6">
      <div className="mb-5">
        <Link href={`/clients/${slug}`} className="text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
          ← Klantoverzicht
        </Link>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">{client.name} bewerken</h1>
      </div>
      <ClientForm
        mode="edit"
        slug={slug}
        initial={initial}
        users={users}
        sectors={sectors}
        canSeeFinance={viewer.permissions.has("finance:read")}
        canDelete={viewer.permissions.has("clients:delete")}
      />

      <details className="sc-card group mt-5">
        <summary className="cursor-pointer list-none px-5 py-3.5 text-sm font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
          Koppelingen (Frame.io, agenda, Drive) <span className="text-xs group-open:hidden">· tonen</span>
        </summary>
        <div className="px-5 pb-5">
          <IntegrationToggles slug={slug} integrations={integrations} />
        </div>
      </details>
    </div>
  );
}
