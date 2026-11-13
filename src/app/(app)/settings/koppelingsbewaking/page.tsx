import type { Metadata } from "next";
import Link from "next/link";
import { requireOwner } from "@/server/auth/context";
import { monitorOverview } from "@/server/monitoring/watch";
import { mailChannel } from "@/server/monitoring/mailer";
import { Badge, Card, CardHeader, EmptyState, Table } from "@/components/ui";
import { LEVEL_LABEL, type Incident, type MonitorLevel } from "@/lib/monitoring-rules";
import { env } from "@/lib/env";
import { MonitorActions } from "./monitor-actions";

export const metadata: Metadata = { title: "Koppelingsbewaking" };
export const dynamic = "force-dynamic";

const DOT: Record<MonitorLevel, string> = {
  ok: "var(--color-good)",
  warn: "var(--color-warn)",
  down: "var(--color-bad)",
  off: "var(--color-ink-faint)",
};
const TONE: Record<MonitorLevel, "good" | "warn" | "bad" | "neutral"> = { ok: "good", warn: "warn", down: "bad", off: "neutral" };

function when(date: Date | string | null | undefined): string {
  if (!date) return "nooit";
  const d = new Date(date);
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  const clock = d.toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" });
  if (mins < 2) return "zojuist";
  if (mins < 60) return `${mins} min geleden`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} uur geleden (${clock})`;
  return clock;
}

function duration(from: string, to: string | null | undefined): string {
  const mins = Math.max(1, Math.round((new Date(to ?? Date.now()).getTime() - new Date(from).getTime()) / 60_000));
  if (mins < 90) return `${mins} min`;
  const h = Math.round(mins / 60);
  return h < 48 ? `${h} uur` : `${Math.round(h / 24)} dagen`;
}

function StatusPill({ level }: { level: MonitorLevel }) {
  return (
    <Badge tone={TONE[level]} dot={DOT[level]}>
      {LEVEL_LABEL[level]}
    </Badge>
  );
}

export default async function KoppelingsbewakingPage() {
  await requireOwner();
  const [{ integrations, processes, state, level }, mail] = await Promise.all([monitorOverview(), mailChannel()]);

  const actionNeeded = integrations.filter((c) => (c.level === "down" || c.level === "warn") && c.action);
  const problems = integrations.filter((c) => c.level === "down" || c.level === "warn");
  const recent = recentHistory(state.history);

  const headline =
    level === "ok"
      ? "Alle koppelingen functioneren correct"
      : level === "down"
        ? `${problems.filter((p) => p.level === "down").length === 1 ? "Een koppeling werkt" : `${problems.filter((p) => p.level === "down").length} koppelingen werken`} niet`
        : `${problems.length} ${problems.length === 1 ? "punt vraagt" : "punten vragen"} aandacht`;

  return (
    <div className="space-y-5">
      {/* Kern in één oogopslag */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-1.5 size-3 shrink-0 rounded-full" style={{ background: DOT[level] }} aria-hidden />
            <div className="min-w-0">
              <h2 className="text-lg font-semibold tracking-tight">{headline}</h2>
              <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
                Automatische controle elk kwartier, ook als niemand is ingelogd. Laatste controle: {when(state.lastRunAt)}.
              </p>
            </div>
          </div>
          <MonitorActions />
        </div>
      </Card>

      {/* Wat moet er gebeuren */}
      {actionNeeded.length > 0 ? (
        <Card className="border-[var(--color-bad)]/25">
          <CardHeader title="Actie nodig" subtitle="Dit kan het portaal niet zelf oplossen, of het lukt niet met automatisch herstel." />
          <ul className="mt-4 divide-y divide-[var(--color-line)]">
            {actionNeeded.map((c) => (
              <li key={c.key} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="size-2 rounded-full" style={{ background: DOT[c.level] }} aria-hidden />
                    <span className="text-sm font-semibold">{c.name}</span>
                    {c.incident ? <span className="text-xs text-[var(--color-ink-muted)]">sinds {when(c.incident.openedAt)}</span> : null}
                  </div>
                  <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{c.summary}</p>
                  <p className="mt-1 text-sm font-medium text-[var(--color-ink)]">{c.action}</p>
                </div>
                <Link href={c.href} className="text-sm font-medium text-[var(--color-brand-600)] hover:underline">
                  Oplossen
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* Koppelingen */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {integrations.map((c) => (
          <Card key={c.key}>
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-sm font-semibold">{c.name}</h3>
              <div className="flex flex-wrap justify-end gap-1.5">
                {c.recurring ? <Badge tone="violet">Terugkerend</Badge> : null}
                <StatusPill level={c.level} />
              </div>
            </div>
            <p className="mt-2 min-h-10 text-sm text-[var(--color-ink-muted)]">{c.summary}</p>
            <dl className="mt-3 space-y-1 border-t border-[var(--color-line)] pt-3 text-xs text-[var(--color-ink-muted)]">
              <Row label="Laatste succesvolle sync" value={c.level === "off" ? "n.v.t." : when(c.lastSuccessAt)} />
              {c.dataLabel ? <Row label="Gegevens actueel t/m" value={c.dataFreshAt ? when(c.dataFreshAt) : "onbekend"} /> : null}
              <Row label="Automatisch herstel" value={recoveryText(c.incident, c.retryable)} />
            </dl>
          </Card>
        ))}
      </div>

      {/* Werkprocessen: werkt de koppeling, én is de data per proces actueel? */}
      <Card padded={false}>
        <div className="p-5 pb-3">
          <CardHeader
            title="Werkprocessen"
            subtitle="Per onderdeel van het portaal: komen de gegevens nog echt binnen? Een bereikbare koppeling die niets meer bijwerkt, staat hier oranje of rood."
          />
        </div>
        <Table
          head={
            <>
              <th className="sc-th">Onderdeel</th>
              <th className="sc-th">Status</th>
              <th className="sc-th">Actualiteit</th>
              <th className="sc-th">Afhankelijk van</th>
            </>
          }
        >
          {processes.map((p) => (
            <tr key={p.key}>
              <td className="sc-td font-medium">{p.name}</td>
              <td className="sc-td"><StatusPill level={p.level} /></td>
              <td className="sc-td text-[var(--color-ink-muted)]">{p.summary}</td>
              <td className="sc-td text-[var(--color-ink-muted)]">{p.dependsOn.join(", ")}</td>
            </tr>
          ))}
        </Table>
      </Card>

      {/* Historie */}
      <Card padded={false}>
        <div className="p-5 pb-3">
          <CardHeader title="Opgeloste problemen, afgelopen 7 dagen" subtitle="Kleine storingen die het portaal zelf heeft hersteld krijgen geen melding, maar staan wel hier." />
        </div>
        {recent.length === 0 ? (
          <EmptyState title="Geen storingen in de afgelopen 7 dagen" />
        ) : (
          <Table
            head={
              <>
                <th className="sc-th">Koppeling</th>
                <th className="sc-th">Begon</th>
                <th className="sc-th">Duur</th>
                <th className="sc-th">Opgelost</th>
              </>
            }
          >
            {recent.map((h, i) => (
              <tr key={`${h.key}-${h.openedAt}-${i}`}>
                <td className="sc-td font-medium">{h.name}</td>
                <td className="sc-td text-[var(--color-ink-muted)]">{when(h.openedAt)}</td>
                <td className="sc-td text-[var(--color-ink-muted)]">{duration(h.openedAt, h.resolvedAt)}</td>
                <td className="sc-td">
                  {h.autoResolved ? <Badge tone="good">Automatisch</Badge> : <Badge tone="info">Na melding</Badge>}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* Meldingen */}
      <Card>
        <CardHeader title="Zo word je gemeld" />
        <div className="mt-3 space-y-2 text-sm text-[var(--color-ink-muted)]">
          <p>
            <strong className="font-medium text-[var(--color-ink)]">Kritiek</strong> (Drive, Agenda of Frame.io werkt niet, of de geplande taken liggen stil):
            direct een e-mail naar {mail.recipientMasked}
            {mail.via ? ` via de ${mail.via}` : ""}, plus een melding in het portaal. Eén keer per storing, en een korte mail zodra het weer werkt.
          </p>
          <p>
            <strong className="font-medium text-[var(--color-ink)]">Klein of tijdelijk:</strong> het portaal herstelt zelf (na 15, 30, 60 en 120 minuten opnieuw proberen). Geen melding.
          </p>
          <p>
            <strong className="font-medium text-[var(--color-ink)]">Dagoverzicht</strong> om 08:00, alleen als er de afgelopen 24 uur iets was of nog openstaat.
          </p>
          <p className="text-xs">
            Meldingen gaan alleen naar de beheerder, nooit naar klanten, editors of medewerkers, en bevatten geen klantgegevens of toegangssleutels.
            Externe hartslag voor een uptime-dienst: <code className="rounded bg-[var(--color-surface-sunken)] px-1.5 py-0.5 font-mono">{env.APP_URL}/api/monitoring/heartbeat</code>
          </p>
        </div>
      </Card>
    </div>
  );
}

/** Opgeloste incidenten van de afgelopen 7 dagen, nieuwste eerst. */
function recentHistory(history: Incident[]): Incident[] {
  const weekAgo = Date.now() - 7 * 24 * 3_600_000;
  return [...history]
    .filter((h) => new Date(h.resolvedAt ?? h.lastSeenAt).getTime() >= weekAgo)
    .reverse()
    .slice(0, 12);
}

function recoveryText(inc: Incident | null, retryable: boolean): string {
  if (!inc) return retryable ? "niet nodig" : "n.v.t.";
  if (inc.needsHuman) return "niet mogelijk, actie nodig";
  if (!inc.recoveryAttempts) return "gepland";
  const last = inc.lastRecoveryOk ? "gelukt" : "nog niet gelukt";
  return `${inc.recoveryAttempts}x geprobeerd, ${last}`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt>{label}</dt>
      <dd className="text-right font-medium text-[var(--color-ink)]">{value}</dd>
    </div>
  );
}
