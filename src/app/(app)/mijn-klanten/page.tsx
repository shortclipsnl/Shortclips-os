import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { requireInternal } from "@/server/auth/context";
import { listMyClients } from "@/server/client-library";
import { MijnKlantenGrid } from "./mijn-klanten-grid";

export const metadata: Metadata = { title: "Mijn klanten" };
export const dynamic = "force-dynamic";

export default async function MijnKlantenPage() {
  const viewer = await requireInternal();
  const clients = await listMyClients(viewer);

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        title="Mijn klanten"
        description="Jouw persoonlijke klantenbibliotheek: alle klanten waarvoor jij monteert, met hun Editing Guide, bedrijfsinfo en montagerichtlijnen op één plek. Altijd de meest recente versie uit de kennisbank."
      />
      <MijnKlantenGrid clients={clients} />
    </div>
  );
}
