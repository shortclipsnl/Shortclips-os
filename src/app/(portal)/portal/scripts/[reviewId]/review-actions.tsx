"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CheckCircle2, Loader2, MessageSquarePlus, Send } from "lucide-react";
import { approveScriptReview, submitScriptReviewFeedback } from "@/server/actions/script-review";
import { ErrorNote } from "@/components/ui";

/**
 * Twee duidelijke klantacties onderaan de feedbackkolom:
 *  - "Direct goedkeuren" (groen): keurt het script zonder feedback goed → status
 *    "Goedgekeurd door klant" en intern klaar voor opname.
 *  - "Feedback doorgeven" (oranje): dient de geplaatste opmerkingen in (optioneel
 *    met een afsluitende notitie) → status "Feedback ontvangen".
 */
export function ScriptReviewActions({
  reviewId,
  approved,
  approvedByName,
  approvedAt,
  commentCount,
  alreadySubmitted,
}: {
  reviewId: string;
  approved: boolean;
  approvedByName: string | null;
  approvedAt: string | null;
  commentCount: number;
  alreadySubmitted: boolean;
}) {
  const [mode, setMode] = useState<"idle" | "feedback">("idle");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  if (approved) {
    const when = approvedAt ? new Date(approvedAt).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" }) : null;
    return (
      <div className="flex items-center gap-2.5 rounded-[14px] border border-[#2fd27a]/40 bg-[rgba(47,210,122,0.1)] p-4 text-[14px]">
        <CheckCircle2 className="size-5 shrink-0 text-[#2fd27a]" />
        <span>
          <span className="font-semibold text-[#1d8a52]">Goedgekeurd door klant</span>
          {approvedByName ? <span className="text-[var(--color-ink-muted)]"> · {approvedByName}</span> : null}
          {when ? <span className="text-[var(--color-ink-muted)]"> · {when}</span> : null}
        </span>
      </div>
    );
  }

  function approve() {
    setErr(null);
    start(async () => {
      const res = await approveScriptReview(reviewId);
      if (res.ok) router.refresh();
      else setErr(res.message ?? "Er ging iets mis.");
    });
  }

  function submit() {
    setErr(null);
    start(async () => {
      const res = await submitScriptReviewFeedback({ reviewId, note: note.trim() || undefined });
      if (res.ok) { setMode("idle"); setNote(""); router.refresh(); }
      else setErr(res.message ?? "Er ging iets mis.");
    });
  }

  return (
    <div className="rounded-[16px] border border-[var(--sc-line)] bg-[var(--sc-fill)] p-4">
      {alreadySubmitted ? (
        <div className="mb-3 flex items-start gap-2 rounded-[10px] bg-[rgba(46,144,250,0.1)] p-2.5 text-[12.5px] text-[var(--color-ink-muted)]">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#1b6fe8]" />
          <span>Je feedback is doorgegeven — we verwerken je opmerkingen. Je kunt hieronder nog goedkeuren of extra feedback toevoegen.</span>
        </div>
      ) : null}

      {mode === "idle" ? (
        <div className="flex flex-col gap-2.5">
          {/* Direct goedkeuren — opvallend groen */}
          <button
            type="button"
            onClick={approve}
            disabled={pending}
            className="inline-flex w-full items-center justify-center gap-2 rounded-[12px] bg-[#2fd27a] px-4 py-3 text-[15px] font-bold text-white shadow-sm transition hover:brightness-105 disabled:opacity-60"
          >
            {pending ? <Loader2 className="size-5 animate-spin" /> : <Check className="size-5" strokeWidth={2.5} />} Direct goedkeuren
          </button>
          {/* Feedback doorgeven — opvallend oranje */}
          <button
            type="button"
            onClick={() => { setErr(null); setMode("feedback"); }}
            disabled={pending}
            className="inline-flex w-full items-center justify-center gap-2 rounded-[12px] bg-[#ff6a00] px-4 py-3 text-[15px] font-bold text-white shadow-sm transition hover:brightness-105 disabled:opacity-60"
          >
            <MessageSquarePlus className="size-5" /> Feedback doorgeven{commentCount > 0 ? ` (${commentCount})` : ""}
          </button>
          <p className="text-center text-[12px] text-[var(--color-ink-faint)]">
            Alles klopt? Keur direct goed. Opmerkingen geplaatst? Dien ze in met “Feedback doorgeven”.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          <p className="text-[13px] font-semibold text-[var(--color-ink)]">Feedback doorgeven{commentCount > 0 ? ` · ${commentCount} opmerking${commentCount === 1 ? "" : "en"} geplaatst` : ""}</p>
          {commentCount === 0 ? (
            <p className="text-[12.5px] text-[var(--color-ink-muted)]">Je hebt nog geen opmerkingen in het script geplaatst. Schrijf hieronder een algemene opmerking, of selecteer eerst een zin in het script.</p>
          ) : null}
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={4000}
            placeholder={commentCount > 0 ? "Nog een afsluitende opmerking? (optioneel)" : "Beschrijf wat er aangepast moet worden…"}
            className="sc-input w-full resize-y text-sm"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={pending || (commentCount === 0 && !note.trim())}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-[12px] bg-[#ff6a00] px-4 py-2.5 text-[14px] font-bold text-white hover:brightness-105 disabled:opacity-60"
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Versturen
            </button>
            <button type="button" onClick={() => { setMode("idle"); setErr(null); }} disabled={pending} className="rounded-[10px] px-3 py-2.5 text-[13px] font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
              Annuleren
            </button>
          </div>
        </div>
      )}
      {err ? <div className="mt-2.5"><ErrorNote>{err}</ErrorNote></div> : null}
    </div>
  );
}
