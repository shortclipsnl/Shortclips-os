import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Check, CheckCircle2, Download, ExternalLink, MessageSquare, Play } from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { getPortalVideo } from "@/server/portal";
import { Badge, buttonClass, Card, CardHeader, EmptyState } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/format";
import { VideoDecision } from "../../actions-ui";

export const metadata: Metadata = { title: "Video" };
export const dynamic = "force-dynamic";

/** De levensloop van een video zoals de klant 'm ziet (§contentflow). */
const FLOW = ["Script", "Opname", "Edit", "Jouw akkoord", "Goedgekeurd", "Ingepland", "Gepubliceerd"] as const;

/** Welke stap is nu actief, op basis van de interne status. */
const STATUS_TO_STEP: Record<string, number> = {
  recorded: 1, footage_upload: 2, awaiting_editor: 2, editing: 2,
  internal_review: 2, editor_revision: 2, client_review: 3, client_revision: 3,
  approved: 4, ready_to_publish: 5, scheduled: 5, published: 6, analysis_available: 6,
};

/** Wie is nu aan zet? */
function whoseTurn(status: string): string {
  if (status === "client_review") return "Jij — bekijk de video en geef je akkoord of feedback.";
  if (status === "client_revision") return "ShortClips — we verwerken je feedback.";
  if (status === "published" || status === "analysis_available") return "Klaar — de video staat online.";
  if (status === "scheduled" || status === "ready_to_publish") return "ShortClips — ingepland voor publicatie.";
  if (status === "approved") return "ShortClips — we plannen de publicatie in.";
  return "ShortClips — we werken aan je video.";
}

function ProgressTimeline({ status }: { status: string }) {
  const current = STATUS_TO_STEP[status] ?? 0;
  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--color-ink)]">Waar staat deze video?</h2>
        <span className="text-xs text-[var(--color-ink-muted)]">Nu aan zet: {whoseTurn(status).split(" — ")[0]}</span>
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
        {whoseTurn(status)}
      </p>
    </Card>
  );
}

function statusLabel(status: string): { label: string; tone: "warn" | "info" | "good" | "neutral" } {
  switch (status) {
    case "client_review":
      return { label: "Wacht op jouw akkoord", tone: "warn" };
    case "client_revision":
      return { label: "We verwerken je feedback", tone: "info" };
    case "approved":
    case "ready_to_publish":
    case "scheduled":
      return { label: "Klaar voor publicatie", tone: "good" };
    case "published":
      return { label: "Gepubliceerd", tone: "neutral" };
    default:
      return { label: "In productie", tone: "info" };
  }
}

export default async function PortalVideoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const viewer = await requirePortal();
  const { video, threads } = await getPortalVideo(viewer, id);
  const s = statusLabel(video.status);
  const needsDecision = video.status === "client_review" || video.status === "client_revision";

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
            <Badge tone={s.tone}>{s.label}</Badge>
            {video.plannedPublishOn ? (
              <span className="text-xs text-[var(--color-ink-muted)]">
                Verwachte publicatie: {formatDate(video.plannedPublishOn)}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* Voortgangslijn: van script tot gepubliceerd */}
      <ProgressTimeline status={video.status} />

      {/* Akkoord-bonnetje — zwart op wit wie wanneer akkoord gaf */}
      {["approved", "ready_to_publish", "scheduled", "published"].includes(video.status) && video.approvedAt ? (
        <div className="flex items-center gap-3 rounded-[14px] border border-[var(--color-good)]/30 bg-[var(--color-good-soft)] px-4 py-3">
          <CheckCircle2 className="size-5 shrink-0 text-[var(--color-good)]" />
          <p className="text-sm text-[var(--color-ink)]">
            <span className="font-semibold">Door jou goedgekeurd</span> · {formatDateTime(video.approvedAt)}
          </p>
        </div>
      ) : null}

      {/* Speler / bekijken — Frame.io draait achter de schermen */}
      <Card padded={false}>
        <div className="flex aspect-video items-center justify-center rounded-t-xl bg-[var(--color-ink)]/[0.04]">
          <div className="flex size-14 items-center justify-center rounded-full bg-[var(--color-brand-600)] text-white">
            <Play className="size-6 translate-x-0.5" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 p-4">
          {video.frameUrl ? (
            <>
              <a
                href={video.frameUrl}
                target="_blank"
                rel="noreferrer"
                className={buttonClass({ variant: "primary" })}
              >
                <ExternalLink className="size-4" /> Bekijk video
              </a>
              <a
                href={video.frameUrl}
                target="_blank"
                rel="noreferrer"
                className={buttonClass({ variant: "secondary" })}
              >
                <Download className="size-4" /> Downloaden
              </a>
            </>
          ) : (
            <p className="text-sm text-[var(--color-ink-muted)]">
              De video wordt klaargezet. Je kunt 'm hier straks bekijken en downloaden.
            </p>
          )}
        </div>
      </Card>

      {/* Goedkeuren / aanpassing vragen */}
      {needsDecision ? (
        <Card>
          <CardHeader
            title="Wat vind je ervan?"
            subtitle="Keur de video goed, of vraag een aanpassing aan. Je feedback komt direct bij ons team."
          />
          <div className="mt-4">
            <VideoDecision videoId={video.id} />
          </div>
        </Card>
      ) : null}

      {/* Feedbackgeschiedenis */}
      <Card padded={false}>
        <div className="p-5 pb-3">
          <CardHeader title="Feedback" />
        </div>
        {threads.length === 0 ? (
          <div className="px-5 pb-5">
            <EmptyState
              title="Nog geen feedback"
              description="Opmerkingen die je plaatst, verschijnen hier."
              icon={<MessageSquare className="size-6" />}
            />
          </div>
        ) : (
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
        )}
      </Card>
    </div>
  );
}
