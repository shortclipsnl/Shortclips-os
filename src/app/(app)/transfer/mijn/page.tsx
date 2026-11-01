import type { Metadata } from "next";
import { requirePermission } from "@/server/auth/context";
import { listMyTransfers } from "@/server/transfer/service";
import { PageHeader, LinkButton, EmptyState } from "@/components/ui";
import { Send } from "lucide-react";
import { MyTransfersList } from "./mijn-ui";

export const metadata: Metadata = { title: "Mijn transfers" };
export const dynamic = "force-dynamic";

export default async function MijnTransfersPage() {
  const viewer = await requirePermission("transfer:read");
  const rows = await listMyTransfers(viewer);

  return (
    <div className="mx-auto max-w-[1000px]">
      <PageHeader
        title="Mijn transfers"
        description="Je eerdere transfers — status, vervaldatum, aantal downloads en de deel-link."
        actions={<LinkButton href="/transfer" size="sm"><Send className="size-4" /> Nieuwe transfer</LinkButton>}
      />
      {rows.length === 0 ? (
        <EmptyState title="Nog geen transfers" description="Maak je eerste transfer aan om bestanden te versturen." action={<LinkButton href="/transfer" size="sm">Nieuwe transfer</LinkButton>} />
      ) : (
        <MyTransfersList rows={rows} />
      )}
    </div>
  );
}
