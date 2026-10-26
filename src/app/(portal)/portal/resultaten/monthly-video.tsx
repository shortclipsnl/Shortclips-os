import { Play, Sparkles } from "lucide-react";
import type { ClientVideoUpdate } from "@/server/video-updates";

const MONTHS = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];

function periodLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${y}`;
}

/**
 * Persoonlijke videoboodschap van de content creator bij de resultaten:
 * een korte video met toelichting over hoe het gaat en wat we verbeteren.
 */
export function MonthlyVideoCard({ update }: { update: ClientVideoUpdate }) {
  return (
    <section className="sc-glass overflow-hidden p-0">
      <div className="flex items-center gap-2 px-5 pt-5 sm:px-6">
        <span className="grid size-7 place-items-center rounded-lg bg-[rgba(25,168,255,0.14)] text-[var(--sc-accent)]"><Sparkles className="size-4" /></span>
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--sc-accent)]">Van jouw team</span>
          <h2 className="text-[17px] font-bold leading-tight">Je videoboodschap · {periodLabel(update.period)}</h2>
        </div>
      </div>

      <div className="mt-4 px-5 sm:px-6">
        {update.embedUrl ? (
          <div className="relative w-full overflow-hidden rounded-[14px] border border-[var(--sc-line)]" style={{ aspectRatio: "16 / 9" }}>
            <iframe
              src={update.embedUrl}
              title="Videoboodschap van je team"
              className="absolute inset-0 size-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        ) : (
          <a
            href={update.videoUrl}
            target="_blank"
            rel="noreferrer"
            className="group flex items-center gap-4 rounded-[14px] border border-[var(--sc-line)] bg-[var(--sc-fill)] p-4 transition-colors hover:border-[var(--sc-accent)]"
          >
            <span className="grid size-12 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#19a8ff] to-[#1b5fe0] text-white"><Play className="size-5" /></span>
            <div>
              <div className="text-[15px] font-semibold">Bekijk de videoboodschap</div>
              <div className="text-[13px] text-[var(--color-ink-muted)]">Een korte uitleg van je content creator over je resultaten.</div>
            </div>
          </a>
        )}
      </div>

      {update.note ? (
        <p className="mt-4 whitespace-pre-wrap px-5 pb-5 text-[14px] leading-relaxed text-[var(--color-ink-muted)] sm:px-6 sm:pb-6">{update.note}</p>
      ) : (
        <div className="pb-5" />
      )}
    </section>
  );
}
