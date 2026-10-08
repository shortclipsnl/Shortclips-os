"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Search } from "lucide-react";
import { setClientStatus } from "@/server/actions/clients";
import { Avatar, Badge } from "@/components/ui";
import { CLIENT_STATUS } from "@/lib/statuses";
import { formatDate } from "@/lib/format";

export type BoardClient = {
  id: string;
  slug: string;
  name: string;
  status: string;
  color: string | null;
  coordinatorName: string | null;
  nextShoot: string | null;
  inProduction: number;
};

const STOPPED = new Set(["paused", "churned"]);

export function ClientsBoard({ clients, canWrite }: { clients: BoardClient[]; canWrite: boolean }) {
  const [q, setQ] = useState("");

  const { active, inactive } = useMemo(() => {
    const term = q.trim().toLowerCase();
    const match = (c: BoardClient) => !term || c.name.toLowerCase().includes(term);
    return {
      active: clients.filter((c) => !STOPPED.has(c.status) && match(c)),
      inactive: clients.filter((c) => STOPPED.has(c.status) && match(c)),
    };
  }, [clients, q]);

  return (
    <div>
      <div className="mb-4 flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-2 md:max-w-sm">
        <Search className="size-4 text-[var(--color-ink-faint)]" />
        <input
          className="w-full bg-transparent text-sm outline-none"
          placeholder="Zoek klant…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Column title="Actieve klanten" count={active.length} tone="good">
          {active.map((c) => <ClientCard key={c.id} c={c} canWrite={canWrite} />)}
          {active.length === 0 ? <Empty /> : null}
        </Column>
        <Column title="Niet-actieve klanten" count={inactive.length} tone="neutral">
          {inactive.map((c) => <ClientCard key={c.id} c={c} canWrite={canWrite} />)}
          {inactive.length === 0 ? <Empty /> : null}
        </Column>
      </div>
    </div>
  );
}

function Column({ title, count, tone, children }: { title: string; count: number; tone: "good" | "neutral"; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <Badge tone={tone}>{count}</Badge>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Empty() {
  return <p className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] px-4 py-6 text-center text-sm text-[var(--color-ink-faint)]">Geen klanten</p>;
}

function ClientCard({ c, canWrite }: { c: BoardClient; canWrite: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const stopped = STOPPED.has(c.status);

  return (
    <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2.5 hover:shadow-[var(--shadow-raised)]">
      <Link href={`/clients/${c.slug}`} className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar name={c.name} color={c.color} size={34} />
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="truncate font-medium">{c.name}</span>
            <Badge tone={CLIENT_STATUS[c.status]?.tone ?? "neutral"}>{CLIENT_STATUS[c.status]?.label ?? c.status}</Badge>
          </span>
          <span className="mt-0.5 block truncate text-xs text-[var(--color-ink-muted)]">
            {c.coordinatorName ?? "geen verantwoordelijke"}
            {c.inProduction > 0 ? ` · ${c.inProduction} lopend` : ""}
            {c.nextShoot ? ` · opname ${formatDate(c.nextShoot)}` : ""}
          </span>
        </span>
      </Link>
      {canWrite ? (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await setClientStatus(c.slug, stopped ? "active" : "churned");
              router.refresh();
            })
          }
          className="shrink-0 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2.5 py-1 text-xs font-medium text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)]"
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : stopped ? "Activeren" : "Op inactief"}
        </button>
      ) : null}
    </div>
  );
}
