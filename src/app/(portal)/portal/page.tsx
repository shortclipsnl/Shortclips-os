import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, CheckCircle2, ExternalLink, FileText, Play, UserRound } from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { getPortalContact, getPortalData, getPortalFrameUrl } from "@/server/portal";
import { buttonClass } from "@/components/ui";
import { compact, formatDateFull, num, relativeDays } from "@/lib/format";
import { videoCover } from "./cover";

export const metadata: Metadata = { title: "Jouw omgeving" };
export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  opname: "Opnamedag",
  scriptbespreking: "Scriptbespreking",
  evaluatie: "Evaluatiegesprek",
  publicatie: "Publicatie",
  overig: "Afspraak",
};

function prodLabel(status: string): { label: string; cls: string } {
  if (status === "editing") return { label: "In edit", cls: "bg-[var(--color-info-soft)] text-[#4bc4ff]" };
  if (status === "internal_review" || status === "editor_revision")
    return { label: "Controle", cls: "bg-[var(--color-warn-soft)] text-[#ffb020]" };
  if (status === "scheduled" || status === "ready_to_publish" || status === "approved")
    return { label: "Klaar", cls: "bg-[var(--color-good-soft)] text-[#2fd27a]" };
  return { label: "In productie", cls: "bg-[var(--color-info-soft)] text-[#4bc4ff]" };
}

function ShortTile({ title, status }: { title: string; status: string }) {
  const s = prodLabel(status);
  return (
    <article className="sc-short" style={{ background: videoCover(title) }}>
      <span className={`absolute left-2.5 top-2.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${s.cls}`}>
        {s.label}
      </span>
      <span className="sc-play"><Play className="size-[18px] translate-x-0.5" fill="currentColor" /></span>
      <span className="absolute inset-x-3 bottom-3 truncate text-[12.5px] font-semibold text-white">{title}</span>
    </article>
  );
}

function ContactCard({ name, role, initials }: { name: string; role: string; initials: string }) {
  return (
    <div className="sc-glass p-5">
      <div className="flex items-center gap-3">
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#1b6fe8] to-[#22a7ff] font-semibold text-white">
          {initials}
        </span>
        <div>
          <div className="text-[15px] font-semibold">{name}</div>
          <div className="text-[13px] text-[var(--color-ink-muted)]">{role}</div>
        </div>
      </div>
    </div>
  );
}

