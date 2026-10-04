import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { db } from "@/db/client";
import { workflowStatuses } from "@/db/schema";
import { requirePermission } from "@/server/auth/context";
import { Badge, Card, CardHeader, Table } from "@/components/ui";

export const metadata: Metadata = { title: "Statussen" };
export const dynamic = "force-dynamic";

const DOMAIN_LABELS: Record<string, string> = {
  video: "Video pipeline",
  script: "Scripts",
  production: "Opnamedagen",
  publication: "Publicaties",
};

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
