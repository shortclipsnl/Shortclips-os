"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Merge } from "lucide-react";
import { mergeDuplicateTasks } from "@/server/actions/task-dedup";

type Group = { clientName: string | null; title: string; count: number };

export function TaskDedupCard({ groups }: { groups: Group[] }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();

  if (groups.length === 0) {
    return (
      <div className="mb-6 rounded-[var(--radius-lg)] border border-[var(--color-good)]/25 bg-[var(--color-good-soft)]/40 px-4 py-3 text-sm">
        <strong className="font-semibold">Geen dubbele taken.</strong> De takenlijst bevat geen duidelijke dubbelingen meer.
      </div>
    );
  }

  const totalExtra = groups.reduce((n, g) => n + (g.count - 1), 0);

  return (
    <div className="mb-6 rounded-[var(--radius-lg)] border border-[var(--color-warn)]/30 bg-[var(--color-warn-soft)]/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold tracking-tight">Dubbele taken opschonen</h2>
          <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
            {groups.length} groep{groups.length === 1 ? "" : "en"} met dubbele open taken ({totalExtra} te sluiten). Per groep blijft de oudste staan; de rest wordt gesloten (blijft terugvindbaar).
          </p>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await mergeDuplicateTasks();
              setMsg(res.ok ? `✓ ${res.closed ?? 0} dubbele taken gesloten` : res.message ?? "Mislukt");
              if (res.ok) router.refresh();
            })
          }
          className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-ink)] px-3.5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Merge className="size-4" />}
          Samenvoegen ({totalExtra})
        </button>
      </div>

      <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto text-xs">
        {groups.slice(0, 20).map((g, i) => (
          <li key={i} className="flex items-center justify-between gap-2 rounded bg-[var(--color-surface)] px-2.5 py-1">
            <span className="min-w-0 truncate">{g.clientName ? `${g.clientName} · ` : ""}{g.title}</span>
            <span className="shrink-0 font-semibold text-[var(--color-warn)]">{g.count}×</span>
          </li>
        ))}
      </ul>
      {msg ? <p className="mt-2 text-xs font-medium text-[#14633a]">{msg}</p> : null}
    </div>
  );
}
