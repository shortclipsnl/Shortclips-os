"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Search } from "lucide-react";
import { Badge, ClientLogo } from "@/components/ui";
import { CLIENT_STATUS } from "@/lib/statuses";
import { formatDate } from "@/lib/format";
import { setClientStatus } from "@/server/actions/clients";

export type BoardClient = {
  id: string;
  slug: string;
  name: string;
  status: string;
  color: string | null;
  logoUrl: string | null;
  coordinatorId: string | null;
  coordinatorName: string | null;
  nextShoot: string | null;
  inProduction: number;
  shortsPerMonth: number;
  monthlyRevenue: number | null;
};

/** Kleine gekleurde chip voor scanbaarheid. */
function Chip({ children, tone }: { children: React.ReactNode; tone: "blue" | "indigo" | "amber" | "grey" | "green" }) {
  const cls = {
    blue: "bg-[var(--color-info-soft)] text-[#0060a8]",
    indigo: "bg-[var(--color-indigo-ink)] text-white",
    amber: "bg-[var(--color-warn-soft)] text-[#8a5300]",
    green: "bg-[var(--color-good-soft)] text-[#1d6b4c]",
    grey: "bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]",
  }[tone];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-medium ${cls}`}>{children}</span>;
}

const STOPPED = new Set(["paused", "churned"]);

export function ClientsBoard({ clients, viewerId, defaultPod = "alle" }: { clients: BoardClient[]; viewerId?: string; defaultPod?: "mijn" | "alle" }) {
  const [q, setQ] = useState("");
  // Standaard alleen de actieve klanten; niet-actieve nemen pas ruimte in als je
  // daar bewust naar wisselt.
  const [view, setView] = useState<"active" | "inactive">("active");
  // "Mijn klanten" = jouw pod (waar jij verantwoordelijke bent), met schakelaar
  // naar "Alle klanten". Standaard je eigen pod als je er een hebt.
  const [pod, setPod] = useState<"mijn" | "alle">(defaultPod);
  const myCount = useMemo(() => (viewerId ? clients.filter((c) => c.coordinatorId === viewerId).length : 0), [clients, viewerId]);
  const inPod = (c: BoardClient) => pod === "alle" || (!!viewerId && c.coordinatorId === viewerId);

  const { active, inactive } = useMemo(() => {
    const term = q.trim().toLowerCase();
    const match = (c: BoardClient) => (!term || c.name.toLowerCase().includes(term)) && inPod(c);
    return {
      active: clients.filter((c) => !STOPPED.has(c.status) && match(c)),
      inactive: clients.filter((c) => STOPPED.has(c.status) && match(c)),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients, q, pod, viewerId]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const totalActive = useMemo(() => clients.filter((c) => !STOPPED.has(c.status) && inPod(c)).length, [clients, pod, viewerId]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const totalInactive = useMemo(() => clients.filter((c) => STOPPED.has(c.status) && inPod(c)).length, [clients, pod, viewerId]);
  const shown = view === "active" ? active : inactive;

  return (
    <div>
      {/* Pod-schakelaar: eigen klanten vs. alle klanten (alleen als je een pod hebt). */}
      {viewerId && myCount > 0 ? (
        <div className="mb-3 inline-flex rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] p-0.5">
          {([
            { key: "mijn", label: "Mijn klanten", count: myCount },
            { key: "alle", label: "Alle klanten", count: clients.length },
          ] as const).map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setPod(opt.key)}
              className={
                pod === opt.key
                  ? "inline-flex items-center gap-2 rounded-[4px] bg-[var(--color-brand-600)] px-3 py-1.5 text-xs font-semibold text-white"
                  : "inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
              }
            >
              {opt.label}
              <span className={`rounded-full px-1.5 text-2xs font-semibold ${pod === opt.key ? "bg-white/20" : "bg-[var(--color-surface-2)]"}`}>{opt.count}</span>
            </button>
          ))}
        </div>
      ) : null}

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
          {shown.map((c) => <ClientCard key={c.id} c={c} />)}
        </div>
      )}
    </div>
  );
}

function Empty() {
  return <p className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] px-4 py-10 text-center text-sm text-[var(--color-ink-faint)]">Geen klanten in deze weergave</p>;
}

function ClientCard({ c }: { c: BoardClient }) {
  const stopped = STOPPED.has(c.status);
  const [pending, start] = useTransition();
  const router = useRouter();
  // Klik op het status-icoontje = actief ↔ niet-actief wisselen. Niet-actief
  // zetten we als "paused"; weer aan = "active".
  const toggle = () =>
    start(async () => {
      await setClientStatus(c.slug, stopped ? "active" : "paused");
      router.refresh();
    });

  return (
    <div className="flex min-w-0 items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2.5 hover:shadow-[var(--shadow-raised)]">
      {/* Klikbare statusindicator: groen = actief, rood = niet-actief. Klik om te wisselen. */}
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-label={stopped ? "Op actief zetten" : "Op niet-actief zetten"}
        title={stopped ? "Niet-actief — klik om te activeren" : "Actief — klik om op niet-actief te zetten"}
        className="grid size-6 shrink-0 place-items-center rounded-full transition hover:bg-[var(--color-surface-2)]"
      >
        {pending ? (
          <Loader2 className="size-3 animate-spin text-[var(--color-ink-faint)]" />
        ) : (
          <span className="size-2.5 rounded-full ring-2 ring-transparent" style={{ background: stopped ? "var(--color-bad)" : "var(--color-good)" }} />
        )}
      </button>
      <Link href={`/clients/${c.slug}`} className="flex min-w-0 flex-1 items-center gap-3">
        <ClientLogo name={c.name} logoUrl={c.logoUrl} color={c.color} size={52} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
            <Badge tone={CLIENT_STATUS[c.status]?.tone ?? "neutral"}>{CLIENT_STATUS[c.status]?.label ?? c.status}</Badge>
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-1">
            <Chip tone="blue">{c.shortsPerMonth > 0 ? `${c.shortsPerMonth} shorts/mnd` : "shorts ?"}</Chip>
            {c.inProduction > 0 ? <Chip tone="amber">{c.inProduction} lopend</Chip> : null}
            {c.nextShoot ? <Chip tone="green">opname {formatDate(c.nextShoot)}</Chip> : null}
            <Chip tone="grey">{c.coordinatorName ?? "geen verantwoordelijke"}</Chip>
          </span>
        </span>
      </Link>
    </div>
  );
}
