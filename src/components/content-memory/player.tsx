"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Check, ChevronLeft, ChevronRight, Copy, ExternalLink, X } from "lucide-react";
import { ClientLogo } from "@/components/ui";

/* ------------------------------------------------------------------ *
 * Videospeler: één venster voor de hele pagina, zelfde officiële
 * platformspelers als de Resultatenpagina.
 * ------------------------------------------------------------------ */

export type PlayerVideo = {
  id: string;
  title: string;
  platform: string;
  publishedOn: string | null;
  views: number;
  embedUrl: string | null;
  externalUrl: string | null;
};

const PLATFORM_LABEL: Record<string, string> = { instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook", youtube: "YouTube Shorts", linkedin: "LinkedIn" };
const nfmt = new Intl.NumberFormat("nl-NL");
const dateNl = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");

const PlayerCtx = createContext<(v: PlayerVideo) => void>(() => {});

export function MemoryPlayerProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<PlayerVideo | null>(null);
  const close = useCallback(() => setOpen(null), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, close]);

  return (
    <PlayerCtx.Provider value={setOpen}>
      {children}
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-label={open.title}>
          <button type="button" aria-label="Sluiten" className="absolute inset-0" onClick={close} />
          <div className="relative z-10 flex w-full max-w-[380px] flex-col gap-3">
            <div className="flex items-center justify-between gap-3 text-white">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{open.title}</p>
                <p className="text-xs text-white/60">
                  {PLATFORM_LABEL[open.platform] ?? open.platform}{open.publishedOn ? ` · ${dateNl(open.publishedOn)}` : ""} · {nfmt.format(open.views)} weergaven
                </p>
              </div>
              <button type="button" onClick={close} aria-label="Sluiten" className="grid size-9 shrink-0 place-items-center rounded-full bg-white/10 hover:bg-white/20"><X className="size-5" /></button>
            </div>
            {open.embedUrl ? (
              <div className="relative aspect-[9/16] max-h-[76vh] w-full overflow-hidden rounded-[14px] bg-black">
                <iframe
                  key={open.id}
                  src={open.embedUrl}
                  title={open.title}
                  className="absolute inset-0 size-full border-0"
                  allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                  allowFullScreen
                />
              </div>
            ) : (
              <p className="rounded-[10px] bg-white/10 px-3 py-6 text-center text-sm text-white/90">Deze video kan niet in het portaal worden afgespeeld.</p>
            )}
            {open.externalUrl ? (
              <a href={open.externalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-1.5 text-xs text-white/70 hover:text-white">
                <ExternalLink className="size-3.5" /> Open op {PLATFORM_LABEL[open.platform] ?? open.platform}
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </PlayerCtx.Provider>
  );
}

/** Maakt de (op de server gerenderde) thumbnail klikbaar: speelt de video af in het venster. */
export function PlayTrigger({ video, children, className = "" }: { video: PlayerVideo; children: ReactNode; className?: string }) {
  const play = useContext(PlayerCtx);
  return (
    <button type="button" onClick={() => play(video)} className={`group block text-left ${className}`} aria-label={`Speel af: ${video.title}`}>
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * Kopiëren
 * ------------------------------------------------------------------ */

export function CopyButton({ text, label = "Kopieer" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setDone(true);
    window.setTimeout(() => setDone(false), 1600);
  };
  return (
    <button
      type="button"
      onClick={copy}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${done ? "border-[var(--color-good)]/40 bg-[var(--color-good-soft)] text-[var(--color-good)]" : "border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}
      aria-label={`${label}: ${text}`}
    >
      {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {done ? "Gekopieerd" : label}
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * Klantselectie: compacte logobalk, geselecteerde klant gemarkeerd
 * ------------------------------------------------------------------ */

export type StripClient = { id: string; name: string; slug: string; logoUrl: string | null; color: string | null; n: number };

export function MemoryClientStrip({ clients, activeSlug, weergave, extraQuery = "" }: { clients: StripClient[]; activeSlug?: string; weergave: "intern" | "klant"; extraQuery?: string }) {
  const active = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    active.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [activeSlug]);
  if (!clients.length) return null;
  return (
    <nav aria-label="Klanten" className="sc-card overflow-x-auto [scrollbar-width:thin]">
      <ul className="flex min-w-max gap-1 p-2">
        {clients.map((c) => {
          const on = c.slug === activeSlug;
          return (
            <li key={c.id}>
              <Link
                ref={on ? active : undefined}
                href={`/contentgeheugen?klant=${c.slug}${weergave === "klant" ? "&weergave=klant" : ""}${extraQuery}`}
                scroll={false}
                aria-current={on ? "page" : undefined}
                title={`${c.name} · ${c.n} posts`}
                className={`flex w-[84px] flex-col items-center gap-1.5 rounded-lg px-1.5 py-2 text-center transition-colors ${on ? "bg-[var(--color-indigo-ink)] text-white ring-2 ring-[var(--color-indigo-mist)]" : "text-[var(--color-ink)] hover:bg-[var(--color-surface-sunken)]"}`}
              >
                <span className="rounded-lg bg-white">
                  <ClientLogo name={c.name} logoUrl={c.logoUrl} color={c.color} size={44} />
                </span>
                <span className="line-clamp-2 text-2xs font-medium leading-tight">{c.name}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/* ------------------------------------------------------------------ *
 * Omslag met vangnet: lukt de afbeelding niet, dan een titelkaart in
 * Shortclips-blauw met de openingszin. Nooit een leeg of zwart vlak.
 * ------------------------------------------------------------------ */

export function CoverImage({ src, title, big = false }: { src: string | null; title: string; big?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={title} loading="lazy" onError={() => setFailed(true)} className="absolute inset-0 size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
    );
  }
  return (
    <span className="absolute inset-0 flex flex-col justify-center bg-gradient-to-br from-[#1a1a4c] via-[#00003b] to-[#000029] p-[12%] text-white">
      <span className={`line-clamp-6 font-semibold leading-snug ${big ? "text-[15px]" : "text-[9px]"}`}>{title}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Horizontale slider met pijlen (Beste video's).
 * ------------------------------------------------------------------ */

export function Slider({ children, label }: { children: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const by = (dir: number) => ref.current?.scrollBy({ left: dir * Math.max(280, (ref.current?.clientWidth ?? 600) * 0.8), behavior: "smooth" });
  return (
    <div className="relative">
      <div className="absolute -top-[52px] right-0 hidden gap-2 sm:flex">
        <button type="button" onClick={() => by(-1)} aria-label="Naar links" className="grid size-9 place-items-center rounded-full border border-white/25 text-white/80 hover:bg-white/10 hover:text-white"><ChevronLeft className="size-4" /></button>
        <button type="button" onClick={() => by(1)} aria-label="Naar rechts" className="grid size-9 place-items-center rounded-full border border-white/25 text-white/80 hover:bg-white/10 hover:text-white"><ChevronRight className="size-4" /></button>
      </div>
      <div ref={ref} role="list" aria-label={label} className="-mx-1 flex snap-x snap-mandatory gap-4 overflow-x-auto px-1 pb-3 [scrollbar-color:rgba(255,255,255,.3)_transparent] [scrollbar-width:thin]">
        {children}
      </div>
    </div>
  );
}
