import type { Metadata } from "next";
import { requirePermission } from "@/server/auth/context";
import { listActiveClientsForAi } from "@/server/ai/knowledge";
import { aiConfigured } from "@/server/ai/client";
import { PageHeader } from "@/components/ui";
import { BriefingMaker } from "./briefing-ui";

export const metadata: Metadata = { title: "Editor Briefing" };
export const dynamic = "force-dynamic";

export default async function BriefingPage() {
  const viewer = await requirePermission("ai:read");
  const clients = await listActiveClientsForAi(viewer);

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        title="AI Editor Briefing Maker"
        description="Genereer één duidelijke editingbriefing per opnamesessie op basis van de scripts."
      />
      <BriefingMaker clients={clients} aiReady={aiConfigured()} />
    </div>
  );
}
