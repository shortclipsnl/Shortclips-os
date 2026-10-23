"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { setResearchStatus, coupleResearchToClient } from "@/server/actions/sales-research";
import { RESEARCH_STATUSES, RESEARCH_STATUS_LABEL } from "@/lib/sales-research";

type ClientOpt = { id: string; name: string };

/** Dossierstatus + koppeling aan een bestaande klant (wanneer de prospect klant wordt). */
export function StatusBar({ id, status, clientId, clients }: { id: string; status: string; clientId: string | null; clients: ClientOpt[] }) {
  const [pending, start] = useTransition();
  const router = useRouter();

  const changeStatus = (s: string) => start(async () => { await setResearchStatus(id, s); router.refresh(); });
  const changeClient = (cid: string) => start(async () => { await coupleResearchToClient(id, cid || null); router.refresh(); });

  // "klaar" (oude waarde) tonen als onderzoek_afgerond in de keuzelijst.
  const current = status === "klaar" ? "onderzoek_afgerond" : status;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-2)] p-3">
      {pending ? <Loader2 className="size-4 animate-spin text-[var(--color-ink-faint)]" /> : null}
      <label className="flex items-center gap-2 text-sm">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Status</span>
        <select className="sc-input h-8 w-auto py-0 text-xs" value={current} onChange={(e) => changeStatus(e.target.value)} disabled={pending}>
          {RESEARCH_STATUSES.map((s) => <option key={s} value={s}>{RESEARCH_STATUS_LABEL[s]}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Gekoppelde klant</span>
        <select className="sc-input h-8 w-auto py-0 text-xs" value={clientId ?? ""} onChange={(e) => changeClient(e.target.value)} disabled={pending}>
          <option value="">— niet gekoppeld —</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
    </div>
  );
}
