import type { Metadata } from "next";
import { requireInternal } from "@/server/auth/context";
import { getCapacityOverview } from "@/server/capacity";
import { PageHeader, Card, Stat, Badge, TeamAvatar } from "@/components/ui";
import { euro } from "@/lib/format";
import { GrowthSimulator } from "./simulator";

export const metadata: Metadata = { title: "Teamcapaciteit" };
export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, { label: string; tone: "good" | "warn" | "bad" | "neutral"; bar: string }> = {
  gezond: { label: "Gezond", tone: "good", bar: "var(--color-good)" },
  hoog: { label: "Hoog", tone: "warn", bar: "var(--color-warn)" },
  kritiek: { label: "Kritiek", tone: "bad", bar: "var(--color-bad)" },
  geen_data: { label: "Geen data", tone: "neutral", bar: "var(--color-line-strong)" },
};

export default async function CapacityPage() {
  const viewer = await requireInternal();
  const canSeeFinance = viewer.permissions.has("finance:read");
  const { people, params, summary } = await getCapacityOverview();

  const paramMap = new Map(params.map((p) => [p.key, p.value ?? 0]));

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="Teamcapaciteit"
        description="Hoeveel werk ligt er per persoon de komende weken, en waar zit de rek? Belasting wordt automatisch berekend uit opnamedagen, editwerk en klanten — in de capaciteitseenheid van elke persoon."
      />

      {people.length === 0 ? (
        <Card><p className="text-sm text-[var(--color-ink-muted)]">Nog geen capaciteitsgegevens. Draai de import (Beheer → Koppelingen) of de nachtelijke sync.</p></Card>
      ) : (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {people.map((p) => {
            const st = STATUS_STYLE[p.status]!;
            const pct = p.occupancy ?? 0;
            return (
              <div key={p.id} className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4"
                style={{ boxShadow: `inset 3px 0 0 ${st.bar}` }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <TeamAvatar name={p.name} size={20} />
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{p.name}</div>
                      <div className="text-2xs text-[var(--color-ink-muted)]">
                        {p.role ?? "—"}{p.employment ? ` · ${p.employment}` : ""}
                      </div>
                    </div>
                  </div>
                  <Badge tone={st.tone}>{st.label}</Badge>
                </div>

                {p.load !== null ? (
                  <>
                    <div className="mt-3 flex items-end justify-between">
                      <div className="text-2xl font-bold tabular-nums leading-none">
                        {p.load}
                        {p.green !== null ? <span className="text-sm font-medium text-[var(--color-ink-faint)]"> / {p.green}</span> : null}
                      </div>
                      {p.occupancy !== null ? <div className="text-xs font-semibold" style={{ color: st.bar }}>{p.occupancy}%</div> : null}
                    </div>
                    <div className="mt-1 text-2xs text-[var(--color-ink-faint)]">{p.unitLabel}</div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--color-surface-sunken)]">
                      <span className="block h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: st.bar }} />
                    </div>
                  </>
                ) : (
                  <p className="mt-3 text-xs text-[var(--color-ink-faint)]">Belasting niet gemeten voor deze rol.</p>
                )}

                {p.detail ? <p className="mt-2 text-2xs text-[var(--color-ink-muted)]">{p.detail}</p> : null}
                {canSeeFinance && p.costPerMonth ? (
                  <p className="mt-1 text-2xs text-[var(--color-ink-faint)]">kosten {euro(p.costPerMonth)}/mnd</p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {/* Teamsamenvatting */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Actieve klanten" value={String(summary.activeClients)} />
        <Stat label="Shorts per maand" value={String(summary.monthlyShorts)} hint="afname actieve klanten" />
        <Stat label="Editketen" value={summary.editChainUsedPct !== null ? `${summary.editChainUsedPct}%` : "—"}
          tone={summary.editChainUsedPct !== null && summary.editChainUsedPct > 90 ? "bad" : summary.editChainUsedPct !== null && summary.editChainUsedPct > 75 ? "warn" : "good"}
          hint={summary.editChainCapacity ? `max ~${summary.editChainCapacity}/mnd` : undefined} />
        <Stat label="Actieve editors" value={String(summary.activeEditors)} />
      </div>

      {canSeeFinance && summary.monthlyRevenue !== null ? (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Omzet (indicatief)" value={euro(summary.monthlyRevenue)} hint="per maand" />
          <Stat label="Personeels- + directe kosten" value={summary.staffCost ? euro(summary.staffCost) : "—"} hint="per maand" />
          <Stat label="Indicatief resultaat" value={summary.estimatedProfit !== null ? euro(summary.estimatedProfit) : "—"} tone={summary.estimatedProfit !== null && summary.estimatedProfit < 0 ? "bad" : "good"} hint="per maand" />
        </div>
      ) : null}

      {/* Groeisimulator */}
      <GrowthSimulator
        currentClients={summary.activeClients}
        canSeeFinance={canSeeFinance}
        p={{
          shortsPerClient: paramMap.get("shorts_klant_contract") ?? 5.56,
          opnPerClient: paramMap.get("opn_klant_contract") ?? 1,
          editPerEditor: paramMap.get("edit_cap_editor") ?? 24,
          ccClientsHigh: paramMap.get("cc_klanten_hoog") ?? 26,
          vgCapacity: paramMap.get("vg_hoog_4w") ?? 16,
          revenuePerClient: paramMap.get("omzet_klant") ?? 1978,
          costStaff: paramMap.get("kosten_medewerker") ?? 2775,
          editCostShort: paramMap.get("edit_kosten_short") ?? 48,
          costOverig: paramMap.get("kosten_overig") ?? 480,
        }}
      />

      {/* Aannames */}
      <details className="mt-6">
        <summary className="cursor-pointer text-sm font-semibold">Aannames &amp; grenzen ({params.length})</summary>
        <Card padded={false} className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-[var(--color-line)] text-left text-xs text-[var(--color-ink-faint)]">
                <th className="px-4 py-2 font-medium">Aanname</th>
                <th className="px-2 py-2 text-right font-medium">Waarde</th>
                <th className="px-2 py-2 font-medium">Eenheid</th>
                <th className="px-4 py-2 font-medium">Zekerheid</th>
              </tr>
            </thead>
            <tbody>
              {params.map((p) => (
                <tr key={p.key} className="border-b border-[var(--color-line)] last:border-0">
                  <td className="px-4 py-2">{p.label ?? p.key}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{p.value ?? "—"}</td>
                  <td className="px-2 py-2 text-[var(--color-ink-muted)]">{p.unit ?? ""}</td>
                  <td className="px-4 py-2">
                    <Badge tone={p.confidence === "Bevestigd" ? "good" : p.confidence === "Indicatief" ? "warn" : "neutral"}>{p.confidence ?? "—"}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </details>
    </div>
  );
}
