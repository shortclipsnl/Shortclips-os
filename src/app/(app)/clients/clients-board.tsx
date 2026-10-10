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
  logoUrl: string | null;
  coordinatorName: string | null;
  nextShoot: string | null;
  inProduction: number;
  shortsPerMonth: number;
};

const STOPPED = new Set(["paused", "churned"]);

export function ClientsBoard({ clients, canWrite }: { clients: BoardClient[]; canWrite: boolean }) {
  const [q, setQ] = useState("");
  // Standaard alleen de actieve klanten; niet-actieve nemen pas ruimte in als je
  // daar bewust naar wisselt.
  const [view, setView] = useState<"active" | "inactive">("active");

  const { active, inactive } = useMemo(() => {
    const term = q.trim().toLowerCase();
    const match = (c: BoardClient) => !term || c.name.toLowerCase().includes(term);
    return {
      active: clients.filter((c) => !STOPPED.has(c.status) && match(c)),
      inactive: clients.filter((c) => STOPPED.has(c.status) && match(c)),
    };
  }, [clients, q]);

  const totalActive = useMemo(() => clients.filter((c) => !STOPPED.has(c.status)).length, [clients]);
  const totalInactive = clients.length - totalActive;
  const shown = view === "active" ? active : inactive;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {/* Wissel tussen actieve en niet-actieve klanten. */}
        <div className="inline-flex rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] p-0.5">
          {([
            { key: "active", label: "Actieve klanten", count: totalActive, dot: "var(--color-good)" },
            { key: "inactive", label: "Niet-actieve klanten", count: totalInactive, dot: "var(--color-bad)" },
          ] as const).map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setView(opt.key)}
              className={
                view === opt.key
                  ? "inline-flex items-center gap-2 rounded-[4px] bg-[var(--color-indigo-ink)] px-3 py-1.5 text-xs font-medium text-white"
                  : "inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
              }
            >
              <span className="size-2 rounded-full" style={{ background: opt.dot }} />
              {opt.label}
              <span className={`rounded-full px-1.5 text-2xs font-semibold ${view === opt.key ? "bg-white/20" : "bg-[var(--color-surface-2)]"}`}>{opt.count}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-2 md:min-w-64">
          <Search className="size-4 text-[var(--color-ink-faint)]" />
          <input
            className="w-full bg-transparent text-sm outline-none"
            placeholder="Zoek klant…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      {shown.length === 0 ? (
        <Empty />
      ) : (
        <div className="grid gap-2.5 md:grid-cols-2">
          {shown.map((c) => <ClientCard key={c.id} c={c} canWrite={canWrite} />)}
        </div>
      )}
    </div>
  );
}

function Empty() {
  return <p className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] px-4 py-10 text-center text-sm text-[var(--color-ink-faint)]">Geen klanten in deze weergave</p>;
}

function ClientCard({ c, canWrite }: { c: BoardClient; canWrite: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const stopped = STOPPED.has(c.status);

  return (
    <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2.5 hover:shadow-[var(--shadow-raised)]">
      {/* Statusindicator: groen = actief, rood = niet-actief. */}
      <span
        className="size-2.5 shrink-0 rounded-full"
        style={{ background: stopped ? "var(--color-bad)" : "var(--color-good)" }}
        title={stopped ? "Niet-actief" : "Actief"}
      />
      <Link href={`/clients/${c.slug}`} className="flex min-w-0 flex-1 items-center gap-3">
        {c.logoUrl ? (
          <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] p-0.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={c.logoUrl} alt="" className="max-h-full max-w-full object-contain" />
          </span>
        ) : (
          <Avatar name={c.name} color={c.color} size={34} />
        )}
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="truncate font-medium">{c.name}</span>
            {stopped ? (
              <Badge tone={CLIENT_STATUS[c.status]?.tone ?? "neutral"}>{CLIENT_STATUS[c.status]?.label ?? c.status}</Badge>
            ) : null}
          </span>
          <span className="mt-0.5 block truncate text-xs text-[var(--color-ink-muted)]">
            {c.shortsPerMonth > 0 ? `${c.shortsPerMonth} shorts/maand` : "shorts/maand onbekend"}
            {` · ${c.coordinatorName ?? "geen verantwoordelijke"}`}
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
