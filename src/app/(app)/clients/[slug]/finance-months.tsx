"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil } from "lucide-react";
import { upsertFinanceMonth } from "@/server/actions/finance";
import { Button } from "@/components/ui";

export type FinanceMonth = {
  id: string;
  period: string;
  revenue: string;
  extraRevenue: string;
  editCost: string;
  shootCost: string;
  strategyCost: string;
  otherCost: string;
  note: string | null;
};

const eur = (n: number) => `€ ${n.toLocaleString("nl-NL", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
function monthLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, 1).toLocaleDateString("nl-NL", { month: "short", year: "numeric" });
}
function net(r: FinanceMonth): number {
  return Number(r.revenue) + Number(r.extraRevenue) - Number(r.editCost) - Number(r.shootCost) - Number(r.strategyCost) - Number(r.otherCost);
}

export function FinanceMonths({ clientId, months, canWrite }: { clientId: string; months: FinanceMonth[]; canWrite: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);

  if (months.length === 0) {
    return (
      <p className="px-5 py-4 text-sm text-[var(--color-ink-muted)]">
        Nog geen maandstaten. Deze worden elke nacht automatisch aangemaakt voor actieve klanten (omzet, meerwerk en editkosten); daarna vul je de directe kosten in.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-[var(--color-line)] text-left text-xs text-[var(--color-ink-faint)]">
            <th className="px-5 py-2 font-medium">Maand</th>
            <th className="px-2 py-2 text-right font-medium">Omzet</th>
            <th className="px-2 py-2 text-right font-medium">Meerwerk</th>
            <th className="px-2 py-2 text-right font-medium">Edit</th>
            <th className="px-2 py-2 text-right font-medium">Opname</th>
            <th className="px-2 py-2 text-right font-medium">Strategie</th>
            <th className="px-2 py-2 text-right font-medium">Overig</th>
            <th className="px-2 py-2 text-right font-medium">Netto</th>
            {canWrite ? <th className="px-3 py-2" /> : null}
          </tr>
        </thead>
        <tbody>
          {months.map((m) =>
            editing === m.id ? (
              <EditRow key={m.id} clientId={clientId} month={m} onDone={() => setEditing(null)} />
            ) : (
              <tr key={m.id} className="border-b border-[var(--color-line)]">
                <td className="px-5 py-2 font-medium">{monthLabel(m.period)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{eur(Number(m.revenue))}</td>
                <td className="px-2 py-2 text-right tabular-nums text-[var(--color-ink-muted)]">{Number(m.extraRevenue) > 0 ? eur(Number(m.extraRevenue)) : "—"}</td>
                <td className="px-2 py-2 text-right tabular-nums text-[var(--color-ink-muted)]">−{eur(Number(m.editCost))}</td>
                <td className="px-2 py-2 text-right tabular-nums text-[var(--color-ink-muted)]">−{eur(Number(m.shootCost))}</td>
                <td className="px-2 py-2 text-right tabular-nums text-[var(--color-ink-muted)]">−{eur(Number(m.strategyCost))}</td>
                <td className="px-2 py-2 text-right tabular-nums text-[var(--color-ink-muted)]">−{eur(Number(m.otherCost))}</td>
                <td className="px-2 py-2 text-right font-bold tabular-nums">{eur(net(m))}</td>
                {canWrite ? (
                  <td className="px-3 py-2 text-right">
                    <button type="button" onClick={() => setEditing(m.id)} className="rounded p-1 text-[var(--color-ink-faint)] hover:text-[var(--color-brand-600)]" aria-label="Kosten bewerken">
                      <Pencil className="size-4" />
                    </button>
                  </td>
                ) : null}
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

function EditRow({ clientId, month, onDone }: { clientId: string; month: FinanceMonth; onDone: () => void }) {
  const [shoot, setShoot] = useState(month.shootCost);
  const [strategy, setStrategy] = useState(month.strategyCost);
  const [other, setOther] = useState(month.otherCost);
  const [pending, start] = useTransition();
  const router = useRouter();

  function save() {
    start(async () => {
      const res = await upsertFinanceMonth({
        clientId,
        period: month.period,
        shootCost: Number(shoot) || 0,
        strategyCost: Number(strategy) || 0,
        otherCost: Number(other) || 0,
      });
      if (res.ok) { onDone(); router.refresh(); }
    });
  }
  const cell = "w-20 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2 py-1 text-right text-sm tabular-nums";

  return (
    <tr className="border-b border-[var(--color-line)] bg-[var(--color-surface-sunken)]">
      <td className="px-5 py-2 font-medium">{monthLabel(month.period)}</td>
      <td className="px-2 py-2 text-right tabular-nums">{eur(Number(month.revenue))}</td>
      <td className="px-2 py-2 text-right tabular-nums text-[var(--color-ink-muted)]">{Number(month.extraRevenue) > 0 ? eur(Number(month.extraRevenue)) : "—"}</td>
      <td className="px-2 py-2 text-right tabular-nums text-[var(--color-ink-muted)]">−{eur(Number(month.editCost))}</td>
      <td className="px-2 py-2 text-right"><input className={cell} inputMode="decimal" value={shoot} onChange={(e) => setShoot(e.target.value)} /></td>
      <td className="px-2 py-2 text-right"><input className={cell} inputMode="decimal" value={strategy} onChange={(e) => setStrategy(e.target.value)} /></td>
      <td className="px-2 py-2 text-right"><input className={cell} inputMode="decimal" value={other} onChange={(e) => setOther(e.target.value)} /></td>
      <td className="px-2 py-2 text-right font-bold tabular-nums">
        {eur(Number(month.revenue) + Number(month.extraRevenue) - Number(month.editCost) - (Number(shoot) || 0) - (Number(strategy) || 0) - (Number(other) || 0))}
      </td>
      <td className="px-3 py-2">
        <span className="flex justify-end gap-1.5">
          <Button size="sm" onClick={save} disabled={pending}>{pending ? <Loader2 className="size-4 animate-spin" /> : "Opslaan"}</Button>
          <Button size="sm" variant="ghost" onClick={onDone}>×</Button>
        </span>
      </td>
    </tr>
  );
}
