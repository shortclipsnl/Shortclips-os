import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/server/auth/context";
import { getEditingDashboard, listEditorsWithRates } from "@/server/editing";
import { editorCapacityMap } from "@/server/metrics";
import { editorLoad, LOAD_LABEL } from "@/lib/metrics";
import { Avatar, Badge, Card, CardHeader, EmptyState, PageHeader, Table } from "@/components/ui";
import { euro, formatDate, num } from "@/lib/format";
import { RateRow } from "./editing-ui";

export const metadata: Metadata = { title: "Editors" };
export const dynamic = "force-dynamic";

const LEVEL_COLOR: Record<string, string> = {
  normaal: "var(--color-good)",
  hoog: "var(--color-warn)",
  overbelast: "var(--color-bad)",
  geen_data: "var(--color-ink-faint)",
};

export default async function EditingPage() {
  const viewer = await requireInternal();
  const canSeeCosts = viewer.permissions.has("finance:read_costs");
  const canManage = viewer.permissions.has("team:write");

  const [data, editors, capMap] = await Promise.all([
    getEditingDashboard(viewer),
    canManage ? listEditorsWithRates() : Promise.resolve([]),
    editorCapacityMap(),
  ]);

  return (
    <div className="mx-auto max-w-[1300px]">
      <PageHeader title="Editing Dashboard" description="De volledige editingproductie per editor en per klant, met automatisch berekende editingkosten." />

      {/* Per editor */}
      <div className="mb-3 rounded-[var(--radius-md)] bg-[var(--color-indigo-ink)] px-4 py-2.5 text-sm font-bold tracking-tight text-white">Per editor</div>
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
                  <Avatar name={e.editor_name} size={34} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{e.editor_name}</div>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs" style={{ color: level.color }}>
                      {level.label}
                      {e.leave ? <span className="rounded-full bg-[var(--color-warn-soft)] px-1.5 py-0.5 text-2xs font-medium text-[#8a5300]">afwezig {formatDate(e.leave.start_on)}–{formatDate(e.leave.end_on)}</span> : null}
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

      {/* Per klant */}
      <Card padded={false} className="mb-6">
        <CardHeader title="Per klant" subtitle="Welke editor, hoeveel video's en wat de editingkosten per klant zijn." className="p-5 pb-2" />
        <Table head={<><th className="sc-th">Klant</th><th className="sc-th">Editor(s)</th><th className="sc-th text-right">In productie</th><th className="sc-th text-right">Afgerond (mnd)</th><th className="sc-th text-right">Wacht op feedback</th><th className="sc-th text-right">Te laat</th><th className="sc-th">Deadline</th>{canSeeCosts ? <><th className="sc-th text-right">Editkosten/mnd</th><th className="sc-th text-right">Gem./video</th></> : null}</>}>
          {data.clients.map((c) => (
            <tr key={c.id} className="sc-row-link">
              <td className="sc-td"><Link href={`/clients/${c.slug}?tab=videos`} className="flex items-center gap-2 font-medium hover:underline"><Avatar name={c.name} color={c.color} size={20} />{c.name}</Link></td>
              <td className="sc-td text-[var(--color-ink-muted)]">{c.editors ?? "—"}</td>
              <td className="sc-td text-right tabular-nums">{num(Number(c.in_production))}</td>
              <td className="sc-td text-right tabular-nums text-[var(--color-ink-muted)]">{num(Number(c.done_month))}</td>
              <td className="sc-td text-right tabular-nums text-[var(--color-ink-muted)]">{num(Number(c.awaiting_feedback))}</td>
              <td className={`sc-td text-right tabular-nums ${Number(c.late) > 0 ? "font-semibold text-[var(--color-bad)]" : "text-[var(--color-ink-muted)]"}`}>{num(Number(c.late))}</td>
              <td className="sc-td text-[var(--color-ink-muted)]">{c.next_due ? formatDate(c.next_due) : "—"}</td>
              {canSeeCosts ? (
                <>
                  <td className="sc-td text-right tabular-nums">{Number(c.client_rate) > 0 ? euro(Number(c.client_rate) * Number(c.quota)) : "—"}</td>
                  <td className="sc-td text-right tabular-nums text-[var(--color-ink-muted)]">{Number(c.client_rate) > 0 ? euro(Number(c.client_rate)) : "—"}</td>
                </>
              ) : null}
            </tr>
          ))}
        </Table>
      </Card>

      {/* Editor-tarieven beheer */}
      {canManage ? (
        <Card padded={false}>
          <CardHeader title="Editor-tarieven & capaciteit" subtitle="Tarief per video en weekcapaciteit per editor. De editingkosten worden hiermee automatisch berekend; een afwijkend tarief per video stel je op de videopagina in." className="p-5 pb-2" />
          {editors.length === 0 ? <EmptyState title="Geen editors gevonden" /> : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-line)] text-left text-xs text-[var(--color-ink-faint)]">
                  <th className="px-5 py-2 font-medium">Editor</th>
                  <th className="px-2 py-2 text-right font-medium">Tarief / video</th>
                  <th className="px-2 py-2 text-right font-medium">Capaciteit / week</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {editors.map((e) => <RateRow key={e.id} editor={e} />)}
              </tbody>
            </table>
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
