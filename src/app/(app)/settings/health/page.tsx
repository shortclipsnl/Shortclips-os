import type { Metadata } from "next";
import { desc, sql } from "drizzle-orm";
import { db, activeDriver } from "@/db/client";
import { errorLogs } from "@/db/schema";
import { requirePermission } from "@/server/auth/context";
import { Badge, Card, CardHeader, EmptyState, Stat, Table } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { env } from "@/lib/env";

export const metadata: Metadata = { title: "Systeemstatus" };
export const dynamic = "force-dynamic";

const CATEGORY_LABELS: Record<string, string> = {
  application: "Applicatie",
  integration: "Koppeling",
  auth: "Authenticatie",
  sync: "Synchronisatie",
  user: "Gebruiker",
  job: "Achtergrondtaak",
};

/** Reactietijd van de database meten, buiten de render om. */
async function measureDatabaseLatency(): Promise<number> {
  const started = Date.now();
  await db.execute(sql`select 1`);
  return Date.now() - started;
}

export default async function HealthPage() {
  await requirePermission("settings:read");

  const latency = await measureDatabaseLatency();

  const [counts, recent] = await Promise.all([
    db.execute(sql`
      select category, count(*)::int as aantal
      from error_logs
      where occurred_at >= now() - interval '7 days'
      group by category
      order by aantal desc
    `),
    db.select().from(errorLogs).orderBy(desc(errorLogs.occurredAt)).limit(30),
  ]);

  const categoryRows = ((counts as unknown as { rows?: Array<Record<string, unknown>> }).rows ??
    (counts as unknown as Array<Record<string, unknown>>)) as Array<{
    category: string;
    aantal: number;
  }>;
  const total = categoryRows.reduce((s, r) => s + Number(r.aantal), 0);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Database" value={`${latency} ms`} hint={activeDriver() === "pglite" ? "PGlite (ingebouwd)" : "PostgreSQL"} tone={latency < 100 ? "good" : "warn"} />
        <Stat label="Fouten (7 dagen)" value={total} tone={total === 0 ? "good" : total > 20 ? "bad" : "warn"} />
        <Stat label="Omgeving" value={env.NODE_ENV} />
        <Stat label="Geplande taken" value={env.CRON_SECRET ? "beveiligd" : "open"} tone={env.CRON_SECRET ? "good" : "warn"} />
      </div>

      {activeDriver() === "pglite" ? (
        <Card className="border-[var(--color-warn)]/30 bg-[var(--color-warn-soft)]/40">
          <p className="text-sm text-[#8a5300]">
            <strong className="font-semibold">Let op:</strong> deze installatie draait op
            PGlite, de ingebouwde Postgres. Die is bedoeld om lokaal te werken en
            ondersteunt één proces tegelijk. Voor productie hoort hier een echte
            Postgres (bijvoorbeeld Supabase) via <code className="font-mono">DATABASE_URL</code>.
          </p>
        </Card>
      ) : null}

      <Card padded={false}>
        <div className="p-5 pb-3">
          <CardHeader
            title="Recente fouten"
            subtitle="Technische details blijven hier; gebruikers zien alleen begrijpelijke meldingen."
          />
        </div>
        {recent.length === 0 ? (
          <EmptyState title="Geen fouten geregistreerd" />
        ) : (
          <Table
            head={
              <>
                <th className="sc-th">Wanneer</th>
                <th className="sc-th">Soort</th>
                <th className="sc-th">Bron</th>
                <th className="sc-th">Melding</th>
              </>
            }
          >
            {recent.map((e) => (
              <tr key={e.id}>
                <td className="sc-td whitespace-nowrap text-[var(--color-ink-muted)]">
                  {formatDateTime(e.occurredAt)}
                </td>
                <td className="sc-td">
                  <Badge tone={e.category === "integration" || e.category === "sync" ? "warn" : "bad"}>
                    {CATEGORY_LABELS[e.category] ?? e.category}
                  </Badge>
                </td>
                <td className="sc-td font-mono text-xs text-[var(--color-ink-muted)]">
                  {e.source ?? "—"}
                </td>
                <td className="sc-td max-w-md truncate">{e.message}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
