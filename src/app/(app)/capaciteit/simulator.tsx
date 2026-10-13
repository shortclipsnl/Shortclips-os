"use client";

import { useState } from "react";
import { Card } from "@/components/ui";

type Params = {
  shortsPerClient: number;
  opnPerClient: number;
  editPerEditor: number;
  ccClientsHigh: number;
  vgCapacity: number;
  revenuePerClient: number;
  costStaff: number;
  editCostShort: number;
  costOverig: number;
};

function euro(v: number): string {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
}

/**
 * Wat-als: bij hoeveel actieve klanten heb je hoeveel editors, content
 * creatives en videografen nodig — en wat blijft er indicatief over? Gebruikt
 * de aannames uit CAPACITEIT INSTELLINGEN (overgenomen uit Monday).
 */
export function GrowthSimulator({ currentClients, canSeeFinance, p }: { currentClients: number; canSeeFinance: boolean; p: Params }) {
  const [clients, setClients] = useState(currentClients);

  const shortsPerMonth = clients * p.shortsPerClient;
  const opnamesPerMonth = clients * p.opnPerClient;
  const editorsNeeded = Math.max(1, Math.ceil(shortsPerMonth / p.editPerEditor));
  const ccNeeded = Math.max(1, Math.ceil(clients / p.ccClientsHigh));
  const vgNeeded = Math.max(1, Math.ceil(opnamesPerMonth / p.vgCapacity));

  const revenue = clients * p.revenuePerClient;
  const editCost = shortsPerMonth * p.editCostShort;
  const staffCost = (ccNeeded + vgNeeded) * p.costStaff + p.costOverig;
  const profit = revenue - editCost - staffCost;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold tracking-tight">Groeisimulator</h2>
          <p className="text-2xs text-[var(--color-ink-muted)]">Schuif met het aantal actieve klanten en zie wat je nodig hebt.</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={5}
            max={60}
            value={clients}
            onChange={(e) => setClients(Number(e.target.value))}
            className="w-44 accent-[var(--color-brand-500)]"
            aria-label="Aantal actieve klanten"
          />
          <input
            type="number"
            min={1}
            value={clients}
            onChange={(e) => setClients(Math.max(1, Number(e.target.value) || 1))}
            className="h-8 w-16 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2 text-right text-sm tabular-nums"
          />
          <span className="text-xs text-[var(--color-ink-muted)]">klanten</span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Shorts / maand" value={Math.round(shortsPerMonth).toString()} />
        <Tile label="Opnames / maand" value={Math.round(opnamesPerMonth).toString()} />
        <Tile label="Editors nodig" value={String(editorsNeeded)} accent />
        <Tile label="Content Creatives" value={String(ccNeeded)} accent />
        <Tile label="Videografen" value={String(vgNeeded)} accent />
        <Tile label="Omzet / maand" value={canSeeFinance ? euro(revenue) : "—"} />
      </div>

      {canSeeFinance ? (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Tile label="Editkosten / maand" value={euro(editCost)} />
          <Tile label="Team + overig / maand" value={euro(staffCost)} />
          <Tile label="Indicatief resultaat" value={euro(profit)} tone={profit < 0 ? "var(--color-bad)" : "var(--color-good)"} />
        </div>
      ) : null}

      <p className="mt-3 text-2xs text-[var(--color-ink-faint)]">
        Indicatief, op basis van de aannames uit het capaciteitsonderzoek. Werving + inwerken van een nieuwe kracht duurt ~{" "}
        richtlijn 6–8 weken; houd daar rekening mee bij groei.
      </p>
    </Card>
  );
}

function Tile({ label, value, accent, tone }: { label: string; value: string; accent?: boolean; tone?: string }) {
  return (
    <div className={`rounded-[var(--radius-md)] px-3 py-2.5 ${accent ? "bg-[var(--color-info-soft)]" : "bg-[var(--color-surface-sunken)]"}`}>
      <div className="text-lg font-bold tabular-nums leading-none" style={tone ? { color: tone } : undefined}>{value}</div>
      <div className="mt-1 text-2xs text-[var(--color-ink-faint)]">{label}</div>
    </div>
  );
}
