import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CalendarDays, Check, ExternalLink, Film, FolderOpen, MessageSquareText } from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { getPortalVideos } from "@/server/portal";
import { getPortalFrameLibrary, type PortalFrameSession } from "@/server/portal-frame";
import { getPortalSettingsForClient } from "@/server/portal-settings";
import { FrameVideoGrid } from "@/components/portal/frame-video-grid";
import { StatusPill, portalBtn, type StatusTone } from "@/components/portal/status-pill";
import { VideoProces } from "@/components/portal/video-proces";
import { formatDateFull } from "@/lib/format";
import { deadlineText } from "@/lib/portal-status";
import { SessionApprove } from "./session-approve";

export const metadata: Metadata = { title: "Video's" };
export const dynamic = "force-dynamic";

const TONE: Record<NonNullable<PortalFrameSession["status"]>["key"], StatusTone> = {
  feedback: "orange",
  verwerken: "blue",
  productie: "blue",
  goedgekeurd: "green",
  online: "green",
};

function overdue(s: PortalFrameSession): boolean {
  return !!s.feedbackDeadline && new Date(s.feedbackDeadline).getTime() < new Date().setHours(0, 0, 0, 0);
}

function SessionStatus({ s }: { s: PortalFrameSession }) {
  if (!s.status) return null;
  if (s.status.key === "feedback" && overdue(s)) return <StatusPill tone="red">Feedbacktermijn verstreken</StatusPill>;
  return <StatusPill tone={TONE[s.status.key]}>{s.status.label}</StatusPill>;
}

function sessionSub(s: PortalFrameSession): string {
  const parts: string[] = [];
  if (s.shootDate) parts.push(`Opname ${formatDateFull(s.shootDate)}`);
  parts.push(`${s.videos.length} video${s.videos.length === 1 ? "" : "'s"}`);
  return parts.join(" · ");
}

