import { Card, CardHeader } from "@/components/ui";
import { getRetentionOverview, recentResolvedFeedback, retentionContext } from "@/server/client-retention";
import { listAttentionTeam } from "@/server/attention";
import {
  FEEDBACK_CATEGORY_LABEL, FEEDBACK_KIND_LABEL, FEEDBACK_SOURCE_LABEL, HEALTH_LABEL, platformLabel,
  type FeedbackSource, type HealthStatus,
} from "@/lib/client-retention";
import { ContractTermsForm, FeedbackForm, ResolveFeedbackButton } from "./retention-forms";

const DOT: Record<HealthStatus, string> = { gezond: "var(--color-good)", aandacht: "var(--color-warn)", direct: "var(--color-bad)" };
const nl = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" }) : "onbekend");
const fmt = (n: number) => n.toLocaleString("nl-NL");

/**
 * Klantbehoud per klant: tevredenheid (met de redenen), resultatentrend,
 * contractmoment (commercieel, apart gehouden) en de geregistreerde feedback.
 * Bewust zonder bedragen: die blijven onder Financieel.
 */
export async function RetentionTab({ clientId }: { clientId: string }) {
  const ctx = await retentionContext();
  const [[r], resolved, team] = await Promise.all([
    getRetentionOverview(ctx, [clientId]),
    recentResolvedFeedback(clientId),
    listAttentionTeam(),
  ]);
  if (!r) {
    return <Card><p className="text-sm text-[var(--color-ink-muted)]">Klantbehoud wordt alleen bijgehouden voor actieve klanten.</p></Card>;
  }
  const name = (uid: string | null) => team.find((t) => t.id === uid)?.name ?? "Niet toegewezen";
  const k = r.contract;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
      <div className="space-y-5">
        {/* Tevredenheid */}
        <Card>
          <div className="flex items-center gap-2.5">
            <span className="size-3 rounded-full" style={{ background: DOT[r.health.status] }} />
            <h2 className="text-base font-semibold">{HEALTH_LABEL[r.health.status]}</h2>
          </div>
          <ul className="mt-3 space-y-1.5 text-sm text-[var(--color-ink-muted)]">
            {r.health.reasons.map((x) => <li key={x}>{x}</li>)}
          </ul>
          <p className="mt-3 text-xs text-[var(--color-ink-faint)]">
            Gezond: geen negatieve signalen. Aandacht: dalende resultaten, een open klacht of ontbrekende gegevens. Direct: een ernstig signaal, drie of meer open klachten, of een klacht terwijl de resultaten dalen. Een naderend contractmoment telt hier niet mee.
          </p>
        </Card>

        {/* Resultaten */}
        <Card padded={false}>
          <CardHeader className="p-5 pb-3" title="Resultaten" subtitle={`Laatste 30 dagen tegenover de 30 dagen daarvoor · grens ${ctx.dropPct}%`} />
          <div className="px-5 pb-5 text-sm">
            <p className="mb-3 text-[var(--color-ink-muted)]">{r.results.summary}</p>
            {r.results.platforms.length ? (
              <table className="w-full text-left">
                <thead className="text-xs text-[var(--color-ink-faint)]"><tr><th className="py-1 font-medium">Platform</th><th className="font-medium">Statistiek</th><th className="text-right font-medium">Vorige</th><th className="text-right font-medium">Nu</th><th className="text-right font-medium">Verschil</th></tr></thead>
                <tbody>
                  {r.results.platforms.flatMap((p) => p.changes.length ? p.changes.map((m) => (
                    <tr key={`${p.platform}-${m.key}`} className="border-t border-[var(--color-line)]">
                      <td className="py-1.5">{platformLabel(p.platform)}</td><td>{m.label}</td>
                      <td className="text-right tabular-nums">{fmt(m.prev)}{m.key === "engagement" ? "%" : ""}</td>
                      <td className="text-right tabular-nums">{fmt(m.cur)}{m.key === "engagement" ? "%" : ""}</td>
                      <td className={`text-right tabular-nums ${m.pct <= -ctx.dropPct ? "font-semibold text-[var(--color-bad)]" : ""}`}>{m.pct > 0 ? "+" : ""}{m.pct}%</td>
                    </tr>
                  )) : [(
                    <tr key={p.platform} className="border-t border-[var(--color-line)]"><td className="py-1.5">{platformLabel(p.platform)}</td><td colSpan={4} className="text-[var(--color-ink-muted)]">Geen oordeel: {p.note}</td></tr>
                  )])}
                </tbody>
              </table>
            ) : null}
            {r.results.weakVideos.length ? (
              <p className="mt-3 text-xs text-[var(--color-ink-muted)]">Opvallend zwak: {r.results.weakVideos.map((v) => `${v.title} (${fmt(v.views ?? 0)})`).join(", ")}. Een losse video is op zichzelf geen reden tot zorg.</p>
            ) : null}
          </div>
        </Card>

        {/* Feedback */}
        <Card padded={false}>
          <CardHeader className="p-5 pb-3" title="Klachten en signalen" subtitle="Alleen echte ontevredenheid. Normale correcties (ondertitel, kleine aanpassing) horen in Frame.io of de scriptcontrole." />
          <div className="space-y-2 px-5 pb-5">
            {r.openFeedback.length === 0 ? <p className="text-sm text-[var(--color-ink-muted)]">Geen open klachten.</p> : null}
            {r.openFeedback.map((f) => (
              <div key={f.id} className="rounded-[var(--radius-md)] border border-[var(--color-line)] p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-ink-muted)]">
                  <span className={`rounded px-1.5 py-px font-semibold ${f.kind === "ernstig" ? "bg-[var(--color-bad-soft)] text-[#a3271c]" : "bg-[var(--color-warn-soft)] text-[#8a5300]"}`}>{FEEDBACK_KIND_LABEL[f.kind]}</span>
                  {FEEDBACK_CATEGORY_LABEL[f.category]} · {FEEDBACK_SOURCE_LABEL[f.source as FeedbackSource] ?? f.source} · {name(f.ownerId)} · uiterlijk {nl(f.dueOn)}
                  {f.status === "opgepakt" ? <span className="font-medium text-[var(--color-violet)]">· opgepakt</span> : null}
                </div>
                <p className="mt-1 font-medium text-[var(--color-ink)]">{f.summary}</p>
                <p className="text-[var(--color-ink-muted)]">Vervolgactie: {f.followUp}</p>
                <ResolveFeedbackButton id={f.id} />
              </div>
            ))}
            {resolved.length ? (
              <details className="pt-2 text-sm">
                <summary className="cursor-pointer text-xs font-medium text-[var(--color-ink-muted)]">Afgehandeld ({resolved.length})</summary>
                <ul className="mt-2 space-y-1.5">
                  {resolved.map((f) => (
                    <li key={f.id} className="text-xs text-[var(--color-ink-muted)]"><span className="text-[var(--color-ink)]">{f.summary}</span> · {f.resolution ?? "opgelost"} · {f.resolvedBy ?? ""} {f.resolvedAt ? nl(f.resolvedAt) : ""}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        </Card>
      </div>

      <div className="space-y-5">
        <Card padded={false}>
          <CardHeader className="p-5 pb-3" title="Feedback registreren" subtitle="Bij een ernstig signaal krijgt de verantwoordelijke direct een melding." />
          <div className="px-5 pb-5"><FeedbackForm clientId={clientId} team={team.map((t) => ({ id: t.id, name: t.name }))} /></div>
        </Card>

        {/* Contract: commerciële opvolging, los van tevredenheid */}
        <Card padded={false}>
          <CardHeader className="p-5 pb-3" title="Contractmoment" subtitle="Commerciële opvolging. Staat los van tevredenheid." />
          <div className="space-y-3 px-5 pb-5 text-sm">
            {r.commercial ? (
              <p className={`font-medium ${r.commercial.tone === "urgent" ? "text-[var(--color-bad)]" : r.commercial.tone === "aandacht" ? "text-[#8a5300]" : "text-[var(--color-ink)]"}`}>{r.commercial.label}</p>
            ) : k.decisionDate ? <p className="text-[var(--color-ink-muted)]">Beslismoment {nl(k.decisionDate)}, nog geen actie nodig.</p> : null}
            {k.issues.length ? (
              <p className="rounded-[var(--radius-sm)] bg-[var(--color-warn-soft)] px-3 py-2 text-xs text-[#8a5300]">Controle nodig: {k.issues.join(", ").toLowerCase()}. Het systeem gaat niet uit van een verlenging zolang dit niet is gecontroleerd.</p>
            ) : <p className="text-xs text-[var(--color-good)]">Gegevens gecontroleerd.</p>}
            <ContractTermsForm clientId={clientId} initial={{ startsOn: k.startsOn ?? "", endsOn: k.endsOn ?? "", noticePeriodDays: k.contractId && k.noticePeriodDays != null ? String(k.noticePeriodDays) : "", autoRenew: k.autoRenew ?? false }} />
          </div>
        </Card>
      </div>
    </div>
  );
}
