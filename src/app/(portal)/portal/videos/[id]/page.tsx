import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Download, ExternalLink, MessageSquare, Play } from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { getPortalVideo } from "@/server/portal";
import { Badge, buttonClass, Card, CardHeader, EmptyState } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { VideoDecision } from "../../actions-ui";

export const metadata: Metadata = { title: "Video" };
export const dynamic = "force-dynamic";

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
          <div className="mt-2">
            <Badge tone={s.tone}>{s.label}</Badge>
          </div>
        </div>
      </div>

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
