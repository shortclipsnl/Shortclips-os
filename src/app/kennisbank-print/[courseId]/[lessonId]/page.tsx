import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { kbCourses } from "@/db/schema";
import { requireInternal } from "@/server/auth/context";
import { getLesson } from "@/server/kennisbank";
import { DocRenderer } from "@/components/kennisbank/doc-renderer";
import type { PMDoc } from "@/lib/kennisbank-doc";
import { PrintBar } from "../../print-now";

export const dynamic = "force-dynamic";

const NAVY = "#00003b";

/**
 * Printvriendelijke A4-weergave van één SOP/les — standalone (geen portaal-
 * chrome), zodat zowel de headless-PDF als een directe print er netjes uitzien.
 */
export default async function KennisbankPrintPage({ params }: { params: Promise<{ courseId: string; lessonId: string }> }) {
  const { courseId, lessonId } = await params;
  const viewer = await requireInternal();
  const lesson = await getLesson(viewer, courseId, lessonId);
  if (!lesson) notFound();

  const [course] = await db.select({ title: kbCourses.title }).from(kbCourses).where(eq(kbCourses.id, courseId)).limit(1);
  const updated = lesson.updatedAt
    ? new Date(lesson.updatedAt).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" })
    : null;
  const pdfHref = `/api/kennisbank/${courseId}/lessons/${lessonId}/pdf`;

  return (
    <div style={{ background: "#fff", color: "#1c2230", minHeight: "100vh" }}>
      <style>{`
        @page { size: A4; margin: 16mm; }
        @media print { .no-print { display: none !important; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
        * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      `}</style>

      <PrintBar pdfHref={pdfHref} />

      <div style={{ maxWidth: 840, margin: "0 auto", padding: "0 28px 60px", fontFamily: "Inter, system-ui, sans-serif" }}>
        {/* Titelblok in de huisstijl. */}
        <div style={{ background: NAVY, color: "#fff", borderRadius: 16, padding: "30px 34px", marginTop: 28 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 20, fontWeight: 900 }}>ShortClips</span>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>Kennisbank · SOP</span>
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 800, margin: "18px 0 0", lineHeight: 1.2 }}>{lesson.title}</h1>
          <div style={{ marginTop: 8, fontSize: 13, color: "rgba(255,255,255,0.75)" }}>
            {course?.title ? course.title : "Shortclips Kennisbank"}
            {updated ? ` · bijgewerkt ${updated}` : ""}
          </div>
        </div>

        {/* Inhoud van de SOP. */}
        <div style={{ marginTop: 24 }}>
          <DocRenderer doc={lesson.content as unknown as PMDoc} />
        </div>
      </div>
    </div>
  );
}
