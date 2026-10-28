import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink, FileText, Video } from "lucide-react";
import { requireManageClients } from "@/server/auth/context";
import { listClientsAdmin } from "@/server/clients";
import { listPortalClients, type PortalStatus } from "@/server/portal-admin";
import { emailConfigured } from "@/server/email";
import { Avatar, Badge, Card, ClientLogo, EmptyState, InfoNote, LinkButton, PageHeader, Stat, Table } from "@/components/ui";
import { CLIENT_STATUS } from "@/lib/statuses";
import { ClientRowActions } from "./row-actions";
import { ClientPortalManager } from "../klantportalen/portalen-beheer";

export const metadata: Metadata = { title: "Klanten" };
export const dynamic = "force-dynamic";

const STOPPED = new Set(["paused", "churned"]);
const FILTERS = [
  { key: "actief", label: "Actief" },
  { key: "gestopt", label: "Gestopt" },
  { key: "alle", label: "Alle" },
] as const;

const PORTAL_BADGE: Record<PortalStatus, { label: string; cls: string }> = {
  actief: { label: "Actief", cls: "bg-[var(--color-good-soft)] text-[#1d6b4c]" },
  uitgenodigd: { label: "Uitgenodigd", cls: "bg-[var(--color-warn-soft)] text-[#8a5300]" },
  gedeactiveerd: { label: "Gedeactiveerd", cls: "bg-[var(--color-bad-soft)] text-[var(--color-bad)]" },
  geen: { label: "Geen toegang", cls: "bg-[var(--color-neutral-soft)] text-[var(--color-ink-muted)]" },
};

function portalBadge(email: string | null) {
  if (!email) return <Badge tone="warn">Geen login</Badge>;
  if (email.toLowerCase().endsWith("@pilot.shortclips.nl")) return <Badge tone="info">Placeholder</Badge>;
  return <Badge tone="good">Eigen e-mail</Badge>;
}

function fmtDate(d: Date | null) {
  if (!d) return null;
  try { return new Date(d).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" }); }
  catch { return null; }
}

/** Twee tabbladen onder één dak: alles rond klanten op één plek. */
function tabLink(active: boolean) {
  return `rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${active ? "bg-[var(--color-indigo-ink)] text-white" : "bg-[var(--color-surface-2)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`;
}

export default async function KlantenPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; status?: string }>;
}) {
  const viewer = await requireManageClients();
  const params = await searchParams;
  const tab: "overzicht" | "portalen" = params.tab === "portalen" ? "portalen" : "overzicht";

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Klanten"
        description="Beheer en portalen van al je klanten op één plek."
        actions={tab === "overzicht" ? <LinkButton href="/clients/new">Nieuwe klant</LinkButton> : undefined}
      />

      <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-[var(--color-line)] bg-[var(--color-surface-2)] p-1">
        <Link href="/klantenbeheer" className={tabLink(tab === "overzicht")}>Overzicht</Link>
        <Link href="/klantenbeheer?tab=portalen" className={tabLink(tab === "portalen")}>Portalen</Link>
      </div>

      {tab === "overzicht" ? <OverzichtTab viewer={viewer} status={params.status} /> : <PortalenTab viewer={viewer} />}
    </div>
  );
}

/* ----------------------------------------------------- Tab: overzicht */

