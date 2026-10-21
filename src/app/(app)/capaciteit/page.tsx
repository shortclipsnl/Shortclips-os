import type { Metadata } from "next";
import { requireInternal } from "@/server/auth/context";
import { getCapacityOverview } from "@/server/capacity";
import { isCoreStaffByName } from "@/server/core-staff";
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
  const overview = await getCapacityOverview();
  const { params, summary } = overview;

  // De eigenaar (Jarno/Janno) hoort niet in de capaciteitsverdeling.
  const people = overview.people.filter((p) => {
    const n = (p.name ?? "").toLowerCase();
    const r = (p.role ?? "").toLowerCase();
    return !(n.includes("jarno") || n.includes("janno") || r.includes("eigenaar") || r.includes("owner"));
  });

  const paramMap = new Map(params.map((p) => [p.key, p.value ?? 0]));

  // Financiële aannames (kosten, omzet, marges) zijn uitsluitend voor de
  // eigenaar — niet voor de rest van het team. finance:read heeft alleen de
  // eigenaar, dus canSeeFinance schermt dit af in de hele pagina.
  const isFinanceParam = (p: (typeof params)[number]) =>
    /euro|€/i.test(p.unit ?? "") ||
    /kosten|omzet|marge|winst|resultaat|tarief|prijs/i.test(p.key) ||
    /kosten|omzet|marge|winst|resultaat|tarief|prijs/i.test(p.label ?? "");
  const visibleParams = canSeeFinance ? params : params.filter((p) => !isFinanceParam(p));

  // Zelfde indeling als de Teampagina: vast kernteam vs. freelancers & overig.
  const core = people.filter((p) => isCoreStaffByName(p.name));
  const rest = people.filter((p) => !isCoreStaffByName(p.name));

  const renderCard = (p: (typeof people)[number]) => {
    const st = STATUS_STYLE[p.status]!;
    const pct = p.occupancy ?? 0;
    return (
      <div key={p.id} className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4"
        style={{ boxShadow: `inset 3px 0 0 ${st.bar}` }}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <TeamAvatar name={p.name} size={48} />
            <div className="min-w-0">
              <div className="truncate font-semibold">{p.name}</div>
              <div className="text-xs text-[var(--color-ink-muted)]">
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
        {p.availabilityNote ? (
          <p className="mt-2 flex items-start gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-warn-soft)] px-2 py-1.5 text-2xs text-[#8a5300]">
            <span className="font-semibold">Niet beschikbaar:</span> <span className="min-w-0">{p.availabilityNote}</span>
          </p>
        ) : null}
        {canSeeFinance && p.costPerMonth ? (
          <p className="mt-1 text-2xs text-[var(--color-ink-faint)]">kosten {euro(p.costPerMonth)}/mnd</p>
        ) : null}
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="Teamcapaciteit"
        description="Hoeveel werk ligt er per persoon de komende weken, en waar zit de rek? Belasting wordt automatisch berekend uit opnamedagen, editwerk en klanten — in de capaciteitseenheid van elke persoon."
      />

      {people.length === 0 ? (
        <Card className="mb-6"><p className="text-sm text-[var(--color-ink-muted)]">Nog geen capaciteitsgegevens. Draai de import (Beheer → Koppelingen) of de nachtelijke sync.</p></Card>
      ) : (
        <>
          {/* Vaste medewerkers (het vaste kernteam) */}
          <div className="mb-3 flex items-center gap-3 border-l-4 border-[var(--color-indigo-ink)] pl-3">
            <div>
              <h2 className="text-base font-bold tracking-tight">Vaste medewerkers</h2>
              <p className="text-xs text-[var(--color-ink-muted)]">Het vaste kernteam</p>
            </div>
            <span className="ml-auto rounded-full bg-[var(--color-indigo-ink)] px-2.5 py-0.5 text-xs font-semibold text-white">{core.length}</span>
          </div>
          {core.length === 0 ? (
            <Card className="mb-6"><p className="text-sm text-[var(--color-ink-muted)]">Geen vaste medewerkers met capaciteitsgegevens.</p></Card>
          ) : (
            <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{core.map(renderCard)}</div>
          )}

          {/* Freelancers & overig team */}
          <div className="mb-3 flex items-center gap-3 border-l-4 border-[var(--color-warn)] pl-3">
            <div>
              <h2 className="text-base font-bold tracking-tight">Freelancers &amp; overig team</h2>
              <p className="text-xs text-[var(--color-ink-muted)]">Flexibele inzet</p>
            </div>
            <span className="ml-auto rounded-full bg-[var(--color-warn)] px-2.5 py-0.5 text-xs font-semibold text-white">{rest.length}</span>
          </div>
          {rest.length === 0 ? (
            <Card className="mb-6"><p className="text-sm text-[var(--color-ink-muted)]">Geen freelancers of overig team met capaciteitsgegevens.</p></Card>
          ) : (
            <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{rest.map(renderCard)}</div>
          )}
        </>
      )}

      {/* Teamsamenvatting — in kleur, zodat je in één oogopslag kunt scannen. */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Actieve klanten" value={String(summary.activeClients)} tone="info" />
        <Stat label="Shorts per maand" value={String(summary.monthlyShorts)} hint="afname actieve klanten" tone="lime" />
        <Stat label="Editketen" value={summary.editChainUsedPct !== null ? `${summary.editChainUsedPct}%` : "—"}
          tone={summary.editChainUsedPct !== null && summary.editChainUsedPct > 90 ? "bad" : summary.editChainUsedPct !== null && summary.editChainUsedPct > 75 ? "warn" : "good"}
          hint={summary.editChainCapacity ? `max ~${summary.editChainCapacity}/mnd` : undefined} />
        <Stat label="Actieve editors" value={String(summary.activeEditors)} tone="violet" />
      </div>

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
          revenuePerClient: canSeeFinance ? (paramMap.get("omzet_klant") ?? 1978) : 0,
          costStaff: canSeeFinance ? (paramMap.get("kosten_medewerker") ?? 2775) : 0,
          editCostShort: canSeeFinance ? (paramMap.get("edit_kosten_short") ?? 48) : 0,
          costOverig: canSeeFinance ? (paramMap.get("kosten_overig") ?? 480) : 0,
        }}
      />

      {/* Aannames */}
      <details className="mt-6">
        <summary className="cursor-pointer text-sm font-semibold">Aannames &amp; grenzen ({visibleParams.length})</summary>
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
              {visibleParams.map((p) => (
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
