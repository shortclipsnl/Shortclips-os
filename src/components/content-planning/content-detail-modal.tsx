"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Copy, Download, ExternalLink, Film, Link2, Loader2, Maximize2, RotateCcw, X } from "lucide-react";
import { PLATFORM, PUBLICATION_STATUS } from "@/lib/statuses";
import { ClientLogo } from "@/components/ui";
import { PlatformIcon } from "@/components/platform-icon";
import { cleanCaption } from "@/lib/clean-caption";
import { PublishPanel } from "./publish-panel";

/**
 * Detailvenster van een bericht in de contentplanning: links de contentinfo en
 * caption, rechts de bijbehorende video (afspelen, volledig scherm, downloaden).
 * De video komt uit dezelfde Frame-bibliotheek als het klantportaal en de knop
 * "Short video's"; afspelen en downloaden lopen via dezelfde beveiligde routes.
 * Op kleine schermen staan de twee delen onder elkaar.
 */

export type DetailItem = {
  id: string;
  title: string;
  caption: string | null;
  clientName: string;
  clientSlug: string | null;
  clientLogo: string | null;
  clientColor: string | null;
  scheduledOn: string;
  scheduledAt: string | null;
  contentType: string | null;
  platforms: string[];
  deliverableId: string | null;
  status?: string | null;
};

type Video = {
  id: string;
  title: string;
  fileName: string;
  sessionTitle: string;
  subfolder: string | null;
  durationSeconds: number | null;
  source: "handmatig" | "automatisch";
  upgraded: boolean;
  viewUrl: string | null;
};

type Candidates = Array<{ key: string; title: string; videos: Array<{ id: string; title: string; subfolder: string | null; durationSeconds: number | null }> }>;

const STATUS_TONE: Record<string, string> = {
  warn: "bg-[var(--color-warn-soft)] text-[#8a5300]",
  info: "bg-[var(--color-info-soft)] text-[#0b5f8a]",
  lime: "bg-[var(--color-lime-soft)] text-[#4d5f05]",
  good: "bg-[var(--color-good-soft)] text-[#1d6b4c]",
  bad: "bg-[var(--color-bad-soft)] text-[#a3271c]",
};

export { cleanCaption };

