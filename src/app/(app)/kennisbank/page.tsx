import type { Metadata } from "next";
import Link from "next/link";
import { Lock, EyeOff } from "lucide-react";
import { requireInternal } from "@/server/auth/context";
import { canManageKennisbank, listCourses } from "@/server/kennisbank";
import { aiConfigured } from "@/server/ai/client";
import { EmptyState, PageHeader } from "@/components/ui";
import { KbProgressBar } from "@/components/kennisbank/progress-bar";
import { CourseAdminMenu, NewCourseCard } from "./admin-ui";
import { SopMaker } from "./sop-maker";
import { KbSearch } from "./kb-search";

export const metadata: Metadata = { title: "Shortclips Kennisbank" };
export const dynamic = "force-dynamic";

export default async function KennisbankPage() {
  const viewer = await requireInternal();
  const manage = canManageKennisbank(viewer);
  const courses = await listCourses(viewer);

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        title="Shortclips Kennisbank"
        description="Onze bedrijfsprocessen, werkinstructies, trainingen en SOP's op één plek."
        actions={
          manage ? (
            <div className="flex items-center gap-2">
              <SopMaker courses={courses.map((c) => ({ id: c.id, title: c.title }))} aiReady={aiConfigured()} />
              <Link href="/kennisbank/migratie" className="rounded-md border border-[var(--color-line-strong)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--color-surface-2)]">
                Migratiestatus
              </Link>
            </div>
          ) : null
        }
      />

      {/* Zoekbalk bovenaan: typ een vraag/trefwoord en zie meteen de lessen
          waar het antwoord in staat. */}
      <KbSearch />

      {courses.length === 0 && !manage ? (
        <EmptyState title="Nog geen cursussen" description="De kennisbank wordt op dit moment gevuld." />
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((c, i) => (
            <div key={c.id} className="group relative flex flex-col overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-sm transition hover:shadow-md">
              <Link href={`/kennisbank/${c.id}`} className="flex flex-1 flex-col focus-visible:outline-none">
                <div className="relative aspect-[1460/752] w-full overflow-hidden bg-[var(--color-indigo-ink)]">
                  {c.coverAssetId ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/kennisbank/assets/${c.coverAssetId}`} alt="" className="h-full w-full object-cover" loading={i < 6 ? "eager" : "lazy"} />
                  ) : (
                    <div className="flex h-full items-center justify-center px-6 text-center text-lg font-bold uppercase text-white">{c.title}</div>
                  )}
                </div>
                <div className="flex flex-1 flex-col p-4">
                  <h2 className="flex items-center gap-1.5 text-[17px] font-semibold leading-snug text-[var(--color-ink)]">
                    {c.isRestricted ? <Lock className="h-4 w-4 shrink-0 text-[var(--color-ink-muted)]" aria-label="Afgeschermd" /> : null}
                    {!c.isPublished ? <EyeOff className="h-4 w-4 shrink-0 text-[var(--color-warn)]" aria-label="Concept" /> : null}
                    <span className="truncate">{c.title}</span>
                  </h2>
                  <p className="mt-1.5 line-clamp-2 min-h-[2.75rem] text-sm leading-relaxed text-[var(--color-ink-muted)]">{c.description}</p>
                  <KbProgressBar done={c.completedCount} total={c.lessonCount} className="mt-4" />
                </div>
              </Link>
              {manage ? (
                <div className="absolute right-2 top-2">
                  <CourseAdminMenu course={c} isFirst={i === 0} isLast={i === courses.length - 1} />
                </div>
              ) : null}
            </div>
          ))}
          {manage ? <NewCourseCard /> : null}
        </div>
      )}
    </div>
  );
}
