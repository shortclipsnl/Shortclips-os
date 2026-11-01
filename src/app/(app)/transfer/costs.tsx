import { Card, Stat } from "@/components/ui";
import type { TransferCosts as Costs } from "@/server/transfer/service";

function fmtGB(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}

/** Kostenoverzicht voor de eigenaar — opslag, verbruik en geschatte kosten. */
export function TransferCosts({ costs }: { costs: Costs }) {
  const eur = (costs.estMonthlyCostCents / 100).toFixed(2);
  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold">Opslag & kosten</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Opslag in gebruik" value={fmtGB(costs.totalBytes)} tone="info" />
        <Stat label="Deze maand geüpload" value={fmtGB(costs.uploadedThisMonthBytes)} />
        <Stat label="Actieve transfers" value={costs.activeTransfers} tone="good" />
        <Stat label="Binnenkort verwijderd" value={costs.expiringSoon} tone={costs.expiringSoon > 0 ? "warn" : "neutral"} />
      </div>
      <p className="mt-3 text-xs text-[var(--color-ink-faint)]">
        Geschatte opslagkosten: <strong className="text-[var(--color-ink)]">${eur}/maand</strong> (R2-opslag; egress is gratis). Dit is een schatting op basis van de opgeslagen bytes.
      </p>
    </Card>
  );
}
