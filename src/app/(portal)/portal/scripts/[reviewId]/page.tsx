import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarClock, FileText, MapPin } from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { getPortalScriptReview, type ScriptReviewStatus } from "@/server/script-review";
import { formatDateFull, relativeDays } from "@/lib/format";
import { workingDaysUntil } from "@/lib/workdays";
import { nlHolidaySet } from "@/lib/holidays";
import { ScriptApprovalView } from "./approval-view";

export const metadata: Metadata = { title: "Script bekijken" };
export const dynamic = "force-dynamic";

const TZ = "Europe/Amsterdam";

/** Klantgerichte status bovenaan; oranje = wacht op jou, blauw = wij, groen = klaar. */
const PORTAL_STATUS: Record<ScriptReviewStatus, { label: string; cls: string }> = {
  klaar_controle:   { label: "Wacht op jouw akkoord",  cls: "bg-[var(--st-orange-bg)] text-[var(--st-orange)]" },
  opnieuw_controle: { label: "Aangepast, opnieuw beoordelen", cls: "bg-[var(--st-orange-bg)] text-[var(--st-orange)]" },
  feedback_gegeven: { label: "Wijzigingen ontvangen",  cls: "bg-[var(--st-blue-bg)] text-[var(--st-blue)]" },
  wordt_aangepast:  { label: "Wordt aangepast",        cls: "bg-[var(--st-blue-bg)] text-[var(--st-blue)]" },
  goedgekeurd:      { label: "Goedgekeurd",            cls: "bg-[var(--st-green-bg)] text-[var(--st-green)]" },
};

/** "Graag vóór donderdag 13 november · nog 2 werkdagen". */
function deadlineLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  const day = d.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", timeZone: TZ });
  const today = new Date().toLocaleDateString("en-CA", { timeZone: TZ });
  const target = d.toLocaleDateString("en-CA", { timeZone: TZ });
  if (target < today) return `De termijn was ${day}. Graag zo snel mogelijk.`;
  const left = workingDaysUntil(today, target, nlHolidaySet());
  const rest = target === today ? "vandaag" : left <= 1 ? "nog 1 werkdag" : `nog ${left} werkdagen`;
  return `Graag vóór ${day} · ${rest}`;
}

export default async function PortalScriptReviewPage({ params }: { params: Promise<{ reviewId: string }> }) {
  const { reviewId } = await params;
  const viewer = await requirePortal();
  const review = await getPortalScriptReview(viewer, reviewId);
  if (!review) notFound();

  const status = PORTAL_STATUS[review.status];

  return (
    <div className="flex flex-col gap-[20px]">
      <div>
        <Link href="/portal/scripts" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--sc-accent)] hover:underline">
          <ArrowLeft className="size-4" /> Alle scripts
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[24px] font-bold tracking-tight">{review.title}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-[var(--color-ink-muted)]">
              {review.shootOn ? (
                <span className="inline-flex items-center gap-1.5"><CalendarClock className="size-4 text-[var(--sc-accent)]" /> Opname {formatDateFull(review.shootOn)} · {relativeDays(review.shootOn)}{review.shootTime ? ` · vanaf ${review.shootTime.slice(0, 5)}` : ""}</span>
              ) : null}
              {review.shootLocation ? <span className="inline-flex items-center gap-1.5"><MapPin className="size-4 text-[var(--sc-accent)]" /> {review.shootLocation}</span> : null}
              {review.currentVersion > 1 ? <span>versie {review.currentVersion}</span> : null}
            </div>
          </div>
          <span className={`inline-flex shrink-0 items-center rounded-full px-3.5 py-1.5 text-[13px] font-bold ${status.cls}`}>{status.label}</span>
        </div>
      </div>

      {review.currentVersionId ? (
        <ScriptApprovalView
          reviewId={review.id}
          pdfUrl={`/api/portal/script-pdf/${review.currentVersionId}`}
          status={review.status}
          currentVersion={review.currentVersion}
          approval={review.approval}
          pins={review.threads.map((t) => ({ id: t.id, pageNumber: t.pageNumber, posX: t.posX, posY: t.posY, isResolved: t.isResolved, authorName: t.authorName, comments: t.comments }))}
          threads={review.threads.map((t) => ({ id: t.id, versionNumber: t.versionNumber, pageNumber: t.pageNumber, isResolved: t.isResolved, comments: t.comments }))}
          deadlineLabel={review.status === "goedgekeurd" ? null : deadlineLabel(review.feedbackDeadline)}
          approvedByName={review.approvedByName}
          approvedAt={review.approvedAt}
        />
      ) : (
        <div className="sc-glass grid place-items-center gap-2 p-10 text-center">
          <FileText className="size-7 text-[var(--color-ink-faint)]" strokeWidth={1.5} />
          <p className="text-sm text-[var(--color-ink-muted)]">Er staat nog geen PDF klaar voor dit script.</p>
        </div>
      )}
    </div>
  );
}
