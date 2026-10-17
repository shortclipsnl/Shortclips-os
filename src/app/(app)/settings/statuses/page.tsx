import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { db } from "@/db/client";
import { workflowStatuses } from "@/db/schema";
import { requirePermission } from "@/server/auth/context";
import { Badge, Card, CardHeader, Table } from "@/components/ui";
import {
  STATUS_TO_PHASE,
  VIDEO_PHASE_META,
  VIDEO_PHASE_ORDER,
  VIDEO_STATUS,
  type VideoPhase,
  type VideoStage,
} from "@/lib/statuses";

export const metadata: Metadata = { title: "Statussen" };
export const dynamic = "force-dynamic";

const DOMAIN_LABELS: Record<string, string> = {
  video: "Video pipeline",
  script: "Scripts",
  production: "Opnamedagen",
  publication: "Publicaties",
};

/** Alle fases in weergavevolgorde, met de terminale "Live" achteraan. */
const PHASES: VideoPhase[] = [...VIDEO_PHASE_ORDER, "live"];

/** Welke interne statussen vouwen samen tot elke fase (omgekeerde van STATUS_TO_PHASE). */
function statusesForPhase(phase: VideoPhase): VideoStage[] {
  return (Object.keys(STATUS_TO_PHASE) as VideoStage[]).filter((s) => STATUS_TO_PHASE[s] === phase);
}

export default async function StatusesPage() {
  await requirePermission("settings:read");

  const rows = await db
    .select()
    .from(workflowStatuses)
    .orderBy(asc(workflowStatuses.domain), asc(workflowStatuses.sortOrder));

  const domains = [...new Set(rows.map((r) => r.domain))];

  return (
    <div className="space-y-5">
      <Card>
        <p className="text-sm text-[var(--color-ink-muted)]">
          Statussen bepalen de volgorde in de pipeline, de kleur in de interface,
          of de klant ze ziet, en binnen hoeveel uur een stap afgerond hoort te
          zijn. Overschrijding van die streeftijd kleurt de rij en voedt de
          signalering op het dashboard.
        </p>
      </Card>

      {/* Productiefasen — de 13 videostatussen vouwen samen tot één fasemodel
          (#4). Deze namen en kleuren zijn overal in de app gelijk; de losse
          statussen hieronder blijven bestaan voor de "Volgende stap"-besturing. */}
      <Card padded={false}>
        <div className="p-5 pb-3">
          <CardHeader
            title="Productiefasen"
            subtitle="Elke video doorloopt dezelfde zeven fasen (plus de terminale fase Live). De onderliggende statussen vallen vast in één fase — overal in de app dezelfde naam en kleur."
          />
        </div>
        <Table
          head={
            <>
              <th className="sc-th">#</th>
              <th className="sc-th">Fase</th>
              <th className="sc-th">Omvat deze statussen</th>
            </>
          }
        >
          {PHASES.map((phase, i) => {
            const statuses = statusesForPhase(phase);
            return (
              <tr key={phase}>
                <td className="sc-td tabular-nums text-[var(--color-ink-muted)]">
                  {phase === "live" ? "–" : i + 1}
                </td>
                <td className="sc-td">
                  <Badge tone={VIDEO_PHASE_META[phase].tone}>{VIDEO_PHASE_META[phase].label}</Badge>
                </td>
                <td className="sc-td">
                  {statuses.length === 0 ? (
                    <span className="text-xs text-[var(--color-ink-faint)]">
                      vóór de opname — nog geen video (geplande opnamedag)
                    </span>
                  ) : (
                    <span className="flex flex-wrap gap-1.5">
                      {statuses.map((s) => (
                        <span
                          key={s}
                          className="rounded-[var(--radius-sm)] bg-[var(--color-surface-sunken)] px-2 py-0.5 text-xs text-[var(--color-ink-muted)]"
                        >
                          {VIDEO_STATUS[s].label}
                        </span>
                      ))}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      </Card>

      {domains.map((domain) => (
        <Card key={domain} padded={false}>
          <div className="p-5 pb-3">
            <CardHeader title={DOMAIN_LABELS[domain] ?? domain} />
          </div>
          <Table
            head={
              <>
                <th className="sc-th">Volgorde</th>
                <th className="sc-th">Label</th>
                <th className="sc-th">Sleutel</th>
                <th className="sc-th">Kleur</th>
                <th className="sc-th">Zichtbaar voor klant</th>
                <th className="sc-th text-right">Streeftijd</th>
              </>
            }
          >
            {rows
              .filter((r) => r.domain === domain)
              .map((r) => (
                <tr key={r.id}>
                  <td className="sc-td tabular-nums text-[var(--color-ink-muted)]">
                    {r.sortOrder}
                  </td>
                  <td className="sc-td font-medium">{r.label}</td>
                  <td className="sc-td font-mono text-xs text-[var(--color-ink-muted)]">{r.key}</td>
                  <td className="sc-td">
                    <span className="flex items-center gap-2">
                      <span
                        className="size-3 rounded-full border border-[var(--color-line)]"
                        style={{ background: r.color ?? "#ccc" }}
                      />
                      <span className="font-mono text-xs text-[var(--color-ink-muted)]">
                        {r.color}
                      </span>
                    </span>
                  </td>
                  <td className="sc-td">
                    <Badge tone={r.isClientVisible ? "lime" : "neutral"}>
                      {r.isClientVisible ? "ja" : "nee"}
                    </Badge>
                  </td>
                  <td className="sc-td text-right tabular-nums text-[var(--color-ink-muted)]">
                    {r.slaHours ? `${r.slaHours} uur` : "—"}
                  </td>
                </tr>
              ))}
          </Table>
        </Card>
      ))}
    </div>
  );
}
