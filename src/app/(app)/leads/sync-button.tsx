"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { syncLeadsFromMail } from "@/server/actions/leads";

function relative(iso: string | null): string {
  if (!iso) return "nog niet gesynchroniseerd";
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "zojuist";
  if (mins < 60) return `${mins} min geleden`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} uur geleden`;
  return d.toLocaleDateString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function SyncLeadsButton({ lastSyncAt, configured }: { lastSyncAt: string | null; configured: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();

  function run() {
    setMsg(null);
    start(async () => {
      const res = await syncLeadsFromMail();
      if (res.ok) { setMsg("Synchronisatie voltooid."); router.refresh(); }
      else setMsg(res.message ?? "Mislukt");
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
        title="Leest de mailmap 'Leads - Shortclips' uit en voegt nieuwe aanvragen toe"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Nu synchroniseren
      </button>
      <span className="text-2xs text-[var(--color-ink-faint)]">
        {configured ? `Laatste synchronisatie: ${relative(lastSyncAt)}` : "Gmail-koppeling nog niet ingesteld"}
      </span>
      {msg ? <span className="text-2xs text-[var(--color-ink-muted)]">{msg}</span> : null}
    </div>
  );
}
