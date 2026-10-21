import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import {
  CalendarClock,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import { requireInternal } from "@/server/auth/context";
import { getClientHub, type ClientHub } from "@/server/clients";
import { ScriptHistory } from "./script-history";
import { FilesBrowser } from "./files-browser";
import {
  Avatar,
  Badge,
  Card,
  CardHeader,
  ClientLogo,
  EmptyState,
  LinkButton,
  Stat,
  Table,
} from "@/components/ui";
import {
  compact,
  daysSince,
  daysUntil,
  euro,
  formatDate,
  formatDateFull,
  formatDateTime,
  num,
  periodLabel,
  plural,
  relativeDays,
} from "@/lib/format";
import {
  CLIENT_STATUS,
  INVOICE_STATUS,
  PLATFORM,
  PRODUCTION_STATUS,
  PUBLICATION_STATUS,
  RISK_LEVEL,
  SCRIPT_STATUS,
  TASK_PRIORITY,
  videoPhase,
} from "@/lib/statuses";
import { ClientTabs, type TabDef } from "./tabs";
import { FinanceMonths } from "./finance-months";
import { GenerateReportButton, ReportPublishToggle } from "./report-actions";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const viewer = await requireInternal();
  const hub = await getClientHub(viewer, slug);
  return { title: hub.client.name };
}

