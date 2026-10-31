import type { Metadata } from "next";
import { requireInternal } from "@/server/auth/context";
import { listClients } from "@/server/clients";
import { coveringForUser } from "@/server/leave-cover";
import { LinkButton, PageHeader } from "@/components/ui";
import { ClientsBoard, type BoardClient } from "./clients-board";

export const metadata: Metadata = { title: "Klanten" };
export const dynamic = "force-dynamic";

const STOPPED = new Set(["paused", "churned"]);

export default async function ClientsPage() {
  const viewer = await requireInternal();
  const all = await listClients(viewer);
  const canWrite = viewer.permissions.has("clients:write");
  // Maandprijs is financieel → uitsluitend voor de eigenaar (finance:read).
  const canSeeRevenue = viewer.permissions.has("finance:read");

  const clients: BoardClient[] = all.map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    status: c.status,
    color: c.color,
    logoUrl: c.logoUrl,
    coordinatorId: c.coordinatorId,
    coordinatorName: c.coordinatorName,
    coordinatorAvatar: c.coordinatorAvatar,
    nextShoot: c.nextShoot,
    inProduction: Number(c.inProduction),
    shortsPerMonth: Number(c.monthlyVideoQuota),
    monthlyRevenue: canSeeRevenue ? Number(c.monthlyRevenue ?? 0) : null,
  }));

  const activeCount = clients.filter((c) => !STOPPED.has(c.status)).length;
  const inactiveCount = clients.filter((c) => STOPPED.has(c.status)).length;
  // Eigen pod = klanten waar jij verantwoordelijke bent. Heb je een pod, dan
  // staat "Mijn klanten" standaard aan (met een schakelaar naar Alle klanten).
  // Vervanging bij afwezigheid: ook de klanten van wie je nu vervangt tellen als
  // "mijn klanten".
  const covering = await coveringForUser(viewer.id);
  const coveringIds = covering.map((c) => c.absentId);
  const myCount = clients.filter((c) => c.coordinatorId === viewer.id || (!!c.coordinatorId && coveringIds.includes(c.coordinatorId))).length;

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Klanten"
        description={`${activeCount} actief · ${inactiveCount} niet-actief`}
        actions={canWrite ? <LinkButton href="/clients/new">Nieuwe klant</LinkButton> : undefined}
      />
      {canWrite ? (
        <p className="-mt-2 mb-4 max-w-3xl text-sm text-[var(--color-ink-muted)]">
          Nieuwe klant? Klik rechtsboven op{" "}
          <span className="font-semibold text-[var(--color-ink)]">Nieuwe klant</span> en vul meteen{" "}
          <span className="font-semibold text-[var(--color-ink)]">alle gegevens volledig</span> in
          (naam, website, logo, verantwoordelijke, aantal shorts per maand, contactpersoon…). Dan klopt
          alles vanaf het begin en hoeft er later niets te worden aangevuld.
        </p>
      ) : null}
      <ClientsBoard clients={clients} viewerId={viewer.id} coveringIds={coveringIds} coveringNames={covering.map((c) => c.absentName)} defaultPod={myCount > 0 ? "mijn" : "alle"} />
    </div>
  );
}
