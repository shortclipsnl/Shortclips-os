import type { Metadata } from "next";
import Link from "next/link";
import { Video as VideoIcon } from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { getPortalVideos } from "@/server/portal";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Video's" };
export const dynamic = "force-dynamic";

type Row = {
  id: string;
  title: string;
  status: string;
  thumbnailUrl: string | null;
  publishedAt: Date | null;
  statusChangedAt: Date | null;
};

/** Klantvriendelijke statuslabels — geen interne termen. */
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

function VideoGrid({ rows }: { rows: Row[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((v) => {
        const s = statusLabel(v.status);
        const date = v.publishedAt ?? v.statusChangedAt;
        return (
          <Link
            key={v.id}
            href={`/portal/videos/${v.id}`}
            className="group overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] transition-shadow hover:shadow-md"
          >
            <div className="relative flex aspect-video items-center justify-center bg-[var(--color-surface-2)]">
              {v.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={v.thumbnailUrl} alt="" className="size-full object-cover" />
              ) : (
                <VideoIcon className="size-8 text-[var(--color-ink-faint)]" strokeWidth={1.5} />
              )}
            </div>
            <div className="p-3">
              <p className="truncate text-sm font-medium text-[var(--color-ink)]">{v.title}</p>
              <div className="mt-2 flex items-center justify-between gap-2">
                <Badge tone={s.tone}>{s.label}</Badge>
                {date ? (
                  <span className="text-xs text-[var(--color-ink-muted)]">{formatDate(date)}</span>
                ) : null}
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

export default async function PortalVideosPage() {
  const viewer = await requirePortal();
  const data = await getPortalVideos(viewer);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Video&apos;s</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Al je video&apos;s op één plek — bekijk, geef feedback en download.
        </p>
      </div>

      {data.totaal === 0 ? (
        <EmptyState
          title="Nog geen video's"
          description="Zodra we video's opleveren, verschijnen ze hier."
          icon={<VideoIcon className="size-6" />}
        />
      ) : (
        <>
          {data.actieNodig.length > 0 ? (
            <Card padded={false}>
              <div className="p-5 pb-3">
                <CardHeader
                  title="Actie nodig"
                  subtitle="Deze video's wachten op jouw akkoord of feedback."
                />
              </div>
              <div className="px-5 pb-5">
                <VideoGrid rows={data.actieNodig} />
              </div>
            </Card>
          ) : null}

          {data.inProductie.length > 0 ? (
            <Card padded={false}>
              <div className="p-5 pb-3">
                <CardHeader title="In productie" subtitle="Waar we nu aan werken." />
              </div>
              <div className="px-5 pb-5">
                <VideoGrid rows={data.inProductie} />
              </div>
            </Card>
          ) : null}

          <Card padded={false}>
            <div className="p-5 pb-3">
              <CardHeader title="Gepubliceerd" subtitle={`${data.gepubliceerd.length} video's`} />
            </div>
            <div className="px-5 pb-5">
              {data.gepubliceerd.length === 0 ? (
                <EmptyState title="Nog niets gepubliceerd" />
              ) : (
                <VideoGrid rows={data.gepubliceerd} />
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
