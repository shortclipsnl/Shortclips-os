import type { Metadata } from "next";
import { requirePermission } from "@/server/auth/context";
import { listAiOutputs } from "@/server/ai/knowledge";
import { aiConfigured } from "@/server/ai/client";
import { PageHeader } from "@/components/ui";
import { BerichtAssistent } from "./bericht-ui";
import type { ReplyDraft } from "@/server/actions/ai-tools";

export const metadata: Metadata = { title: "Klantbericht Assistent" };
export const dynamic = "force-dynamic";

export default async function BerichtPage() {
  const viewer = await requirePermission("ai:read");
  const outputs = await listAiOutputs(viewer, "message");
  const recent = outputs.map((o) => ({
    id: o.id,
    title: o.title,
    clientName: o.clientName,
    createdAt: o.createdAt.toISOString(),
    output: o.output as ReplyDraft,
  }));

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        title="AI Klantbericht Assistent"
        description="Sleep een screenshot erin of plak het bericht — de assistent herkent zelf de klant en het kanaal en stelt een conceptantwoord op in de Shortclips-stijl."
      />
      <BerichtAssistent aiReady={aiConfigured()} recent={recent} />
    </div>
  );
}
