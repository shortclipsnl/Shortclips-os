"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CheckCircle2, Loader2, MessageSquarePlus } from "lucide-react";
import { approveScriptReview, submitScriptReviewFeedback } from "@/server/actions/script-review";
import { Button, ErrorNote, buttonClass } from "@/components/ui";

/**
 * Klantacties onder de PDF: goedkeuren of feedback geven. Bij een reeds
 * goedgekeurde review tonen we wie en wanneer. Feedback wordt automatisch
 * bewaard en aan deze scripts gekoppeld.
 */
export function ScriptReviewActions({
  reviewId,
  approved,
  approvedByName,
  approvedAt,
}: {
  reviewId: string;
  approved: boolean;
  approvedByName: string | null;
  approvedAt: string | null;
}) {
  const [mode, setMode] = useState<"idle" | "feedback">("idle");
  const [body, setBody] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  if (sent) {
    return (
      <div className="flex items-start gap-2.5 rounded-[16px] border border-[rgba(46,144,250,0.35)] bg-[rgba(25,168,255,0.08)] p-5 text-[14px]">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-[var(--sc-accent)]" />
        <div>
          <p className="font-semibold">Je feedback is doorgestuurd</p>
          <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
            Je vaste contactpersoon bij Shortclips heeft bericht gekregen en verwerkt je opmerkingen. Zodra de bijgewerkte versie
            klaar is, zetten we die hier terug en krijg je een melding om opnieuw te kijken.
          </p>
        </div>
      </div>
    );
  }

  if (approved) {
    const when = approvedAt ? new Date(approvedAt).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" }) : null;
    return (
      <div className="flex items-center gap-2.5 rounded-[14px] border border-[#2fd27a]/30 bg-[rgba(47,210,122,0.08)] p-4 text-[14px]">
        <CheckCircle2 className="size-5 shrink-0 text-[#2fd27a]" />
        <span>
          <span className="font-semibold text-[#2fd27a]">Goedgekeurd</span>
          {approvedByName ? <span className="text-[var(--color-ink-muted)]"> door {approvedByName}</span> : null}
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

  function send() {
    setErr(null);
    start(async () => {
      const res = await submitScriptReviewFeedback({ reviewId, body });
      if (res.ok) { setSent(true); setBody(""); router.refresh(); }
      else setErr(res.message ?? "Er ging iets mis.");
    });
  }

  return (
    <div className="rounded-[16px] border border-[var(--sc-line)] bg-[var(--sc-fill)] p-5">
      <h3 className="text-[15px] font-semibold">Wat wil je doen?</h3>
      <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">Alles klopt? Keur de scripts goed. Nog iets op te merken? Geef je feedback — die slaan we automatisch op.</p>

      {mode === "idle" ? (
        <div className="mt-4 flex flex-wrap gap-2.5">
          <Button onClick={approve} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Goedkeuren
          </Button>
          <button type="button" onClick={() => setMode("feedback")} disabled={pending} className={buttonClass({ variant: "secondary" })}>
            <MessageSquarePlus className="size-4" /> Feedback geven
          </button>
        </div>
      ) : (
        <div className="mt-4">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            autoFocus
            maxLength={4000}
            placeholder="Beschrijf wat er aangepast moet worden (bijv. 'Bij pagina 2 klopt het cijfer niet')…"
            className="sc-input w-full resize-y text-sm"
          />
          <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
            <Button onClick={send} disabled={pending || !body.trim()}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : sent ? <Check className="size-4 text-[#2fd27a]" /> : <MessageSquarePlus className="size-4" />}
              Feedback versturen
            </Button>
            <button type="button" onClick={() => { setMode("idle"); setErr(null); }} disabled={pending} className={buttonClass({ variant: "ghost", size: "sm" })}>
              Annuleren
            </button>
          </div>
        </div>
      )}
      {err ? <div className="mt-3"><ErrorNote>{err}</ErrorNote></div> : null}
    </div>
  );
}
