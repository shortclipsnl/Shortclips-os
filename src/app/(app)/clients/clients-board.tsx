"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, Check, Clapperboard, Film, Search, UserRound, Users } from "lucide-react";
import { ClientLogo, TeamAvatar } from "@/components/ui";
import { type DocButtonSlot } from "@/components/client-docs/doc-buttons";

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
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {shown.map((c) => <ClientCard key={c.id} c={c} />)}
        </div>
      )}
    </div>
  );
}

function Empty() {
  return <p className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] px-4 py-10 text-center text-sm text-[var(--color-ink-faint)]">Geen klanten in deze weergave</p>;
}

/** Compacte klantkaart: alleen wat het team dagelijks nodig heeft. Status,
 *  lopende video's, opnamedatum en contractmoment staan op de klantpagina;
 *  actief/niet-actief wisselen gaat via Klant bewerken of Klantenbeheer. */
function ClientCard({ c }: { c: BoardClient }) {
  const btn =
    "inline-flex min-h-[40px] min-w-0 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border px-2 text-xs font-medium transition";
  const live = `${btn} border-[var(--color-line-strong)] bg-[var(--color-surface-sunken)] text-[var(--color-ink)] hover:border-[var(--color-ink)]`;
  return (
    <div className="flex min-w-0 flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4 transition hover:shadow-[var(--shadow-raised)]">
      <Link href={`/clients/${c.slug}`} className="flex min-w-0 items-center gap-3">
        <ClientLogo name={c.name} logoUrl={c.logoUrl} color={c.color} size={48} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold">{c.name}</span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-[var(--color-ink-muted)]">
            <UserRound className="size-3.5 shrink-0" strokeWidth={1.75} />
            <span className="truncate">{c.coordinatorName ?? "Geen contactpersoon"}</span>
          </span>
        </span>
        <span className="shrink-0 text-right" title="Shorts per maand">
          <span className="block text-2xl font-bold leading-none">{c.shortsPerMonth > 0 ? c.shortsPerMonth : "?"}</span>
          <span className="mt-1 block text-2xs text-[var(--color-ink-muted)]">shorts p/m</span>
        </span>
      </Link>
      <div className="grid grid-cols-3 gap-2">
        {c.docs.map((s) => {
          const Icon = s.kind === "klanten_guide" ? BookOpen : Clapperboard;
          return s.url ? (
            <a key={s.kind} href={s.url} target="_blank" rel="noopener noreferrer" title={`${s.label} openen (PDF)`} className={live}>
              <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
              <span className="truncate">{s.label}</span>
            </a>
          ) : (
            <span key={s.kind} title={`${s.label} is nog niet geüpload`} className={`${btn} cursor-not-allowed border-dashed border-[var(--color-line-strong)] text-[var(--color-ink-faint)]`}>
              <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
              <span className="truncate">{s.label}</span>
            </span>
          );
        })}
        <Link href={`/clients/${c.slug}/videos`} title="Alle short video's van deze klant per opnamesessie" className={live}>
          <Film className="size-3.5 shrink-0" strokeWidth={1.75} />
          <span className="truncate">Video&apos;s</span>
        </Link>
      </div>
    </div>
  );
}
