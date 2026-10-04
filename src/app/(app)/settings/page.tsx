import type { Metadata } from "next";
import { sql } from "drizzle-orm";
import { db, activeDriver } from "@/db/client";
import { requireInternal } from "@/server/auth/context";
import { Card, CardHeader, Stat } from "@/components/ui";
import { env } from "@/lib/env";

export const metadata: Metadata = { title: "Instellingen" };
export const dynamic = "force-dynamic";

export default async function SettingsOverviewPage() {
  const viewer = await requireInternal();

  const counts = await db.execute(sql`
    select
      (select count(*) from users where deleted_at is null)::int as gebruikers,
      (select count(*) from clients where deleted_at is null)::int as klanten,
      (select count(*) from automation_rules where is_enabled = true and deleted_at is null)::int as automatiseringen,
      (select count(*) from integration_connections where status = 'connected')::int as koppelingen
  `);
  const row = ((counts as unknown as { rows?: Array<Record<string, number>> }).rows ??
    (counts as unknown as Array<Record<string, number>>))[0] ?? {};

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Gebruikers" value={Number(row.gebruikers ?? 0)} href="/settings/users" />
        <Stat label="Klanten" value={Number(row.klanten ?? 0)} href="/clients" />
        <Stat label="Actieve automatiseringen" value={Number(row.automatiseringen ?? 0)} href="/settings/automations" />
        <Stat label="Verbonden koppelingen" value={Number(row.koppelingen ?? 0)} href="/settings/integrations" />
      </div>

      <Card>
        <CardHeader title="Omgeving" subtitle="Hoe deze installatie nu draait." />
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <Row label="Omgeving" value={env.NODE_ENV} />
          <Row label="Applicatie-URL" value={env.APP_URL} />
          <Row label="Database" value={activeDriver() === "pglite" ? "PGlite (ingebouwd, lokaal)" : "PostgreSQL"} />
          <Row label="Sessiegeheim" value={env.SESSION_SECRET ? "ingesteld" : "ontwikkelwaarde"} />
          <Row label="AI-samenvattingen" value={env.ANTHROPIC_API_KEY ? "ingeschakeld" : "uitgeschakeld"} />
          <Row label="Geplande taken" value={env.CRON_SECRET ? "beveiligd" : "geen CRON_SECRET ingesteld"} />
        </dl>
      </Card>

      <Card>
        <CardHeader title="Jouw rechten" subtitle={`${viewer.permissions.size} rechten actief`} />
        <div className="mt-3 flex flex-wrap gap-1.5">
          {[...viewer.permissions].sort().map((p) => (
            <code
              key={p}
              className="rounded bg-[var(--color-surface-sunken)] px-1.5 py-0.5 font-mono text-2xs text-[var(--color-ink-muted)]"
            >
              {p}
            </code>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[var(--color-line)] pb-2">
      <dt className="text-[var(--color-ink-muted)]">{label}</dt>
      <dd className="truncate font-medium">{value}</dd>
    </div>
  );
}
