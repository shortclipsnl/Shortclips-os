import type { Metadata } from "next";
import Link from "next/link";
import { Check, Play, Video as VideoIcon } from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { getPortalVideos } from "@/server/portal";
import { CoverImage } from "@/components/portal/cover-image";
import { clientStatusView, statusToneClass } from "@/lib/portal-status";
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

function Tile({ v }: { v: Row }) {
  const view = clientStatusView(v.status);
  const s = { label: view.label, cls: statusToneClass(view.tone) };
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
      </article>
      <p className="mt-2 line-clamp-2 text-[13px] font-medium leading-snug text-[var(--color-ink)] group-hover:text-[#9fdcff]">{v.title}</p>
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

const FEEDBACK_TIPS = [
  "Bekijk de video's volledig voordat je feedback geeft.",
  "Verzamel al je opmerkingen en geef ze zoveel mogelijk in één ronde door.",
  "Let op feitelijke juistheid: namen, teksten, cijfers en productinformatie.",
  "Geef je opmerking bij de juiste video en het juiste moment (met tijdcode).",
  "Houd rekening met de gekozen strategie, montage en stijl van Shortclips.",
  "Vermijd losse of tegenstrijdige feedback via meerdere kanalen.",
];

/** Korte, scanbare uitleg hoe de klant video's controleert. */
function VideoFeedbackGuide() {
  return (
    <section className="sc-glass p-5 sm:p-6">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--sc-accent)]">Zo controleer je jouw video&apos;s</span>
      <h2 className="mt-1 text-[18px] font-bold tracking-tight">Eén duidelijke feedbackronde werkt het best</h2>
      <ul className="mt-4 grid gap-2.5 sm:grid-cols-2">
        {FEEDBACK_TIPS.map((t) => (
          <li key={t} className="flex items-start gap-2.5 text-[13.5px] text-[var(--color-ink-muted)]">
            <Check className="mt-0.5 size-4 shrink-0 text-[#2fd27a]" /> {t}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function PortalVideosPage() {
  const viewer = await requirePortal();
  const data = await getPortalVideos(viewer);

  return (
    <div className="flex flex-col gap-7">
      <div>
        <h1 className="text-[25px] font-bold tracking-tight">Video&apos;s</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">Al je video&apos;s op één plek, bekijk, geef feedback en download.</p>
      </div>

      {data.totaal === 0 ? (
        <div className="sc-glass grid place-items-center gap-2 p-14 text-center">
          <VideoIcon className="size-7 text-[var(--color-ink-faint)]" strokeWidth={1.5} />
          <p className="text-sm font-medium">Nog geen video&apos;s</p>
          <p className="text-[13px] text-[var(--color-ink-muted)]">Zodra we video&apos;s opleveren, verschijnen ze hier.</p>
        </div>
      ) : (
        <>
          <VideoFeedbackGuide />
          <Group title="Jouw beoordeling" subtitle="Deze video's wachten op jouw akkoord." rows={data.actieNodig} />
          <Group title="In productie" subtitle="Hier zijn wij mee bezig, je hoeft nu niets te doen." rows={data.inProductie} />
          <Group title="Online" subtitle={`${data.gepubliceerd.length} video's`} rows={data.gepubliceerd.slice(0, 40)} />
        </>
      )}
    </div>
  );
}
