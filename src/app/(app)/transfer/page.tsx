import type { Metadata } from "next";
import { requirePermission, isOwner } from "@/server/auth/context";
import { r2Configured } from "@/server/transfer/r2";
import { getTransferCosts } from "@/server/transfer/service";
import { PageHeader, LinkButton } from "@/components/ui";
import { TransferUploader } from "./transfer-ui";
import { TransferCosts } from "./costs";

export const metadata: Metadata = { title: "Transfer" };
export const dynamic = "force-dynamic";
// Een transfer aanmaken en de R2-delen signen kan bij veel bestanden even duren.
export const maxDuration = 120;

export default async function TransferPage() {
  const viewer = await requirePermission("transfer:read");
  const owner = isOwner(viewer);
  const costs = owner ? await getTransferCosts() : null;

  return (
    <div className="mx-auto max-w-[760px]">
      <PageHeader
        title="Shortclips Transfer"
        description="Sleep bestanden erin, upload ze en kopieer de downloadlink. De ontvanger heeft geen account nodig."
        actions={<LinkButton href="/transfer/mijn" variant="secondary" size="sm">Mijn transfers</LinkButton>}
      />
      <TransferUploader storageReady={r2Configured()} canWrite={viewer.permissions.has("transfer:write")} />
      {costs ? <div className="mt-6"><TransferCosts costs={costs} /></div> : null}
    </div>
  );
}
