import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Check, CheckCircle2, ExternalLink, Play } from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { getPortalVideo, getPortalFrameUrl } from "@/server/portal";
import { Badge, buttonClass, Card, CardHeader } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/format";
import { clientStatusView, deadlineText, feedbackBeingProcessed, reviewDeadline, waitingOnClient } from "@/lib/portal-status";
import { VideoDecision } from "../../actions-ui";

export const metadata: Metadata = { title: "Video" };
export const dynamic = "force-dynamic";

/** De zes klantstatussen als levensloop (§projectstatus). */
const FLOW = ["Script", "Opname", "In montage", "Jouw beoordeling", "Ingepland", "Online"] as const;

/** Welke stap is nu actief, op basis van de interne status. */
const STATUS_TO_STEP: Record<string, number> = {
  recorded: 1, footage_upload: 2, awaiting_editor: 2, editing: 2,
  internal_review: 2, editor_revision: 2, client_revision: 2, client_review: 3,
  approved: 4, ready_to_publish: 4, scheduled: 4, published: 5, analysis_available: 5,
};

/** Wie is nu aan zet, en de uitleg daarbij. */
function turnInfo(status: string): { who: string | null; explain: string } {
  if (status === "client_review") return { who: "Jij", explain: "Bekijk de video en geef je akkoord of feedback." };
  if (status === "client_revision") return { who: "Shortclips", explain: "We verwerken je feedback." };
  if (status === "published" || status === "analysis_available") return { who: null, explain: "Deze video staat online." };
  if (status === "scheduled" || status === "ready_to_publish" || status === "approved") return { who: "Shortclips", explain: "Ingepland voor publicatie." };
  return { who: "Shortclips", explain: "We werken aan je video." };
}

function ProgressTimeline({ status }: { status: string }) {
  const current = STATUS_TO_STEP[status] ?? 0;
  const turn = turnInfo(status);
  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--color-ink)]">Waar staat deze video?</h2>
        <span className="text-xs text-[var(--color-ink-muted)]">{turn.who ? `Nu aan zet: ${turn.who}` : "Deze video staat online"}</span>
      </div>
      <ol className="flex gap-1 overflow-x-auto pb-1">
        {FLOW.map((label, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={label} className="flex min-w-[76px] flex-1 flex-col items-center gap-1.5 text-center">
              <div className="flex w-full items-center">
                <span className={`h-0.5 flex-1 ${i === 0 ? "opacity-0" : done || active ? "bg-[var(--color-brand-600)]" : "bg-[var(--color-line)]"}`} />
                <span
                  className={`grid size-6 shrink-0 place-items-center rounded-full text-[10px] font-bold ${
                    done
                      ? "bg-[var(--color-brand-600)] text-white"
                      : active
                        ? "bg-[var(--color-brand-600)] text-white ring-4 ring-[var(--color-brand-600)]/20"
                        : "border border-[var(--color-line)] bg-[var(--color-surface-2)] text-[var(--color-ink-faint)]"
                  }`}
                >
                  {done ? <Check className="size-3.5" /> : i + 1}
                </span>
                <span className={`h-0.5 flex-1 ${i === FLOW.length - 1 ? "opacity-0" : done ? "bg-[var(--color-brand-600)]" : "bg-[var(--color-line)]"}`} />
              </div>
              <span className={`text-[11px] leading-tight ${active ? "font-semibold text-[var(--color-ink)]" : "text-[var(--color-ink-muted)]"}`}>{label}</span>
            </li>
          );
        })}
      </ol>
      <p className="mt-4 rounded-lg bg-[var(--color-surface-2)] px-3 py-2 text-[13px] text-[var(--color-ink-muted)]">
        {turn.explain}
      </p>
    </Card>
  );
}

