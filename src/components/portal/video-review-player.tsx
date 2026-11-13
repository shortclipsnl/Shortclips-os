"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  CornerDownRight,
  Download,
  Loader2,
  MessageSquarePlus,
  Pencil,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { openExternalDownloadInApp } from "@/lib/save-file";
import { formatTimecode, VIDEO_REVIEW_LABEL, VIDEO_REVIEW_TONE } from "@/lib/video-review";
import { StatusPill } from "@/components/portal/status-pill";
import {
  addVideoComment,
  approvePortalVideo,
  deleteVideoComment,
  replyToVideoComment,
  submitSessionFeedback,
  updateVideoComment,
} from "@/server/actions/video-review";
import type { ReviewComment, VideoReview } from "@/server/video-review";

export type ReviewVideo = {
  id: string;
  title: string;
  subfolder: string | null;
  durationSeconds: number | null;
  review: VideoReview | null;
};

type Msg = { ok: boolean; text: string } | null;

/**
 * Videospeler met feedback op tijdcode, in de stijl van Frame.io maar volledig
 * in het portaal. Opmerkingen zijn eerst concepten; met "Feedback versturen"
 * gaat alles van de sessie in één keer naar het team (en naar Frame.io).
 * Wordt per video opnieuw gemount (key = video-id), zodat invoer niet meeloopt.
 */
