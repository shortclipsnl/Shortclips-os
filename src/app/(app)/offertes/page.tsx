import type { Metadata } from "next";
import { ExternalLink, FileSignature } from "lucide-react";
import { requireQuotesAccess } from "@/server/auth/context";
import { getQuotesOverview } from "@/server/quotes";
import { pandadocConfigured } from "@/server/quotes/pandadoc-client";
import { lastPandaDocSync } from "@/server/quotes/pandadoc-sync";
import { PageHeader } from "@/components/ui";
import { OffertesBoard } from "./offertes-board";

export const metadata: Metadata = { title: "Offertes" };
export const dynamic = "force-dynamic";

export default async function OffertesPage() {
  await requireQuotesAccess();
  const [{ rows, stats, owners }, last] = await Promise.all([getQuotesOverview(), lastPandaDocSync()]);

  const lastLog = Array.isArray(last?.log) ? (last!.log as { level?: string; message?: string }[]) : [];
  const lastError = last?.error ?? lastLog.filter((l) => l.level === "error").at(-1)?.message ?? null;
  const sync = {
    configured: pandadocConfigured(),
    at: last?.finishedAt ? new Date(last.finishedAt).toISOString() : null,
    ok: !last || last.status === "success" || last.status === "partial",
    message: lastError,
  };

  return (
    <div className="mx-auto max-w-[1300px]">
      <PageHeader
        title="Offertes"
        description="Alle offertes uit PandaDoc op één plek: status, bedrag, klantactiviteit en de gekoppelde lead. Aanmaken, verzenden en ondertekenen gebeurt in PandaDoc."
        actions={
          <a href="https://app.pandadoc.com/a/#/documents" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">
            <ExternalLink className="size-4" /> Nieuwe offerte in PandaDoc
          </a>
        }
      />

      {rows.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface)] px-6 py-16 text-center">
          <FileSignature className="mx-auto mb-3 size-8 text-[var(--color-ink-faint)]" />
          <p className="text-sm font-semibold text-[var(--color-ink)]">Nog geen offertes</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-[var(--color-ink-muted)]">{sync.configured ? "Zodra er offertes in PandaDoc staan, verschijnen ze hier automatisch." : "Koppel PandaDoc (PANDADOC_API_KEY) om de offertes hier te tonen."}</p>
        </div>
      ) : (
        <OffertesBoard rows={rows} stats={stats} owners={owners} sync={sync} />
      )}
    </div>
  );
}