/** Sessiekaart in het overzicht: omslag (eerste video), titel, status, aantal. */
function SessionCard({ s }: { s: PortalFrameSession }) {
  const covers = s.videos.slice(0, 3);
  const attention = s.status?.key === "feedback";
  return (
    <Link
      href={`/portal/videos?sessie=${encodeURIComponent(s.key)}`}
      className={`sc-glass group flex flex-col overflow-hidden p-0 transition-shadow hover:shadow-[var(--shadow-raised)] ${attention ? "ring-2 ring-[var(--sc-act)]/50" : ""}`}
    >
      <div className="grid h-40 grid-cols-3 gap-px bg-[var(--sc-line)]">
        {covers.map((v) => (
          <div key={v.id} className="relative overflow-hidden bg-[var(--sc-fill-strong)]">
            <span className="absolute inset-0 grid place-items-center text-[var(--color-ink-faint)]"><Film className="size-5" strokeWidth={1.5} /></span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/portal/frame/${v.id}/thumb`} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
          </div>
        ))}
        {Array.from({ length: Math.max(0, 3 - covers.length) }).map((_, i) => <div key={i} className="bg-[var(--sc-fill)]" />)}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-[15.5px] font-semibold leading-snug">{s.title}</h3>
          <ArrowRight className="mt-0.5 size-4 shrink-0 text-[var(--color-ink-faint)] transition-transform group-hover:translate-x-0.5" />
        </div>
        <p className="text-[12.5px] text-[var(--color-ink-muted)]">{sessionSub(s)}</p>
        <div className="mt-auto pt-1"><SessionStatus s={s} /></div>
      </div>
    </Link>
  );
}

export default async function PortalVideosPage({ searchParams }: { searchParams: Promise<{ sessie?: string }> }) {
  const viewer = await requirePortal();
  const { sessie } = await searchParams;
  const [lib, legacy, settings] = await Promise.all([
    getPortalFrameLibrary(viewer),
    getPortalVideos(viewer),
    getPortalSettingsForClient(viewer.clientId ?? ""),
  ]);

  const waiting = lib.sessions.filter((s) => s.status?.key === "feedback");
  // Akkoordverzoeken van het team die (nog) niet aan een Frame-sessie hangen.
  const linkedApprove = new Set(lib.sessions.map((s) => s.approveId).filter(Boolean));
  const looseActions = legacy.actieNodig.filter((v) => !linkedApprove.has(v.id));

  const selected = sessie ? lib.sessions.find((s) => s.key === sessie) ?? null : null;

  /* ---------------- Detail: één opnamesessie ---------------- */
  if (selected) {
    const dl = selected.status?.key === "feedback" ? deadlineText(selected.feedbackDeadline ? new Date(selected.feedbackDeadline) : null) : null;
    return (
      <div className="flex flex-col gap-6">
        <Link href="/portal/videos" className="inline-flex w-fit items-center gap-1.5 text-[13px] font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
          <ArrowLeft className="size-4" /> Alle opnamesessies
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[26px] font-bold tracking-tight">{selected.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2.5 text-[13px] text-[var(--color-ink-muted)]">
              <SessionStatus s={selected} />
              <span>{sessionSub(selected)}</span>
            </div>
          </div>
        </div>

        {selected.status?.key === "feedback" ? (
          <section className="sc-glass flex flex-wrap items-center justify-between gap-4 p-5" style={{ boxShadow: "inset 4px 0 0 var(--sc-act)" }}>
            <div className="min-w-0 max-w-xl">
              <p className="text-[15px] font-semibold">Deze video&apos;s wachten op jouw feedback</p>
              <p className="mt-1 text-[13.5px] text-[var(--color-ink-muted)]">
                Bekijk de video&apos;s hieronder. Alles goed? Keur ze in één keer goed. Wil je iets aangepast hebben, geef het dan gebundeld door{lib.reviewUrl ? " in Frame, met tijdcode bij de video" : " aan je contactpersoon"}.
              </p>
              {dl ? <p className={`mt-1.5 text-[13px] font-semibold ${dl.urgent ? "text-[var(--st-orange)]" : "text-[var(--color-ink)]"}`}>{dl.text}</p> : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {selected.approveId ? <SessionApprove deliverableId={selected.approveId} /> : null}
              {lib.reviewUrl ? (
                <a href={lib.reviewUrl} target="_blank" rel="noreferrer" className={portalBtn.soft}>
                  <MessageSquareText className="size-4" /> Feedback geven in Frame <ExternalLink className="size-3.5" />
                </a>
              ) : null}
            </div>
          </section>
        ) : null}

        <FrameVideoGrid videos={selected.videos} />
      </div>
    );
  }

  /* ---------------- Overzicht: alle opnamesessies ---------------- */
  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Video&apos;s</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            Al je video&apos;s per opnamesessie, rechtstreeks uit onze videobibliotheek. Klik op een sessie om de video&apos;s te bekijken.
          </p>
        </div>
        {lib.reviewUrl ? (
          <a href={lib.reviewUrl} target="_blank" rel="noreferrer" className={portalBtn.soft}>
            <ExternalLink className="size-4" /> Openen in Frame
          </a>
        ) : null}
      </div>

      {/* Wat er van de klant verwacht wordt, bovenaan */}
      {waiting.length > 0 || looseActions.length > 0 ? (
        <section className="sc-glass p-5" style={{ boxShadow: "inset 4px 0 0 var(--sc-act)" }}>
          <div className="flex flex-wrap items-center gap-2.5">
            <StatusPill tone="orange">Actie nodig</StatusPill>
            <h2 className="text-[16px] font-semibold">
              {waiting.length + looseActions.length === 1 ? "Er wacht 1 sessie op jouw feedback" : `Er wachten ${waiting.length + looseActions.length} sessies op jouw feedback`}
            </h2>
          </div>
          <div className="mt-3 flex flex-col gap-2">
            {waiting.map((s) => {
              const dl = deadlineText(s.feedbackDeadline ? new Date(s.feedbackDeadline) : null);
              return (
                <Link key={s.key} href={`/portal/videos?sessie=${encodeURIComponent(s.key)}`} className="flex flex-wrap items-center gap-3 rounded-[12px] border border-[var(--sc-line)] bg-[var(--sc-fill)] px-4 py-3 hover:bg-[var(--sc-fill-strong)]">
                  <FolderOpen className="size-4 shrink-0 text-[var(--st-orange)]" />
                  <span className="min-w-0 flex-1 text-[14px] font-semibold">{s.title} <span className="font-normal text-[var(--color-ink-muted)]">· {s.videos.length} video&apos;s</span></span>
                  {dl ? <span className={`text-[12.5px] ${dl.urgent ? "font-semibold text-[var(--st-orange)]" : "text-[var(--color-ink-muted)]"}`}>{dl.text}</span> : null}
                  <span className={portalBtn.act + " h-9"}>Bekijk &amp; beoordeel <ArrowRight className="size-4" /></span>
                </Link>
              );
            })}
            {looseActions.map((v) => (
              <Link key={v.id} href={`/portal/videos/${v.id}`} className="flex flex-wrap items-center gap-3 rounded-[12px] border border-[var(--sc-line)] bg-[var(--sc-fill)] px-4 py-3 hover:bg-[var(--sc-fill-strong)]">
                <Film className="size-4 shrink-0 text-[var(--st-orange)]" />
                <span className="min-w-0 flex-1 text-[14px] font-semibold">{v.sessionDate ? `Opname ${formatDateFull(v.sessionDate)}` : v.title}</span>
                <span className={portalBtn.act + " h-9"}>Beoordelen <ArrowRight className="size-4" /></span>
              </Link>
            ))}
          </div>
        </section>
      ) : lib.sessions.length > 0 ? (
        <section className="sc-glass flex items-center gap-3 p-4 text-[14px]">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--st-green-bg)] text-[var(--st-green)]"><Check className="size-4" /></span>
          Er wacht nu niets op jouw feedback. Je kunt alle video&apos;s hieronder terugkijken.
        </section>
      ) : null}

      {lib.sessions.length === 0 ? (
        <section className="sc-glass grid place-items-center gap-2 p-14 text-center">
          <Film className="size-7 text-[var(--color-ink-faint)]" strokeWidth={1.5} />
          <p className="text-sm font-semibold">Nog geen video&apos;s in je bibliotheek</p>
          <p className="max-w-md text-[13px] text-[var(--color-ink-muted)]">
            Zodra de video&apos;s van je eerste opnamesessie klaarstaan, verschijnen ze hier automatisch per sessie.
          </p>
        </section>
      ) : (
        <section>
          <div className="mb-3.5 flex items-baseline justify-between gap-2">
            <h2 className="flex items-center gap-2 text-[17px] font-semibold"><CalendarDays className="size-4 text-[var(--sc-accent)]" /> Opnamesessies</h2>
            <span className="text-[12.5px] text-[var(--color-ink-faint)]">{lib.sessions.length} sessies · {lib.totalVideos} video&apos;s</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {lib.sessions.map((s) => <SessionCard key={s.key} s={s} />)}
          </div>
        </section>
      )}

      {lib.sessions.length > 0 ? <VideoProces extraFeedbackFee={settings.extraFeedbackFee} /> : null}
    </div>
  );
}
