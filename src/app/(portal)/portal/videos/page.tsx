import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink, Play, Video as VideoIcon } from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { getPortalFrameUrl, getPortalVideos } from "@/server/portal";
import { buttonClass } from "@/components/ui";
import { CoverImage } from "@/components/portal/cover-image";
import { formatDate } from "@/lib/format";
import { videoCover } from "../cover";

export const metadata: Metadata = { title: "Video's" };
export const dynamic = "force-dynamic";

type Row = {
  id: string;
  title: string;
  status: string;
  frameAssetId: string | null;
  thumbnailUrl: string | null;
  publishedAt: Date | null;
  statusChangedAt: Date | null;
};

function statusChip(status: string): { label: string; cls: string } {
  switch (status) {
    case "client_review":
      return { label: "Jouw akkoord", cls: "bg-[var(--color-warn-soft)] text-[#ffb020]" };
    case "client_revision":
      return { label: "In aanpassing", cls: "bg-[var(--color-info-soft)] text-[#4bc4ff]" };
    case "approved":
    case "ready_to_publish":
    case "scheduled":
      return { label: "Klaar", cls: "bg-[var(--color-good-soft)] text-[#2fd27a]" };
    case "published":
      return { label: "Gepubliceerd", cls: "bg-white/10 text-[var(--color-ink-muted)]" };
    default:
      return { label: "In edit", cls: "bg-[var(--color-info-soft)] text-[#4bc4ff]" };
  }
}

function Tile({ v }: { v: Row }) {
  const s = statusChip(v.status);
  const date = v.publishedAt ?? v.statusChangedAt;
  // Echte Frame-omslag via de proxy (vers gehouden); de kleur-omslag blijft als
  // zachte placeholder eronder staan tot de afbeelding is ingeladen.
  const cover = v.frameAssetId ? `/api/frame/thumb/${v.id}` : null;
  return (
    <Link href={`/portal/videos/${v.id}`} className="group block">
      <article
        className="sc-short transition-transform duration-200 group-hover:-translate-y-0.5"
        style={{ background: videoCover(v.title) }}
      >
        {cover ? <CoverImage src={cover} /> : null}
        <span className={`absolute left-2.5 top-2.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${s.cls}`}>{s.label}</span>
        <span className="sc-play"><Play className="size-[18px] translate-x-0.5" fill="currentColor" /></span>
        <span className="absolute inset-x-3 bottom-3">
          <span className="block truncate text-[12.5px] font-semibold text-white">{v.title}</span>
          {date ? <span className="block text-[11px] text-white/60">{formatDate(date)}</span> : null}
        </span>
      </article>
    </Link>
  );
}

function Group({ title, subtitle, rows }: { title: string; subtitle?: string; rows: Row[] }) {
  if (rows.length === 0) return null;
  return (
    <section>
      <div className="mb-3.5">
        <h2 className="text-base font-semibold">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-[13px] text-[var(--color-ink-muted)]">{subtitle}</p> : null}
      </div>
      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-5">
        {rows.map((v) => <Tile key={v.id} v={v} />)}
      </div>
    </section>
  );
}

export default async function PortalVideosPage() {
  const viewer = await requirePortal();
  const [data, frameUrl] = await Promise.all([getPortalVideos(viewer), getPortalFrameUrl(viewer)]);

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[25px] font-bold tracking-tight">Video&apos;s</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">Al je video&apos;s op één plek — bekijk, geef feedback en download.</p>
        </div>
        {frameUrl ? (
          <a href={frameUrl} target="_blank" rel="noreferrer" className={buttonClass({ variant: "accent" })}>
            <ExternalLink className="size-4" /> Beoordeel je video&apos;s in Frame
          </a>
        ) : null}
      </div>

      {data.totaal === 0 ? (
        <div className="sc-glass grid place-items-center gap-2 p-14 text-center">
          <VideoIcon className="size-7 text-[var(--color-ink-faint)]" strokeWidth={1.5} />
          <p className="text-sm font-medium">Nog geen video&apos;s</p>
          <p className="text-[13px] text-[var(--color-ink-muted)]">Zodra we video&apos;s opleveren, verschijnen ze hier.</p>
        </div>
      ) : (
        <>
          <Group title="Actie nodig" subtitle="Deze video's wachten op jouw akkoord of feedback." rows={data.actieNodig} />
          <Group title="In productie" subtitle="Waar we nu aan werken." rows={data.inProductie} />
          <Group title="Gepubliceerd" subtitle={`${data.gepubliceerd.length} video's`} rows={data.gepubliceerd.slice(0, 40)} />
        </>
      )}
    </div>
  );
}
