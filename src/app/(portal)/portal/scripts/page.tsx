import type { Metadata } from "next";
import { FileText } from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { getPortalData } from "@/server/portal";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui";
import { ScriptDecision } from "../actions-ui";

export const metadata: Metadata = { title: "Scripts" };
export const dynamic = "force-dynamic";

export default async function PortalScriptsPage() {
  const viewer = await requirePortal();
  const data = await getPortalData(viewer);
  const scripts = data.scriptsToReview;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Scripts</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Bekijk je scripts, geef feedback en keur ze goed.
        </p>
      </div>

      {scripts.length === 0 ? (
        <EmptyState
          title="Geen scripts die op je wachten"
          description="Zodra er een script klaarstaat voor jouw akkoord, verschijnt het hier."
          icon={<FileText className="size-6" />}
        />
      ) : (
        <div className="space-y-4">
          {scripts.map((s) => (
            <Card key={s.id} padded={false}>
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-[var(--color-ink)]">{s.title}</h2>
                    <Badge tone="warn">Wacht op jouw akkoord</Badge>
                  </div>
                </div>
                {s.hook ? (
                  <div className="mt-3 space-y-2 text-sm text-[var(--color-ink)]">
                    <p><span className="font-medium">Hook:</span> {s.hook}</p>
                    {s.body ? <p className="whitespace-pre-wrap text-[var(--color-ink-muted)]">{s.body}</p> : null}
                    {s.cta ? <p><span className="font-medium">CTA:</span> {s.cta}</p> : null}
                  </div>
                ) : null}
                <div className="mt-4">
                  <ScriptDecision scriptId={s.id} />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <CardHeader
        title="Eerdere scripts"
        subtitle="Scripts van vorige sessies komen hier zodra ze vanuit Google Drive gekoppeld zijn."
      />
    </div>
  );
}
