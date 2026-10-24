import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, CheckCircle2, Clock, FileText, Play, Sparkles } from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { getPortalContact, getPortalData } from "@/server/portal";
import { buttonClass } from "@/components/ui";
import { CountUp } from "@/components/portal/count-up";
import { compact, formatDateFull, num, relativeDays } from "@/lib/format";
import { clientStatusView, deadlineText, reviewDeadline, statusToneClass, waitingText } from "@/lib/portal-status";
import { PLATFORM } from "@/lib/statuses";
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

function ShortTile({ title, status }: { title: string; status: string }) {
  const v = clientStatusView(status);
  const s = { label: v.label, cls: statusToneClass(v.tone) };
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
  const [data, contact] = await Promise.all([
    getPortalData(viewer),
    getPortalContact(viewer),
  ]);

  // Alle openstaande klant­acties: video's te beoordelen + scripts goed te keuren.
  const scriptsToReview = data.scriptsToReview ?? [];
  const openActions = data.awaitingApproval.length + scriptsToReview.length;
  const firstName = viewer.fullName.split(" ")[0];
  const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();

  // Statusoverzicht, zelfde bronnen als de rest van het portaal zodat de
  // aantallen overal gelijk zijn. Online = totaal; de rest = wat er nu loopt.
  const online = data.published.length;
  const counts = { opname: 0, montage: 0, ingepland: 0 };
  for (const v of data.inProgress) {
    const k = clientStatusView(v.status).key;
    if (k === "opname") counts.opname++;
    else if (k === "montage") counts.montage++;
    else if (k === "ingepland") counts.ingepland++;
  }
  const anyOverdue = data.awaitingApproval.some((v) => deadlineText(reviewDeadline(v.statusChangedAt))?.urgent);

  // Eén zin statusoverzicht (vervangt losse tellers).
  const parts: string[] = [];
  if (online > 0) parts.push(`${online} video's online`);
  if (counts.montage > 0) parts.push(`${counts.montage} in montage`);
  if (openActions > 0) parts.push(`${openActions} wacht op jouw beoordeling`);
  if (counts.ingepland > 0) parts.push(`${counts.ingepland} ingepland`);
  const monthSentence = parts.length ? `${parts.join(", ")}.` : "Er loopt op dit moment niets.";

  const breakdown = [
    { label: "Opname (nu)", value: counts.opname },
    { label: "In montage (nu)", value: counts.montage },
    { label: "Wacht op jou (nu)", value: openActions },
    { label: "Ingepland (nu)", value: counts.ingepland },
    { label: "Online (totaal)", value: online },
  ];

  return (
    <div className="flex flex-col gap-[18px]">
      {/* Hero */}
      <div className="px-0.5 pt-1">
        <h1 className="text-[29px] font-bold tracking-tight">Welkom terug, {firstName}</h1>
        <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
          Alles rond de video&apos;s van {data.client.name}, in één studio-omgeving.
        </p>
      </div>

      {/* Nieuw online — melding de ochtend nadat we een video hebben geplaatst. */}
      {data.recentlyPublished.length > 0 ? (
        <section className="sc-glass sc-glow p-5" style={{ background: "linear-gradient(180deg, rgba(47,210,122,0.12), rgba(255,255,255,0.03))" }}>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#2fd27a]">Nieuw online</span>
          <h3 className="mt-1.5 text-[16px] font-semibold">
            {data.recentlyPublished.length === 1
              ? "We hebben een nieuwe video van je geplaatst 🎬"
              : `We hebben ${data.recentlyPublished.length} nieuwe video's van je geplaatst 🎬`}
          </h3>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            Al gezien? Leuk om &apos;m even te bekijken — en te delen als je enthousiast bent.
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {data.recentlyPublished.map((v) => (
              <li key={v.id}>
                <Link
                  href={v.deliverableId ? `/portal/videos/${v.deliverableId}` : "/portal/videos"}
                  className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-[12px] border border-white/10 bg-white/5 px-3.5 py-2.5 transition-colors hover:border-white/25"
                >
                  <Play className="size-4 shrink-0 text-[#2fd27a]" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{v.title}</span>
                  {v.platforms.length > 0 ? (
                    <span className="shrink-0 text-xs text-[var(--color-ink-muted)]">
                      op {v.platforms.map((p) => PLATFORM[p]?.label ?? p).join(", ")}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Statusoverzicht, één oogopslag: waar staan je video's */}
      <section className="sc-glass p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Je video&apos;s</h2>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
              anyOverdue ? "bg-[var(--color-warn-soft)] text-[#ffb020]" : "bg-[var(--color-good-soft)] text-[#2fd27a]"
            }`}
          >
            <span className={`size-1.5 rounded-full ${anyOverdue ? "bg-[#ffb020]" : "bg-[#2fd27a]"}`} />
            {anyOverdue ? "Je aandacht gevraagd" : "Op schema"}
          </span>
        </div>
        <p className="mt-2 text-[15px] text-[var(--color-ink)]">{monthSentence}</p>
        <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-[14px] border border-white/10 bg-white/5 sm:grid-cols-3 lg:grid-cols-5">
          {breakdown.map((s) => (
            <div key={s.label} className="bg-[rgba(10,12,38,0.6)] p-3.5">
              <CountUp value={s.value} className="block text-[22px] font-bold tabular-nums leading-none" />
              <div className="mt-1.5 text-[11.5px] font-medium text-[var(--color-ink-muted)]">{s.label}</div>
            </div>
          ))}
        </div>
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
            {openActions > 0 ? (
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">Actie nodig</span>
            ) : null}
          </div>
          {openActions > 0 ? (
            <div className="mt-4 flex flex-col gap-3">
              {/* Scripts die op jouw akkoord wachten */}
              {scriptsToReview.slice(0, 3).map((s) => (
                <div key={s.id} className="rounded-[14px] border border-white/10 bg-white/[0.04] p-3">
                  <div className="flex items-start gap-3.5">
                    <span className="grid h-[58px] w-[44px] shrink-0 place-items-center rounded-[9px] bg-[rgba(25,168,255,0.14)] text-[#4bc4ff]">
                      <FileText className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <Link href="/portal/scripts" className="block truncate text-sm font-semibold hover:text-[#9fdcff]">{s.title}</Link>
                      <div className="mt-0.5 text-[12.5px] text-[var(--color-ink-muted)]">Script — wacht op jouw akkoord</div>
                      <div className="mt-1 flex items-center gap-1 text-[12px] text-[var(--color-ink-faint)]">
                        <Clock className="size-3.5" /> {waitingText(s.updatedAt)}
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full bg-[rgba(25,168,255,0.14)] px-2.5 py-1 text-[11px] font-semibold text-[#4bc4ff]">Jouw akkoord</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link href="/portal/scripts" className={buttonClass({ variant: "accent", size: "sm" })}>
                      <FileText className="size-3.5" /> Bekijk en keur goed
                    </Link>
                  </div>
                </div>
              ))}
              {/* Video's die op jouw beoordeling wachten */}
              {data.awaitingApproval.slice(0, 4).map((v) => {
                const dl = deadlineText(reviewDeadline(v.statusChangedAt));
                const reviewUrl = v.frameUrl ?? `/portal/videos/${v.id}`;
                const external = Boolean(v.frameUrl);
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
                        <div className="mt-0.5 text-[12.5px] text-[var(--color-ink-muted)]">Klaar om te bekijken · {waitingText(v.statusChangedAt)}</div>
                        {dl ? (
                          <div className={`mt-1 flex items-center gap-1 text-[12px] ${dl.urgent ? "text-[#ffb020]" : "text-[var(--color-ink-faint)]"}`}>
                            <Clock className="size-3.5" /> {dl.text}
                          </div>
                        ) : null}
                      </div>
                      <span className="shrink-0 rounded-full bg-[var(--color-warn-soft)] px-2.5 py-1 text-[11px] font-semibold text-[#ffb020]">Jouw beoordeling</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <a
                        href={reviewUrl}
                        target={external ? "_blank" : undefined}
                        rel="noreferrer"
                        className={buttonClass({ variant: "accent", size: "sm" })}
                      >
                        <Play className="size-3.5" fill="currentColor" /> Bekijk en geef feedback
                      </a>
                      <Link href={`/portal/videos/${v.id}`} className={buttonClass({ variant: "secondary", size: "sm" })}>
                        Details
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-4 text-sm text-[var(--color-ink-muted)]">Je hoeft nu niets te doen. Wij zijn aan zet.</p>
          )}
        </section>

        <section className="sc-glass p-5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">Komt eraan</span>
            <Link href="/portal/planning" className="text-[13px] font-semibold text-[#4bc4ff]">Planning →</Link>
          </div>
          {data.upcomingShoot ? (
            <div className="mt-3 flex gap-3.5">
              <div className="flex size-[54px] shrink-0 flex-col items-center justify-center rounded-[14px] border border-white/10 bg-gradient-to-br from-[rgba(25,168,255,0.22)] to-[rgba(27,95,224,0.22)]">
                <span className="text-lg font-bold leading-none">{new Date(data.upcomingShoot.scheduledOn).getDate()}</span>
                <span className="mt-0.5 text-[10px] uppercase tracking-wider text-[var(--color-ink-muted)]">
                  {new Date(data.upcomingShoot.scheduledOn).toLocaleDateString("nl-NL", { month: "short" })}
                </span>
              </div>
              <div className="min-w-0">
                <div className="text-[15px] font-semibold">Opnamedag</div>
                <div className="mt-0.5 text-[13px] text-[var(--color-ink-muted)]">
                  {relativeDays(data.upcomingShoot.scheduledOn)}
                  {data.upcomingShoot.startTime ? ` · vanaf ${data.upcomingShoot.startTime.slice(0, 5)}` : ""}
                  {contact.videographer ? ` · ${contact.videographer.name.split(" ")[0]} (videograaf)` : ""}
                </div>
              </div>
            </div>
          ) : null}
          {data.appointments.filter((a) => a.kind !== "opname").slice(0, 2).map((a) => (
            <div key={a.id} className="mt-2.5 flex items-center gap-3 border-t border-white/10 pt-2.5 first:border-t-0">
              <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-[rgba(25,168,255,0.1)] text-[#4bc4ff]">
                <CalendarClock className="size-[18px]" strokeWidth={1.8} />
              </span>
              <div className="min-w-0 text-[13px]">
                <div className="font-semibold">{KIND_LABEL[a.kind] ?? "Afspraak"}</div>
                <div className="text-[var(--color-ink-muted)]">{formatDateFull(a.startsAt)} · {relativeDays(a.startsAt)}</div>
              </div>
            </div>
          ))}
          {!data.upcomingShoot && data.appointments.filter((a) => a.kind !== "opname").length === 0 ? (
            <p className="mt-3 text-sm text-[var(--color-ink-muted)]">Nog niets gepland. Je contactpersoon neemt contact met je op.</p>
          ) : null}
        </section>
      </div>

      {/* Update van Shortclips — de maandelijkse insight, zodra er een rapport is */}
      {data.reports.length > 0 ? (
        <section className="sc-glass p-5" style={{ background: "linear-gradient(180deg, rgba(25,168,255,0.07), rgba(255,255,255,0.02))" }}>
          <div className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-lg bg-[rgba(25,168,255,0.14)] text-[#4bc4ff]"><Sparkles className="size-4" /></span>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#4bc4ff]">Update van Shortclips</span>
          </div>
          <h3 className="mt-2.5 text-[15px] font-semibold">{data.reports[0]!.title}</h3>
          {data.reports[0]!.summary || data.reports[0]!.manualNote ? (
            <p className="mt-1 text-[13.5px] leading-relaxed text-[var(--color-ink-muted)]">
              {data.reports[0]!.summary ?? data.reports[0]!.manualNote}
            </p>
          ) : null}
          <Link href="/portal/resultaten" className="mt-3 inline-block text-[13px] font-semibold text-[#4bc4ff]">Bekijk je resultaten →</Link>
        </section>
      ) : null}

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

      {/* Resultaten, 30 dagen (alleen tonen als er cijfers zijn, nooit nullen) */}
      {data.metrics.views + data.metrics.reach + data.metrics.engagements > 0 ? (
        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">Resultaten, 30 dagen</h2>
            <Link href="/portal/resultaten" className="text-[13px] font-semibold text-[#4bc4ff]">Meer →</Link>
          </div>
          <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
            <Metric k="Weergaven" v={compact(data.metrics.views)} />
            <Metric k="Bereik" v={compact(data.metrics.reach)} />
            <Metric k="Interacties" v={compact(data.metrics.engagements)} />
            <Metric k="Volgers" v={`+${num(data.metrics.followerGrowth)}`} />
          </div>
        </section>
      ) : null}

      {/* Contact */}
      <section>
        <h2 className="mb-3 text-base font-semibold">Je contactpersonen</h2>
        <div className="grid gap-[18px] sm:grid-cols-2">
          {contact.coordinator ? (
            <Link href="/portal/samenwerking?tab=team"><ContactCard name={contact.coordinator.name} role={contact.coordinator.role} initials={initials(contact.coordinator.name)} /></Link>
          ) : null}
          {contact.videographer ? (
            <Link href="/portal/samenwerking?tab=team"><ContactCard name={contact.videographer.name} role={contact.videographer.role} initials={initials(contact.videographer.name)} /></Link>
          ) : null}
        </div>
      </section>

      <footer className="pt-2 text-xs text-[var(--color-ink-faint)]">
        <FileText className="mb-0.5 mr-1 inline size-3.5" /> Alles in dit portaal komt automatisch uit onze systemen, je hoeft niets handmatig bij te houden.
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
