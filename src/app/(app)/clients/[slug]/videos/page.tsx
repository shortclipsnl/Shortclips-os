import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { ArrowLeft, ArrowRight, CalendarDays, ExternalLink, Film } from "lucide-react";
import { db } from "@/db/client";
import { clients } from "@/db/schema";
import { assertClientAccess, requireInternal } from "@/server/auth/context";
import { getFrameLibraryForClient, type PortalFrameSession } from "@/server/portal-frame";
import { FrameVideoGrid } from "@/components/portal/frame-video-grid";
import { StatusPill, type StatusTone } from "@/components/portal/status-pill";
import { ClientLogo } from "@/components/ui";
import { formatDateFull } from "@/lib/format";

export const metadata: Metadata = { title: "Short video's" };
export const dynamic = "force-dynamic";

/**
 * Interne knop "Short video's" bij een klant: alle video's per opnamesessie.
 * Bewust géén eigen videosysteem: dezelfde bibliotheek (`getFrameLibraryForClient`),
 * hetzelfde videoraster en dezelfde beveiligde afspeel- en downloadroutes als de
 * videopagina in het klantportaal. Wat de klant ziet, ziet het team ook.
 * Alleen voor medewerkers met toegang tot deze klant.
 */

const TONE: Record<NonNullable<PortalFrameSession["status"]>["key"], StatusTone> = {
  feedback: "orange",
  verwerken: "blue",
  productie: "blue",
  goedgekeurd: "green",
  online: "green",
};

function SessionStatus({ s }: { s: PortalFrameSession }) {
  if (!s.status) return null;
  const label = s.status.key === "feedback" ? "Wacht op feedback klant" : s.status.label;
  return <StatusPill tone={TONE[s.status.key]}>{label}</StatusPill>;
}

function sessionSub(s: PortalFrameSession): string {
  const parts: string[] = [];
  if (s.shootDate) parts.push(`Opname ${formatDateFull(s.shootDate)}`);
  parts.push(`${s.videos.length} video${s.videos.length === 1 ? "" : "'s"}`);
  return parts.join(" · ");
}

export default async function ClientVideosPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ sessie?: string }>;
}) {
  const viewer = await requireInternal();
  const { slug } = await params;
  const { sessie } = await searchParams;
  const [client] = await db
    .select({ id: clients.id, name: clients.name, slug: clients.slug, logoUrl: clients.logoUrl, color: clients.color })
    .from(clients)
    .where(and(eq(clients.slug, slug), isNull(clients.deletedAt)))
    .limit(1);
  if (!client) notFound();
  assertClientAccess(viewer, client.id);

  const lib = await getFrameLibraryForClient(client.id);
  const base = `/clients/${client.slug}/videos`;
  const selected = sessie ? lib.sessions.find((s) => s.key === sessie) ?? null : null;

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <ClientLogo name={client.name} logoUrl={client.logoUrl} color={client.color} size={40} />
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight">Short video&apos;s · {client.name}</h1>
          <p className="text-sm text-[var(--color-ink-muted)]">
            {lib.sessions.length} sessies · {lib.totalVideos} video&apos;s, rechtstreeks uit Frame. Dezelfde video&apos;s als in het klantportaal.
          </p>
        </div>
      </div>
      {lib.reviewUrl ? (
        <a href={lib.reviewUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--color-surface-2)]">
          <ExternalLink className="size-3.5" /> Openen in Frame
        </a>
      ) : null}
    </div>
  );

  if (selected) {
    return (
      <div className="sc-lib flex flex-col gap-6">
        <Link href={base} className="inline-flex w-fit items-center gap-1.5 text-[13px] font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
          <ArrowLeft className="size-4" /> Alle opnamesessies
        </Link>
        {header}
        <section className="sc-card flex flex-col gap-5 p-5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-[17px] font-semibold">{selected.title}</h2>
            <SessionStatus s={selected} />
            <span className="text-[13px] text-[var(--color-ink-muted)]">{sessionSub(selected)}</span>
          </div>
          <FrameVideoGrid videos={selected.videos} reviewUrl={lib.reviewUrl} />
        </section>
      </div>
    );
  }

  return (
    <div className="sc-lib flex flex-col gap-6">
      <Link href={`/clients/${client.slug}`} className="inline-flex w-fit items-center gap-1.5 text-[13px] font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
        <ArrowLeft className="size-4" /> {client.name}
      </Link>
      {header}

      {lib.sessions.length === 0 ? (
        <section className="sc-card grid place-items-center gap-2 p-14 text-center">
          <Film className="size-7 text-[var(--color-ink-faint)]" strokeWidth={1.5} />
          <p className="text-sm font-semibold">Nog geen video&apos;s gevonden in Frame</p>
          <p className="max-w-md text-[13px] text-[var(--color-ink-muted)]">
            {lib.connected
              ? "Zodra er video's in het Frame-project van deze klant staan, verschijnen ze hier automatisch per opnamesessie."
              : "Deze klant is nog niet aan een Frame-project gekoppeld. Koppel het project op de klantpagina, dan verschijnen de video's hier automatisch."}
          </p>
        </section>
      ) : (
        <section>
          <h2 className="mb-3.5 flex items-center gap-2 text-[15px] font-semibold"><CalendarDays className="size-4 text-[var(--sc-accent)]" /> Opnamesessies</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {lib.sessions.map((s) => {
              const covers = s.videos.slice(0, 3);
              return (
                <Link key={s.key} href={`${base}?sessie=${encodeURIComponent(s.key)}`} className="sc-card group flex flex-col overflow-hidden p-0 transition-shadow hover:shadow-[var(--shadow-raised)]">
                  <div className="grid h-40 grid-cols-3 gap-px bg-[var(--color-line)]">
                    {covers.map((v) => (
                      <div key={v.id} className="relative overflow-hidden bg-[var(--color-surface-2)]">
                        <span className="absolute inset-0 grid place-items-center text-[var(--color-ink-faint)]"><Film className="size-5" strokeWidth={1.5} /></span>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/portal/frame/${v.id}/thumb`} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
                      </div>
                    ))}
                    {Array.from({ length: Math.max(0, 3 - covers.length) }).map((_, i) => <div key={i} className="bg-[var(--color-surface-sunken)]" />)}
                  </div>
                  <div className="flex flex-1 flex-col gap-2 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-[15px] font-semibold leading-snug">{s.title}</h3>
                      <ArrowRight className="mt-0.5 size-4 shrink-0 text-[var(--color-ink-faint)] transition-transform group-hover:translate-x-0.5" />
                    </div>
                    <p className="text-[12.5px] text-[var(--color-ink-muted)]">{sessionSub(s)}</p>
                    <div className="mt-auto pt-1"><SessionStatus s={s} /></div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
