import type { Metadata } from "next";
import { requirePermission } from "@/server/auth/context";
import { listActiveClientsForAi } from "@/server/ai/knowledge";
import { aiConfigured } from "@/server/ai/client";
import { PageHeader } from "@/components/ui";
import { CaptionMaker } from "./caption-ui";

export const metadata: Metadata = { title: "Caption Maker" };
export const dynamic = "force-dynamic";

export default async function CaptionPage() {
  const viewer = await requirePermission("ai:read");
  const clients = await listActiveClientsForAi(viewer);

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        title="AI Caption Maker"
        description="Genereer per short captions voor Instagram en TikTok op basis van je scripts en de stijl van de klant."
      />
      <CaptionMaker clients={clients} aiReady={aiConfigured()} />
    </div>
  );
}
