import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarClock, CheckCircle2, FileText, MapPin, MessageSquareText } from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { getPortalScriptReview, SCRIPT_REVIEW_STATUS } from "@/server/script-review";
import { Badge } from "@/components/ui";
import { formatDateFull, relativeDays } from "@/lib/format";
import { ScriptPdfReview } from "@/components/portal/script-pdf-review";
import { ScriptReviewActions } from "./review-actions";

export const metadata: Metadata = { title: "Script bekijken" };
export const dynamic = "force-dynamic";

const TONE: Record<string, "warn" | "info" | "good" | "neutral"> = { warn: "warn", info: "info", good: "good", neutral: "neutral" };

export default async function PortalScriptReviewPage({ params }: { params: Promise<{ reviewId: string }> }) {
  const { reviewId } = await params;
  const viewer = await requirePortal();
  const review = await getPortalScriptReview(viewer, reviewId);
  if (!review) notFound();

  const meta = SCRIPT_REVIEW_STATUS[review.status];
  const when = (iso: string) => new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="flex flex-col gap-[20px]">
      {/* Terug + kop */}
      <div>
        <Link href="/portal/scripts" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--sc-accent)] hover:underline">
          <ArrowLeft className="size-4" /> Terug naar scripts
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[24px] font-bold tracking-tight">{review.title}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-[var(--color-ink-muted)]">
              {review.shootOn ? (
                <span className="inline-flex items-center gap-1.5"><CalendarClock className="size-4 text-[var(--sc-accent)]" /> {formatDateFull(review.shootOn)} · {relativeDays(review.shootOn)}{review.shootTime ? ` · vanaf ${review.shootTime.slice(0, 5)}` : ""}</span>
              ) : null}
              {review.shootLocation ? <span className="inline-flex items-center gap-1.5"><MapPin className="size-4 text-[var(--sc-accent)]" /> {review.shootLocation}</span> : null}
              {review.currentVersion > 1 ? <span>versie {review.currentVersion}</span> : null}
            </div>
          </div>
          <Badge tone={TONE[meta.tone]}>{meta.label}</Badge>
        </div>
        {review.status !== "goedgekeurd" && review.feedbackDeadline ? (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[rgba(255,176,32,0.14)] px-3 py-1 text-[13px] font-semibold text-[#ffb020]">
            <CalendarClock className="size-4" /> Wacht op jouw feedback · geef je reactie vóór {new Date(review.feedbackDeadline).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" })}
          </p>
        ) : null}
      </div>

      {/* PDF met klik-om-te-reageren */}
      {review.currentVersionId ? (
        <ScriptPdfReview
          url={`/api/portal/script-pdf/${review.currentVersionId}`}
          reviewId={review.id}
          canAnnotate={review.status !== "goedgekeurd"}
          pins={review.threads.map((t) => ({ id: t.id, pageNumber: t.pageNumber, posX: t.posX, posY: t.posY, isResolved: t.isResolved, authorName: t.authorName, comments: t.comments }))}
        />
      ) : (
        <div className="sc-glass grid place-items-center gap-2 p-10 text-center">
          <FileText className="size-7 text-[var(--color-ink-faint)]" strokeWidth={1.5} />
          <p className="text-sm text-[var(--color-ink-muted)]">Er staat nog geen PDF klaar voor dit script.</p>
        </div>
      )}

      {/* Klantacties */}
      <ScriptReviewActions
        reviewId={review.id}
        approved={review.status === "goedgekeurd"}
        approvedByName={review.approvedByName}
        approvedAt={review.approvedAt}
      />

      {/* Geplaatste opmerkingen */}
      {review.threads.length > 0 ? (
        <section className="sc-glass p-5">
          <div className="flex items-center gap-2">
            <MessageSquareText className="size-4 text-[var(--sc-accent)]" />
            <h2 className="text-base font-semibold">Jouw opmerkingen</h2>
          </div>
          <ul className="mt-3 flex flex-col gap-2.5">
            {review.threads.map((t) => (
              <li key={t.id} className="rounded-[12px] border border-[var(--sc-line)] bg-[var(--sc-fill)] p-3.5">
                <div className="flex items-center justify-between gap-2 text-[12px] text-[var(--color-ink-faint)]">
                  <span>
                    {t.pageNumber ? `Pagina ${t.pageNumber}` : "Algemene opmerking"}
                    {t.versionNumber ? ` · versie ${t.versionNumber}` : ""}
                  </span>
                  {t.isResolved ? <span className="inline-flex items-center gap-1 text-[#2fd27a]"><CheckCircle2 className="size-3.5" /> Verwerkt</span> : null}
                </div>
                {t.comments.map((c) => (
                  <div key={c.id} className="mt-2 first:mt-1.5">
                    <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-[var(--color-ink)]">{c.body}</p>
                    <p className="mt-0.5 text-[11.5px] text-[var(--color-ink-faint)]">{c.authorName ?? "Jij"} · {when(c.createdAt)}</p>
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