function fmtDate(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, day).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function fmtDuration(s: number | null): string | null {
  if (!s || s <= 0) return null;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function Label({ children }: { children: React.ReactNode }) {
  return <dt className="text-2xs font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-faint)]">{children}</dt>;
}

export function ContentDetailModal({ item, onClose }: { item: DetailItem; onClose: () => void }) {
  const has = !!(item.caption && item.caption.trim());
  const text = has ? cleanCaption(item.caption!) : "";
  const [copied, setCopied] = useState(false);
  const [video, setVideo] = useState<Video | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [playError, setPlayError] = useState(false);
  const [picker, setPicker] = useState<Candidates | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/contentplanning/items/${item.id}/video`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { video: Video | null; canEdit: boolean }) => {
        if (!alive) return;
        setVideo(d.video);
        setCanEdit(d.canEdit);
      })
      .catch(() => alive && setLoadError(true))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [item.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.fullscreenElement) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard geblokkeerd */
    }
  }

  const openPicker = useCallback(async () => {
    setPickerOpen(true);
    if (picker) return;
    const r = await fetch(`/api/contentplanning/items/${item.id}/video?kandidaten=1`, { cache: "no-store" });
    if (r.ok) setPicker(((await r.json()) as { candidates: Candidates }).candidates ?? []);
    else setPicker([]);
  }, [item.id, picker]);

  async function link(frameAssetId: string | null) {
    setSaving(true);
    try {
      const r = await fetch(`/api/contentplanning/items/${item.id}/video`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frameAssetId }),
      });
      if (r.ok) {
        setVideo(((await r.json()) as { video: Video | null }).video);
        setPlayError(false);
        setPickerOpen(false);
      }
    } finally {
      setSaving(false);
    }
  }

  function fullscreen() {
    const el = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (!el) return;
    if (el.requestFullscreen) void el.requestFullscreen().catch(() => el.webkitEnterFullscreen?.());
    else el.webkitEnterFullscreen?.();
  }

  const status = item.status ? PUBLICATION_STATUS[item.status] : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-[var(--radius-lg)] bg-[var(--color-surface)] shadow-[var(--shadow-pop)] sm:rounded-[var(--radius-lg)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={item.title}
      >
        {/* Kop */}
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-line)] px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <ClientLogo name={item.clientName} logoUrl={item.clientLogo} color={item.clientColor} size={38} />
            <div className="min-w-0">
              <div className="truncate text-xs font-medium text-[var(--color-ink-muted)]">{item.clientName}</div>
              <div className="truncate text-base font-semibold">{video?.title ?? item.title}</div>
            </div>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded p-1.5 text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]" aria-label="Sluiten">
            <X className="size-5" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_340px] md:overflow-hidden">
          {/* Links: contentinformatie */}
          <div className="flex min-w-0 flex-col gap-5 p-5 md:overflow-y-auto">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
              <div className="flex flex-col gap-1">
                <Label>Klant</Label>
                <dd className="text-sm font-semibold">{item.clientName}</dd>
              </div>
              <div className="flex flex-col gap-1">
                <Label>Publicatiestatus</Label>
                <dd>
                  {status ? (
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_TONE[status.tone] ?? "bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]"}`}>{status.label}</span>
                  ) : (
                    <span className="text-sm text-[var(--color-ink-faint)]">Onbekend</span>
                  )}
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <Label>Publicatiedatum</Label>
                <dd className="text-sm first-letter:uppercase">
                  {fmtDate(item.scheduledOn)}
                  {item.scheduledAt ? `, ${item.scheduledAt.slice(0, 5)}` : ""}
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <Label>Platform</Label>
                <dd className="flex flex-wrap gap-1.5">
                  {item.platforms.length > 0 ? (
                    item.platforms.map((p) => (
                      <span key={p} className="inline-flex items-center gap-1 rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-xs text-[var(--color-ink-muted)]">
                        <PlatformIcon platform={p} size={12} title={PLATFORM[p]?.label} />
                        {PLATFORM[p]?.label ?? p}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-[var(--color-ink-faint)]">Nog niet bepaald</span>
                  )}
                </dd>
              </div>
              <div className="col-span-2 flex flex-col gap-1">
                <Label>Titel</Label>
                <dd className="text-sm">
                  {item.title}
                  {item.contentType ? <span className="text-[var(--color-ink-muted)]"> · {item.contentType}</span> : null}
                </dd>
              </div>
            </dl>

            <div className="flex min-h-0 flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-2xs font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-faint)]">Caption</span>
                {has ? (
                  <button type="button" onClick={copy} className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2 py-1 text-2xs font-medium hover:bg-[var(--color-surface-sunken)]">
                    {copied ? <Check className="size-3 text-[var(--color-good)]" /> : <Copy className="size-3" />}
                    {copied ? "Gekopieerd" : "Kopiëren"}
                  </button>
                ) : null}
              </div>
              {has ? (
                <p className="max-h-[40vh] overflow-y-auto rounded-[var(--radius-sm)] bg-[var(--color-surface-sunken)] p-3 text-sm leading-relaxed whitespace-pre-wrap md:max-h-[46vh]">{text}</p>
              ) : (
                <p className="rounded-[var(--radius-sm)] border border-dashed border-[var(--color-warn)]/40 bg-[var(--color-warn-soft)]/50 p-3 text-sm text-[#8a5300]">
                  Nog geen caption bij deze upload. Zet de caption in de omschrijving van de afspraak in Google Agenda, dan verschijnt hij hier automatisch.
                </p>
              )}
            </div>

            <PublishPanel
              itemId={item.id}
              clientName={item.clientName}
              when={`${fmtDate(item.scheduledOn)}${item.scheduledAt ? `, ${item.scheduledAt.slice(0, 5)}` : ""}`}
            />

            <Link
              href={item.deliverableId ? `/videos/${item.deliverableId}` : item.clientSlug ? `/clients/${item.clientSlug}?tab=planning` : "#"}
              className="mt-auto inline-flex w-fit items-center gap-1 text-xs font-medium text-[var(--color-brand-600)] hover:underline"
            >
              <ExternalLink className="size-3.5" /> Open details
            </Link>
          </div>

          {/* Rechts: videospeler */}
          <div className="flex flex-col gap-3 border-t border-[var(--color-line)] bg-[var(--color-surface-sunken)] p-5 md:overflow-y-auto md:border-t-0 md:border-l">
            {loading ? (
              <div className="grid aspect-[9/16] w-full max-w-[300px] place-items-center self-center rounded-[14px] bg-[var(--color-surface-2)]">
                <Loader2 className="size-6 animate-spin text-[var(--color-ink-faint)]" />
              </div>
            ) : video ? (
              <>
                <video
                  ref={videoRef}
                  key={video.id}
                  src={`/api/portal/frame/${video.id}/play`}
                  poster={`/api/portal/frame/${video.id}/thumb`}
                  controls
                  playsInline
                  preload="metadata"
                  onError={() => setPlayError(true)}
                  className="aspect-[9/16] max-h-[60vh] w-full max-w-[300px] self-center rounded-[14px] bg-black object-contain"
                />
                {playError ? (
                  <p className="rounded-[var(--radius-sm)] bg-[var(--color-warn-soft)] px-3 py-2 text-xs text-[#8a5300]">
                    Deze video kan nu niet worden afgespeeld. Probeer het over een paar minuten opnieuw of open hem in Frame.
                  </p>
                ) : null}
                <div className="flex flex-col gap-0.5 text-xs text-[var(--color-ink-muted)]">
                  <span className="font-semibold text-[var(--color-ink)]">{video.title}</span>
                  <span>
                    {video.sessionTitle}
                    {video.subfolder ? ` · ${video.subfolder}` : ""}
                    {fmtDuration(video.durationSeconds) ? ` · ${fmtDuration(video.durationSeconds)}` : ""}
                  </span>
                  <span className="text-[var(--color-ink-faint)]">
                    {video.source === "automatisch" ? "Automatisch gekoppeld op titel" : video.upgraded ? "Gekoppeld, nieuwste versie wordt getoond" : "Handmatig gekoppeld"}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a
                    href={`/api/portal/frame/${video.id}/download`}
                    download
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-3 py-2 text-sm font-semibold text-white hover:opacity-90"
                  >
                    <Download className="size-4" /> Video downloaden
                  </a>
                  <button
                    type="button"
                    onClick={fullscreen}
                    className="inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm font-medium hover:bg-[var(--color-surface-2)]"
                    title="Volledig scherm"
                  >
                    <Maximize2 className="size-4" /> Volledig scherm
                  </button>
                </div>
                {video.viewUrl ? (
                  <a href={video.viewUrl} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1 text-xs font-medium text-[var(--color-brand-600)] hover:underline">
                    <ExternalLink className="size-3.5" /> Openen in Frame
                  </a>
                ) : null}
              </>
            ) : (
              <div className="grid aspect-[9/16] w-full max-w-[300px] place-items-center self-center rounded-[14px] border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface)] p-6 text-center">
                <div className="flex flex-col items-center gap-2">
                  <Film className="size-7 text-[var(--color-ink-faint)]" strokeWidth={1.5} />
                  <p className="text-sm font-semibold">{loadError ? "Video kon niet worden geladen" : "Nog geen video gekoppeld"}</p>
                  <p className="text-xs text-[var(--color-ink-muted)]">
                    {loadError ? "Probeer het later opnieuw." : "Er is in Frame geen video gevonden die duidelijk bij dit bericht hoort."}
                  </p>
                </div>
              </div>
            )}

            {canEdit && !loading ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--color-line)] pt-3">
                <button type="button" onClick={openPicker} className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-brand-600)] hover:underline">
                  <Link2 className="size-3.5" /> {video ? "Andere video kiezen" : "Video koppelen"}
                </button>
                {video?.source === "handmatig" ? (
                  <button type="button" onClick={() => link(null)} disabled={saving} className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-ink-muted)] hover:underline">
                    <RotateCcw className="size-3.5" /> Terug naar automatisch
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {pickerOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={(e) => { e.stopPropagation(); setPickerOpen(false); }}>
          <div className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-[var(--radius-lg)] bg-[var(--color-surface)] shadow-[var(--shadow-pop)]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-2 border-b border-[var(--color-line)] px-4 py-3">
              <span className="text-sm font-semibold">Video kiezen · {item.clientName}</span>
              <button type="button" onClick={() => setPickerOpen(false)} className="rounded p-1 text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-2)]" aria-label="Sluiten">
                <X className="size-4" />
              </button>
            </div>
            <div className="overflow-y-auto p-2">
              {picker === null ? (
                <div className="grid place-items-center p-8"><Loader2 className="size-5 animate-spin text-[var(--color-ink-faint)]" /></div>
              ) : picker.length === 0 ? (
                <p className="p-6 text-center text-sm text-[var(--color-ink-muted)]">Er staan nog geen video&apos;s van deze klant in Frame.</p>
              ) : (
                picker.map((s) => (
                  <div key={s.key} className="mb-2">
                    <div className="px-2 pt-2 pb-1 text-2xs font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-faint)]">{s.title}</div>
                    {s.videos.map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        disabled={saving}
                        onClick={() => link(v.id)}
                        className={`flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-2 text-left text-sm hover:bg-[var(--color-surface-2)] ${video?.id === v.id ? "bg-[var(--color-good-soft)]" : ""}`}
                      >
                        <Film className="size-4 shrink-0 text-[var(--color-ink-faint)]" />
                        <span className="min-w-0 flex-1 truncate">{v.title}</span>
                        {v.subfolder ? <span className="shrink-0 text-2xs text-[var(--color-ink-faint)]">{v.subfolder}</span> : null}
                        {video?.id === v.id ? <Check className="size-4 shrink-0 text-[var(--color-good)]" /> : null}
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
