import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, Download, FileText, Info, Link2, Pencil, Video } from "lucide-react";
import { requireInternal } from "@/server/auth/context";
import { canManageKennisbank, getCourse, getLesson } from "@/server/kennisbank";
import { DocRenderer } from "@/components/kennisbank/doc-renderer";
import { KbProgressBar } from "@/components/kennisbank/progress-bar";
import { videoEmbedUrl, type PMDoc } from "@/lib/kennisbank-doc";
import { CourseOutline } from "./outline";
import { CompleteButton } from "./complete-button";
import { LessonEditorLoader } from "./editor-loader";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ courseId: string }> }): Promise<Metadata> {
  const viewer = await requireInternal();
  const detail = await getCourse(viewer, (await params).courseId);
  return { title: detail ? `${detail.course.title} · Kennisbank` : "Kennisbank" };
}

export default async function CoursePage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ les?: string; bewerk?: string }>;
}) {
  const viewer = await requireInternal();
  const manage = canManageKennisbank(viewer);
  const { courseId } = await params;
  const sp = await searchParams;
  const detail = await getCourse(viewer, courseId);
  if (!detail) notFound();

  const activeId = sp.les && detail.lessonOrder.some((l) => l.id === sp.les) ? sp.les : detail.lessonOrder[0]?.id ?? null;
  const lesson = activeId ? await getLesson(viewer, courseId, activeId) : null;
  const idx = activeId ? detail.lessonOrder.findIndex((l) => l.id === activeId) : -1;
  const prev = idx > 0 ? detail.lessonOrder[idx - 1] : null;
  const next = idx >= 0 && idx < detail.lessonOrder.length - 1 ? detail.lessonOrder[idx + 1] : null;
  const completed = idx >= 0 ? detail.lessonOrder[idx]!.completed : false;
  const editing = manage && sp.bewerk === "1" && lesson;
  const embed = lesson?.videoUrl ? videoEmbedUrl(lesson.videoUrl) : null;

  const outline = (
    <>
      <div className="px-3 pb-3">
        <h1 className="text-base font-semibold leading-snug text-[var(--color-ink)]">{detail.course.title}</h1>
        <KbProgressBar done={detail.completedCount} total={detail.lessonCount} className="mt-3" />
      </div>
      <CourseOutline courseId={courseId} outline={detail.outline} activeLessonId={activeId} manage={manage} />
    </>
  );

  return (
    <div className="mx-auto max-w-[1200px]">
      <div className="mb-4 flex items-center gap-1 text-sm text-[var(--color-ink-muted)]">
        <Link href="/kennisbank" className="inline-flex items-center gap-1 hover:text-[var(--color-ink)]">
          <ChevronLeft className="h-4 w-4" /> Shortclips Kennisbank
        </Link>
      </div>

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        {/* Mobiel en tablet: inklapbaar lessenoverzicht boven de les. */}
        <details className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] lg:hidden" open={!lesson}>
          <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-semibold">
            <span className="min-w-0 truncate">{detail.course.title}: alle lessen</span>
            <span className="ml-2 shrink-0 text-xs font-normal text-[var(--color-ink-muted)]">
              {detail.completedCount}/{detail.lessonCount}
            </span>
          </summary>
          <div className="max-h-[60vh] overflow-y-auto px-1 pb-3 pt-1">{outline}</div>
        </details>

        <aside className="hidden w-[340px] shrink-0 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] py-4 lg:sticky lg:top-4 lg:block lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
          {outline}
        </aside>

        <section className="min-w-0 flex-1">
          {!lesson ? (
            <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-8 text-sm text-[var(--color-ink-muted)]">
              Deze cursus heeft nog geen lessen.{manage ? " Voeg links een hoofdstuk of les toe." : ""}
            </div>
          ) : editing ? (
            <LessonEditorLoader
              courseId={courseId}
              lesson={{
                id: lesson.id,
                title: lesson.title,
                content: lesson.content as PMDoc,
                videoUrl: lesson.videoUrl,
                resources: lesson.resources,
                isPublished: lesson.isPublished,
              }}
            />
          ) : (
            <article className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-5 sm:p-7">
              <header className="flex flex-wrap items-start justify-between gap-3">
                <h2 className="min-w-0 text-xl font-bold tracking-tight text-[var(--color-ink)] sm:text-2xl">{lesson.title}</h2>
                <div className="flex items-center gap-2">
                  <CompleteButton lessonId={lesson.id} completed={completed} />
                  {manage ? (
                    <Link href={`/kennisbank/${courseId}?les=${lesson.id}&bewerk=1`} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-line-strong)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--color-surface-2)]">
                      <Pencil className="h-3.5 w-3.5" /> Bewerken
                    </Link>
                  ) : null}
                </div>
              </header>

              {manage && !lesson.isPublished ? (
                <p className="mt-3 rounded-md bg-[var(--color-warn-soft)] px-3 py-2 text-sm text-[var(--color-ink)]">Concept: deze les is nog niet zichtbaar voor het team.</p>
              ) : null}
              {manage && lesson.migrationNotes ? (
                <p className="mt-3 flex gap-2 rounded-md bg-[var(--color-info-soft)] px-3 py-2 text-sm text-[var(--color-ink)]">
                  <Info className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    <strong>Migratie:</strong> {lesson.migrationNotes}
                  </span>
                </p>
              ) : null}

              {lesson.videoAssetId ? (
                <div className="mt-5 overflow-hidden rounded-lg bg-black">
                  <video controls preload="metadata" className="mx-auto max-h-[70vh] w-full" src={`/api/kennisbank/assets/${lesson.videoAssetId}`} />
                </div>
              ) : embed ? (
                <div className="mt-5 aspect-video overflow-hidden rounded-lg bg-black">
                  <iframe src={embed} title={lesson.title} className="h-full w-full" allow="autoplay; fullscreen; picture-in-picture" allowFullScreen />
                </div>
              ) : lesson.videoUrl ? (
                <a href={lesson.videoUrl} target="_blank" rel="noopener noreferrer" className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-[var(--color-brand-700)] underline">
                  <Video className="h-4 w-4" /> Video bekijken
                </a>
              ) : null}

              <div className="mt-4">
                <DocRenderer doc={lesson.content as PMDoc} />
              </div>

              {lesson.resources.length > 0 ? (
                <div className="mt-8 border-t border-[var(--color-line)] pt-5">
                  <h3 className="text-sm font-semibold text-[var(--color-ink)]">Bijlagen</h3>
                  <ul className="mt-2 space-y-2">
                    {lesson.resources.map((r, i) => {
                      const href = r.assetId ? `/api/kennisbank/assets/${r.assetId}` : r.url ?? "#";
                      return (
                        <li key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-line)] px-3 py-2">
                          {r.assetId ? <FileText className="h-4 w-4 shrink-0 text-[var(--color-ink-muted)]" /> : <Link2 className="h-4 w-4 shrink-0 text-[var(--color-ink-muted)]" />}
                          <a href={href} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--color-brand-700)] hover:underline">
                            {r.title}
                          </a>
                          {r.fileName ? <span className="hidden text-xs text-[var(--color-ink-faint)] sm:inline">{r.fileName}</span> : null}
                          {r.assetId ? (
                            <a href={`${href}?download=1`} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)]" aria-label={`${r.title} downloaden`}>
                              <Download className="h-3.5 w-3.5" /> Download
                            </a>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}

              <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-line)] pt-4 text-sm">
                {prev ? (
                  <Link href={`/kennisbank/${courseId}?les=${prev.id}`} className="inline-flex max-w-[48%] items-center gap-1 text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
                    <ChevronLeft className="h-4 w-4 shrink-0" /> <span className="truncate">{prev.title}</span>
                  </Link>
                ) : <span />}
                {next ? (
                  <Link href={`/kennisbank/${courseId}?les=${next.id}`} className="inline-flex max-w-[48%] items-center gap-1 text-right font-medium text-[var(--color-ink)] hover:text-[var(--color-brand-700)]">
                    <span className="truncate">{next.title}</span> <ChevronRight className="h-4 w-4 shrink-0" />
                  </Link>
                ) : null}
              </footer>
              {manage && lesson.sourceRef ? (
                <p className="mt-4 text-xs text-[var(--color-ink-faint)]">Bron: {lesson.sourceRef}</p>
              ) : null}
            </article>
          )}
        </section>
      </div>
    </div>
  );
}
