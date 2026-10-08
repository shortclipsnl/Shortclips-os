import type { Metadata } from "next";
import { requirePermission } from "@/server/auth/context";
import { listActiveClientsForAi } from "@/server/ai/knowledge";
import { aiConfigured } from "@/server/ai/client";
import { PageHeader } from "@/components/ui";
import { BerichtAssistent } from "./bericht-ui";

export const metadata: Metadata = { title: "Klantbericht Assistent" };
export const dynamic = "force-dynamic";

export default async function BerichtPage() {
  const viewer = await requirePermission("ai:read");
  const clients = await listActiveClientsForAi(viewer);

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        title="AI Klantbericht Assistent"
        description="Stel snel een professioneel conceptantwoord op in de Shortclips-stijl, met context uit het dashboard."
      />
      <BerichtAssistent clients={clients} aiReady={aiConfigured()} />
    </div>
  );
}
