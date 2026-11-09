import type { Metadata } from "next";
import { requireInternal } from "@/server/auth/context";
import { listClients } from "@/server/clients";
import { coveringForUser } from "@/server/leave-cover";
import { getCurrentDocs, toSlots, visibleKinds } from "@/server/client-documents";
import { LinkButton, PageHeader } from "@/components/ui";
import { ClientsBoard, type BoardClient } from "./clients-board";
import { getRetentionOverview, retentionContext } from "@/server/client-retention";
import { isEditorRole } from "@/server/auth/context";
import { listOnboardings } from "@/server/onboarding";
import { OnboardingOverview } from "./onboarding-overview";

export const metadata: Metadata = { title: "Klanten" };
export const dynamic = "force-dynamic";

const STOPPED = new Set(["paused", "churned"]);

export default async function ClientsPage() {
  const viewer = await requireInternal();
  const all = await listClients(viewer);
  // Klanten Guide + Editing Guide per klant, uit de centrale bron.
  const docsByClient = await getCurrentDocs(all.map((c) => c.id));
  const kinds = visibleKinds(viewer);
  const canWrite = viewer.permissions.has("clients:write");
  // Maandprijs is financieel → uitsluitend voor de eigenaar (finance:read).
  const canSeeRevenue = viewer.permissions.has("finance:read");

  // Klantgezondheid alleen voor het team (niet voor editors), alleen actieve klanten.
  const health = isEditorRole(viewer)
    ? new Map()
    : new Map((await getRetentionOverview(await retentionContext(), all.map((c) => c.id)).catch(() => [])).map((r) => [r.clientId, r]));

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
    docs: toSlots(docsByClient.get(c.id), { kinds }).map((s) => ({ kind: s.kind, label: s.label, url: s.doc?.url ?? null })),
    health: health.get(c.id) ? { status: health.get(c.id)!.health.status, reasons: health.get(c.id)!.health.reasons, commercial: health.get(c.id)!.commercial } : null,
  }));

  const activeCount = clients.filter((c) => !STOPPED.has(c.status)).length;
  const inactiveCount = clients.filter((c) => STOPPED.has(c.status)).length;
  // Eigen pod = klanten waar jij verantwoordelijke bent. Heb je een pod, dan
  // staat "Mijn klanten" standaard aan (met een schakelaar naar Alle klanten).
  // Vervanging bij afwezigheid: ook de klanten van wie je nu vervangt tellen als
  // "mijn klanten".
  const covering = await coveringForUser(viewer.id);
  const coveringIds = covering.map((c) => c.absentId);
  const onboardings = isEditorRole(viewer) ? [] : await listOnboardings().catch(() => []);
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
          Gewonnen lead? Zet hem om via Leads → Naar klant, dan richt het portaal alles in. Anders: klik rechtsboven op{" "}
          <span className="font-semibold text-[var(--color-ink)]">Nieuwe klant</span> en vul meteen{" "}
          <span className="font-semibold text-[var(--color-ink)]">alle gegevens volledig</span> in
          (naam, website, logo, verantwoordelijke, aantal shorts per maand, contactpersoon…). Dan klopt
          alles vanaf het begin en hoeft er later niets te worden aangevuld.
        </p>
      ) : null}
      <OnboardingOverview rows={onboardings} />
      <ClientsBoard clients={clients} viewerId={viewer.id} coveringIds={coveringIds} coveringNames={covering.map((c) => c.absentName)} defaultPod={myCount > 0 ? "mijn" : "alle"} />
    </div>
  );
}