export function VideoReviewPlayer({
  videos,
  index,
  sessionKey,
  sessionDrafts,
  onIndex,
  onClose,
}: {
  videos: ReviewVideo[];
  index: number;
  sessionKey: string;
  sessionDrafts: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const video = videos[index]!;
  const review = video.review;
  const canReview = !!review?.state.canReview;
  const ref = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(video.durationSeconds ?? 0);
  const [playError, setPlayError] = useState(false);
  const [text, setText] = useState("");
  const [stamp, setStamp] = useState<number | null>(null);
  const [general, setGeneral] = useState(false);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const [showPrevious, setShowPrevious] = useState(false);
  const typing = useRef(false);

  const step = useCallback((d: number) => onIndex((index + d + videos.length) % videos.length), [index, videos.length, onIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing.current) {
        if (e.key === "Escape") (document.activeElement as HTMLElement | null)?.blur();
        return;
      }
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && videos.length > 1) step(1);
      if (e.key === "ArrowLeft" && videos.length > 1) step(-1);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, step, videos.length]);

  const seek = (ms: number | null) => {
    if (ms == null || !ref.current) return;
    ref.current.currentTime = ms / 1000;
    ref.current.pause();
    setTime(ms / 1000);
  };

  /** Bij beginnen met typen: video pauzeren en het moment vastzetten. */
  const captureMoment = () => {
    typing.current = true;
    const v = ref.current;
    if (v && !v.paused) v.pause();
    if (stamp == null && !general) setStamp(Math.round((v?.currentTime ?? time) * 1000));
  };

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setMsg(r.message ? { ok: r.ok, text: r.message } : r.ok ? null : { ok: false, text: "Dat lukte niet. Probeer het opnieuw." });
      if (r.ok) {
        after?.();
        router.refresh();
      }
    });

  const add = () => {
    if (!text.trim()) return;
    const tc = general ? null : stamp ?? Math.round(time * 1000);
    run(() => addVideoComment({ assetId: video.id, timecodeMs: tc, body: text }), () => {
      setText("");
      setStamp(null);
      setMsg(null);
    });
  };

  const comments = useMemo(() => review?.comments ?? [], [review]);
  const top = comments.filter((c) => !c.parentId);
  const repliesOf = (id: string) => comments.filter((c) => c.parentId === id);
  const markers = top.filter((c) => c.timecodeMs != null);
  const videoDrafts = review?.draftCount ?? 0;
  const dur = duration || video.durationSeconds || 0;

  return (
    <div className="fixed inset-0 z-50 flex bg-[#05061a]/90 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={video.title}>
      <div className="relative mx-auto flex h-full w-full max-w-[1180px] flex-col gap-0 overflow-y-auto p-3 sm:p-5 lg:flex-row lg:gap-6 lg:overflow-hidden">
        {/* ---------------- Speler ---------------- */}
        <div className="flex shrink-0 flex-col items-center gap-3 lg:h-full lg:w-[440px] lg:justify-center">
          <div className="flex w-full items-center justify-between gap-3 text-white">
            <button type="button" onClick={onClose} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[13px] font-medium hover:bg-white/20">
              <X className="size-4" /> Sluiten
            </button>
            {videos.length > 1 ? (
              <div className="flex items-center gap-2 text-white/80">
                <button type="button" onClick={() => step(-1)} className="grid size-9 place-items-center rounded-full bg-white/10 hover:bg-white/20" aria-label="Vorige video"><ChevronLeft className="size-5" /></button>
                <span className="min-w-[44px] text-center text-[12px] tabular-nums">{index + 1} / {videos.length}</span>
                <button type="button" onClick={() => step(1)} className="grid size-9 place-items-center rounded-full bg-white/10 hover:bg-white/20" aria-label="Volgende video"><ChevronRight className="size-5" /></button>
              </div>
            ) : null}
          </div>

          <div className="flex w-fit max-w-full flex-col items-center gap-2">
          <video
            ref={ref}
            key={`${video.id}:${review?.mediaFileId ?? ""}`}
            src={`/api/portal/frame/${video.id}/play`}
            poster={`/api/portal/frame/${video.id}/thumb`}
            controls
            playsInline
            preload="metadata"
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || video.durationSeconds || 0)}
            onError={() => setPlayError(true)}
            className="aspect-[9/16] h-[52vh] w-auto max-w-full rounded-[16px] bg-black object-contain sm:h-[60vh] lg:h-[72vh]"
          />

          {/* Tijdlijn met de momenten waarop opmerkingen staan */}
          {dur > 0 && markers.length > 0 ? (
            <div className="relative h-5 w-full" aria-label="Opmerkingen op de tijdlijn">
              <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/15" />
              <div className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/40" style={{ width: `${Math.min(100, (time / dur) * 100)}%` }} />
              {markers.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => seek(c.timecodeMs)}
                  title={`${formatTimecode(c.timecodeMs)} · ${c.body.slice(0, 60)}`}
                  className={`absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[#05061a] transition-transform hover:scale-125 ${c.status === "draft" ? "bg-[var(--st-orange)]" : c.completed ? "bg-[var(--st-green)]" : "bg-white"}`}
                  style={{ left: `${Math.min(100, ((c.timecodeMs ?? 0) / 1000 / dur) * 100)}%` }}
                />
              ))}
            </div>
          ) : null}
          </div>

          {playError ? (
            <p className="max-w-[400px] rounded-[10px] bg-white/10 px-3 py-2 text-center text-[13px] text-white/90">
              Deze video kan nu niet worden afgespeeld. Probeer het over een paar minuten opnieuw of neem contact op met je contactpersoon.
            </p>
          ) : null}

          <a
            href={`/api/portal/frame/${video.id}/download`}
            download
            onClick={(e) => { if (openExternalDownloadInApp(`/api/portal/frame/${video.id}/download`)) e.preventDefault(); }}
            className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-[13px] font-semibold text-white hover:bg-white/20"
          >
            <Download className="size-4" /> Video downloaden
          </a>
        </div>

        {/* ---------------- Beoordeling ---------------- */}
        <section className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[18px] bg-[var(--color-surface)] text-[var(--color-ink)] shadow-2xl lg:mt-0 lg:max-w-[460px] lg:self-center lg:max-h-[92vh]">
          <header className="border-b border-[var(--sc-line)] p-4 sm:p-5">
            <p className="line-clamp-2 text-[16px] font-semibold leading-snug">{video.title}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {review?.label ? <StatusPill tone={VIDEO_REVIEW_TONE[review.label]}>{VIDEO_REVIEW_LABEL[review.label]}</StatusPill> : null}
              {review && review.versionNumber > 1 ? (
                <span className="rounded-full bg-[var(--sc-fill)] px-2.5 py-1 text-[11.5px] font-semibold text-[var(--color-ink-muted)]">
                  Versie {review.versionNumber}{review.hasNewVersion ? " · nieuw" : ""}
                </span>
              ) : null}
            </div>
            {review?.hasNewVersion ? (
              <p className="mt-2 text-[13px] text-[var(--color-ink-muted)]">Er staat een nieuwe versie klaar met je eerdere feedback verwerkt. Bekijk hem opnieuw en keur goed of geef nieuwe feedback.</p>
            ) : null}
            {review?.label === "goedgekeurd" && review.approvedAt ? (
              <p className="mt-2 flex items-center gap-1.5 text-[13px] text-[var(--st-green)]">
                <CheckCircle2 className="size-4" /> Goedgekeurd{review.approvedBy ? ` door ${review.approvedBy}` : ""} op {new Date(review.approvedAt).toLocaleDateString("nl-NL", { day: "numeric", month: "long" })}
              </p>
            ) : null}
          </header>

          {/* Opmerkingen */}
          <div className="min-h-[120px] flex-1 overflow-y-auto px-4 py-3 sm:px-5">
            {top.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-[var(--color-ink-faint)]">
                {canReview ? "Nog geen opmerkingen. Pauzeer de video op het juiste moment en typ je opmerking hieronder." : "Geen opmerkingen bij deze versie."}
              </p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {top.map((c) => (
                  <CommentItem key={c.id} c={c} replies={repliesOf(c.id)} onSeek={seek} canReply={c.status === "submitted"} run={run} pending={pending} onTyping={(t) => (typing.current = t)} />
                ))}
              </ul>
            )}

            {review && review.previous.length > 0 ? (
              <div className="mt-4 border-t border-[var(--sc-line)] pt-3">
                <button type="button" onClick={() => setShowPrevious((x) => !x)} className="flex w-full items-center justify-between text-[12.5px] font-semibold text-[var(--color-ink-muted)]">
                  Feedback op eerdere versies ({review.previous.filter((c) => !c.parentId).length})
                  <ChevronDown className={`size-4 transition-transform ${showPrevious ? "rotate-180" : ""}`} />
                </button>
                {showPrevious ? (
                  <ul className="mt-2 flex flex-col gap-2 opacity-80">
                    {review.previous.filter((c) => !c.parentId).map((c) => (
                      <li key={c.id} className="rounded-[12px] bg-[var(--sc-fill)] px-3 py-2 text-[13px]">
                        <span className="mr-1.5 font-semibold tabular-nums text-[var(--color-ink-muted)]">v{c.versionNumber}{c.timecodeMs != null ? ` · ${formatTimecode(c.timecodeMs)}` : ""}</span>
                        {c.body}
                        {c.completed ? <span className="ml-1.5 text-[11.5px] font-semibold text-[var(--st-green)]">Verwerkt</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Nieuwe opmerking */}
          {canReview ? (
            <div className="border-t border-[var(--sc-line)] p-4 sm:p-5">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-[12.5px]">
                {general ? (
                  <span className="rounded-full bg-[var(--sc-fill)] px-2.5 py-1 font-semibold text-[var(--color-ink-muted)]">Algemene opmerking</span>
                ) : (
                  <button type="button" onClick={() => seek(stamp ?? Math.round(time * 1000))} className="inline-flex items-center gap-1 rounded-full bg-[var(--st-orange-bg)] px-2.5 py-1 font-semibold tabular-nums text-[var(--st-orange)]">
                    <Clock className="size-3.5" /> Bij {formatTimecode(stamp ?? Math.round(time * 1000))}
                  </button>
                )}
                {!general && stamp != null ? (
                  <button type="button" onClick={() => setStamp(Math.round((ref.current?.currentTime ?? time) * 1000))} className="text-[var(--color-ink-muted)] underline-offset-2 hover:underline">
                    Huidig moment gebruiken
                  </button>
                ) : null}
                <button type="button" onClick={() => { setGeneral((g) => !g); setStamp(null); }} className="ml-auto text-[var(--color-ink-muted)] underline-offset-2 hover:underline">
                  {general ? "Op een moment in de video" : "Geen specifiek moment"}
                </button>
              </div>
              <div className="flex items-end gap-2">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onFocus={captureMoment}
                  onBlur={() => (typing.current = false)}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) add(); }}
                  rows={2}
                  maxLength={3000}
                  placeholder="Wat wil je hier anders zien?"
                  className="min-h-[52px] flex-1 resize-none rounded-[12px] border border-[var(--sc-line)] bg-[var(--color-surface)] px-3 py-2.5 text-[14px] outline-none focus:border-[var(--sc-accent)]"
                />
                <button type="button" onClick={add} disabled={pending || !text.trim()} className="grid size-11 shrink-0 place-items-center rounded-[12px] bg-[var(--color-ink)] text-[var(--color-surface)] disabled:opacity-40" aria-label="Opmerking toevoegen">
                  {pending ? <Loader2 className="size-4 animate-spin" /> : <MessageSquarePlus className="size-4" />}
                </button>
              </div>
              <p className="mt-1.5 text-[11.5px] text-[var(--color-ink-faint)]">Je opmerkingen worden pas naar ons gestuurd als je op Feedback versturen klikt.</p>
            </div>
          ) : null}

          {/* Acties */}
          {canReview || sessionDrafts > 0 ? (
            <footer className="border-t border-[var(--sc-line)] bg-[var(--sc-fill)] p-4 sm:p-5">
              {msg ? <p className={`mb-2 text-[12.5px] ${msg.ok ? "text-[var(--st-green)]" : "text-[var(--st-red)]"}`}>{msg.text}</p> : null}
              {confirmApprove ? (
                <div className="flex flex-col gap-2">
                  <p className="text-[13.5px] font-semibold">Deze video goedkeuren?</p>
                  <p className="text-[12.5px] text-[var(--color-ink-muted)]">
                    De video gaat daarna door naar de planning.{videoDrafts > 0 ? ` Je ${videoDrafts === 1 ? "niet verstuurde opmerking bij deze video vervalt" : `${videoDrafts} niet verstuurde opmerkingen bij deze video vervallen`}.` : ""}
                  </p>
                  <div className="flex gap-2">
                    <button type="button" disabled={pending} onClick={() => run(() => approvePortalVideo(video.id), () => setConfirmApprove(false))} className="sc-btn-act inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-[10px] px-4 text-[14px] font-semibold">
                      {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Ja, goedkeuren
                    </button>
                    <button type="button" onClick={() => setConfirmApprove(false)} className="h-10 rounded-[10px] border border-[var(--sc-line)] bg-[var(--color-surface)] px-4 text-[13px] font-medium">Annuleren</button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {sessionDrafts > 0 ? (
                    <button type="button" disabled={pending} onClick={() => run(() => submitSessionFeedback(sessionKey))} className="sc-btn-cta inline-flex h-11 w-full items-center justify-center gap-2 rounded-[10px] px-4 text-[14px] font-semibold">
                      {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Feedback versturen ({sessionDrafts})
                    </button>
                  ) : null}
                  {canReview ? (
                    <button type="button" disabled={pending} onClick={() => setConfirmApprove(true)} className={`${sessionDrafts > 0 ? "border border-[var(--sc-line)] bg-[var(--color-surface)]" : "sc-btn-act"} inline-flex h-11 w-full items-center justify-center gap-2 rounded-[10px] px-4 text-[14px] font-semibold`}>
                      <Check className="size-4" /> Video goedkeuren
                    </button>
                  ) : null}
                </div>
              )}
              {sessionDrafts > 0 && !confirmApprove ? (
                <p className="mt-2 text-[11.5px] text-[var(--color-ink-faint)]">
                  {sessionDrafts === 1 ? "1 opmerking" : `${sessionDrafts} opmerkingen`} in deze sessie {sessionDrafts === 1 ? "staat" : "staan"} klaar. Je kunt eerst andere video&apos;s bekijken en alles in één keer versturen.
                </p>
              ) : null}
            </footer>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function CommentItem({
  c,
  replies,
  onSeek,
  canReply,
  run,
  pending,
  onTyping,
}: {
  c: ReviewComment;
  replies: ReviewComment[];
  onSeek: (ms: number | null) => void;
  canReply: boolean;
  run: (fn: () => Promise<{ ok: boolean; message?: string }>, after?: () => void) => void;
  pending: boolean;
  onTyping: (t: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.body);
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");
  const isDraft = c.status === "draft";

  return (
    <li className={`rounded-[14px] border px-3.5 py-3 ${isDraft ? "border-[var(--st-orange)]/40 bg-[var(--st-orange-bg)]/40" : "border-[var(--sc-line)] bg-[var(--color-surface)]"}`}>
      <div className="flex items-center gap-2 text-[12px]">
        {c.timecodeMs != null ? (
          <button type="button" onClick={() => onSeek(c.timecodeMs)} className="rounded-full bg-[var(--sc-fill-strong)] px-2 py-0.5 font-semibold tabular-nums hover:bg-[var(--sc-fill)]">
            {formatTimecode(c.timecodeMs)}
          </button>
        ) : (
          <span className="rounded-full bg-[var(--sc-fill)] px-2 py-0.5 font-semibold text-[var(--color-ink-muted)]">Algemeen</span>
        )}
        <span className="truncate text-[var(--color-ink-muted)]">{c.authorKind === "shortclips" ? "Shortclips" : c.authorName ?? "Jij"}</span>
        <span className="ml-auto shrink-0">
          {isDraft ? (
            <span className="font-semibold text-[var(--st-orange)]">Nog niet verstuurd</span>
          ) : c.completed ? (
            <span className="inline-flex items-center gap-1 font-semibold text-[var(--st-green)]"><Check className="size-3.5" /> Verwerkt</span>
          ) : (
            <span className="text-[var(--color-ink-faint)]">Verstuurd</span>
          )}
        </span>
      </div>

      {editing ? (
        <div className="mt-2 flex flex-col gap-2">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} onFocus={() => onTyping(true)} onBlur={() => onTyping(false)} rows={3} className="w-full resize-none rounded-[10px] border border-[var(--sc-line)] bg-[var(--color-surface)] px-3 py-2 text-[14px] outline-none focus:border-[var(--sc-accent)]" />
          <div className="flex gap-2">
            <button type="button" disabled={pending || !draft.trim()} onClick={() => run(() => updateVideoComment(c.id, draft), () => setEditing(false))} className="h-8 rounded-[8px] bg-[var(--color-ink)] px-3 text-[12.5px] font-semibold text-[var(--color-surface)]">Opslaan</button>
            <button type="button" onClick={() => { setEditing(false); setDraft(c.body); }} className="h-8 rounded-[8px] px-3 text-[12.5px] text-[var(--color-ink-muted)]">Annuleren</button>
          </div>
        </div>
      ) : (
        <p className="mt-1.5 whitespace-pre-wrap text-[14px] leading-relaxed">{c.body}</p>
      )}

      {isDraft && !editing ? (
        <div className="mt-2 flex gap-3 text-[12px] text-[var(--color-ink-muted)]">
          <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1 hover:text-[var(--color-ink)]"><Pencil className="size-3.5" /> Aanpassen</button>
          <button type="button" disabled={pending} onClick={() => run(() => deleteVideoComment(c.id))} className="inline-flex items-center gap-1 hover:text-[var(--st-red)]"><Trash2 className="size-3.5" /> Verwijderen</button>
        </div>
      ) : null}

      {replies.length > 0 ? (
        <ul className="mt-2.5 flex flex-col gap-2 border-l-2 border-[var(--sc-line)] pl-3">
          {replies.map((r) => (
            <li key={r.id} className="text-[13.5px]">
              <span className="text-[12px] font-semibold text-[var(--color-ink-muted)]">{r.authorKind === "shortclips" ? "Shortclips" : r.authorName ?? "Jij"}</span>
              <p className="whitespace-pre-wrap leading-relaxed">{r.body}</p>
            </li>
          ))}
        </ul>
      ) : null}

      {canReply ? (
        replying ? (
          <div className="mt-2.5 flex items-end gap-2">
            <textarea value={reply} onChange={(e) => setReply(e.target.value)} onFocus={() => onTyping(true)} onBlur={() => onTyping(false)} rows={2} placeholder="Reageer…" className="flex-1 resize-none rounded-[10px] border border-[var(--sc-line)] bg-[var(--color-surface)] px-3 py-2 text-[13.5px] outline-none focus:border-[var(--sc-accent)]" />
            <button type="button" disabled={pending || !reply.trim()} onClick={() => run(() => replyToVideoComment(c.id, reply), () => { setReply(""); setReplying(false); })} className="grid size-9 place-items-center rounded-[10px] bg-[var(--color-ink)] text-[var(--color-surface)] disabled:opacity-40" aria-label="Reactie versturen">
              <Send className="size-4" />
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setReplying(true)} className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
            <CornerDownRight className="size-3.5" /> Reageren
          </button>
        )
      ) : null}
    </li>
  );
}
