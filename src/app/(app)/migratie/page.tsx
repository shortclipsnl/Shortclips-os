import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { requireOwner } from "@/server/auth/context";
import { getMigrationStatus } from "@/server/migration-status";
import { isMondaySyncEnabled } from "@/server/app-settings";
import { Badge, Card, CardHeader, PageHeader, Stat } from "@/components/ui";
import { MondaySyncToggle } from "./migratie-toggle";

export const metadata: Metadata = { title: "Monday-migratie" };
export const dynamic = "force-dynamic";

function when(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default async function MigrationPage() {
  await requireOwner();
  const [s, mondayOn] = await Promise.all([getMigrationStatus(), isMondaySyncEnabled()]);
  const a = s.attention;
  const issues =
    a.videosWithoutShoot + a.duplicateClients.length + a.duplicateLeads.length + a.wonLeadsUnconverted;

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        title="Monday-migratie"
        description="Controleoverzicht: hoeveel is uit Monday overgenomen, hoeveel is gekoppeld, en wat vraagt nog aandacht voordat Monday kan worden opgezegd."
      />

      <MondaySyncToggle enabled={mondayOn} />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Records overgenomen uit Monday" value={String(s.totalMapped)} />
        <Stat label="Aandachtspunten" value={String(issues)} tone={issues > 0 ? "warn" : "good"} />
        <Stat label="Koppelsuggesties open" value={String(a.openSuggestions)} hint="video ↔ opname" href="/koppelingen" />
      </div>

      {/* Per Monday-bord */}
      <Card padded={false} className="mb-6">
        <CardHeader title="Per Monday-bord" subtitle="Overgenomen items en laatste synchronisatie." className="p-5 pb-2" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-[var(--color-line)] text-left text-xs text-[var(--color-ink-faint)]">
                <th className="px-5 py-2 font-medium">Bord → doel</th>
                <th className="px-3 py-2 text-right font-medium">Overgenomen</th>
                <th className="px-3 py-2 font-medium">Laatste sync</th>
              </tr>
            </thead>
            <tbody>
              {s.boards.map((b) => (
                <tr key={b.board} className="border-b border-[var(--color-line)] last:border-0">
                  <td className="px-5 py-2.5 font-medium">{b.board}{b.note ? <span className="ml-2 text-2xs text-[var(--color-ink-faint)]">({b.note})</span> : null}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{b.mapped}</td>
                  <td className="px-3 py-2.5 text-[var(--color-ink-muted)]">{when(b.last)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Dekking per entiteit */}
      <Card padded={false} className="mb-6">
        <CardHeader title="Dekking per onderdeel" subtitle="Totaal in het dashboard en hoeveel daarvan uit Monday komt." className="p-5 pb-2" />
        <div className="grid grid-cols-2 gap-px bg-[var(--color-line)] sm:grid-cols-3">
          {s.coverage.map((c) => (
            <div key={c.entity} className="bg-[var(--color-surface)] p-4">
              <div className="text-xs text-[var(--color-ink-faint)]">{c.entity}</div>
              <div className="mt-0.5 text-xl font-bold tabular-nums">{c.total}</div>
              <div className="text-2xs text-[var(--color-ink-muted)]">{c.fromMonday} uit Monday</div>
            </div>
          ))}
        </div>
      </Card>

      {/* Aandachtspunten */}
      <Card padded={false} className="mb-6">
        <CardHeader title="Aandachtspunten" subtitle="Punten om te controleren vóór Monday wordt opgezegd." className="p-5 pb-2" />
        <ul className="divide-y divide-[var(--color-line)]">
          <AttentionRow
            bad={a.videosWithoutShoot > 0}
            label={`${a.videosWithoutShoot} video's nog niet aan een opname gekoppeld`}
            action={a.openSuggestions > 0 ? <Link href="/koppelingen" className="text-xs font-semibold text-[var(--color-brand-700)] hover:underline">{a.openSuggestions} suggesties reviewen →</Link> : null}
          />
          <AttentionRow bad={a.wonLeadsUnconverted > 0} label={`${a.wonLeadsUnconverted} gewonnen leads nog niet omgezet naar klant`} action={a.wonLeadsUnconverted > 0 ? <Link href="/leads" className="text-xs font-semibold text-[var(--color-brand-700)] hover:underline">Naar leads →</Link> : null} />
          <AttentionRow bad={a.duplicateClients.length > 0} label={`${a.duplicateClients.length} mogelijk dubbele klanten (zelfde naam)`} detail={a.duplicateClients.slice(0, 6).map((d) => `${d.nm} (${d.n})`).join(", ")} />
          <AttentionRow bad={a.duplicateLeads.length > 0} label={`${a.duplicateLeads.length} mogelijk dubbele leads (zelfde e-mail)`} detail={a.duplicateLeads.slice(0, 6).map((d) => `${d.em} (${d.n})`).join(", ")} />
        </ul>
      </Card>

      {/* Recente sync-jobs */}
      <Card padded={false}>
        <CardHeader title="Recente synchronisaties" subtitle="De laatste Monday-importruns." className="p-5 pb-2" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-[var(--color-line)] text-left text-xs text-[var(--color-ink-faint)]">
                <th className="px-5 py-2 font-medium">Taak</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Nieuw / bij / mislukt</th>
                <th className="px-3 py-2 font-medium">Klaar</th>
              </tr>
            </thead>
            <tbody>
              {s.jobs.length === 0 ? (
                <tr><td colSpan={4} className="px-5 py-6 text-center text-sm text-[var(--color-ink-faint)]">Nog geen importruns geregistreerd.</td></tr>
              ) : s.jobs.map((j, i) => (
                <tr key={i} className="border-b border-[var(--color-line)] last:border-0">
                  <td className="px-5 py-2.5 font-medium">{j.jobType}</td>
                  <td className="px-3 py-2.5"><Badge tone={j.status === "success" ? "good" : j.status === "error" ? "bad" : "neutral"}>{j.status}</Badge></td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-[var(--color-ink-muted)]">{j.created} / {j.updated} / <span className={j.failed > 0 ? "text-[var(--color-bad)] font-semibold" : ""}>{j.failed}</span></td>
                  <td className="px-3 py-2.5 text-[var(--color-ink-muted)]">{when(j.finishedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function AttentionRow({ bad, label, detail, action }: { bad: boolean; label: string; detail?: string; action?: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3">
      {bad ? <AlertTriangle className="size-4 shrink-0 text-[var(--color-warn)]" /> : <CheckCircle2 className="size-4 shrink-0 text-[var(--color-good)]" />}
      <span className="min-w-0 flex-1">
        <span className="block text-sm">{label}</span>
        {detail ? <span className="block text-2xs text-[var(--color-ink-faint)]">{detail}</span> : null}
      </span>
      {action}
    </li>
  );
}
