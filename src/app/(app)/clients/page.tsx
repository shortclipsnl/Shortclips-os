import type { Metadata } from "next";
import { requireInternal } from "@/server/auth/context";
import { listClients } from "@/server/clients";
import { LinkButton, PageHeader } from "@/components/ui";
import { ClientsBoard, type BoardClient } from "./clients-board";

export const metadata: Metadata = { title: "Klanten" };
export const dynamic = "force-dynamic";

const STOPPED = new Set(["paused", "churned"]);

export default async function ClientsPage() {
  const viewer = await requireInternal();
  const all = await listClients(viewer);
  const canWrite = viewer.permissions.has("clients:write");

  const clients: BoardClient[] = all.map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    status: c.status,
    color: c.color,
    coordinatorName: c.coordinatorName,
    nextShoot: c.nextShoot,
    inProduction: Number(c.inProduction),
    shortsPerMonth: Number(c.monthlyVideoQuota),
  }));

  const activeCount = clients.filter((c) => !STOPPED.has(c.status)).length;
  const inactiveCount = clients.filter((c) => STOPPED.has(c.status)).length;

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Klanten"
        description={`${activeCount} actief · ${inactiveCount} niet-actief`}
        actions={canWrite ? <LinkButton href="/clients/new">Nieuwe klant</LinkButton> : undefined}
      />
      <ClientsBoard clients={clients} canWrite={canWrite} />
    </div>
  );
}
