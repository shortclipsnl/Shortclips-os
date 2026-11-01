import type { Metadata } from "next";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { requirePermission, isOwner } from "@/server/auth/context";
import { r2Configured, r2HealthCheck } from "@/server/transfer/r2";
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
  // Alleen de eigenaar ziet de opslagstatus (en doet de R2-setup).
  const health = owner ? await r2HealthCheck() : null;

  return (
    <div className="mx-auto max-w-[760px]">
      <PageHeader
        title="Shortclips Transfer"
        description="Sleep bestanden erin, upload ze en kopieer de downloadlink. De ontvanger heeft geen account nodig."
        actions={<LinkButton href="/transfer/mijn" variant="secondary" size="sm">Mijn transfers</LinkButton>}
      />
      {health ? (
        health.ok ? (
          <div className="mb-4 flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-good)]/30 bg-[var(--color-good-soft)] px-3 py-2 text-sm text-[#14633a]">
            <CheckCircle2 className="size-4 shrink-0" />
            <span>Opslag verbonden — bucket <code className="font-mono">{health.bucket}</code>. Uploaden en downloaden werkt.</span>
          </div>
        ) : (
          <div className="mb-4 flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-warn)]/30 bg-[var(--color-warn-soft)] px-3 py-2 text-sm text-[#8a5300]">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div>
              <p>{health.message}</p>
              <p className="mt-1 text-xs">Stappenplan: <code className="font-mono">docs/TRANSFER-SETUP.md</code>. Vul de R2-sleutels in bij de omgevingsvariabelen (lokaal <code className="font-mono">.env.local</code>, productie in Vercel).</p>
            </div>
          </div>
        )
      ) : null}
      <TransferUploader storageReady={r2Configured()} canWrite={viewer.permissions.has("transfer:write")} />
      {costs ? <div className="mt-6"><TransferCosts costs={costs} /></div> : null}
    </div>
  );
}
