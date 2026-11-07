"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Loader2, Search, Users } from "lucide-react";
import { ClientLogo, TeamAvatar } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { setClientStatus } from "@/server/actions/clients";
import { ClientDocButtons, type DocButtonSlot } from "@/components/client-docs/doc-buttons";

export type BoardClient = {
  id: string;
  slug: string;
  name: string;
  status: string;
  color: string | null;
  logoUrl: string | null;
  coordinatorId: string | null;
  coordinatorName: string | null;
  coordinatorAvatar: string | null;
  nextShoot: string | null;
  inProduction: number;
  shortsPerMonth: number;
  monthlyRevenue: number | null;
  /** Klanten Guide + Editing Guide uit de centrale bron. */
  docs: DocButtonSlot[];
  /** Klantgezondheid (tevredenheid) en, apart, het contractmoment. */
  health?: { status: "gezond" | "aandacht" | "direct"; reasons: string[]; commercial: { label: string; tone: "neutraal" | "aandacht" | "urgent" } | null } | null;
};

const HEALTH = {
  gezond: { label: "Gezond", dot: "var(--color-good)", cls: "bg-[var(--color-good-soft)] text-[#1d6b4c]" },
  aandacht: { label: "Aandacht nodig", dot: "var(--color-warn)", cls: "bg-[var(--color-warn-soft)] text-[#8a5300]" },
  direct: { label: "Directe aandacht", dot: "var(--color-bad)", cls: "bg-[var(--color-bad-soft)] text-[#a3271c]" },
} as const;

