import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { automationRules, automationRuns } from "@/db/schema";
import { requirePermission } from "@/server/auth/context";
import { Badge, Card, CardHeader, EmptyState, Table } from "@/components/ui";
import { formatDateTime, relativeDays } from "@/lib/format";

export const metadata: Metadata = { title: "Automatiseringen" };
export const dynamic = "force-dynamic";

const TRIGGER_LABELS: Record<string, string> = {
  "video.status_changed": "Video verandert van status",
  "script.status_changed": "Script verandert van status",
  "frameio.asset_approved": "Frame.io-goedkeuring",
  "frameio.comment_created": "Nieuwe Frame.io-opmerking",
  "schedule.daily": "Dagelijks",
  "schedule.hourly": "Elk uur",
};

export default async function AutomationsPage() {
  await requirePermission("automations:read");

  const [rules, runs] = await Promise.all([
    db.select().from(automationRules).orderBy(desc(automationRules.isEnabled), automationRules.name),
    db
      .select({
        id: automationRuns.id,
        status: automationRuns.status,
        triggerEvent: automationRuns.triggerEvent,
        createdAt: automationRuns.createdAt,
        error: automationRuns.error,
        ruleName: automationRules.name,
      })
      .from(automationRuns)
      .innerJoin(automationRules, eq(automationRules.id, automationRuns.ruleId))
      .orderBy(desc(automationRuns.createdAt))
      .limit(20),
  ]);

  return (
    <div className="space-y-5">
      <Card>
        <p className="text-sm text-[var(--color-ink-muted)]">
          Automatiseringen bestaan uit een trigger, voorwaarden en acties. Ze
          staan in de database, niet in de code — regels kunnen dus worden
          aangepast zonder nieuwe versie. Elke uitvoering wordt vastgelegd.
        </p>
      </Card>

      <div className="space-y-3">
        {rules.map((rule) => (
          <Card key={rule.id}>
            <CardHeader
              title={rule.name}
              subtitle={rule.description}
              action={
                <span className="flex items-center gap-2">
                  <Badge tone="neutral">{TRIGGER_LABELS[rule.trigger] ?? rule.trigger}</Badge>
                  <Badge tone={rule.isEnabled ? "good" : "neutral"}>
                    {rule.isEnabled ? "actief" : "uit"}
                  </Badge>
                </span>
              }
            />
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-[var(--color-ink-muted)]">
              <span>
                Acties:{" "}
                {(rule.actions as Array<{ type: string }>).map((a) => a.type).join(", ")}
              </span>
              <span>{rule.runCount}× uitgevoerd</span>
              {rule.lastRunAt ? <span>laatst {relativeDays(rule.lastRunAt)}</span> : null}
            </div>
          </Card>
        ))}
      </div>

      <Card padded={false}>
        <div className="p-5 pb-3">
          <CardHeader title="Recente uitvoeringen" />
        </div>
        {runs.length === 0 ? (
          <EmptyState
            title="Nog niets uitgevoerd"
            description="Automatiseringen starten zodra er een bijbehorende gebeurtenis plaatsvindt."
          />
        ) : (
          <Table
            head={
              <>
                <th className="sc-th">Regel</th>
                <th className="sc-th">Trigger</th>
                <th className="sc-th">Status</th>
                <th className="sc-th">Wanneer</th>
              </>
            }
          >
            {runs.map((r) => (
              <tr key={r.id}>
                <td className="sc-td font-medium">{r.ruleName}</td>
                <td className="sc-td text-[var(--color-ink-muted)]">
                  {TRIGGER_LABELS[r.triggerEvent] ?? r.triggerEvent}
                </td>
                <td className="sc-td">
                  <Badge tone={r.status === "success" ? "good" : r.status === "error" ? "bad" : "info"}>
                    {r.status === "success" ? "gelukt" : r.status === "error" ? "fout" : r.status}
                  </Badge>
                  {r.error ? (
                    <span className="ml-2 text-xs text-[var(--color-ink-muted)]">{r.error}</span>
                  ) : null}
                </td>
                <td className="sc-td text-[var(--color-ink-muted)]">{formatDateTime(r.createdAt)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
