import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, FileText, History, MessageSquare } from "lucide-react";
import { requirePermission } from "@/server/auth/context";
import { getInternalScriptReview, SCRIPT_REVIEW_STATUS } from "@/server/script-review";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { ScriptPdfReview } from "@/components/portal/script-pdf-review";
import { ThreadCard, UploadNewVersion, TakeInProgress, type InternalThread } from "./review-internal-ui";

export const metadata: Metadata = { title: "Scriptcontrole" };
export const dynamic = "force-dynamic";

const TONE: Record<string, "warn" | "info" | "good" | "neutral"> = { warn: "warn", info: "info", good: "good", neutral: "neutral" };

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" });
}

export default async function InternalScriptReviewPage({ params }: { params: Promise<{ reviewId: string }> }) {
  const { reviewId } = await params;
  const viewer = await requirePermission("scripts:write");
  const review = await getInternalScriptReview(viewer, reviewId);
  if (!review) notFound();

  const meta = SCRIPT_REVIEW_STATUS[review.status];
  const clientThreads = review.threads.filter((t) => t.visibility === "client");
  const openClientThreads = clientThreads.filter((t) => !t.isResolved).length;

  return (
    <div className="mx-auto max-w-[1100px]">
      <Link href="/scriptcontrole" className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-brand-600)] hover:underline">
        <ArrowLeft className="size-4" /> Terug naar scriptcontrole
      </Link>
      <PageHeader
        title={review.title}
        description={`${review.clientName} · opname ${fmtDate(review.shootOn)} · versie ${review.currentVersion}`}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={TONE[meta.tone]}>{meta.label}</Badge>
            {review.status === "feedback_gegeven" ? <TakeInProgress reviewId={review.id} /> : null}
          </div>
        }
      />

      {review.status === "goedgekeurd" ? (
        <div className="mb-5 flex items-center gap-2.5 rounded-[var(--radius-md)] border border-[var(--color-good)]/30 bg-[var(--color-good-soft)] p-4 text-sm">
          <CheckCircle2 className="size-5 shrink-0 text-[var(--color-good)]" />
          <span><strong className="font-semibold text-[#1d6b4c]">Goedgekeurd</strong>{review.approvedByName ? ` door ${review.approvedByName}` : ""}{review.approvedVersion ? ` · versie ${review.approvedVersion}` : ""}{review.approvedAt ? ` · ${new Date(review.approvedAt).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" })}` : ""}.</span>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        {/* PDF met de pins van de klant */}
        <div className="portal-studio rounded-[var(--radius-lg)] bg-[var(--color-canvas,#05061d)] p-3">
          {review.currentVersionId ? (
            <ScriptPdfReview
              url={`/api/portal/script-pdf/${review.currentVersionId}`}
              reviewId={review.id}
              canAnnotate={false}
              pins={review.threads.filter((t) => t.visibility === "client").map((t) => ({ id: t.id, pageNumber: t.pageNumber, posX: t.posX, posY: t.posY, isResolved: t.isResolved, authorName: t.authorName, comments: t.comments.filter((c) => !c.isInternal).map((c) => ({ id: c.id, body: c.body, authorName: c.authorName, createdAt: c.createdAt })) }))}
            />
          ) : (
            <p className="p-8 text-center text-sm text-[var(--color-ink-muted)]">Geen PDF.</p>
          )}
        </div>

        {/* Feedback verwerken + nieuwe versie + historie */}
        <div className="flex flex-col gap-5">
          <Card>
            <div className="flex items-center gap-2">
              <MessageSquare className="size-4 text-[var(--color-brand-600)]" />
              <h2 className="text-base font-semibold">Feedback van de klant</h2>
              {openClientThreads > 0 ? <span className="rounded-full bg-[var(--color-warn-soft)] px-2 py-0.5 text-2xs font-semibold text-[#8a5300]">{openClientThreads} open</span> : null}
            </div>
            {clientThreads.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--color-ink-muted)]">Nog geen opmerkingen van de klant.</p>
            ) : (
              <div className="mt-3 flex flex-col gap-3">
                {review.threads.map((t) => <ThreadCard key={t.id} thread={t as InternalThread} />)}
              </div>
            )}
          </Card>

          <Card>
            <div className="flex items-center gap-2">
              <FileText className="size-4 text-[var(--color-brand-600)]" />
              <h2 className="text-base font-semibold">Aangepaste versie uploaden</h2>
            </div>
            <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">Upload de bijgewerkte PDF; de klant krijgt automatisch bericht en kan opnieuw controleren.</p>
            <div className="mt-3"><UploadNewVersion reviewId={review.id} /></div>
          </Card>

          <Card padded={false}>
            <CardHeader title="Versiehistorie" className="p-5 pb-2" />
            <ul className="divide-y divide-[var(--color-line)]">
              {review.versions.map((v) => (
                <li key={v.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                  <History className="size-4 shrink-0 text-[var(--color-ink-faint)]" />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">Versie {v.versionNumber}</span>
                    {v.note ? <span className="text-[var(--color-ink-muted)]"> — {v.note}</span> : null}
                    <span className="block text-2xs text-[var(--color-ink-faint)]">{new Date(v.createdAt).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}{review.approvedVersion === v.versionNumber ? " · goedgekeurd" : ""}</span>
                  </span>
                  <a href={`/api/portal/script-pdf/${v.id}`} target="_blank" rel="noreferrer" className="shrink-0 text-xs font-medium text-[var(--color-brand-600)] hover:underline">Openen</a>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
