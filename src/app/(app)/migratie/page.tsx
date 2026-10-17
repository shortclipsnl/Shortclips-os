import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { requireOwner } from "@/server/auth/context";
import { getMigrationStatus } from "@/server/migration-status";
import { isMondaySyncEnabled } from "@/server/app-settings";
import { findDuplicateTaskGroups } from "@/server/task-dedup";
import { getMondayExitCriteria } from "@/server/monday-exit";
import { Badge, Card, CardHeader, PageHeader, Stat } from "@/components/ui";
import { MondaySyncToggle } from "./migratie-toggle";
import { TaskDedupCard } from "./task-dedup-card";

export const metadata: Metadata = { title: "Monday-migratie" };
export const dynamic = "force-dynamic";

function when(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default async function MigrationPage() {
  await requireOwner();
  const [s, mondayOn, dupGroups, exit] = await Promise.all([getMigrationStatus(), isMondaySyncEnabled(), findDuplicateTaskGroups(), getMondayExitCriteria()]);
  const a = s.attention;
  const issues =
    a.videosWithoutShoot + a.duplicateClients.length + a.duplicateLeads.length + a.wonLeadsUnconverted;

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        title="Monday-migratie"
        description="Controleoverzicht: hoeveel is uit Monday overgenomen, hoeveel is gekoppeld, en wat vraagt nog aandacht voordat Monday kan worden opgezegd."
      />

      {/* De 8 exitcriteria: wanneer kan Monday eruit? */}
      <Card padded={false} className="mb-6">
        <CardHeader title={`Monday-exitcriteria — ${exit.behaald}/8 behaald`} subtitle="Monday mag pas worden opgezegd als alle acht aantoonbaar groen zijn." className="p-5 pb-2" />
        <ul className="divide-y divide-[var(--color-line)]">
          {exit.criteria.map((c) => (
            <li key={c.n} className="flex items-start gap-3 px-5 py-3">
              <Badge tone={c.status === "behaald" ? "good" : c.status === "deels" ? "warn" : "bad"}>
                {c.status === "behaald" ? "behaald" : c.status === "deels" ? "deels" : "nog niet"}
              </Badge>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{c.n}. {c.title}</div>
                <div className="text-2xs text-[var(--color-ink-muted)]">{c.getest}</div>
                {c.status !== "behaald" ? <div className="text-2xs text-[var(--color-ink-faint)]">Nog nodig: {c.open}</div> : null}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <MondaySyncToggle enabled={mondayOn} />

      <TaskDedupCard groups={dupGroups.map((g) => ({ clientName: g.clientName, title: g.title, count: g.count }))} />

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

      {/* #10 — opschonen mensen & namen (alleen lezen, voor goedkeuring) */}
      {(() => {
        const p = s.people;
        const total = p.duplicateNames.length + p.placeholders.length + p.firstNameOnly.length;
        return (
          <Card padded={false} className="mb-6">
            <CardHeader
              title={`Opschonen: mensen & namen — ${total} aandachtspunt${total === 1 ? "" : "en"}`}
              subtitle="Kandidaten om op te schonen. Niets wordt automatisch verwijderd — bekijk de lijst en geef aan wat weg of samengevoegd mag worden."
              className="p-5 pb-2"
            />
            {total === 0 ? (
              <div className="flex items-center gap-3 px-5 py-4 text-sm text-[var(--color-ink-muted)]">
                <CheckCircle2 className="size-4 text-[var(--color-good)]" /> Geen dubbele of onvolledige teamleden gevonden.
              </div>
            ) : (
              <div className="divide-y divide-[var(--color-line)]">
                {p.duplicateNames.length > 0 ? (
                  <div className="px-5 py-3">
                    <div className="text-sm font-medium">Mogelijk dubbele teamleden (zelfde naam)</div>
                    <ul className="mt-1.5 space-y-1">
                      {p.duplicateNames.map((d) => (
                        <li key={d.nm} className="text-xs text-[var(--color-ink-muted)]">
                          <span className="font-medium text-[var(--color-ink)]">{d.nm}</span> — {d.n}× · {d.emails}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {p.placeholders.length > 0 ? (
                  <div className="px-5 py-3">
                    <div className="text-sm font-medium">Niet-geactiveerde of placeholder-accounts</div>
                    <ul className="mt-1.5 space-y-1">
                      {p.placeholders.map((u) => (
                        <li key={u.email} className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-ink-muted)]">
                          <span className="font-medium text-[var(--color-ink)]">{u.full_name}</span>
                          <span>{u.email}</span>
                          <Badge tone={u.status === "invited" ? "warn" : "neutral"}>{u.status === "invited" ? "nooit ingelogd" : u.status}</Badge>
                          <span className="text-[var(--color-ink-faint)]">{u.primary_role}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {p.firstNameOnly.length > 0 ? (
                  <div className="px-5 py-3">
                    <div className="text-sm font-medium">Teamleden met alleen een voornaam (naam aanvullen)</div>
                    <ul className="mt-1.5 space-y-1">
                      {p.firstNameOnly.map((u) => (
                        <li key={u.email} className="text-xs text-[var(--color-ink-muted)]">
                          <span className="font-medium text-[var(--color-ink)]">{u.full_name}</span> — {u.email} · {u.primary_role}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            )}
          </Card>
        );
      })()}

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
