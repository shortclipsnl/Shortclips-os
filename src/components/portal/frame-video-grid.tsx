"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Film, Play, X } from "lucide-react";

export type GridVideo = {
  id: string;
  title: string;
  subfolder: string | null;
  durationSeconds: number | null;
};

function fmtDuration(s: number | null): string | null {
  if (!s || s <= 0) return null;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Thumbnail uit Frame (via de beveiligde proxy) met een neutrale placeholder. */
function Thumb({ id, title }: { id: string; title: string }) {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  return (
    <div className="relative aspect-[9/16] w-full overflow-hidden rounded-[14px] border border-[var(--sc-line)] bg-[var(--sc-fill-strong)]">
      {state !== "ok" ? (
        <span className="absolute inset-0 grid place-items-center text-[var(--color-ink-faint)]">
          <Film className="size-6" strokeWidth={1.5} />
        </span>
      ) : null}
      {state !== "error" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/portal/frame/${id}/thumb`}
          alt={title}
          loading="lazy"
          onLoad={() => setState("ok")}
          onError={() => setState("error")}
          className={`absolute inset-0 size-full object-cover transition-opacity duration-500 ${state === "ok" ? "opacity-100" : "opacity-0"}`}
        />
      ) : null}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/55 to-transparent" />
      <span className="absolute bottom-2.5 left-2.5 grid size-9 place-items-center rounded-full bg-white/90 text-[#00003b] shadow-md transition-transform group-hover:scale-105">
        <Play className="size-4 translate-x-px" fill="currentColor" />
      </span>
    </div>
  );
}

/**
 * Raster met de video's van één sessie, gegroepeerd per submap. Klik = de video
 * speelt direct af in het portaal (ondertekende Frame-link via de server; geen
 * publieke deellink). Pijltjes/toetsenbord om door de sessie te bladeren.
 */
export function FrameVideoGrid({ videos }: { videos: GridVideo[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const [playError, setPlayError] = useState(false);
  const close = useCallback(() => { setOpen(null); setPlayError(false); }, []);
  const step = useCallback((d: number) => { setPlayError(false); setOpen((i) => (i === null ? i : (i + d + videos.length) % videos.length)); }, [videos.length]);

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close, step]);

  const groups: Array<{ name: string | null; items: Array<{ v: GridVideo; i: number }> }> = [];
  videos.forEach((v, i) => {
    let g = groups.find((x) => x.name === v.subfolder);
    if (!g) { g = { name: v.subfolder, items: [] }; groups.push(g); }
    g.items.push({ v, i });
  });
  groups.sort((a, b) => (a.name === null ? -1 : b.name === null ? 1 : a.name.localeCompare(b.name, "nl")));

  const current = open !== null ? videos[open] : null;

  return (
    <>
      <div className="flex flex-col gap-6">
        {groups.map((g) => (
          <div key={g.name ?? "_"}>
            {g.name ? <h3 className="mb-3 text-[13px] font-semibold text-[var(--color-ink-muted)]">{g.name}</h3> : null}
            <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {g.items.map(({ v, i }) => (
                <button key={v.id} type="button" onClick={() => setOpen(i)} className="group text-left focus-visible:outline-none">
                  <Thumb id={v.id} title={v.title} />
                  <p className="mt-2 line-clamp-2 text-[13.5px] font-semibold leading-snug text-[var(--color-ink)] group-hover:text-[var(--sc-accent)]">{v.title}</p>
                  {fmtDuration(v.durationSeconds) ? <p className="mt-0.5 text-[12px] tabular-nums text-[var(--color-ink-faint)]">{fmtDuration(v.durationSeconds)}</p> : null}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {current ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-label={current.title}>
          <button type="button" aria-label="Sluiten" className="absolute inset-0" onClick={close} />
          <div className="relative z-10 flex w-full max-w-[420px] flex-col items-center gap-3">
            <div className="flex w-full items-center justify-between gap-3 text-white">
              <p className="min-w-0 truncate text-[14px] font-semibold">{current.title}</p>
              <button type="button" onClick={close} aria-label="Sluiten" className="grid size-9 shrink-0 place-items-center rounded-full bg-white/10 hover:bg-white/20"><X className="size-5" /></button>
            </div>
            <video
              key={current.id}
              src={`/api/portal/frame/${current.id}/play`}
              poster={`/api/portal/frame/${current.id}/thumb`}
              controls
              autoPlay
              playsInline
              onError={() => setPlayError(true)}
              className="max-h-[78vh] w-full rounded-[16px] bg-black"
            />
            {playError ? (
              <p className="rounded-[10px] bg-white/10 px-3 py-2 text-center text-[13px] text-white/90">
                Deze video kan nu niet worden afgespeeld. Probeer het over een paar minuten opnieuw of neem contact op met je contactpersoon.
              </p>
            ) : null}
            {videos.length > 1 ? (
              <div className="flex items-center gap-3 text-white/80">
                <button type="button" onClick={() => step(-1)} className="grid size-10 place-items-center rounded-full bg-white/10 hover:bg-white/20" aria-label="Vorige video"><ChevronLeft className="size-5" /></button>
                <span className="text-[12px] tabular-nums">{(open ?? 0) + 1} / {videos.length}</span>
                <button type="button" onClick={() => step(1)} className="grid size-10 place-items-center rounded-full bg-white/10 hover:bg-white/20" aria-label="Volgende video"><ChevronRight className="size-5" /></button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
