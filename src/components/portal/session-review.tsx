"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CheckCircle2, Download, Film, Loader2, MessageSquareText, Play, Send } from "lucide-react";
import { openExternalDownloadInApp } from "@/lib/save-file";
import { reviewSummary, VIDEO_REVIEW_LABEL, VIDEO_REVIEW_TONE } from "@/lib/video-review";
import { StatusPill, portalBtn } from "@/components/portal/status-pill";
import { approvePortalSession, submitSessionFeedback } from "@/server/actions/video-review";
import { VideoReviewPlayer, type ReviewVideo } from "./video-review-player";

function fmtDuration(s: number | null): string | null {
  if (!s || s <= 0) return null;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function Thumb({ id, title, approved }: { id: string; title: string; approved: boolean }) {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  return (
    <div className="relative aspect-[9/16] w-full overflow-hidden rounded-[14px] border border-[var(--sc-line)] bg-[var(--sc-fill-strong)]">
      {state !== "ok" ? <span className="absolute inset-0 grid place-items-center text-[var(--color-ink-faint)]"><Film className="size-6" strokeWidth={1.5} /></span> : null}
      {state !== "error" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/portal/frame/${id}/thumb`} alt={title} loading="lazy" onLoad={() => setState("ok")} onError={() => setState("error")} className={`absolute inset-0 size-full object-cover transition-opacity duration-500 ${state === "ok" ? "opacity-100" : "opacity-0"}`} />
      ) : null}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/55 to-transparent" />
      <span className="absolute bottom-2.5 left-2.5 grid size-9 place-items-center rounded-full bg-white/90 text-[#00003b] shadow-md transition-transform group-hover:scale-105">
        <Play className="size-4 translate-x-px" fill="currentColor" />
      </span>
      {approved ? (
        <span className="absolute right-2.5 top-2.5 grid size-8 place-items-center rounded-full bg-[var(--st-green)] text-white shadow-md" title="Goedgekeurd">
          <Check className="size-4" strokeWidth={3} />
        </span>
      ) : null}
    </div>
  );
}

/**
 * Eén opnamesessie: voortgang bovenaan, per video status, aantal opmerkingen,
 * "Bekijken en beoordelen" en "Downloaden", en één knop om alle feedback van de
 * sessie in één keer te versturen.
 */
export function SessionReview({ videos, sessionKey, canApproveAll }: { videos: ReviewVideo[]; sessionKey: string; canApproveAll: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);

  const drafts = videos.reduce((n, v) => n + (v.review?.draftCount ?? 0), 0);
  const summary = reviewSummary(videos.map((v) => v.review?.label ?? null));
  const openForReview = videos.filter((v) => v.review?.state.canReview && v.review.label !== "goedgekeurd").length;

  const groups: Array<{ name: string | null; items: Array<{ v: ReviewVideo; i: number }> }> = [];
  videos.forEach((v, i) => {
    let g = groups.find((x) => x.name === v.subfolder);
    if (!g) { g = { name: v.subfolder, items: [] }; groups.push(g); }
    g.items.push({ v, i });
  });
  groups.sort((a, b) => (a.name === null ? -1 : b.name === null ? 1 : a.name.localeCompare(b.name, "nl")));
  // Nummering in weergavevolgorde ("video 3"), gelijk aan de melding voor het team.
  const displayNo = new Map(groups.flatMap((g) => g.items).map(({ v }, n) => [v.id, n + 1]));
  const ordered = groups.flatMap((g) => g.items.map((x) => x.v));
  const openVideo = (id: string) => setOpen((displayNo.get(id) ?? 1) - 1);

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    start(async () => {
      const r = await fn();
      setMsg({ ok: r.ok, text: r.message ?? (r.ok ? "Gelukt." : "Dat lukte niet.") });
      setConfirmAll(false);
      if (r.ok) router.refresh();
    });

  return (
    <>
      {/* Compacte voortgang */}
      {summary.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13.5px]">
          <span className="font-semibold">{videos.length} video&apos;s</span>
          {summary.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5 text-[var(--color-ink-muted)]">
              <span className="text-[var(--sc-line)]">|</span>
              <span className={`size-2 rounded-full ${s.key === "goedgekeurd" ? "bg-[var(--st-green)]" : VIDEO_REVIEW_TONE[s.key] === "orange" ? "bg-[var(--st-orange)]" : "bg-[var(--st-blue)]"}`} />
              {s.label}
            </span>
          ))}
        </div>
      ) : null}

      {/* Verzendbalk: alles in één keer */}
      {drafts > 0 || (canApproveAll && openForReview > 1) || msg ? (
        <section className="sc-glass sticky top-2 z-20 flex flex-wrap items-center justify-between gap-3 p-4" style={{ boxShadow: drafts > 0 ? "inset 4px 0 0 var(--sc-act)" : undefined }}>
          <div className="min-w-0 text-[13.5px]">
            {drafts > 0 ? (
              <p><span className="font-semibold">{drafts === 1 ? "1 opmerking" : `${drafts} opmerkingen`} klaar om te versturen.</span> <span className="text-[var(--color-ink-muted)]">Het team krijgt alles in één bericht.</span></p>
            ) : openForReview > 1 ? (
              <p className="text-[var(--color-ink-muted)]">Alles goed? Keur alle {openForReview} openstaande video&apos;s in één keer goed.</p>
            ) : null}
            {msg ? <p className={`mt-0.5 text-[12.5px] ${msg.ok ? "text-[var(--st-green)]" : "text-[var(--st-red)]"}`}>{msg.text}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {drafts > 0 ? (
              <button type="button" disabled={pending} onClick={() => run(() => submitSessionFeedback(sessionKey))} className={portalBtn.cta}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Feedback versturen
              </button>
            ) : null}
            {canApproveAll && openForReview > 1 && drafts === 0 ? (
              confirmAll ? (
                <>
                  <button type="button" disabled={pending} onClick={() => run(() => approvePortalSession(sessionKey))} className={portalBtn.act}>
                    {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Ja, alle {openForReview} goedkeuren
                  </button>
                  <button type="button" onClick={() => setConfirmAll(false)} className={portalBtn.soft}>Annuleren</button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirmAll(true)} className={portalBtn.act}><Check className="size-4" /> Alles goedkeuren</button>
              )
            ) : null}
          </div>
        </section>
      ) : null}

      <div className="flex flex-col gap-6">
        {groups.map((g) => (
          <div key={g.name ?? "_"}>
            {g.name ? <h3 className="mb-3 text-[13px] font-semibold text-[var(--color-ink-muted)]">{g.name}</h3> : null}
            <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {g.items.map(({ v }) => {
                const r = v.review;
                const approved = r?.label === "goedgekeurd";
                const count = (r?.feedbackCount ?? 0) + (r?.draftCount ?? 0);
                return (
                  <div key={v.id} className="group flex flex-col">
                    <button type="button" onClick={() => openVideo(v.id)} className="text-left focus-visible:outline-none" aria-label={`${v.title} bekijken en beoordelen`}>
                      <Thumb id={v.id} title={v.title} approved={approved} />
                    </button>
                    <p className="mt-2 line-clamp-2 text-[13.5px] font-semibold leading-snug">
                      <span className="mr-1 tabular-nums text-[var(--color-ink-faint)]">{displayNo.get(v.id)}.</span>{v.title}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {r?.label ? <StatusPill tone={VIDEO_REVIEW_TONE[r.label]} className="!px-2 !py-0.5 !text-[11px]">{VIDEO_REVIEW_LABEL[r.label]}</StatusPill> : null}
                      {count > 0 ? (
                        <span className="inline-flex items-center gap-1 text-[11.5px] text-[var(--color-ink-muted)]" title="Opmerkingen bij deze versie">
                          <MessageSquareText className="size-3.5" /> {r && r.draftCount > 0 ? (r.draftCount === count ? `${count} niet verstuurd` : `${count} (${r.draftCount} niet verstuurd)`) : count}
                        </span>
                      ) : null}
                      {fmtDuration(v.durationSeconds) ? <span className="text-[11.5px] tabular-nums text-[var(--color-ink-faint)]">{fmtDuration(v.durationSeconds)}</span> : null}
                    </div>
                    <div className="mt-2 flex flex-col gap-1.5">
                      <button type="button" onClick={() => openVideo(v.id)} className={`inline-flex h-8 w-full min-w-0 items-center justify-center gap-1.5 rounded-full px-3 text-[12px] font-semibold ${r?.state.canReview && !approved ? "sc-btn-act" : "border border-[var(--sc-line)] bg-[var(--sc-fill)] text-[var(--color-ink)] hover:bg-[var(--sc-fill-strong)]"}`}>
                        {approved ? <CheckCircle2 className="size-3.5 shrink-0" /> : <Play className="size-3 shrink-0" fill="currentColor" />}
                        <span className="truncate">{r?.state.canReview && !approved ? "Bekijken en beoordelen" : "Bekijken"}</span>
                      </button>
                      <a
                        href={`/api/portal/frame/${v.id}/download`}
                        download
                        onClick={(e) => { if (openExternalDownloadInApp(`/api/portal/frame/${v.id}/download`)) e.preventDefault(); }}
                        className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-full border border-[var(--sc-line)] bg-[var(--color-surface)] px-3 text-[12px] font-medium text-[var(--color-ink)] hover:bg-[var(--sc-fill)]"
                        aria-label={`${v.title} downloaden`}
                      >
                        <Download className="size-3.5" /> Downloaden
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {open !== null && ordered[open] ? (
        <VideoReviewPlayer key={ordered[open].id} videos={ordered} index={open} sessionKey={sessionKey} sessionDrafts={drafts} onIndex={setOpen} onClose={() => setOpen(null)} />
      ) : null}
    </>
  );
}
