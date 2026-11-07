import type { Metadata } from "next";
import { and, inArray, isNull, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { requirePermission } from "@/server/auth/context";
import { PageHeader } from "@/components/ui";
import { getOpsSettings, resolveEscalationPeople } from "@/server/ops-control/settings";
import { recentRuns } from "@/server/ops-control/run";
import { OpsSettingsForm } from "./form";

export const metadata: Metadata = { title: "Operationele controle" };
export const dynamic = "force-dynamic";

export default async function OpsControlSettingsPage() {
  await requirePermission("settings:write");
  const [settings, people, runs, staff] = await Promise.all([
    getOpsSettings(),
    resolveEscalationPeople(),
    recentRuns(8),
    db.select({ id: users.id, fullName: users.fullName }).from(users)
      .where(and(isNull(users.deletedAt), eq(users.status, "active"), inArray(users.primaryRole, ["owner", "admin", "operational_manager", "project_coordinator", "content_creator", "videographer"])))
      .orderBy(sql`${users.fullName}`),
  ]);

  return (
    <div className="mx-auto max-w-[820px] space-y-6">
      <PageHeader
        title="Operationele controle"
        description="Twee vaste controles per werkdag. De Hub kijkt zelf naar scripting, editing, klantfeedback, klantcommunicatie, opnames, deadlines en taken, maakt taken aan voor de verantwoordelijke en escaleert wat blijft liggen."
      />
      <OpsSettingsForm
        initial={settings}
        staff={staff.map((s) => ({ id: s.id, name: s.fullName }))}
        resolved={{ leadId: people.leadId, backupId: people.backupId }}
      />
      <section>
        <h2 className="mb-2 text-sm font-semibold text-[var(--color-ink)]">Laatste controles</h2>
        <ul className="divide-y divide-[var(--color-line)] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm">
          {runs.length === 0 ? <li className="px-4 py-3 text-[var(--color-ink-muted)]">Nog geen controles uitgevoerd.</li> : null}
          {runs.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
              <span className="w-40 tabular-nums">{r.startedAt.toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
              <span className="w-20 text-[var(--color-ink-muted)]">{r.slot}</span>
              <span className={r.status === "success" ? "text-[var(--color-good)]" : r.status === "running" ? "text-[var(--color-ink-muted)]" : "text-[var(--color-bad)]"}>{r.status === "success" ? "Gelukt" : r.status === "running" ? "Bezig" : "Mislukt"}</span>
              {r.summary ? (
                <span className="text-xs text-[var(--color-ink-muted)]">
                  {r.summary.open} open · {r.summary.created} nieuw · {r.summary.resolvedAuto} opgelost · {r.summary.reopened} heropend · {r.summary.escalated} geëscaleerd · {r.summary.notified} meldingen
                  {r.summary.errors.length ? ` · ${r.summary.errors.length} bron(nen) niet bereikbaar` : ""}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
