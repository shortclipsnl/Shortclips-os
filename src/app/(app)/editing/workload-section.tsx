import { getEditingDashboard, listEditorsWithRates } from "@/server/editing";
import { editorCapacityMap } from "@/server/metrics";
import { editorLoad, LOAD_LABEL } from "@/lib/metrics";
import type { Viewer } from "@/server/auth/context";
import { Avatar, Card, CardHeader, EmptyState } from "@/components/ui";
import { euro, formatDate, num } from "@/lib/format";
import { editorDisplayName } from "@/lib/editors";
import { RateRow } from "./editing-ui";
import { PerClientEditors } from "./per-client-editors";

const LEVEL_COLOR: Record<string, string> = {
  normaal: "var(--color-good)",
  hoog: "var(--color-warn)",
  overbelast: "var(--color-bad)",
  geen_data: "var(--color-ink-faint)",
};

/**
 * Editorbelasting (werkvoorraad per editor), per-klant-overzicht en de
 * editor-tarieven. Verhuisd uit de losse /editing-pagina zodat alles op één
 * samengevoegde Editing-pagina staat (geen dubbel dashboard).
 */
export async function WorkloadSection({ viewer }: { viewer: Viewer }) {
  const canSeeCosts = viewer.permissions.has("finance:read_costs");
  const canManage = viewer.permissions.has("team:write");
  const [data, editors, capMap] = await Promise.all([
    getEditingDashboard(viewer),
    canManage ? listEditorsWithRates() : Promise.resolve([]),
    editorCapacityMap(),
  ]);

  return (
    <div className="mt-8">
      {/* Werkvoorraad per editor */}
      <div className="mb-3 rounded-[var(--radius-md)] bg-[var(--color-indigo-ink)] px-4 py-2.5 text-sm font-bold tracking-tight text-white">Werkvoorraad per editor</div>
      {data.editors.length === 0 ? (
        <Card className="mb-6"><EmptyState title="Nog geen editwerk toegewezen" /></Card>
      ) : (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.editors.map((e) => {
            const open = Number(e.in_production);
            const capacity = capMap.get(e.editor_id) ?? 0;
            const { pct, level: lvl } = editorLoad(open, capacity);
            const level = { label: LOAD_LABEL[lvl], color: LEVEL_COLOR[lvl]! };
            return (
              <div key={e.editor_id} className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3.5">
                <div className="flex items-center gap-3">
                  <Avatar name={e.editor_name} size={46} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-base font-semibold">{editorDisplayName(e.editor_name)}</div>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs" style={{ color: level.color }}>
                      {level.label}
                      {e.leave ? <span className="rounded-full bg-[var(--color-warn-soft)] px-1.5 py-0.5 text-2xs font-medium text-[#8a5300]">afwezig {formatDate(e.leave.start_on)}–{formatDate(e.leave.end_on)}</span> : null}
                    </div>
                    <div className="mt-0.5 text-xs font-semibold text-[var(--color-ink)]">
                      {Number(e.rate) > 0 ? `${euro(Number(e.rate))} per short` : <span className="font-normal text-[var(--color-ink-faint)]">prijs niet ingesteld</span>}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold leading-none tabular-nums">{open}</div>
                    <div className="text-2xs text-[var(--color-ink-faint)]">in productie</div>
                  </div>
                </div>
                {capacity > 0 ? (
                  <div className="mt-3">
                    <div className="h-2 overflow-hidden rounded-full bg-[var(--color-surface-sunken)]">
                      <span className="block h-full rounded-full" style={{ width: `${Math.min(100, pct ?? 0)}%`, background: level.color }} />
                    </div>
                    <div className="mt-1 text-2xs text-[var(--color-ink-faint)]">{open} van {capacity} shorts per 4 weken{pct !== null ? ` · ${pct}%` : ""}</div>
                  </div>
                ) : null}
                <div className="mt-3 grid grid-cols-3 gap-1.5 text-center">
                  <Mini label="Afgerond (mnd)" value={num(Number(e.done_month))} />
                  <Mini label="Wacht op feedback" value={num(Number(e.awaiting_feedback))} />
                  <Mini label="Te laat" value={num(Number(e.late))} tone={Number(e.late) > 0 ? "var(--color-bad)" : undefined} />
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-[var(--color-ink-muted)]">
                  <span>{num(Number(e.clients_active))} klanten</span>
                  {e.next_due ? <span>eerstvolgende deadline {formatDate(e.next_due)}</span> : null}
                  {canSeeCosts ? <span className="font-semibold text-[var(--color-ink)]">editkosten lopend: {euro(Number(e.cost_active))}</span> : null}
                  {canSeeCosts && Number(e.rate) > 0 ? <span>{euro(Number(e.rate))}/video</span> : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Per klant — met editor-filterknoppen en een aanpasbare editor per klant. */}
      <PerClientEditors clients={data.clients} canManage={canManage} canSeeCosts={canSeeCosts} />

      {/* Editor-tarieven beheer */}
      {canManage ? (
        <Card padded={false}>
          <CardHeader title="Prijs per editor & capaciteit" subtitle="De prijs per short en de weekcapaciteit per editor. Hiermee worden de editkosten automatisch berekend." className="p-5 pb-2" />
          {editors.length === 0 ? <EmptyState title="Geen editors gevonden" /> : (
            <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="border-b border-[var(--color-line)] text-left text-xs text-[var(--color-ink-faint)]">
                  <th className="px-5 py-2 font-medium">Editor</th>
                  <th className="px-2 py-2 text-right font-medium">Prijs / short</th>
                  <th className="px-2 py-2 text-right font-medium">Capaciteit / week</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {editors.map((e) => <RateRow key={e.id} editor={e} />)}
              </tbody>
            </table>
            </div>
          )}
        </Card>
      ) : null}
    </div>
  );
}

function Mini({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-[var(--radius-sm)] bg-[var(--color-surface-sunken)] py-1.5">
      <div className="text-sm font-bold tabular-nums leading-none" style={tone ? { color: tone } : undefined}>{value}</div>
      <div className="mt-0.5 text-2xs text-[var(--color-ink-faint)]">{label}</div>
    </div>
  );
}
