import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, desc, eq, isNull, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { kbChapters, kbCourses, kbImportRuns, kbLessons } from "@/db/schema";
import { requireOwner } from "@/server/auth/context";
import { Card, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Kennisbank · Migratiestatus" };
export const dynamic = "force-dynamic";

/**
 * Alleen voor de eigenaar: laat zien wat er uit Skool is overgezet en wat nog
 * van Skool afhankelijk is. Skool pas opzeggen als hier niets meer openstaat.
 */
export default async function MigratiePage() {
  await requireOwner();
  const [runs, totals, open, skoolRefs] = await Promise.all([
    db.select().from(kbImportRuns).orderBy(desc(kbImportRuns.createdAt)).limit(5),
    db
      .select({
        courses: sql<number>`(select count(*) from kb_courses where deleted_at is null)::int`,
        chapters: sql<number>`(select count(*) from kb_chapters where deleted_at is null)::int`,
        lessons: sql<number>`(select count(*) from kb_lessons where deleted_at is null)::int`,
        drafts: sql<number>`(select count(*) from kb_lessons where deleted_at is null and is_published = false)::int`,
        assets: sql<number>`(select count(*) from kb_assets where is_complete)::int`,
        bytes: sql<number>`(select coalesce(sum(byte_size),0) from kb_assets where is_complete)::bigint`,
      })
      .from(sql`(select 1) as x`),
    db
      .select({ id: kbLessons.id, courseId: kbLessons.courseId, title: kbLessons.title, notes: kbLessons.migrationNotes, course: kbCourses.title, chapter: kbChapters.title })
      .from(kbLessons)
      .innerJoin(kbCourses, eq(kbCourses.id, kbLessons.courseId))
      .leftJoin(kbChapters, eq(kbChapters.id, kbLessons.chapterId))
      .where(and(isNull(kbLessons.deletedAt), isNotNull(kbLessons.migrationNotes)))
      .orderBy(asc(kbCourses.sortOrder), asc(kbLessons.sortOrder)),
    db
      .select({ id: kbLessons.id, courseId: kbLessons.courseId, title: kbLessons.title, course: kbCourses.title })
      .from(kbLessons)
      .innerJoin(kbCourses, eq(kbCourses.id, kbLessons.courseId))
      .where(and(isNull(kbLessons.deletedAt), sql`(${kbLessons.content}::text like '%skool.com%' or ${kbLessons.resources}::text like '%skool.com%')`))
      .orderBy(asc(kbCourses.sortOrder), asc(kbLessons.sortOrder)),
  ]);
  const t = totals[0]!;
  const last = runs[0];
  const s = (last?.summary ?? {}) as Record<string, unknown>;
  const ready = open.length === 0 && skoolRefs.length === 0;

  return (
    <div className="mx-auto max-w-[1000px] space-y-5">
      <PageHeader title="Kennisbank · Migratiestatus" description="Wat is er uit Skool overgezet, en wat is nog van Skool afhankelijk? Alleen zichtbaar voor de eigenaar." />
      <Card>
        <div className={`rounded-md px-4 py-3 text-sm font-medium ${ready ? "bg-[var(--color-good-soft)] text-[var(--color-good)]" : "bg-[var(--color-warn-soft)] text-[var(--color-ink)]"}`}>
          {ready
            ? "Alles staat in de eigen database. Er is niets meer afhankelijk van Skool."
            : `Nog niet klaar om Skool op te zeggen: ${open.length} les(sen) met openstaande migratiepunten en ${skoolRefs.length} les(sen) met een verwijzing naar skool.com.`}
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          {[
            ["Cursussen", t.courses],
            ["Hoofdstukken", t.chapters],
            ["Lessen", `${t.lessons} (waarvan ${t.drafts} concept)`],
            ["Bestanden in eigen opslag", t.assets],
            ["Opslag", `${Math.round(Number(t.bytes) / 1024 / 1024)} MB`],
            ["Laatste import", last ? new Date(last.createdAt).toLocaleString("nl-NL") : "nog niet"],
          ].map(([k, v]) => (
            <div key={String(k)} className="rounded-lg bg-[var(--color-surface-sunken)] px-3 py-2">
              <dt className="text-xs text-[var(--color-ink-muted)]">{k}</dt>
              <dd className="font-semibold">{String(v)}</dd>
            </div>
          ))}
        </dl>
        {last ? (
          <p className="mt-3 text-xs text-[var(--color-ink-muted)]">
            Import uit Skool: {String(s.images ?? 0)} afbeeldingen, {String(s.files ?? 0)} bijlagen, {String(s.skoolVideos ?? 0)} Skool-video&apos;s, {String(s.loomVideos ?? 0)} Loom-video&apos;s, {String(s.internalLinksRewritten ?? 0)} interne links omgezet, voortgang: {String(s.progressRows ?? 0)} afgeronde lessen (alleen jouw eigen voortgang).
          </p>
        ) : null}
      </Card>

      <Card>
        <h2 className="text-sm font-semibold">Openstaande migratiepunten ({open.length})</h2>
        {open.length === 0 ? <p className="mt-2 text-sm text-[var(--color-ink-muted)]">Geen.</p> : (
          <ul className="mt-2 divide-y divide-[var(--color-line)] text-sm">
            {open.map((l) => (
              <li key={l.id} className="py-2">
                <Link href={`/kennisbank/${l.courseId}?les=${l.id}`} className="font-medium text-[var(--color-brand-700)] hover:underline">
                  {l.course} › {l.chapter ? `${l.chapter} › ` : ""}{l.title}
                </Link>
                <p className="text-[var(--color-ink-muted)]">{l.notes}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="text-sm font-semibold">Lessen die nog naar skool.com verwijzen ({skoolRefs.length})</h2>
        {skoolRefs.length === 0 ? <p className="mt-2 text-sm text-[var(--color-ink-muted)]">Geen.</p> : (
          <ul className="mt-2 space-y-1 text-sm">
            {skoolRefs.map((l) => (
              <li key={l.id}>
                <Link href={`/kennisbank/${l.courseId}?les=${l.id}`} className="text-[var(--color-brand-700)] hover:underline">{l.course} › {l.title}</Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
