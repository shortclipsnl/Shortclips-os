import type { Metadata } from "next";
import { desc } from "drizzle-orm";
import {
  AlertCircle,
  CheckCircle2,
  CircleDashed,
} from "lucide-react";
import { db } from "@/db/client";
import { syncJobs, integrationEvents } from "@/db/schema";
import { requirePermission } from "@/server/auth/context";
import { integrationHealth } from "@/server/integrations/registry";
import { appointmentReviewStats, unmatchedAppointments } from "@/server/appointments";
import { env } from "@/lib/env";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Table } from "@/components/ui";
import { formatDateTime, relativeDays } from "@/lib/format";
import { INTEGRATION_LABEL } from "@/lib/statuses";
import { JobButton, TestButton } from "./actions-ui";

export const metadata: Metadata = { title: "Koppelingen" };
export const dynamic = "force-dynamic";

const STATUS_META: Record<string, { label: string; tone: "good" | "warn" | "bad" | "neutral" }> = {
  connected: { label: "Verbonden", tone: "good" },
  degraded: { label: "Instabiel", tone: "warn" },
  disconnected: { label: "Verbroken", tone: "bad" },
  error: { label: "Fout", tone: "bad" },
  not_configured: { label: "Nog niet ingesteld", tone: "neutral" },
};