export default async function PortalVideoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const viewer = await requirePortal();
  const { video, threads } = await getPortalVideo(viewer, id);
  const view = clientStatusView(video.status);
  const needsDecision = waitingOnClient(video.status);
  const inFeedback = feedbackBeingProcessed(video.status);
  const dl = needsDecision ? deadlineText(reviewDeadline(video.statusChangedAt)) : null;
  const expectedNewVersion = inFeedback ? reviewDeadline(video.statusChangedAt) : null;
  // Een goedgekeurde/ingeplande/online video hoort altijd terug te kijken te zijn.
  // Ontbreekt de directe Frame-link, val dan terug op de review-omgeving van de klant.
  const isReady = ["approved", "ready_to_publish", "scheduled", "published", "analysis_available"].includes(video.status);
  const frameFallback = isReady && !video.frameUrl ? await getPortalFrameUrl(viewer) : null;
  const playUrl = video.frameUrl ?? frameFallback;

  return (
    <div className="space-y-6">
      <Link
        href="/portal/videos"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
      >
        <ArrowLeft className="size-4" /> Terug naar video&apos;s
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{video.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone={view.tone}>{view.label}</Badge>
            {view.sublabel ? (
              <span className="text-xs text-[var(--color-ink-muted)]">{view.sublabel}</span>
            ) : null}
            {dl ? (
              <span className={`text-xs font-medium ${dl.urgent ? "text-[#19a8ff]" : "text-[var(--color-ink-muted)]"}`}>
                {dl.text}
              </span>
            ) : null}
            {video.plannedPublishOn && !needsDecision ? (
              <span className="text-xs text-[var(--color-ink-muted)]">
                Verwachte publicatie: {formatDate(video.plannedPublishOn)}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* Voortgangslijn: van script tot gepubliceerd */}
      <ProgressTimeline status={video.status} />

      {/* Akkoord-bonnetje, zwart op wit wie wanneer akkoord gaf */}
      {["approved", "ready_to_publish", "scheduled", "published"].includes(video.status) && video.approvedAt ? (
        <div className="flex items-center gap-3 rounded-[14px] border border-[var(--color-good)]/30 bg-[var(--color-good-soft)] px-4 py-3">
          <CheckCircle2 className="size-5 shrink-0 text-[var(--color-good)]" />
          <p className="text-sm text-[var(--color-ink)]">
            <span className="font-semibold">Door jou goedgekeurd</span> · {formatDateTime(video.approvedAt)}
          </p>
        </div>
      ) : null}

      {/* Bekijken gebeurt in Frame (review + download). Alleen een speler tonen
          als er echt iets af te spelen valt. */}
      {playUrl ? (
        <a href={playUrl} target="_blank" rel="noreferrer" className="group block">
          <Card padded={false} className="overflow-hidden">
            <div className="flex aspect-video items-center justify-center bg-[var(--color-indigo-ink)]/[0.06]">
              <span className="flex size-14 items-center justify-center rounded-full bg-[var(--color-brand-600)] text-white transition-transform group-hover:scale-105">
                <Play className="size-6 translate-x-0.5" fill="currentColor" />
              </span>
            </div>
            <div className="flex items-center gap-2 p-4 text-sm font-semibold text-[var(--color-brand-600)]">
              <ExternalLink className="size-4" />
              {needsDecision ? "Bekijk en geef feedback in Frame" : "Bekijk en download in Frame"}
            </div>
          </Card>
        </a>
      ) : (
        <Card className="flex items-center gap-3 text-sm text-[var(--color-ink-muted)]">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--color-surface-2)] text-[var(--color-ink-faint)]">
            <Play className="size-4" />
          </span>
          De video wordt klaargezet. Je kunt &apos;m hier straks bekijken.
        </Card>
      )}

      {/* Jouw beoordeling, alleen wanneer de klant echt aan zet is */}
      {needsDecision ? (
        <Card>
          <CardHeader
            title="Keur goed of vraag een aanpassing"
            subtitle="Eén gebundelde feedbackronde per video. Geef je feedback het liefst met tijdcode in Frame."
          />
          <div className="mt-4">
            <VideoDecision videoId={video.id} frameUrl={video.frameUrl} />
          </div>
        </Card>
      ) : inFeedback ? (
        <Card className="flex items-start gap-3 border-[rgba(46,144,250,0.35)] bg-[rgba(25,168,255,0.07)]">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-[var(--sc-accent)]" />
          <div>
            <p className="text-sm font-semibold text-[var(--color-ink)]">
              Feedback ontvangen{video.statusChangedAt ? ` op ${formatDate(video.statusChangedAt)}` : ""}
            </p>
            <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
              We verwerken je feedback{expectedNewVersion ? ` en verwachten een nieuwe versie rond ${formatDate(expectedNewVersion)}` : " en zetten een nieuwe versie klaar"}. Je hoeft nu niets te doen.
            </p>
          </div>
        </Card>
      ) : null}

      {/* Feedbackgeschiedenis, alleen tonen als er echt feedback bij deze video hoort */}
      {threads.length > 0 ? (
        <Card padded={false}>
          <div className="p-5 pb-3">
            <CardHeader title="Jouw feedback op deze video" />
          </div>
          <ul className="divide-y divide-[var(--color-line)]">
            {threads.map((t) => (
              <li key={t.id} className="px-5 py-4">
                {t.timecodeMs != null ? (
                  <span className="text-xs font-medium text-[var(--color-brand-600)]">
                    {Math.floor(t.timecodeMs / 60000)}:
                    {String(Math.floor((t.timecodeMs % 60000) / 1000)).padStart(2, "0")}
                  </span>
                ) : null}
                {t.comments.map((c) => (
                  <div key={c.id} className="mt-1">
                    <p className="text-sm text-[var(--color-ink)]">{c.body}</p>
                    <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
                      {c.authorName ?? "Jij"} · {formatDateTime(c.createdAt)}
                    </p>
                  </div>
                ))}
                {t.isResolved ? (
                  <Badge tone="good">Verwerkt</Badge>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
