"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toggleClientIntegration } from "@/server/actions/clients";
import { Badge, ErrorNote } from "@/components/ui";
import { INTEGRATION_LABEL } from "@/lib/statuses";

type Integration = {
  id: string;
  provider: string;
  externalName: string | null;
  externalUrl: string | null;
  isActive: boolean;
};

export function IntegrationToggles({ slug, integrations }: { slug: string; integrations: Integration[] }) {
  if (integrations.length === 0) {
    return (
      <p className="text-sm text-[var(--color-ink-muted)]">
        Nog geen koppelingen. Deze ontstaan automatisch zodra de klant in Frame.io of Google Drive gematcht is.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {integrations.map((i) => (
        <IntegrationRow key={i.id} slug={slug} integration={i} />
      ))}
      <p className="pt-1 text-xs text-[var(--color-ink-faint)]">
        Uitzetten koppelt deze bron tijdelijk los; de synchronisatie laat &apos;m dan met rust. De externe ID&apos;s zelf beheer je via de import.
      </p>
    </div>
  );
}

function IntegrationRow({ slug, integration }: { slug: string; integration: Integration }) {
  const [active, setActive] = useState(integration.isActive);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--color-line)] px-3 py-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{INTEGRATION_LABEL[integration.provider] ?? integration.provider}</span>
          <Badge tone={active ? "good" : "neutral"}>{active ? "Actief" : "Uit"}</Badge>
        </div>
        {integration.externalName ? (
          <span className="block truncate text-xs text-[var(--color-ink-muted)]">{integration.externalName}</span>
        ) : null}
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const next = !active;
            const res = await toggleClientIntegration(integration.id, next, slug);
            if (res.ok) {
              setActive(next);
              router.refresh();
            } else {
              setErr(res.message ?? "Mislukt");
            }
          })
        }
        className="shrink-0 rounded-[var(--radius-sm)] border border-[var(--color-line)] px-3 py-1 text-xs font-medium hover:bg-[var(--color-surface-2)]"
      >
        {pending ? <Loader2 className="inline size-3.5 animate-spin" /> : active ? "Uitzetten" : "Aanzetten"}
      </button>
      {err ? <ErrorNote>{err}</ErrorNote> : null}
    </div>
  );
}
