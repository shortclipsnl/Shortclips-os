import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, ExternalLink, MessageSquareText, Play, Video as VideoIcon } from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { getPortalVideos } from "@/server/portal";
import { getPortalSettings } from "@/server/portal-settings";
import { CoverImage } from "@/components/portal/cover-image";
import { VideoProces } from "@/components/portal/video-proces";
import { buttonClass } from "@/components/ui";
import { clientStatusView, statusToneClass } from "@/lib/portal-status";
import { videoCover } from "../cover";

export const metadata: Metadata = { title: "Video's" };
export const dynamic = "force-dynamic";

type Row = {
  id: string;
  title: string;
  status: string;
  frameAssetId: string | null;
  frameUrl: string | null;
  thumbnailUrl: string | null;
  publishedAt: Date | null;
  statusChangedAt: Date | null;
};

function Tile({ v }: { v: Row }) {
  const view = clientStatusView(v.status);
  const s = { label: view.label, cls: statusToneClass(view.tone) };
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
      </article>
      <p className="mt-2 line-clamp-2 text-[13px] font-medium leading-snug text-[var(--color-ink)] group-hover:text-[#9fdcff]">{v.title}</p>
    </Link>
  );
}

/** Eén video die op beoordeling wacht — met een directe link naar de Frame-post. */
function ReviewRow({ v }: { v: Row }) {
  const cover = v.frameAssetId ? `/api/frame/thumb/${v.id}` : null;
  return (
    <div className="sc-glass flex items-center gap-4 p-3.5">
      <Link href={`/portal/videos/${v.id}`} className="block w-16 shrink-0">
        <span className="sc-short block" style={{ background: videoCover(v.title) }}>
          {cover ? <CoverImage src={cover} /> : null}
          <span className="sc-play"><Play className="size-3.5 translate-x-0.5" fill="currentColor" /></span>
        </span>
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={`/portal/videos/${v.id}`} className="line-clamp-2 text-[14px] font-semibold leading-snug hover:text-[var(--sc-accent)]">{v.title}</Link>
        <p className="mt-0.5 text-[12.5px] text-[var(--color-ink-muted)]">Wacht op jouw akkoord of feedback</p>
      </div>
      {v.frameUrl ? (
        <a href={v.frameUrl} target="_blank" rel="noreferrer" className={`${buttonClass({ variant: "accent", size: "sm" })} shrink-0`}>
          Beoordeel in Frame <ExternalLink className="size-3.5" />
        </a>
      ) : (
        <Link href={`/portal/videos/${v.id}`} className={`${buttonClass({ variant: "accent", size: "sm" })} shrink-0`}>
          Beoordelen <ArrowRight className="size-3.5" />
        </Link>
      )}
    </div>
  );
}

function Group({ title, subtitle, rows, max }: { title: string; subtitle?: string; rows: Row[]; max?: number }) {
  if (rows.length === 0) return null;
  return (
    <section>
      <div className="mb-3.5">
        <h2 className="text-base font-semibold">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-[13px] text-[var(--color-ink-muted)]">{subtitle}</p> : null}
      </div>
      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-5">
        {rows.slice(0, max ?? rows.length).map((v) => <Tile key={v.id} v={v} />)}
      </div>
    </section>
  );
}

export default async function PortalVideosPage() {
  const viewer = await requirePortal();
  const [data, settings] = await Promise.all([getPortalVideos(viewer), getPortalSettings()]);

  return (
    <div className="flex flex-col gap-7">
      <div>
        <h1 className="text-[25px] font-bold tracking-tight">Video&apos;s</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">Bekijk je video&apos;s, geef feedback in Frame en zie wat er online staat.</p>
      </div>

      {data.totaal === 0 ? (
        <div className="sc-glass grid place-items-center gap-2 p-14 text-center">
          <VideoIcon className="size-7 text-[var(--color-ink-faint)]" strokeWidth={1.5} />
          <p className="text-sm font-medium">Nog geen video&apos;s</p>
          <p className="text-[13px] text-[var(--color-ink-muted)]">Zodra we video&apos;s opleveren, verschijnen ze hier.</p>
        </div>
      ) : (
        <>
          {/* Jouw beoordeling — het belangrijkste, bovenaan */}
          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[18px] font-bold tracking-tight">Jouw beoordeling</h2>
              {data.actieNodig.length > 0 ? (
                <span className="rounded-full bg-[rgba(255,176,32,0.16)] px-2.5 py-1 text-[12px] font-semibold text-[#ffb020]">
                  {data.actieNodig.length} video&apos;s wachten op je akkoord
                </span>
              ) : null}
            </div>

            {data.actieNodig.length === 0 ? (
              <div className="sc-glass flex items-center gap-3 p-5 text-[14px]">
                <Check className="size-5 shrink-0 text-[#2fd27a]" />
                <span>Je bent helemaal bij — er staat nu niets op je te wachten.</span>
              </div>
            ) : (
              <>
                {/* Zo geef je feedback — kort en duidelijk, gericht op Frame */}
                <div className="sc-glass mb-3 flex items-start gap-3 p-4" style={{ background: "linear-gradient(180deg, rgba(25,168,255,0.07), rgba(255,255,255,0.02))" }}>
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[rgba(25,168,255,0.14)] text-[var(--sc-accent)]"><MessageSquareText className="size-[18px]" /></span>
                  <p className="text-[13.5px] leading-relaxed text-[var(--color-ink-muted)]">
                    Open de video in <strong className="text-[var(--color-ink)]">Frame</strong> en geef je feedback <strong className="text-[var(--color-ink)]">rechtstreeks in de video, met tijdcode</strong> —
                    zo komt elke opmerking op het juiste moment en kunnen we die verwerken. Bundel je opmerkingen per video, dan pakken we ze in één keer op. Alles klopt? Keur de video goed.
                  </p>
                </div>
                <div className="flex flex-col gap-2.5">
                  {data.actieNodig.map((v) => <ReviewRow key={v.id} v={v} />)}
                </div>
              </>
            )}
          </section>

          {/* Online — wat er live staat of gaat */}
          <Group title="Online" subtitle={`${data.gepubliceerd.length} video's staan online`} rows={data.gepubliceerd} max={40} />

          {/* In productie — bewust ingeklapt; hier hoeft de klant niets mee */}
          {data.inProductie.length > 0 ? (
            <details className="sc-glass p-5 [&_summary]:cursor-pointer">
              <summary className="flex items-center gap-2 text-sm font-semibold">
                <VideoIcon className="size-4 text-[var(--color-ink-muted)]" /> In productie ({data.inProductie.length})
                <span className="font-normal text-[var(--color-ink-faint)]">— hier zijn wij mee bezig, je hoeft nu niets te doen</span>
              </summary>
              <div className="mt-4 grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-5">
                {data.inProductie.map((v) => <Tile key={v.id} v={v} />)}
              </div>
            </details>
          ) : null}
        </>
      )}

      {/* Algemene procesinfo: van beeld naar publicatie (document) */}
      {data.totaal > 0 ? <VideoProces extraFeedbackFee={settings.extraFeedbackFee} /> : null}
    </div>
  );
}
