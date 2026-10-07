import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpen, CalendarClock, CheckCircle2, Clock, ExternalLink, FileText, Play, UserRound } from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { getPortalContact, getPortalData, getPortalFrameUrl } from "@/server/portal";
import { buttonClass } from "@/components/ui";
import { CountUp } from "@/components/portal/count-up";
import { compact, formatDate, formatDateFull, num, relativeDays } from "@/lib/format";
import { videoCover } from "./cover";

const READY_STATUSES = new Set(["approved", "ready_to_publish", "scheduled"]);
const MONTH_NL = new Intl.DateTimeFormat("nl-NL", { month: "long" });

/** Reactietermijn: 3 werkdagen na oplevering (conform de afspraken). */
function reviewDeadline(from: Date | string | null | undefined): Date | null {
  if (!from) return null;
  const d = new Date(from);
  if (Number.isNaN(d.getTime())) return null;
  let added = 0;
  while (added < 3) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return d;
}

function deadlineText(d: Date | null): { text: string; urgent: boolean } | null {
  if (!d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(d);
  due.setHours(0, 0, 0, 0);
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return { text: `Graag z.s.m. — termijn was ${formatDate(d)}`, urgent: true };
  if (days === 0) return { text: "Reageer bij voorkeur vandaag", urgent: true };
  if (days === 1) return { text: `Reageer bij voorkeur voor morgen (${formatDate(d)})`, urgent: true };
  return { text: `Reageer bij voorkeur voor ${formatDate(d)} · nog ${days} dagen`, urgent: days <= 2 };
}

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

  // Maandoverzicht — zelfde bronnen als de rest van het portaal, zodat de cijfers
  // nergens uit elkaar lopen.
  const now = new Date();
  const monthName = MONTH_NL.format(now);
  const klaarVoorPublicatie = data.inProgress.filter((v) => READY_STATUSES.has(v.status)).length;
  const inProductie = data.inProgress.length - klaarVoorPublicatie;
  const gepubliceerdDezeMaand = data.published.filter(
    (v) => v.publishedAt && new Date(v.publishedAt).getMonth() === now.getMonth() && new Date(v.publishedAt).getFullYear() === now.getFullYear(),
  ).length;
  const afgesproken = data.client.monthlyVideoQuota ?? 0;
  const anyOverdue = data.awaitingApproval.some((v) => {
    const t = deadlineText(reviewDeadline(v.statusChangedAt));
    return t?.urgent;
  });
  const monthStats = [
    afgesproken > 0 ? { label: "afgesproken", value: afgesproken } : null,
    { label: "in productie", value: inProductie },
    { label: "wacht op jou", value: openActions },
    { label: "klaar voor publicatie", value: klaarVoorPublicatie },
    { label: "gepubliceerd", value: gepubliceerdDezeMaand },
  ].filter(Boolean) as Array<{ label: string; value: number }>;

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

      {/* Maandoverzicht — één oogopslag: waar staan we deze maand */}
      <section className="sc-glass p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold capitalize">{monthName}</h2>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
              anyOverdue ? "bg-[var(--color-warn-soft)] text-[#ffb020]" : "bg-[var(--color-good-soft)] text-[#2fd27a]"
            }`}
          >
            <span className={`size-1.5 rounded-full ${anyOverdue ? "bg-[#ffb020]" : "bg-[#2fd27a]"}`} />
            {anyOverdue ? "Je aandacht gevraagd" : "Op schema"}
          </span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-[14px] border border-white/10 bg-white/5 sm:grid-cols-3 lg:grid-cols-5">
          {monthStats.map((s) => (
            <div key={s.label} className="bg-[rgba(10,12,38,0.6)] p-3.5">
              <CountUp value={s.value} className="block text-[22px] font-bold tabular-nums leading-none" />
              <div className="mt-1.5 text-[11.5px] font-medium text-[var(--color-ink-muted)]">{s.label}</div>
            </div>
          ))}
        </div>
        {data.upcomingShoot ? (
          <div className="mt-3.5 flex items-center gap-2 text-[13px] text-[var(--color-ink-muted)]">
            <CalendarClock className="size-4 text-[#4bc4ff]" />
            Volgende opname: <span className="font-semibold text-[var(--color-ink)]">{formatDateFull(data.upcomingShoot.scheduledOn)}</span>
            <span className="text-[var(--color-ink-faint)]">· {relativeDays(data.upcomingShoot.scheduledOn)}</span>
          </div>
        ) : null}
      </section>

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
              {data.awaitingApproval.slice(0, 4).map((v) => {
                const isRevision = v.status === "client_revision";
                const dl = isRevision ? null : deadlineText(reviewDeadline(v.statusChangedAt));
                return (
                  <div key={v.id} className="rounded-[14px] border border-white/10 bg-white/[0.04] p-3">
                    <div className="flex items-start gap-3.5">
                      {v.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={v.thumbnailUrl} alt="" className="h-[58px] w-[44px] shrink-0 rounded-[9px] object-cover" />
                      ) : (
                        <span className="grid h-[58px] w-[44px] shrink-0 place-items-center rounded-[9px] text-white" style={{ background: videoCover(v.title) }}>
                          <Play className="size-4" fill="currentColor" />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <Link href={`/portal/videos/${v.id}`} className="block truncate text-sm font-semibold hover:text-[#9fdcff]">{v.title}</Link>
                        <div className="mt-0.5 text-[12.5px] text-[var(--color-ink-muted)]">
                          {isRevision ? "Je feedback is binnen — wij verwerken 'm" : "Klaar om te bekijken"}
                        </div>
                        {dl ? (
                          <div className={`mt-1 flex items-center gap-1 text-[12px] ${dl.urgent ? "text-[#ffb020]" : "text-[var(--color-ink-faint)]"}`}>
                            <Clock className="size-3.5" /> {dl.text}
                          </div>
                        ) : null}
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${isRevision ? "bg-[var(--color-info-soft)] text-[#4bc4ff]" : "bg-[var(--color-warn-soft)] text-[#ffb020]"}`}>
                        {isRevision ? "In behandeling" : "Jouw akkoord"}
                      </span>
                    </div>
                    {!isRevision ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <a
                          href={v.frameUrl ?? frameUrl ?? `/portal/videos/${v.id}`}
                          target={v.frameUrl ?? frameUrl ? "_blank" : undefined}
                          rel="noreferrer"
                          className={buttonClass({ variant: "accent", size: "sm" })}
                        >
                          <Play className="size-3.5" fill="currentColor" /> Bekijk video
                        </a>
                        <Link href={`/portal/videos/${v.id}`} className={buttonClass({ variant: "secondary", size: "sm" })}>
                          Goedkeuren of feedback
                        </Link>
                      </div>
                    ) : null}
                  </div>
                );
              })}
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

      {/* Werkwijze & afspraken — altijd bij de hand */}
      <Link
        href="/portal/werkwijze"
        className="group flex items-center gap-4 rounded-[16px] border border-white/10 bg-white/[0.03] p-5 transition-colors hover:bg-white/[0.06]"
      >
        <span className="grid size-11 shrink-0 place-items-center rounded-[12px] bg-[rgba(25,168,255,0.1)] text-[#4bc4ff]">
          <BookOpen className="size-5" strokeWidth={1.8} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">Werkwijze &amp; afspraken</span>
          <span className="block text-[13px] text-[var(--color-ink-muted)]">Hoe een opnamedag verloopt, wat we afspraken en wie wat doet.</span>
        </span>
        <ArrowRight className="size-5 shrink-0 text-[var(--color-ink-faint)] transition-transform group-hover:translate-x-0.5" />
      </Link>

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
