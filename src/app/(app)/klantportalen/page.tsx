import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink, FileText, Video } from "lucide-react";
import { requireManageClients } from "@/server/auth/context";
import { listPortalClients, type PortalStatus } from "@/server/portal-admin";
import { emailConfigured } from "@/server/email";
import { Card, ClientLogo, PageHeader, Stat } from "@/components/ui";
import { ClientPortalManager } from "./portalen-beheer";

export const metadata: Metadata = { title: "Klantportalen" };
export const dynamic = "force-dynamic";

const PORTAL_BADGE: Record<PortalStatus, { label: string; cls: string }> = {
  actief: { label: "Actief", cls: "bg-[var(--color-good-soft)] text-[#1d6b4c]" },
  uitgenodigd: { label: "Uitgenodigd", cls: "bg-[var(--color-warn-soft)] text-[#8a5300]" },
  gedeactiveerd: { label: "Gedeactiveerd", cls: "bg-[var(--color-bad-soft)] text-[var(--color-bad)]" },
  geen: { label: "Geen toegang", cls: "bg-[var(--color-neutral-soft)] text-[var(--color-ink-muted)]" },
};

function fmtDate(d: Date | null) {
  if (!d) return null;
  try { return new Date(d).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" }); }
  catch { return null; }
}

export default async function KlantportalenPage() {
  const viewer = await requireManageClients();
  const { rows, totals } = await listPortalClients(viewer);
  const mail = emailConfigured();

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        title="Klantportalen"
        description="Activeer en beheer het klantenportaal per klant: toegang geven, uitnodigen, wachtwoorden herstellen en zien wat er bij de klant openstaat."
      />

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
    </div>
  );
}