export default async function PortalPage() {
  const viewer = await requirePortal();
  const [data, frameUrl, contact] = await Promise.all([
    getPortalData(viewer),
    getPortalFrameUrl(viewer),
    getPortalContact(viewer),
  ]);

  const openActions = data.awaitingApproval.length;
  const firstName = viewer.fullName.split(" ")[0];
  const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();

  return (
    <div className="flex flex-col gap-[18px]">
      {/* Hero */}
      <div className="flex flex-wrap items-end justify-between gap-3 px-0.5 pt-1">
        <div>
          <h1 className="text-[29px] font-bold tracking-tight">Welkom terug, {firstName}</h1>
          <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
            Alles rond de video&apos;s van {data.client.name} — in één studio-omgeving.
          </p>
        </div>
        {frameUrl ? (
          <a href={frameUrl} target="_blank" rel="noreferrer" className={buttonClass({ variant: "accent" })}>
            <ExternalLink className="size-4" /> Beoordeel in Frame
          </a>
        ) : null}
      </div>

      {/* Bento: wacht op jou + volgende opname */}
      <div className="grid gap-[18px] lg:grid-cols-[1.6fr_1fr]">
        <section className="sc-glass sc-glow p-5" style={{ background: "linear-gradient(180deg, rgba(25,168,255,0.09), rgba(255,255,255,0.03))" }}>
          <div className="flex items-center justify-between gap-3">
            {openActions > 0 ? (
              <span className="rounded-full bg-[var(--color-warn-soft)] px-3 py-1 text-xs font-semibold text-[#ffb020]">
                {openActions} {openActions === 1 ? "wacht" : "wachten"} op jou
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-[#2fd27a]">
                <CheckCircle2 className="size-5" /> Niets openstaand
              </span>
            )}
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">Actie nodig</span>
          </div>
          {data.awaitingApproval.length > 0 ? (
            <div className="mt-4 flex flex-col gap-3">
              {data.awaitingApproval.slice(0, 4).map((v) => (
                <Link key={v.id} href={`/portal/videos/${v.id}`} className="flex items-center gap-3.5 rounded-[14px] border border-white/10 bg-white/[0.04] p-3 transition-colors hover:bg-white/[0.07]">
                  <span className="grid h-[52px] w-[40px] shrink-0 place-items-center rounded-[9px] text-white" style={{ background: videoCover(v.title) }}>
                    <Play className="size-4" fill="currentColor" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{v.title}</span>
                    <span className="block text-[12.5px] text-[var(--color-ink-muted)]">Klaar om te bekijken · {relativeDays(v.statusChangedAt)}</span>
                  </span>
                  <span className="shrink-0 rounded-full bg-[var(--color-warn-soft)] px-2.5 py-1 text-[11px] font-semibold text-[#ffb020]">Jouw akkoord</span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-[var(--color-ink-muted)]">Je hoeft nu niets te doen. Wij zijn aan zet.</p>
          )}
        </section>

        <section className="sc-glass p-5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">Volgende opname</span>
          {data.upcomingShoot ? (
            <div className="mt-3 flex gap-3.5">
              <div className="flex size-[62px] shrink-0 flex-col items-center justify-center rounded-[15px] border border-white/10 bg-gradient-to-br from-[rgba(25,168,255,0.22)] to-[rgba(27,95,224,0.22)]">
                <span className="text-xl font-bold leading-none">{new Date(data.upcomingShoot.scheduledOn).getDate()}</span>
                <span className="mt-1 text-[10.5px] uppercase tracking-wider text-[var(--color-ink-muted)]">
                  {new Date(data.upcomingShoot.scheduledOn).toLocaleDateString("nl-NL", { month: "short" })}
                </span>
              </div>
              <div>
                <div className="text-[15px] font-semibold">Opnamedag</div>
                <div className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
                  {relativeDays(data.upcomingShoot.scheduledOn)}
                  {data.upcomingShoot.startTime ? ` · vanaf ${data.upcomingShoot.startTime.slice(0, 5)}` : ""}
                </div>
                {contact.videographer ? (
                  <div className="mt-2 flex items-center gap-1.5 text-[13px] text-[var(--color-ink-muted)]">
                    <UserRound className="size-3.5" /> {contact.videographer.name.split(" ")[0]} · videograaf
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-[var(--color-ink-muted)]">Nog geen opname gepland. Je contactpersoon neemt contact met je op.</p>
          )}
        </section>
      </div>

      {/* Waar we mee bezig zijn */}
      <section className="sc-glass p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Waar we mee bezig zijn</h2>
          <Link href="/portal/videos" className="text-[13px] font-semibold text-[#4bc4ff]">Alle video&apos;s →</Link>
        </div>
        {data.inProgress.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--color-ink-muted)]">Op dit moment staat er niets in productie.</p>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4">
            {data.inProgress.slice(0, 4).map((v) => (
              <Link key={v.id} href={`/portal/videos/${v.id}`}><ShortTile title={v.title} status={v.status} /></Link>
            ))}
          </div>
        )}
      </section>

      {/* Resultaten + afspraken */}
      <div className="grid gap-[18px] lg:grid-cols-[1.6fr_1fr]">
        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">Resultaten — 30 dagen</h2>
            <Link href="/portal/resultaten" className="text-[13px] font-semibold text-[#4bc4ff]">Meer →</Link>
          </div>
          <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
            <Metric k="Weergaven" v={compact(data.metrics.views)} />
            <Metric k="Bereik" v={compact(data.metrics.reach)} />
            <Metric k="Interacties" v={compact(data.metrics.engagements)} />
            <Metric k="Volgers" v={`+${num(data.metrics.followerGrowth)}`} />
          </div>
        </section>

        <section className="sc-glass p-5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">Aankomende afspraken</span>
          {data.appointments.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--color-ink-muted)]">Nog geen afspraken gepland.</p>
          ) : (
            <div className="mt-2.5">
              {data.appointments.slice(0, 4).map((a) => (
                <div key={a.id} className="flex items-center gap-3 border-t border-white/10 py-2.5 first:border-t-0">
                  <span className="grid size-10 shrink-0 place-items-center rounded-[11px] bg-[rgba(25,168,255,0.1)] text-[#4bc4ff]">
                    <CalendarClock className="size-[19px]" strokeWidth={1.8} />
                  </span>
                  <div>
                    <div className="text-sm font-semibold">{KIND_LABEL[a.kind] ?? "Afspraak"}</div>
                    <div className="text-[12.5px] text-[var(--color-ink-muted)]">{formatDateFull(a.startsAt)} · {relativeDays(a.startsAt)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Contact */}
      <section>
        <h2 className="mb-3 text-base font-semibold">Je contactpersonen</h2>
        <div className="grid gap-[18px] sm:grid-cols-2">
          {contact.coordinator ? (
            <Link href="/portal/contact"><ContactCard name={contact.coordinator.name} role={contact.coordinator.role} initials={initials(contact.coordinator.name)} /></Link>
          ) : null}
          {contact.videographer ? (
            <Link href="/portal/contact"><ContactCard name={contact.videographer.name} role={contact.videographer.role} initials={initials(contact.videographer.name)} /></Link>
          ) : null}
        </div>
      </section>

      <footer className="pt-2 text-xs text-[var(--color-ink-faint)]">
        <FileText className="mb-0.5 mr-1 inline size-3.5" /> Alles in dit portaal komt automatisch uit onze systemen — je hoeft niets handmatig bij te houden.
      </footer>
    </div>
  );
}

function Metric({ k, v }: { k: string; v: string }) {
  return (
    <div className="sc-glass p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">{k}</div>
      <div className="mt-1.5 text-[27px] font-bold tabular-nums">{v}</div>
    </div>
  );
}
