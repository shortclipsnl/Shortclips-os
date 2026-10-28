import type { Metadata } from "next";
import Link from "next/link";
import { Check, ExternalLink, MessageSquareText, Play, Video as VideoIcon } from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { getPortalFrameUrl, getPortalVideos } from "@/server/portal";
import { getPortalSettingsForClient } from "@/server/portal-settings";
import { CoverImage } from "@/components/portal/cover-image";
import { VideoProces } from "@/components/portal/video-proces";
import { buttonClass } from "@/components/ui";
import { formatDateFull } from "@/lib/format";
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
  productionDayId: string | null;
  sessionDate: string | null;
  sessionTitle: string | null;
};

type SessionGroup = { key: string; date: string | null; title: string | null; videos: Row[]; frameUrl: string | null };

/** Video's groeperen per opnamesessie, zodat de klant per sessie (6–8 video's)
 *  in één keer in Frame kan beoordelen i.p.v. per losse video te klikken. */
function groupBySession(rows: Row[]): SessionGroup[] {
  const map = new Map<string, SessionGroup>();
  for (const v of rows) {
    const key = v.productionDayId ?? "los";
    let g = map.get(key);
    if (!g) { g = { key, date: v.sessionDate, title: v.sessionTitle, videos: [], frameUrl: null }; map.set(key, g); }
    g.videos.push(v);
    if (!g.frameUrl && v.frameUrl) g.frameUrl = v.frameUrl;
  }
  return [...map.values()].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

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

/** Eén opnamesessie met al z'n te beoordelen video's en één Frame-link. */
function SessionCard({ g }: { g: SessionGroup }) {
  const header = g.date ? `Opname ${formatDateFull(g.date)}` : g.title ?? "Losse video's";
  return (
    <div className="sc-glass p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold">{header}</h3>
          <p className="mt-0.5 text-[12.5px] text-[var(--color-ink-muted)]">{g.videos.length} video&apos;s wachten op je akkoord</p>
        </div>
        {g.frameUrl ? (
          <a href={g.frameUrl} target="_blank" rel="noreferrer" className={`${buttonClass({ variant: "accent", size: "sm" })} shrink-0`}>
            Beoordeel deze sessie in Frame <ExternalLink className="size-3.5" />
          </a>
        ) : null}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4">
        {g.videos.map((v) => <Tile key={v.id} v={v} />)}
      </div>
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
  const [data, settings, frameUrl] = await Promise.all([getPortalVideos(viewer), getPortalSettingsForClient(viewer.clientId ?? ""), getPortalFrameUrl(viewer)]);

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[25px] font-bold tracking-tight">Video&apos;s</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">Bekijk je video&apos;s, geef feedback in Frame en zie wat er online staat.</p>
        </div>
        {frameUrl ? (
          <a href={frameUrl} target="_blank" rel="noreferrer" className={`${buttonClass({ variant: "accent", size: "sm" })} shrink-0`}>
            <ExternalLink className="size-4" /> Open alles in Frame.io
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
          {/* Jouw beoordeling — het belangrijkste, bovenaan */}
          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[18px] font-bold tracking-tight">Jouw beoordeling</h2>
              {data.actieNodig.length > 0 ? (
                <span className="rounded-full bg-[rgba(25,168,255,0.16)] px-2.5 py-1 text-[12px] font-semibold text-[#19a8ff]">
                  {data.actieNodig.length} video&apos;s wachten op je akkoord
                </span>
              ) : null}
            </div>

            {data.actieNodig.length === 0 ? (
              <div className="sc-glass flex items-center gap-3 p-5 text-[14px]">
                <Check className="size-5 shrink-0 text-[#2fd27a]" />
                <span>Je bent helemaal bij; er staat nu niets op je te wachten.</span>
              </div>
            ) : (
              <>
                {/* Zo geef je feedback — per sessie in één keer in Frame */}
                <div className="sc-glass mb-3 flex items-start gap-3 p-4" style={{ background: "linear-gradient(180deg, rgba(25,168,255,0.07), rgba(255,255,255,0.02))" }}>
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[rgba(25,168,255,0.14)] text-[var(--sc-accent)]"><MessageSquareText className="size-[18px]" /></span>
                  <p className="text-[13.5px] leading-relaxed text-[var(--color-ink-muted)]">
                    Je video&apos;s staan per <strong className="text-[var(--color-ink)]">opnamesessie</strong> bij elkaar. Open de sessie in <strong className="text-[var(--color-ink)]">Frame</strong> en bekijk en
                    beoordeel alle video&apos;s van die opname <strong className="text-[var(--color-ink)]">in één keer</strong> — geef je feedback rechtstreeks in de video met tijdcode. Alles klopt? Keur ze goed.
                  </p>
                </div>
                <div className="flex flex-col gap-4">
                  {groupBySession(data.actieNodig).map((g) => <SessionCard key={g.key} g={g} />)}
                </div>
              </>
            )}
          </section>

          {/* Ingepland — goedgekeurd en klaar om online te gaan */}
          {data.ingepland.length > 0 ? (
            <Group title="Ingepland" subtitle={`${data.ingepland.length} video's staan klaar om online te gaan`} rows={data.ingepland} max={40} />
          ) : null}

          {/* Online — wat er live staat of gaat */}
          <Group title="Online" subtitle={`${data.gepubliceerd.length} video's staan online`} rows={data.gepubliceerd} max={40} />

          {/* In productie — bewust ingeklapt; hier hoeft de klant niets mee */}
          {data.inProductie.length > 0 ? (
            <details className="sc-glass p-5 [&_summary]:cursor-pointer">
              <summary className="flex items-center gap-2 text-sm font-semibold">
                <VideoIcon className="size-4 text-[var(--color-ink-muted)]" /> In productie ({data.inProductie.length})
                <span className="font-normal text-[var(--color-ink-faint)]">hier zijn wij mee bezig, je hoeft nu niets te doen</span>
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