/** Status met de redenen als tooltip (de hele kaart linkt al naar de klant). */
function HealthChip({ h }: { h: NonNullable<BoardClient["health"]> }) {
  const s = HEALTH[h.status];
  return (
    <>
      <span title={h.reasons.join("\n")} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-medium ${s.cls}`}>
        <span className="size-1.5 rounded-full" style={{ background: s.dot }} />{s.label}
      </span>
      {h.commercial ? (
        <span title="Contractmoment (commercieel, staat los van tevredenheid)" className={`inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-medium ${h.commercial.tone === "urgent" ? "bg-[var(--color-bad-soft)] text-[#a3271c]" : h.commercial.tone === "aandacht" ? "bg-[var(--color-warn-soft)] text-[#8a5300]" : "bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]"}`}>{h.commercial.label}</span>
      ) : null}
    </>
  );
}

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

export function ClientsBoard({ clients, viewerId, defaultPod = "alle", coveringNames = [] }: { clients: BoardClient[]; viewerId?: string; defaultPod?: "mijn" | "alle"; coveringIds?: string[]; coveringNames?: string[] }) {
  const [q, setQ] = useState("");
  // Standaard alleen de actieve klanten; niet-actieve nemen pas ruimte in als je
  // daar bewust naar wisselt.
  const [view, setView] = useState<"active" | "inactive">("active");
  // Filter op verantwoordelijke via de avatars: null = iedereen, anders de
  // coordinatorId van die persoon. Standaard je eigen klanten als je er hebt.
  const viewerHasClients = !!viewerId && clients.some((c) => c.coordinatorId === viewerId);
  const [person, setPerson] = useState<string | null>(defaultPod === "mijn" && viewerHasClients ? viewerId! : null);

  // De verantwoordelijken (met hun klantentelling) voor de avatar-rij — jijzelf
  // vooraan, daarna op aantal klanten.
  const coordinators = useMemo(() => {
    const m = new Map<string, { id: string; name: string; avatar: string | null; count: number }>();
    for (const c of clients) {
      if (!c.coordinatorId) continue;
      const e = m.get(c.coordinatorId) ?? { id: c.coordinatorId, name: c.coordinatorName ?? "?", avatar: c.coordinatorAvatar, count: 0 };
      e.count++;
      m.set(c.coordinatorId, e);
    }
    return [...m.values()].sort((a, b) => (a.id === viewerId ? -1 : b.id === viewerId ? 1 : 0) || b.count - a.count || a.name.localeCompare(b.name));
  }, [clients, viewerId]);

  const inPerson = (c: BoardClient) => person === null || c.coordinatorId === person;

  const { active, inactive } = useMemo(() => {
    const term = q.trim().toLowerCase();
    const match = (c: BoardClient) => (!term || c.name.toLowerCase().includes(term)) && inPerson(c);
    return {
      active: clients.filter((c) => !STOPPED.has(c.status) && match(c)),
      inactive: clients.filter((c) => STOPPED.has(c.status) && match(c)),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients, q, person]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const totalActive = useMemo(() => clients.filter((c) => !STOPPED.has(c.status) && inPerson(c)).length, [clients, person]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const totalInactive = useMemo(() => clients.filter((c) => STOPPED.has(c.status) && inPerson(c)).length, [clients, person]);
  const shown = view === "active" ? active : inactive;
  const firstName = (n: string) => n.split(" ")[0] ?? n;

  return (
    <div>
      {coveringNames.length > 0 ? (
        <div className="mb-3 flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-info)]/25 bg-[var(--color-info-soft)]/60 px-3 py-2 text-xs text-[var(--color-ink)]">
          🤝 Je vervangt <strong>{coveringNames.join(", ")}</strong> — hun klanten staan nu ook bij &ldquo;Mijn klanten&rdquo;.
        </div>
      ) : null}

      {/* Verantwoordelijke-filter: grotere, goed aanklikbare avatars zodat je in
          één oogopslag ziet wie verantwoordelijk is. Klik om op die persoon te
          filteren; de geselecteerde springt eruit (navy + ring + vinkje). */}
      {coordinators.length > 0 ? (
        <div className="mb-4">
          <p className="mb-2 text-xs font-medium text-[var(--color-ink-faint)]">Verantwoordelijke — klik om te filteren</p>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => setPerson(null)}
              aria-pressed={person === null}
              className={`inline-flex min-h-[44px] items-center gap-2 rounded-full px-4 text-sm font-medium transition ${person === null
                ? "bg-[var(--color-indigo-ink)] text-white ring-2 ring-[var(--color-brand-400)]"
                : "border border-[var(--color-line-strong)] text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-ink)]"}`}
            >
              <Users className="size-5 shrink-0" strokeWidth={1.75} />
              Iedereen
              <span className={`rounded-full px-1.5 text-2xs font-semibold ${person === null ? "bg-white/20" : "bg-[var(--color-surface-2)]"}`}>{clients.length}</span>
            </button>
            {coordinators.map((p) => {
              const sel = person === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPerson(sel ? null : p.id)}
                  aria-pressed={sel}
                  title={sel ? "Filter uitzetten" : `Toon klanten van ${p.name}`}
                  className={`inline-flex min-h-[44px] items-center gap-2.5 rounded-full py-1 pl-1 pr-4 text-sm font-medium transition ${sel
                    ? "bg-[var(--color-indigo-ink)] text-white ring-2 ring-[var(--color-brand-400)]"
                    : "border border-[var(--color-line-strong)] text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-ink)]"}`}
                >
                  <span className="relative shrink-0">
                    <span className={`block overflow-hidden rounded-full ${sel ? "ring-2 ring-white/80" : "ring-1 ring-[var(--color-line)]"}`}>
                      <TeamAvatar name={p.name} avatarUrl={p.avatar} size={40} />
                    </span>
                    {sel ? (
                      <span className="absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-[var(--color-good)] ring-2 ring-[var(--color-indigo-ink)]">
                        <Check className="size-2.5 text-white" strokeWidth={3} />
                      </span>
                    ) : null}
                  </span>
                  <span className="whitespace-nowrap">{firstName(p.name)}{p.id === viewerId ? " (jij)" : ""}</span>
                  <span className={`rounded-full px-1.5 text-2xs font-semibold ${sel ? "bg-white/20" : "bg-[var(--color-surface-2)]"}`}>{p.count}</span>
                </button>
              );
            })}
          </div>
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
    <div className="min-w-0 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2.5 hover:shadow-[var(--shadow-raised)]">
    <div className="flex min-w-0 items-center gap-3">
      <Link href={`/clients/${c.slug}`} className="flex min-w-0 flex-1 items-center gap-3">
        <ClientLogo name={c.name} logoUrl={c.logoUrl} color={c.color} size={52} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{c.name}</span>
          <span className="mt-1 flex flex-wrap items-center gap-1">
            {c.health && !stopped ? <HealthChip h={c.health} /> : null}
            <Chip tone="blue">{c.shortsPerMonth > 0 ? `${c.shortsPerMonth} shorts/mnd` : "shorts ?"}</Chip>
            {c.inProduction > 0 ? <Chip tone="amber">{c.inProduction} lopend</Chip> : null}
            {c.nextShoot ? <Chip tone="green">opname {formatDate(c.nextShoot)}</Chip> : null}
            <Chip tone="grey">{c.coordinatorName ?? "geen verantwoordelijke"}</Chip>
          </span>
        </span>
      </Link>
      {/* Duidelijke klikbare schakelaar rechts: Actief ↔ Niet actief. */}
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-label={stopped ? "Op actief zetten" : "Op niet-actief zetten"}
        title={stopped ? "Niet actief — klik om te activeren" : "Actief — klik om op niet-actief te zetten"}
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
          stopped
            ? "bg-[var(--color-bad-soft)] text-[#a3271c] hover:brightness-95"
            : "bg-[var(--color-good-soft)] text-[#1d6b4c] hover:brightness-95"
        }`}
      >
        {pending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <span className="size-2 rounded-full" style={{ background: stopped ? "var(--color-bad)" : "var(--color-good)" }} />
        )}
        {stopped ? "Niet actief" : "Actief"}
      </button>
    </div>
      {/* De twee vaste PDF's van deze klant, direct te openen. */}
      {c.docs.length > 0 ? <ClientDocButtons slots={c.docs} size="xs" className="mt-2 pl-[64px]" /> : null}
    </div>
  );
}
