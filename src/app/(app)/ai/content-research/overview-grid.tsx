"use client";

import { useState } from "react";
import { Badge, Card, ClientLogo, EmptyState, LinkButton } from "@/components/ui";
import { StartResearchButton } from "./start-research-button";
import type { OverviewClient } from "@/server/content-research/service";

function fmtDate(iso: string | null): string {
  if (!iso) return "nog niet onderzocht";
  return new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });
}

const FILTERS: Array<{ key: "actief" | "nietactief" | "alle"; label: string }> = [
  { key: "actief", label: "Actieve klanten" },
  { key: "nietactief", label: "Niet-actief" },
  { key: "alle", label: "Alle" },
];

export function OverviewGrid({ clients, canWrite }: { clients: OverviewClient[]; canWrite: boolean }) {
  const [filter, setFilter] = useState<"actief" | "nietactief" | "alle">("actief");
  const counts = {
    actief: clients.filter((c) => c.active).length,
    nietactief: clients.filter((c) => !c.active).length,
    alle: clients.length,
  };
  const shown = clients.filter((c) => (filter === "actief" ? c.active : filter === "nietactief" ? !c.active : true));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" onClick={() => setFilter(f.key)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${filter === f.key ? "bg-[var(--color-brand-500)] text-white" : "border border-[var(--color-line)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}>
            {f.label}
            <span className={`rounded-full px-1.5 text-2xs tabular-nums ${filter === f.key ? "bg-white/20" : "bg-[var(--color-neutral-soft)]"}`}>{counts[f.key]}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <EmptyState title="Geen klanten" description={filter === "nietactief" ? "Er zijn geen niet-actieve klanten." : "Zodra er actieve klanten zijn, verschijnen ze hier."} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((c) => (
            <Card key={c.id} className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <ClientLogo name={c.name} logoUrl={c.logoUrl} color={c.color} size={36} />
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-[var(--color-ink)]">
                    {c.name}{!c.active ? <Badge tone="neutral">niet-actief</Badge> : null}
                  </p>
                  <p className="text-2xs text-[var(--color-ink-faint)]">Laatste onderzoek: {fmtDate(c.lastResearchAt)}</p>
                </div>
              </div>

              <div className="flex items-center gap-4 text-sm">
                <span className="tabular-nums"><span className="font-semibold text-[var(--color-ink)]">{c.totalIdeas}</span> <span className="text-[var(--color-ink-muted)]">ideeën</span></span>
                {c.newIdeas > 0 ? <Badge tone="info">{c.newIdeas} nieuw</Badge> : null}
                {c.running ? <Badge tone="info">Onderzoek bezig…</Badge> : null}
              </div>

              <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                <LinkButton href={`/ai/content-research/${c.id}?tab=ideeen`} variant="secondary" size="sm">Bekijk ideeën</LinkButton>
                {canWrite ? <StartResearchButton clientId={c.id} running={c.running} variant="ghost" /> : null}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