export default async function IntegrationsPage() {
  const viewer = await requirePermission("integrations:read");
  const health = await integrationHealth();
  const canWrite = viewer.permissions.has("integrations:write");

  const [recentJobs, recentEvents] = await Promise.all([
    db.select({
      id: syncJobs.id, provider: syncJobs.provider, jobType: syncJobs.jobType,
      status: syncJobs.status, startedAt: syncJobs.startedAt, finishedAt: syncJobs.finishedAt,
      itemsProcessed: syncJobs.itemsProcessed, itemsCreated: syncJobs.itemsCreated,
      itemsUpdated: syncJobs.itemsUpdated, itemsFailed: syncJobs.itemsFailed,
      error: syncJobs.error,
    }).from(syncJobs).orderBy(desc(syncJobs.createdAt)).limit(15),

    db.select({
      id: integrationEvents.id, provider: integrationEvents.provider,
      eventType: integrationEvents.eventType, status: integrationEvents.status,
      receivedAt: integrationEvents.receivedAt, signatureValid: integrationEvents.signatureValid,
      error: integrationEvents.error,
    }).from(integrationEvents).orderBy(desc(integrationEvents.receivedAt)).limit(15),
  ]);

  const [agendaReview, agendaStats] = await Promise.all([
    unmatchedAppointments(50),
    appointmentReviewStats(),
  ]);

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="Koppelingen"
        description="Status van de externe systemen waar ShortClips OS bovenop draait."
      />

      <div className="space-y-5">
        {health.map((item) => {
          const meta = STATUS_META[item.status] ?? STATUS_META.not_configured!;
          return (
            <Card key={item.spec.provider} padded={false}>
              <div className="flex flex-wrap items-start justify-between gap-4 p-5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2.5">
                    {item.status === "connected" ? (
                      <CheckCircle2 className="size-5 text-[var(--color-good)]" strokeWidth={1.75} />
                    ) : item.configured ? (
                      <AlertCircle className="size-5 text-[var(--color-bad)]" strokeWidth={1.75} />
                    ) : (
                      <CircleDashed className="size-5 text-[var(--color-ink-faint)]" strokeWidth={1.75} />
                    )}
                    <h2 className="text-base font-semibold">{item.spec.name}</h2>
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
                    {item.spec.description}
                  </p>
                  <ul className="mt-2 space-y-0.5 text-sm text-[var(--color-ink-muted)]">
                    {item.spec.purpose.map((p) => (
                      <li key={p} className="flex gap-2">
                        <span className="mt-1.5 size-1 shrink-0 rounded-full bg-[var(--color-brand-500)]" />
                        {p}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="w-full shrink-0 space-y-2 sm:w-56">
                  <TestButton provider={item.spec.provider} canTest={viewer.permissions.has("integrations:read")} />
                  <dl className="space-y-1 text-xs text-[var(--color-ink-muted)]">
                    <Row label="Laatste sync" value={item.lastSyncAt ? relativeDays(item.lastSyncAt) : "nooit"} />
                    <Row label="Laatste webhook" value={item.lastWebhookAt ? relativeDays(item.lastWebhookAt) : "nooit"} />
                    <Row label="Items gesynchroniseerd" value={String(item.itemsSynced)} />
                    <Row label="Fouten" value={String(item.errorCount)} />
                  </dl>
                </div>
              </div>

              {item.missing.length > 0 ? (
                <div className="border-t border-[var(--color-line)] bg-[var(--color-warn-soft)]/50 p-5">
                  <p className="text-sm font-semibold text-[#8a5300]">
                    Nog in te vullen: {item.missing.join(", ")}
                  </p>
                  <ul className="mt-3 space-y-2.5">
                    {item.spec.required
                      .filter((r) => item.missing.includes(r.key))
                      .map((r) => (
                        <li key={r.key} className="text-sm">
                          <code className="rounded bg-[var(--color-surface)] px-1.5 py-0.5 font-mono text-xs">
                            {r.key}
                          </code>
                          <span className="ml-2 font-medium">{r.label}</span>
                          <p className="mt-0.5 text-[var(--color-ink-muted)]">Waar: {r.where}</p>
                          {r.scopes ? (
                            <p className="text-[var(--color-ink-muted)]">Rechten: {r.scopes}</p>
                          ) : null}
                        </li>
                      ))}
                  </ul>
                  <p className="mt-3 text-xs text-[var(--color-ink-muted)]">
                    Zet deze waarden in <code className="font-mono">.env.local</code> (lokaal) of in de
                    omgevingsvariabelen van je hosting. Start daarna opnieuw op en klik op
                    &ldquo;Verbinding testen&rdquo;.
                  </p>
                </div>
              ) : null}

              {item.lastErrorMessage ? (
                <div className="border-t border-[var(--color-line)] bg-[var(--color-bad-soft)]/50 px-5 py-3 text-sm text-[#a3271c]">
                  <strong className="font-semibold">Laatste fout:</strong> {item.lastErrorMessage}
                  {item.lastErrorAt ? ` (${formatDateTime(item.lastErrorAt)})` : ""}
                </div>
              ) : null}

              {item.spec.webhookPath ? (
                <div className="border-t border-[var(--color-line)] px-5 py-3 text-xs text-[var(--color-ink-muted)]">
                  Webhook-adres:{" "}
                  <code className="rounded bg-[var(--color-surface-sunken)] px-1.5 py-0.5 font-mono">
                    {env.APP_URL}
                    {item.spec.webhookPath}
                  </code>
                </div>
              ) : null}
            </Card>
          );
        })}
      </div>

      {canWrite ? (
        <Card className="mt-5">
          <CardHeader
            title="Synchronisatie handmatig starten"
            subtitle="Normaal draaien deze taken automatisch. Hier kun je ze direct uitvoeren."
          />
          <div className="mt-4 flex flex-wrap gap-3">
            <JobButton job="frameio.pull_projects" label="Frame.io-projecten ophalen" />
            <JobButton job="frameio.pull_comments" label="Frame.io-feedback ophalen" />
            <JobButton job="signals.daily" label="Dagelijkse signalering" />
            <JobButton job="signals.hourly" label="Opnamecontrole" />
          </div>
        </Card>
      ) : null}

      <Card className="mt-5" padded={false}>
        <div className="p-5 pb-3">
          <CardHeader title="Recente synchronisaties" />
        </div>
        {recentJobs.length === 0 ? (
          <EmptyState title="Nog geen synchronisaties uitgevoerd" />
        ) : (
          <Table
            head={
              <>
                <th className="sc-th">Taak</th>
                <th className="sc-th">Systeem</th>
                <th className="sc-th">Status</th>
                <th className="sc-th text-right">Verwerkt</th>
                <th className="sc-th text-right">Nieuw</th>
                <th className="sc-th text-right">Mislukt</th>
                <th className="sc-th">Wanneer</th>
              </>
            }
          >
            {recentJobs.map((j) => (
              <tr key={j.id}>
                <td className="sc-td font-medium">{j.jobType}</td>
                <td className="sc-td text-[var(--color-ink-muted)]">
                  {INTEGRATION_LABEL[j.provider] ?? j.provider}
                </td>
                <td className="sc-td">
                  <Badge tone={j.status === "success" ? "good" : j.status === "error" ? "bad" : j.status === "partial" ? "warn" : "info"}>
                    {j.status === "success" ? "gelukt" : j.status === "error" ? "fout" : j.status === "partial" ? "deels" : j.status}
                  </Badge>
                  {j.error ? (
                    <span className="ml-2 text-xs text-[var(--color-ink-muted)]">{j.error}</span>
                  ) : null}
                </td>
                <td className="sc-td text-right tabular-nums">{j.itemsProcessed}</td>
                <td className="sc-td text-right tabular-nums">{j.itemsCreated}</td>
                <td className="sc-td text-right tabular-nums">{j.itemsFailed}</td>
                <td className="sc-td text-[var(--color-ink-muted)]">
                  {j.startedAt ? formatDateTime(j.startedAt) : "—"}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card className="mt-5" padded={false}>
        <div className="p-5 pb-3">
          <CardHeader
            title="Ontvangen webhooks"
            subtitle="Elk bericht wordt eerst opgeslagen en daarna verwerkt. Dubbele bezorging heeft geen effect."
          />
        </div>
        {recentEvents.length === 0 ? (
          <EmptyState
            title="Nog geen webhooks ontvangen"
            description="Registreer het webhook-adres hierboven bij het externe systeem."
          />
        ) : (
          <Table
            head={
              <>
                <th className="sc-th">Systeem</th>
                <th className="sc-th">Gebeurtenis</th>
                <th className="sc-th">Handtekening</th>
                <th className="sc-th">Status</th>
                <th className="sc-th">Ontvangen</th>
              </>
            }
          >
            {recentEvents.map((e) => (
              <tr key={e.id}>
                <td className="sc-td font-medium">{INTEGRATION_LABEL[e.provider] ?? e.provider}</td>
                <td className="sc-td text-[var(--color-ink-muted)]">{e.eventType}</td>
                <td className="sc-td">
                  {e.signatureValid === true ? (
                    <Badge tone="good">geldig</Badge>
                  ) : e.signatureValid === false ? (
                    <Badge tone="bad">ongeldig</Badge>
                  ) : (
                    <Badge tone="neutral">niet gecontroleerd</Badge>
                  )}
                </td>
                <td className="sc-td">
                  <Badge tone={e.status === "processed" ? "good" : e.status === "failed" ? "bad" : "info"}>
                    {e.status}
                  </Badge>
                </td>
                <td className="sc-td text-[var(--color-ink-muted)]">{formatDateTime(e.receivedAt)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* Google Agenda: afspraken die (nog) geen zekere klant hebben */}
      <Card>
        <CardHeader title="Afspraken zonder klant — controleren" />
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          {agendaStats.total === 0
            ? "Er is nog niets uit Google Agenda gesynchroniseerd."
            : `${agendaStats.matched} van ${agendaStats.total} afspraken gekoppeld · ${agendaStats.needsReview} te controleren${
                agendaStats.ambiguous ? ` (waarvan ${agendaStats.ambiguous} met meerdere mogelijke klanten)` : ""
              }.`}
        </p>
        {agendaReview.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="Alles gekoppeld"
              description="Elke gesynchroniseerde afspraak is aan een klant gekoppeld. Twijfelgevallen verschijnen hier — nooit stilletjes bij de verkeerde klant."
            />
          </div>
        ) : (
          <Table
            head={
              <>
                <th className="sc-th">Afspraak</th>
                <th className="sc-th">Wanneer</th>
                <th className="sc-th">Agenda</th>
                <th className="sc-th">Reden</th>
              </>
            }
          >
            {agendaReview.map((a) => (
              <tr key={a.id}>
                <td className="sc-td font-medium">{a.title ?? "(zonder titel)"}</td>
                <td className="sc-td text-[var(--color-ink-muted)]">{formatDateTime(a.startsAt)}</td>
                <td className="sc-td text-[var(--color-ink-muted)]">{a.calendarName ?? "–"}</td>
                <td className="sc-td">
                  <Badge tone={a.matchConfidence === "ambiguous" ? "warn" : "neutral"}>
                    {a.matchConfidence === "ambiguous" ? "meerdere mogelijk" : "geen klant herkend"}
                  </Badge>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt>{label}</dt>
      <dd className="font-medium text-[var(--color-ink)]">{value}</dd>
    </div>
  );
}
