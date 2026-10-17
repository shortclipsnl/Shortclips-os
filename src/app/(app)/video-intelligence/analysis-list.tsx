"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { Avatar, Badge, Button, Table } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { PLATFORM } from "@/lib/statuses";
import { VI_STATUS, msToClock } from "./labels";
import { reprocessMany } from "@/server/actions/video-intelligence";

export type AnalysisRow = {
  id: string;
  title: string | null;
  platform: string | null;
  status: string;
  durationMs: number | null;
  createdAt: string | Date;
  clientName: string;
  clientColor: string | null;
};

export function AnalysisList({ rows, canRun }: { rows: AnalysisRow[]; canRun: boolean }) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const toggle = (id: string) => setSel((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const allSelected = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const toggleAll = () => setSel(allSelected ? new Set() : new Set(rows.map((r) => r.id)));

  function runBatch() {
    setMsg(null);
    startTransition(async () => {
      const res = await reprocessMany([...sel]);
      if (res.ok) {
        setMsg(`${res.data!.count} video('s) opnieuw in de wachtrij gezet.`);
        setSel(new Set());
        router.refresh();
      } else {
        setMsg(res.message);
      }
    });
  }

  return (
    <div>
      {canRun && sel.size > 0 ? (
        <div className="mb-2 flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-brand-500)]/30 bg-[var(--color-brand-500)]/5 px-4 py-2.5">
          <span className="text-sm font-medium">{sel.size} geselecteerd</span>
          <Button size="sm" disabled={pending} onClick={runBatch}>
            <RefreshCw className="size-4" /> {pending ? "Bezig…" : "Opnieuw verwerken"}
          </Button>
          <button onClick={() => setSel(new Set())} className="text-sm text-[var(--color-ink-muted)] hover:underline">selectie wissen</button>
        </div>
      ) : null}
      {msg ? <p className="mb-2 text-sm text-[var(--color-ink-muted)]">{msg}</p> : null}

      <Table
        head={
          <>
            {canRun ? <th className="sc-th w-8"><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Alles selecteren" /></th> : null}
            <th className="sc-th">Video</th>
            <th className="sc-th">Klant</th>
            <th className="sc-th">Platform</th>
            <th className="sc-th">Duur</th>
            <th className="sc-th">Toegevoegd</th>
            <th className="sc-th">Status</th>
          </>
        }
      >
        {rows.map((r) => (
          <tr key={r.id} className="sc-row-link">
            {canRun ? (
              <td className="sc-td"><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Selecteer ${r.title ?? "video"}`} /></td>
            ) : null}
            <td className="sc-td">
              <Link href={`/video-intelligence/${r.id}`} className="font-medium hover:underline">{r.title || "Naamloze video"}</Link>
            </td>
            <td className="sc-td">
              <span className="flex items-center gap-2"><Avatar name={r.clientName} color={r.clientColor} size={22} />{r.clientName}</span>
            </td>
            <td className="sc-td text-[var(--color-ink-muted)]">{r.platform ? PLATFORM[r.platform]?.label ?? r.platform : "—"}</td>
            <td className="sc-td tabular-nums text-[var(--color-ink-muted)]">{r.durationMs ? msToClock(r.durationMs) : "—"}</td>
            <td className="sc-td text-[var(--color-ink-muted)]">{formatDate(r.createdAt)}</td>
            <td className="sc-td"><Badge tone={VI_STATUS[r.status]?.tone ?? "neutral"}>{VI_STATUS[r.status]?.label ?? r.status}</Badge></td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