async function OverzichtTab({ viewer, status }: { viewer: Awaited<ReturnType<typeof requireManageClients>>; status?: string }) {
  const all = await listClientsAdmin(viewer);
  const filterKey = status ?? "actief";
  const rows =
    filterKey === "gestopt"
      ? all.filter((r) => STOPPED.has(r.status))
      : filterKey === "alle"
        ? all
        : all.filter((r) => !STOPPED.has(r.status));

  const activeCount = all.filter((r) => !STOPPED.has(r.status)).length;
  const stoppedCount = all.filter((r) => STOPPED.has(r.status)).length;
  const placeholderCount = all.filter(
    (r) => !STOPPED.has(r.status) && r.portalEmail?.toLowerCase().endsWith("@pilot.shortclips.nl"),
  ).length;
  const noLoginCount = all.filter((r) => !STOPPED.has(r.status) && !r.portalEmail).length;

  return (
    <>
      {placeholderCount > 0 || noLoginCount > 0 ? (
        <div className="mb-4">
          <InfoNote tone="warn">
            {placeholderCount > 0 ? `${placeholderCount} actieve klanten hebben nog een placeholder-login (@pilot.shortclips.nl). ` : ""}
            {noLoginCount > 0 ? `${noLoginCount} actieve klanten hebben nog geen portaallogin. ` : ""}
            Vul het echte e-mailadres in bij de klant en draai daarna de portaalsetup.
          </InfoNote>
        </div>
      ) : null}

      <div className="mb-3 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const count = f.key === "gestopt" ? stoppedCount : f.key === "alle" ? all.length : activeCount;
          const active = f.key === filterKey;
          return (
            <Link
              key={f.key}
              href={f.key === "actief" ? "/klantenbeheer" : `/klantenbeheer?status=${f.key}`}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                active
                  ? "bg-[var(--color-indigo-ink)] text-white"
                  : "bg-[var(--color-surface-2)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
              }`}
            >
              {f.label} ({count})
            </Link>
          );
        })}
      </div>

      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState title="Geen klanten in deze weergave" description="Maak een klant aan of pas het filter aan." />
        ) : (
          <Table
            head={
              <>
                <th className="sc-th">Klant</th>
                <th className="sc-th">Status</th>
                <th className="sc-th">Verantwoordelijke</th>
                <th className="sc-th text-right">Shorts/maand</th>
                <th className="sc-th">Portaallogin</th>
                <th className="sc-th text-right">Acties</th>
              </>
            }
          >
            {rows.map((c) => (
              <tr key={c.id}>
                <td className="sc-td">
                  <Link href={`/clients/${c.slug}`} className="flex items-center gap-3">
                    <Avatar name={c.name} color={c.color} size={28} />
                    <span className="font-medium">{c.name}</span>
                  </Link>
                </td>
                <td className="sc-td">
                  <Badge tone={CLIENT_STATUS[c.status]?.tone ?? "neutral"}>
                    {CLIENT_STATUS[c.status]?.label ?? c.status}
                  </Badge>
                </td>
                <td className="sc-td text-[var(--color-ink-muted)]">{c.coordinatorName ?? "—"}</td>
                <td className="sc-td text-right tabular-nums">{c.monthlyVideoQuota}</td>
                <td className="sc-td">{portalBadge(c.portalEmail)}</td>
                <td className="sc-td">
                  <ClientRowActions slug={c.slug} status={c.status} />
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

/* ------------------------------------------------------ Tab: portalen */

async function PortalenTab({ viewer }: { viewer: Awaited<ReturnType<typeof requireManageClients>> }) {
  const { rows, totals } = await listPortalClients(viewer);
  const mail = emailConfigured();

  return (
    <>
      <p className="mb-4 text-sm text-[var(--color-ink-muted)]">
        Activeer en beheer het klantenportaal per klant: toegang geven, uitnodigen, wachtwoorden herstellen en zien wat er bij de klant openstaat.
      </p>

      {/* Status e-mailprovider — eerlijk tonen of uitnodigingen écht verstuurd worden. */}
      <div className={`mb-4 rounded-[var(--radius-md)] border px-4 py-2.5 text-sm ${mail ? "border-[var(--color-good)]/30 bg-[var(--color-good-soft)]/50 text-[#1d6b4c]" : "border-[var(--color-warn)]/30 bg-[var(--color-warn-soft)] text-[#8a5300]"}`}>
        {mail
          ? "E-mail staat aan — uitnodigingen en herstel-links worden automatisch gemaild."
          : "E-mail staat nog niet aan (RESEND_API_KEY + MAIL_FROM ontbreken). Uitnodigen werkt al: je krijgt een beveiligde link die je zelf doorgeeft, of kies ‘Direct wachtwoord’."}
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Actieve portalen" value={String(totals.actief)} tone={totals.actief > 0 ? "good" : undefined} />
        <Stat label="Uitgenodigd" value={String(totals.uitgenodigd)} tone={totals.uitgenodigd > 0 ? "warn" : undefined} />
        <Stat label="Zonder toegang" value={String(totals.geen)} />
        <Stat label="Scripts + video’s wachten" value={`${totals.scriptsWaiting} + ${totals.videosWaiting}`} tone={totals.scriptsWaiting + totals.videosWaiting > 0 ? "warn" : undefined} />
      </div>

      {rows.length === 0 ? (
        <Card><p className="text-sm text-[var(--color-ink-muted)]">Geen klanten gevonden binnen jouw toegang.</p></Card>
      ) : (
        <div className="space-y-3">
          {rows.map((c) => {
            const badge = PORTAL_BADGE[c.portalStatus];
            const last = fmtDate(c.lastLoginAt);
            return (
              <Card key={c.id} padded={false}>
                <div className="p-4">
                  <div className="flex flex-wrap items-start gap-3">
                    <ClientLogo name={c.name} logoUrl={c.logoUrl} color={c.color} size={40} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/clients/${c.slug}`} className="truncate text-sm font-bold text-[var(--color-ink)] hover:text-[var(--color-brand-700)]">{c.name}</Link>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-2xs font-semibold ${badge.cls}`}>{badge.label}</span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-2xs text-[var(--color-ink-faint)]">
                        <span>{c.users.length} gebruiker{c.users.length === 1 ? "" : "s"}</span>
                        {last ? <span>Laatste login {last}</span> : <span>Nog nooit ingelogd</span>}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3 text-xs">
                      {c.scriptsWaiting > 0 ? <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-warn-soft)] px-2 py-0.5 font-semibold text-[#8a5300]"><FileText className="size-3" /> {c.scriptsWaiting} script{c.scriptsWaiting === 1 ? "" : "s"}</span> : null}
                      {c.videosWaiting > 0 ? <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-warn-soft)] px-2 py-0.5 font-semibold text-[#8a5300]"><Video className="size-3" /> {c.videosWaiting} video{c.videosWaiting === 1 ? "" : "'s"}</span> : null}
                      <Link href={`/clients/${c.slug}`} className="inline-flex items-center gap-1 text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">Klant <ExternalLink className="size-3.5" /></Link>
                    </div>
                  </div>

                  <ClientPortalManager
                    clientId={c.id}
                    name={c.name}
                    users={c.users.map((u) => ({
                      id: u.id, email: u.email, fullName: u.fullName, status: u.status,
                      hasPassword: u.hasPassword,
                      lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
                      invitedAt: u.invitedAt ? u.invitedAt.toISOString() : null,
                    }))}
                  />
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