export default async function ClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const viewer = await requireInternal();
  const { slug } = await params;
  const { tab } = await searchParams;
  const hub = await getClientHub(viewer, slug);
  const c = hub.client;

  const activeVideos = hub.videos.filter(
    (v) => !["published", "analysis_available"].includes(v.status),
  );
  const publishedThisMonth = hub.videos.filter(
    (v) => v.publishedAt && new Date(v.publishedAt).getMonth() === new Date().getMonth(),
  ).length;
  // Eerstvolgende opname = de vroegste toekomstige opnamedag uit Google Agenda
  // (niet geannuleerd). shoots staat aflopend op datum, dus expliciet sorteren,
  // zodat dit altijd dezelfde datum toont als het klantenoverzicht.
  const today = new Date().toISOString().slice(0, 10);
  const nextShoot = hub.shoots
    .filter((s) => s.scheduledOn >= today && s.status !== "cancelled")
    .sort((a, b) => a.scheduledOn.localeCompare(b.scheduledOn))[0];

  // Resultaten is pas zinvol als er cijfers binnenkomen óf er kanalen gekoppeld
  // zijn — zelfde voorwaarde als ResultsTab gebruikt om leeg-of-vullen te kiezen.
  const hasResults =
    hub.metrics.views + hub.metrics.reach + hub.metrics.engagements + Math.abs(hub.metrics.followerGrowth) > 0 ||
    hub.socials.length > 0;

  // Vaak-lege tabbladen tonen we alleen als er echt data achter zit (#12), zodat
  // de pagina niet volloopt met lege tabs. Kern-tabs (overzicht, video's, scripts,
  // contactpersoon) blijven altijd staan — die worden verwacht, ook als ze leeg
  // zijn. Een tab die hier wegvalt, kan ook niet geselecteerd worden, dus zijn
  // paneel hieronder rendert dan evenmin.
  const tabs: TabDef[] = [
    { key: "overzicht", label: "Overzicht" },
    { key: "videos", label: "Video's", count: activeVideos.length },
    { key: "scripts", label: "Scripts", count: hub.scripts.filter((s) => s.status !== "shot").length },
    ...(hub.shoots.length > 0 ? [{ key: "opnames", label: "Opnames" }] : []),
    ...(hub.calendar.length > 0 ? [{ key: "planning", label: "Planning" }] : []),
    ...(hasResults ? [{ key: "resultaten", label: "Resultaten" }] : []),
    ...(hub.reports.length > 0 ? [{ key: "rapportages", label: "Rapportages", count: hub.reports.length }] : []),
    ...(hub.knowledge.length > 0 ? [{ key: "kennis", label: "Klantkennis", count: hub.knowledge.length }] : []),
    ...(hub.files.length > 0 ? [{ key: "documenten", label: "Documenten" }] : []),
    { key: "contacten", label: "Contactpersoon", count: hub.contacts.length },
    ...(hub.canSeeFinance ? [{ key: "financieel", label: "Financieel" }, { key: "contract", label: "Contract & facturatie" }] : []),
    ...(hub.insights.length > 0 ? [{ key: "inzichten", label: "AI-inzichten", count: hub.insights.length }] : []),
    ...(hub.integrations.length > 0 ? [{ key: "koppelingen", label: "Koppelingen" }] : []),
  ];
  const active = tabs.some((t) => t.key === tab) ? tab! : "overzicht";

  return (
    <div className="mx-auto max-w-[1400px]">
      {/* Kop */}
      <div className="mb-5">
        <Link
          href="/clients"
          className="text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
        >
          ← Klanten
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            {/* Het klantlogo (met initialen-fallback als er nog geen logo is). */}
            <ClientLogo name={c.name} logoUrl={c.logoUrl} color={c.color} size={60} />
            <div className="min-w-0">
              <h1 className="text-xl font-semibold tracking-tight">{c.name}</h1>
              <p className="mt-0.5 text-sm text-[var(--color-ink-muted)]">
                {c.sector ?? "—"}
                {c.startedOn ? ` · klant sinds ${formatDateFull(c.startedOn)}` : ""}
              </p>
              {/* Korte omschrijving: wat voor bedrijf het is. */}
              {c.description ? (
                <p className="mt-1.5 max-w-xl text-sm leading-snug text-[var(--color-ink)]">{c.description}</p>
              ) : null}
            </div>
          </div>
          <div className="flex items-start gap-4">
            <div className="flex flex-col items-end gap-2">
              <div className="flex flex-wrap items-center justify-end gap-2">
                {c.riskLevel !== "none" ? (
                  <Badge tone={RISK_LEVEL[c.riskLevel]?.tone ?? "neutral"}>
                    {RISK_LEVEL[c.riskLevel]?.label}
                  </Badge>
                ) : (
                  <Badge tone={c.status === "active" ? "ink" : CLIENT_STATUS[c.status]?.tone ?? "neutral"}>
                    {CLIENT_STATUS[c.status]?.label}
                  </Badge>
                )}
                {c.complexity ? (
                  <Badge tone={c.complexity === "hoog" ? "bad" : c.complexity === "gemiddeld" ? "warn" : "good"}>
                    Complexiteit: {c.complexity}
                  </Badge>
                ) : null}
                {c.website ? (
                  <a
                    href={c.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-[var(--color-brand-600)] hover:underline"
                  >
                    Website <ExternalLink className="size-3.5" />
                  </a>
                ) : null}
                {viewer.permissions.has("video_intelligence:read") ? (
                  <LinkButton href={`/video-intelligence?klant=${slug}`} variant="secondary" size="sm">
                    Video-analyses
                  </LinkButton>
                ) : null}
                {viewer.permissions.has("clients:write") ? (
                  <LinkButton href={`/clients/${slug}/edit`} variant="secondary" size="sm">
                    Bewerken
                  </LinkButton>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      {c.riskLevel !== "none" && c.riskReason ? (
        <div className="mb-5 rounded-[var(--radius-lg)] border border-[var(--color-bad)]/20 bg-[var(--color-bad-soft)] px-4 py-3 text-sm text-[#a3271c]">
          <strong className="font-semibold">Aandachtspunt:</strong> {c.riskReason}
        </div>
      ) : null}

      {c.attentionNotes ? (
        <div className="mb-5 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-sm">
          <strong className="font-semibold">Aandachtspunten bij deze klant:</strong>{" "}
          <span className="text-[var(--color-ink-muted)]">{c.attentionNotes}</span>
        </div>
      ) : null}

      <Suspense fallback={null}>
        <ClientTabs tabs={tabs} />
      </Suspense>

      {active === "overzicht" ? (
        <OverviewTab hub={hub} publishedThisMonth={publishedThisMonth} nextShoot={nextShoot} activeVideos={activeVideos.length} />
      ) : null}
      {active === "videos" ? <VideosTab hub={hub} /> : null}
      {active === "scripts" ? <ScriptsTab hub={hub} canVI={viewer.permissions.has("video_intelligence:read")} /> : null}
      {active === "opnames" ? <ShootsTab hub={hub} /> : null}
      {active === "planning" ? <PlanningTab hub={hub} /> : null}
      {active === "resultaten" ? <ResultsTab hub={hub} /> : null}
      {active === "rapportages" ? <ReportsTab hub={hub} slug={slug} canWrite={viewer.permissions.has("reports:write")} /> : null}
      {active === "kennis" ? <KnowledgeTab hub={hub} /> : null}
      {active === "documenten" ? <FilesTab hub={hub} /> : null}
      {active === "contacten" ? <ContactsTab hub={hub} /> : null}
      {active === "financieel" && hub.canSeeFinance ? <FinanceTab hub={hub} /> : null}
      {active === "contract" && hub.canSeeFinance ? <ContractTab hub={hub} /> : null}
      {active === "inzichten" ? <InsightsTab hub={hub} /> : null}
      {active === "koppelingen" ? <IntegrationsTab hub={hub} /> : null}
    </div>
  );
}

/* ---------------------------- Overzicht ---------------------------- */

function OverviewTab({
  hub,
  publishedThisMonth,
  nextShoot,
  activeVideos,
}: {
  hub: ClientHub;
  publishedThisMonth: number;
  nextShoot?: ClientHub["shoots"][number];
  activeVideos: number;
}) {
  const c = hub.client;
  const awaitingClient = hub.videos.filter((v) =>
    ["client_review", "client_revision"].includes(v.status),
  );

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <Stat
          label="Deze maand"
          value={`${publishedThisMonth}/${c.monthlyVideoQuota}`}
          hint="gepubliceerd t.o.v. afspraak"
          tone={publishedThisMonth < c.monthlyVideoQuota ? "warn" : "good"}
        />
        <Stat label="In productie" value={activeVideos} hint="video's onderweg" />
        <Stat
          label="Bij de klant"
          value={awaitingClient.length}
          hint={
            awaitingClient[0]
              ? `oudste ${daysSince(awaitingClient[0].statusChangedAt)} dagen`
              : "niets openstaand"
          }
          tone={awaitingClient.some((v) => daysSince(v.statusChangedAt) > 5) ? "warn" : "neutral"}
        />
        <Stat label="Weergaven (30d)" value={compact(hub.metrics.views)} hint="alle kanalen" />
        <Stat label="Volgersgroei (30d)" value={`+${num(hub.metrics.followerGrowth)}`} />
        {hub.canSeeFinance ? (
          <Stat label="Per maand" value={euro(c.monthlyRevenue)} hint="contractwaarde" />
        ) : (
          <Stat label="Openstaande taken" value={hub.tasks.length} />
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title="Samenwerking" />
          <dl className="mt-4 space-y-3 text-sm">
            <Row label="Pakket" value={hub.package?.name ?? "—"} />
            <Row label="Video's per maand" value={String(c.monthlyVideoQuota)} />
            <Row label="Klant sinds" value={c.startedOn ? formatDateFull(c.startedOn) : "—"} />
            <Row
              label="Contract tot"
              value={
                hub.contract?.endsOn ? (
                  <span className={daysUntil(hub.contract.endsOn) < 60 ? "text-[var(--color-bad)]" : undefined}>
                    {formatDateFull(hub.contract.endsOn)}
                  </span>
                ) : "—"
              }
            />
            <Row label="Projectcoördinator" value={c.coordinatorName ?? "—"} />
            <Row label="Videograaf" value={hub.videographer?.fullName ?? "—"} />
            <Row
              label="Belangrijkste contact"
              value={hub.contacts.find((x) => x.isPrimary)?.fullName ?? "—"}
            />
            <Row
              label="Laatste contact"
              value={c.lastContactAt ? relativeDays(c.lastContactAt) : "—"}
            />
          </dl>
        </Card>

        <Card className="lg:col-span-2" padded={false}>
          <div className="p-5 pb-3">
            <CardHeader
              title="Wat er nu speelt"
              subtitle="Video's die wachten, en de eerstvolgende opname."
            />
          </div>

          {nextShoot ? (
            <div className="mx-5 mb-3 flex items-center gap-3 rounded-[var(--radius-md)] bg-[var(--color-info-soft)] px-4 py-3">
              <CalendarClock className="size-5 shrink-0 text-[var(--color-brand-600)]" strokeWidth={1.75} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  Volgende opname {relativeDays(nextShoot.scheduledOn)}
                </p>
                <p className="text-xs text-[var(--color-ink-muted)]">
                  {formatDateFull(nextShoot.scheduledOn)} · {nextShoot.locationName ?? "locatie onbekend"} ·{" "}
                  {plural(Number(nextShoot.scriptCount), "script")}
                </p>
              </div>
              <LinkButton href={`/productions/${nextShoot.id}`} variant="secondary" size="sm">
                Openen
              </LinkButton>
            </div>
          ) : (
            <div className="mx-5 mb-3 rounded-[var(--radius-md)] bg-[var(--color-warn-soft)] px-4 py-3 text-sm text-[#8a5300]">
              Er staat geen opnamedag gepland. Plan er één om de contentcyclus door te laten lopen.
            </div>
          )}

          {hub.videos.filter((v) => !["published", "analysis_available"].includes(v.status)).length === 0 ? (
            <EmptyState title="Geen lopende video's" />
          ) : (
            <ul className="divide-y divide-[var(--color-line)] border-t border-[var(--color-line)]">
              {hub.videos
                .filter((v) => !["published", "analysis_available"].includes(v.status))
                .slice(0, 8)
                .map((v) => (
                  <li key={v.id}>
                    <Link href={`/videos/${v.id}`} className="sc-row-link flex items-center gap-3 px-5 py-2.5">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{v.title}</span>
                        <span className="block truncate text-xs text-[var(--color-ink-muted)]">
                          {v.editorName ?? "geen editor"} · {daysSince(v.statusChangedAt)} dagen in deze stap
                        </span>
                      </span>
                      <Badge tone={videoPhase(v.status).tone}>
                        {videoPhase(v.status).label}
                      </Badge>
                    </Link>
                  </li>
                ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-[var(--color-ink-muted)]">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

/* ------------------------------ Video's ---------------------------- */

function VideosTab({ hub }: { hub: ClientHub }) {
  if (hub.videos.length === 0)
    return <Card><EmptyState title="Nog geen video's" /></Card>;
  return (
    <Card padded={false}>
      <Table
        head={
          <>
            <th className="sc-th">Video</th>
            <th className="sc-th">Status</th>
            <th className="sc-th">Editor</th>
            <th className="sc-th">Versie</th>
            <th className="sc-th">Deadline</th>
            <th className="sc-th">In deze stap</th>
          </>
        }
      >
        {hub.videos.map((v) => (
          <tr key={v.id} className="sc-row-link">
            <td className="sc-td">
              <Link href={`/videos/${v.id}`} className="font-medium hover:underline">
                {v.title}
              </Link>
            </td>
            <td className="sc-td">
              <Badge tone={videoPhase(v.status).tone}>
                {videoPhase(v.status).label}
              </Badge>
            </td>
            <td className="sc-td text-[var(--color-ink-muted)]">{v.editorName ?? "—"}</td>
            <td className="sc-td tabular-nums">v{v.currentVersion}</td>
            <td className="sc-td text-[var(--color-ink-muted)]">
              {v.dueOn ? formatDate(v.dueOn) : "—"}
            </td>
            <td className="sc-td tabular-nums text-[var(--color-ink-muted)]">
              {daysSince(v.statusChangedAt)} d
            </td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

/* ------------------------------ Scripts ---------------------------- */

function ScriptsTab({ hub, canVI }: { hub: ClientHub; canVI: boolean }) {
  if (hub.scripts.length === 0 && !hub.files.some((f) => f.category === "Scripts" && !f.isFolder))
    return <Card><EmptyState title="Nog geen scripts" /></Card>;
  const driveScripts = hub.files.filter((f) => f.category === "Scripts" && !f.isFolder);
  return (
    <ScriptHistory
      scripts={hub.scripts}
      driveScripts={driveScripts}
      intelligenceHref={canVI ? "/video-intelligence" : null}
    />
  );
}

/* ------------------------------ Opnames ---------------------------- */

function ShootsTab({ hub }: { hub: ClientHub }) {
  if (hub.shoots.length === 0)
    return <Card><EmptyState title="Geen opnamedagen" /></Card>;
  return (
    <Card padded={false}>
      <Table
        head={
          <>
            <th className="sc-th">Opnamedag</th>
            <th className="sc-th">Datum</th>
            <th className="sc-th">Locatie</th>
            <th className="sc-th text-right">Scripts</th>
            <th className="sc-th">Status</th>
          </>
        }
      >
        {hub.shoots.map((s) => (
          <tr key={s.id} className="sc-row-link">
            <td className="sc-td">
              <Link href={`/productions/${s.id}`} className="font-medium hover:underline">
                {s.title}
              </Link>
            </td>
            <td className="sc-td text-[var(--color-ink-muted)]">{formatDateFull(s.scheduledOn)}</td>
            <td className="sc-td text-[var(--color-ink-muted)]">{s.locationName ?? "—"}</td>
            <td className="sc-td text-right tabular-nums">{Number(s.scriptCount)}</td>
            <td className="sc-td">
              <Badge tone={PRODUCTION_STATUS[s.status]?.tone ?? "neutral"}>
                {PRODUCTION_STATUS[s.status]?.label ?? s.status}
              </Badge>
            </td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

/* ------------------------------ Planning --------------------------- */

function PlanningTab({ hub }: { hub: ClientHub }) {
  if (hub.calendar.length === 0)
    return <Card><EmptyState title="Nog niets ingepland" /></Card>;
  return (
    <Card padded={false}>
      <Table
        head={
          <>
            <th className="sc-th">Titel</th>
            <th className="sc-th">Datum</th>
            <th className="sc-th">Platforms</th>
            <th className="sc-th">Status</th>
          </>
        }
      >
        {hub.calendar.map((p) => (
          <tr key={p.id}>
            <td className="sc-td font-medium">{p.title}</td>
            <td className="sc-td text-[var(--color-ink-muted)]">{formatDateFull(p.scheduledOn)}</td>
            <td className="sc-td">
              <span className="flex gap-1.5">
                {(p.platforms as string[]).map((pl) => (
                  <span
                    key={pl}
                    title={PLATFORM[pl]?.label ?? pl}
                    className="size-2.5 rounded-full"
                    style={{ background: PLATFORM[pl]?.color ?? "#999" }}
                  />
                ))}
              </span>
            </td>
            <td className="sc-td">
              <Badge tone={PUBLICATION_STATUS[p.status]?.tone ?? "neutral"}>
                {PUBLICATION_STATUS[p.status]?.label ?? p.status}
              </Badge>
            </td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

/* ----------------------------- Resultaten -------------------------- */

function ResultsTab({ hub }: { hub: ClientHub }) {
  // Vullen-of-verbergen (#12): zonder cijfers én zonder kanalen is dit tabblad
  // leeg — toon dan één eerlijke uitleg i.p.v. een rij nullen.
  const hasMetrics =
    hub.metrics.views + hub.metrics.reach + hub.metrics.engagements + Math.abs(hub.metrics.followerGrowth) > 0;
  if (!hasMetrics && hub.socials.length === 0) {
    return (
      <EmptyState
        title="Nog geen resultaten gekoppeld"
        description="Zodra de kanalen van deze klant aan Metricool gekoppeld zijn en er cijfers binnenkomen, verschijnen hier de weergaven, het bereik en de volgersgroei."
      />
    );
  }
  return (
    <div className="space-y-5">
      {hasMetrics ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Weergaven (30d)" value={compact(hub.metrics.views)} />
          <Stat label="Bereik (30d)" value={compact(hub.metrics.reach)} />
          <Stat label="Interacties (30d)" value={compact(hub.metrics.engagements)} />
          <Stat label="Volgersgroei (30d)" value={`+${num(hub.metrics.followerGrowth)}`} />
        </div>
      ) : null}

      <Card padded={false}>
        <div className="p-5 pb-3">
          <CardHeader title="Kanalen" subtitle="Gekoppelde accounts en volgersaantallen." />
        </div>
        {hub.socials.length === 0 ? (
          <EmptyState title="Geen kanalen gekoppeld" />
        ) : (
          <ul className="divide-y divide-[var(--color-line)]">
            {hub.socials.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-5 py-3">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: PLATFORM[a.platform]?.color ?? "#999" }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {PLATFORM[a.platform]?.label ?? a.platform}
                  </span>
                  <span className="block text-xs text-[var(--color-ink-muted)]">{a.handle}</span>
                </span>
                <span className="text-sm font-semibold tabular-nums">{num(a.followers)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {hasMetrics ? (
        <p className="text-xs text-[var(--color-ink-muted)]">
          Weergaven en interacties zijn vrijwel actueel. Bereik, kijktijd en retentie
          lopen bij de meeste platforms één tot drie dagen achter.
        </p>
      ) : null}
    </div>
  );
}

/* ---------------------------- Rapportages -------------------------- */

function ReportsTab({ hub, slug, canWrite }: { hub: ClientHub; slug: string; canWrite: boolean }) {
  return (
    <div className="space-y-4">
      {canWrite ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3">
          <p className="text-sm text-[var(--color-ink-muted)]">Rapport wordt automatisch uit de cijfers samengesteld; jij keurt goed en publiceert naar het portaal.</p>
          <GenerateReportButton slug={slug} />
        </div>
      ) : null}

      {hub.reports.length === 0 ? (
        <Card><EmptyState title="Nog geen rapportages" description="Genereer het eerste maandrapport met de knop hierboven, of wacht op de nachtelijke concept-generatie." /></Card>
      ) : null}

      {hub.reports.map((r) => (
        <Card key={r.id}>
          <CardHeader
            title={r.title}
            subtitle={`${periodLabel(r.period)} · ${r.isPublished ? "gepubliceerd naar het portaal" : "concept"}`}
            action={
              <span className="flex items-center gap-2">
                <Badge tone={r.isPublished ? "good" : "neutral"}>{r.isPublished ? "live" : "concept"}</Badge>
                {canWrite ? <ReportPublishToggle reportId={r.id} published={r.isPublished} /> : null}
              </span>
            }
          />
          {r.summary ? (
            <p className="mt-3 text-sm text-[var(--color-ink-muted)]">{r.summary}</p>
          ) : null}
          {r.manualNote ? (
            <p className="mt-3 rounded-[var(--radius-sm)] bg-[var(--color-info-soft)] px-3 py-2 text-sm">
              <strong className="font-semibold">Toelichting:</strong> {r.manualNote}
            </p>
          ) : null}
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Object.entries((r.metrics ?? {}) as Record<string, number>).map(([key, value]) => (
              <div key={key} className="rounded-[var(--radius-sm)] bg-[var(--color-surface-sunken)] px-3 py-2">
                <p className="text-2xs tracking-wide text-[var(--color-ink-faint)] uppercase">
                  {key === "videos" ? "video's" : key === "views" ? "weergaven" : key === "reach" ? "bereik" : "volgersgroei"}
                </p>
                <p className="text-sm font-semibold tabular-nums">{compact(Number(value))}</p>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

/* ---------------------------- Klantkennis -------------------------- */

const KNOWLEDGE_LABELS: Record<string, string> = {
  tone_of_voice: "Tone of voice",
  audience: "Doelgroep",
  avoid_words: "Woorden vermijden",
  hook_style: "Hookstijl",
  editing_style: "Editingstijl",
  content_pillar: "Contentpijlers",
  recurring_correction: "Terugkerende correcties",
  fact: "Bedrijfsfeiten",
  strong_example: "Sterke voorbeelden",
  weak_example: "Zwakke voorbeelden",
  competitor: "Concurrenten",
};

function KnowledgeTab({ hub }: { hub: ClientHub }) {
  if (hub.knowledge.length === 0)
    return <Card><EmptyState title="Nog geen klantkennis vastgelegd" description="Klantkennis voedt straks de AI-functies: tone of voice, doelgroep, hookstijl en terugkerende correcties." /></Card>;

  const grouped = new Map<string, typeof hub.knowledge>();
  for (const k of hub.knowledge) {
    const list = grouped.get(k.category) ?? [];
    list.push(k);
    grouped.set(k.category, list);
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {[...grouped.entries()].map(([category, items]) => (
        <Card key={category}>
          <CardHeader title={KNOWLEDGE_LABELS[category] ?? category} />
          <ul className="mt-3 space-y-3">
            {items.map((k) => (
              <li key={k.id}>
                <p className="text-sm font-medium">{k.title}</p>
                <p className="mt-0.5 text-sm text-[var(--color-ink-muted)]">{k.body}</p>
                {k.source !== "manual" ? (
                  <Badge tone="info" className="mt-1.5">
                    afgeleid uit data
                  </Badge>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

/* ---------------------------- Documenten --------------------------- */

function FilesTab({ hub }: { hub: ClientHub }) {
  return <FilesBrowser files={hub.files} />;
}

/* ----------------------------- Contacten --------------------------- */

function ContactsTab({ hub }: { hub: ClientHub }) {
  if (hub.contacts.length === 0)
    return <Card><EmptyState title="Geen contactpersonen" /></Card>;
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {hub.contacts.map((c) => (
        <Card key={c.id}>
          <div className="flex items-start gap-3">
            <Avatar name={c.fullName} size={38} />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{c.fullName}</p>
              <p className="text-sm text-[var(--color-ink-muted)]">{c.role ?? "—"}</p>
              <div className="mt-2 space-y-0.5 text-sm">
                {c.email ? (
                  <a href={`mailto:${c.email}`} className="block truncate text-[var(--color-brand-600)] hover:underline">
                    {c.email}
                  </a>
                ) : null}
                {c.phone ? (
                  <span className="block text-[var(--color-ink-muted)]">{c.phone}</span>
                ) : null}
              </div>
              <div className="mt-2 flex gap-1.5">
                {c.isPrimary ? <Badge tone="info">hoofdcontact</Badge> : null}
                {c.isApprover ? <Badge tone="lime">keurt goed</Badge> : null}
              </div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

/* ------------------------ Contract & facturatie -------------------- */

function FinanceTab({ hub }: { hub: ClientHub }) {
  const c = hub.client;
  const revenue = Number(c.monthlyRevenue) || 0;
  const shorts = c.monthlyVideoQuota || 0;
  const editPer = c.editCostPerVideo != null ? Number(c.editCostPerVideo) : null;

  const extra = c.extraRevenue != null ? Number(c.extraRevenue) : null;
  const revPerShort = shorts > 0 ? revenue / shorts : null;
  const totalEditMonth = editPer != null && shorts > 0 ? editPer * shorts : null;
  // Netto opbrengst = afnameprijs − editkosten. Primair de officiële Monday-waarde
  // (HOOFDBOARD-formule), met de eigen berekening als terugval.
  const mondayNet = c.netMonthlyMonday != null ? Number(c.netMonthlyMonday) : null;
  const grossMonth = mondayNet ?? (totalEditMonth != null ? revenue - totalEditMonth : null);
  const marginPct = grossMonth != null && revenue > 0 ? Math.round((grossMonth / revenue) * 100) : null;

  // Looptijd en totale (geschatte) omzet o.b.v. het maandbedrag.
  const start = c.startedOn ? new Date(c.startedOn) : null;
  const end = c.endedOn ? new Date(c.endedOn) : new Date();
  const monthsActive = start ? Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 30.44))) : null;
  const totalRevenue = monthsActive != null ? revenue * monthsActive : null;

  // Einddatum: stopdatum (als gestopt), anders start + contractduur.
  let endDate: string | null = c.endedOn ?? null;
  if (!endDate && start && c.contractMonths) {
    const d = new Date(start);
    d.setMonth(d.getMonth() + c.contractMonths);
    endDate = d.toISOString().slice(0, 10);
  }

  // Meest voorkomende editor uit de video's van deze klant.
  const editorCount = new Map<string, number>();
  for (const v of hub.videos) if (v.editorName) editorCount.set(v.editorName, (editorCount.get(v.editorName) ?? 0) + 1);
  const topEditor = [...editorCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const monday = hub.integrations.find((i) => i.provider === "monday");
  const lastSynced = monday?.lastSyncedAt ?? null;
  const unknown = <span className="text-[var(--color-ink-faint)]">onbekend</span>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[var(--color-ink-muted)]">Automatisch uit Monday. Alle bedragen exclusief btw.</p>
        <span className="text-xs text-[var(--color-ink-faint)]">
          Laatst bijgewerkt: {lastSynced ? formatDateTime(lastSynced) : "nog niet gesynchroniseerd"}
        </span>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Omzet */}
        <Card padded={false} className="overflow-hidden">
          <div className="bg-[var(--color-indigo-ink)] px-5 py-2.5 text-sm font-bold text-white">Omzet</div>
          <dl className="divide-y divide-[var(--color-line)]">
            <FinRow label="Maandelijkse contractwaarde" value={euro(revenue)} strong />
            <FinRow label="Shorts per maand" value={shorts > 0 ? String(shorts) : unknown} />
            <FinRow label="Omzet per short" value={revPerShort != null ? euro(revPerShort) : unknown} />
            <FinRow label="Totale omzet (geschat)" value={totalRevenue != null ? euro(totalRevenue) : unknown} hint={monthsActive != null ? `${monthsActive} maanden × maandbedrag` : undefined} />
            <FinRow label="Aanvullende omzet (meerwerk)" value={extra != null && extra > 0 ? euro(extra) : <span className="text-[var(--color-ink-faint)]">geen deze maand</span>} hint="uit Monday" />
          </dl>
        </Card>

        {/* Contract */}
        <Card padded={false} className="overflow-hidden">
          <div className="bg-[var(--color-indigo-ink)] px-5 py-2.5 text-sm font-bold text-white">Contract</div>
          <dl className="divide-y divide-[var(--color-line)]">
            <FinRow label="Startdatum" value={c.startedOn ? formatDateFull(c.startedOn) : unknown} />
            <FinRow label="Contractduur" value={c.contractMonths ? `${c.contractMonths} maanden` : unknown} />
            <FinRow label={c.endedOn ? "Stopdatum" : "Einddatum / verlenging"} value={endDate ? formatDateFull(endDate) : unknown} />
            <FinRow label="Status" value={<Badge tone={c.status === "active" ? "ink" : CLIENT_STATUS[c.status]?.tone ?? "neutral"}>{CLIENT_STATUS[c.status]?.label ?? c.status}</Badge>} />
          </dl>
        </Card>

        {/* Productiekosten */}
        <Card padded={false} className="overflow-hidden">
          <div className="bg-[var(--color-indigo-ink)] px-5 py-2.5 text-sm font-bold text-white">Productiekosten</div>
          <dl className="divide-y divide-[var(--color-line)]">
            <FinRow label="Editkosten per short" value={editPer != null ? euro(editPer) : unknown} />
            <FinRow label="Totale editkosten per maand" value={totalEditMonth != null ? euro(totalEditMonth) : unknown} hint={editPer != null && shorts > 0 ? `${euro(editPer)} × ${shorts}` : undefined} />
            <FinRow label="Editor" value={topEditor ?? unknown} />
            <FinRow label="Overige directe kosten" value={<span className="text-[var(--color-ink-faint)]">niet in Monday</span>} hint="opname, strategie, overhead" />
          </dl>
        </Card>

        {/* Rendement */}
        <Card padded={false} className="overflow-hidden">
          <div className="bg-[var(--color-indigo-ink)] px-5 py-2.5 text-sm font-bold text-white">Rendement</div>
          <dl className="divide-y divide-[var(--color-line)]">
            <FinRow label="Omzet per short" value={revPerShort != null ? euro(revPerShort) : unknown} />
            <FinRow label="Editkosten per short" value={editPer != null ? euro(editPer) : unknown} />
            <FinRow label="Opbrengst na editkosten" value={grossMonth != null ? euro(grossMonth) : unknown} hint="afnameprijs − editkosten (Monday)" strong />
            <FinRow label="Brutomarge" value={marginPct != null ? `${marginPct}%` : unknown} />
            <FinRow label="Nettowinst" value={<span className="text-[var(--color-ink-faint)]">onbekend</span>} hint="vereist overige kosten" />
          </dl>
        </Card>
      </div>

      {/* Maandstaten: echte nettowinst per maand incl. handmatige directe kosten. */}
      <Card padded={false} className="overflow-hidden">
        <div className="flex items-center justify-between gap-2 bg-[var(--color-indigo-ink)] px-5 py-2.5 text-white">
          <div>
            <div className="text-sm font-bold">Maandstaten — echte nettowinst</div>
            <div className="text-2xs text-white/60">Omzet, meerwerk en editkosten automatisch uit Monday; vul opname-, strategie- en overige kosten in voor de werkelijke nettowinst.</div>
          </div>
        </div>
        <FinanceMonths
          clientId={c.id}
          canWrite={hub.canWriteFinance}
          months={hub.financeMonths.map((m) => ({
            id: m.id, period: m.period, revenue: m.revenue, extraRevenue: m.extraRevenue, editCost: m.editCost,
            shootCost: m.shootCost, strategyCost: m.strategyCost, otherCost: m.otherCost, note: m.note,
          }))}
        />
      </Card>

      <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-sunken)] px-4 py-3 text-xs text-[var(--color-ink-muted)]">
        <strong className="font-semibold text-[var(--color-ink)]">Opbrengst na editkosten</strong> is de afnameprijs minus de editkosten — dezelfde berekening als Monday&apos;s formule &quot;Netto opbrengst per maand&quot; (Monday-formules zijn niet los via de API uitleesbaar, dus we berekenen hem uit dezelfde Monday-invoer; de uitkomst is identiek). Het is winst ná editkosten. Overige kosten zoals opname, strategie en overhead staan niet in Monday en zijn hier <strong>niet</strong> op nul gezet — daarom is de <strong className="font-semibold text-[var(--color-ink)]">echte nettowinst onbekend</strong> tot die kosten beschikbaar zijn.
      </div>
    </div>
  );
}

function FinRow({ label, value, hint, strong }: { label: string; value: React.ReactNode; hint?: string; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 py-2.5">
      <dt className="text-sm text-[var(--color-ink-muted)]">
        {label}
        {hint ? <span className="mt-0.5 block text-2xs text-[var(--color-ink-faint)]">{hint}</span> : null}
      </dt>
      <dd className={`text-right text-sm tabular-nums ${strong ? "font-bold" : "font-medium"}`}>{value}</dd>
    </div>
  );
}

function ContractTab({ hub }: { hub: ClientHub }) {
  const contract = hub.contract;
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader title="Contract" />
          {contract ? (
            <dl className="mt-4 space-y-3 text-sm">
              <Row label="Referentie" value={contract.reference ?? "—"} />
              <Row label="Start" value={formatDateFull(contract.startsOn)} />
              <Row
                label="Einde"
                value={
                  contract.endsOn ? (
                    <span className={daysUntil(contract.endsOn) < 60 ? "text-[var(--color-bad)]" : undefined}>
                      {formatDateFull(contract.endsOn)} ({daysUntil(contract.endsOn)} d)
                    </span>
                  ) : "doorlopend"
                }
              />
              <Row label="Opzegtermijn" value={`${contract.noticePeriodDays} dagen`} />
              <Row label="Verlengt automatisch" value={contract.autoRenew ? "ja" : "nee"} />
              <Row label="Maandwaarde" value={euro(contract.monthlyValue)} />
            </dl>
          ) : (
            <EmptyState title="Geen contract vastgelegd" />
          )}
        </Card>

        <Card className="lg:col-span-2" padded={false}>
          <div className="p-5 pb-3">
            <CardHeader title="Facturen" />
          </div>
          {hub.invoices.length === 0 ? (
            <EmptyState title="Geen facturen" />
          ) : (
            <Table
              head={
                <>
                  <th className="sc-th">Nummer</th>
                  <th className="sc-th">Periode</th>
                  <th className="sc-th">Vervaldatum</th>
                  <th className="sc-th text-right">Bedrag</th>
                  <th className="sc-th">Status</th>
                </>
              }
            >
              {hub.invoices.map((i) => (
                <tr key={i.id}>
                  <td className="sc-td font-medium">{i.number}</td>
                  <td className="sc-td text-[var(--color-ink-muted)]">
                    {i.period ? periodLabel(i.period) : "—"}
                  </td>
                  <td className="sc-td text-[var(--color-ink-muted)]">{formatDate(i.dueOn)}</td>
                  <td className="sc-td text-right tabular-nums">{euro(i.total, true)}</td>
                  <td className="sc-td">
                    <Badge tone={INVOICE_STATUS[i.status]?.tone ?? "neutral"}>
                      {INVOICE_STATUS[i.status]?.label ?? i.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}

/* --------------------------- AI-inzichten -------------------------- */

function InsightsTab({ hub }: { hub: ClientHub }) {
  if (hub.insights.length === 0)
    return (
      <Card>
        <EmptyState
          title="Nog geen inzichten"
          description="Inzichten ontstaan zodra er genoeg gepubliceerde video's en cijfers zijn om iets betrouwbaars over te zeggen."
          icon={<Sparkles className="size-6" />}
        />
      </Card>
    );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {hub.insights.map((i) => (
        <Card key={i.id}>
          <CardHeader
            title={i.title}
            action={
              <Badge tone={i.method === "deterministic" ? "info" : "lime"}>
                {i.method === "deterministic" ? "berekend" : "taalmodel"}
              </Badge>
            }
          />
          <p className="mt-3 text-sm text-[var(--color-ink-muted)]">{i.body}</p>

          <div className="mt-4 rounded-[var(--radius-sm)] bg-[var(--color-surface-sunken)] p-3">
            <p className="text-2xs font-semibold tracking-wide text-[var(--color-ink-faint)] uppercase">
              Gebaseerd op
            </p>
            <ul className="mt-1.5 space-y-1 text-xs text-[var(--color-ink-muted)]">
              {(i.evidence as Array<{ label: string; value: unknown; source?: string }>).map(
                (e, idx) => (
                  <li key={idx} className="flex justify-between gap-3">
                    <span>{e.label}</span>
                    <span className="font-medium tabular-nums text-[var(--color-ink)]">
                      {String(e.value)}
                    </span>
                  </li>
                ),
              )}
            </ul>
            <p className="mt-2 text-2xs text-[var(--color-ink-faint)]">
              {plural(i.sampleSize, "datapunt", "datapunten")} · {formatDate(i.generatedAt)}
            </p>
          </div>
        </Card>
      ))}
    </div>
  );
}

/* --------------------------- Koppelingen --------------------------- */

const PROVIDER_LABELS: Record<string, string> = {
  monday: "Monday.com",
  frameio: "Frame.io",
  google_drive: "Google Drive",
  ayrshare: "Ayrshare",
  metricool: "Metricool",
};

function IntegrationsTab({ hub }: { hub: ClientHub }) {
  return (
    <Card padded={false}>
      <div className="p-5 pb-3">
        <CardHeader
          title="Externe koppelingen van deze klant"
          subtitle="Welk board, project of map hoort bij deze klant."
          action={
            <LinkButton href="/settings/integrations" variant="secondary" size="sm">
              Koppelingen beheren
            </LinkButton>
          }
        />
      </div>
      {hub.integrations.length === 0 ? (
        <EmptyState
          title="Nog niets gekoppeld"
          description="Koppel het Monday-board, het Frame.io-project en de Drive-map, zodat alles van deze klant hier samenkomt."
        />
      ) : (
        <Table
          head={
            <>
              <th className="sc-th">Systeem</th>
              <th className="sc-th">Extern object</th>
              <th className="sc-th">Laatst gesynchroniseerd</th>
              <th className="sc-th">Status</th>
            </>
          }
        >
          {hub.integrations.map((i) => (
            <tr key={i.id}>
              <td className="sc-td font-medium">{PROVIDER_LABELS[i.provider] ?? i.provider}</td>
              <td className="sc-td text-[var(--color-ink-muted)]">
                {i.externalName ?? i.externalId}
              </td>
              <td className="sc-td text-[var(--color-ink-muted)]">
                {i.lastSyncedAt ? formatDateTime(i.lastSyncedAt) : "nog niet"}
              </td>
              <td className="sc-td">
                <Badge tone={i.isActive ? "good" : "neutral"}>
                  {i.isActive ? "actief" : "uit"}
                </Badge>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

