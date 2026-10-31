import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/server/auth/context";
import { getProject, listStyleVersions } from "@/server/ai-editor/queries";
import type { StoredPlan } from "@/server/ai-editor/pipeline";
import { PageHeader, Badge } from "@/components/ui";
import { EditorView, type EditorData } from "./editor-view";
import { PROJECT_STATUS } from "../labels";

export const metadata: Metadata = { title: "AI Editor" };
export const dynamic = "force-dynamic";

export default async function AiEditorProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requirePermission("ai_editor:read");
  const { id } = await params;
  const data = await getProject(id);
  if (!data) notFound();
  const versions = await listStyleVersions();
  const { project: p } = data;
  const stored = p.plan as StoredPlan | null;
  const st = PROJECT_STATUS[p.status] ?? PROJECT_STATUS.draft;

  const editor: EditorData = {
    id: p.id,
    title: p.title,
    script: p.script ?? "",
    status: p.status,
    phase: p.phase,
    progress: p.progress,
    error: p.error,
    planVersion: p.planVersion,
    styleProfileId: p.styleProfileId,
    hasPreview: Boolean(p.previewPath),
    hasFinal: Boolean(p.finalPath),
    finalFormat: p.finalFormat,
    explanation: (p.explanation ?? []) as string[],
    qc: (p.qc ?? null) as EditorData["qc"],
    costs: (p.costs ?? {}) as EditorData["costs"],
    takes: stored?.plan.takes.map((t) => ({ sentenceIdx: t.sentenceIdx, sentenceText: t.sentenceText, needsUser: t.needsUser, userChosen: Boolean(t.userChosen), chosenTakeId: t.chosenTakeId, options: t.options.map((o) => ({ takeId: o.takeId, text: o.text, score: o.score, inS: o.inS, outS: o.outS, sourceId: o.sourceId })) })) ?? [],
    sources: data.sources.map((s) => {
      const a = (s.analysis ?? {}) as { role?: string; roleOverride?: string | null; speechRatio?: number; log?: { isLog: boolean; reason: string } };
      const pr = (s.probe ?? {}) as { width?: number; height?: number; fps?: number };
      return { id: s.id, filename: s.filename, origin: s.origin, status: s.status, sizeBytes: s.sizeBytes, durationMs: s.durationMs, role: a.role ?? null, roleOverride: a.roleOverride ?? null, speechRatio: a.speechRatio ?? null, log: a.log ?? null, resolution: pr.width ? `${pr.width}×${pr.height} @ ${Math.round((pr.fps ?? 0) * 100) / 100}` : null };
    }),
    feedback: data.feedback.map((f) => ({ id: f.id, text: f.text, status: f.status, response: f.response, createdAt: f.createdAt.toISOString(), version: f.appliedPlanVersion })),
    versions: versions.map((v) => ({ id: v.id, version: v.version, isActive: v.isActive })),
    canRun: viewer.permissions.has("ai_editor:run"),
    canStyle: viewer.permissions.has("ai_editor:style"),
    sourceNames: Object.fromEntries(data.sources.map((s) => [s.id, s.filename])),
  };

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        breadcrumb={<Link href="/ai-editor" className="text-xs text-[var(--color-ink-muted)] hover:underline">← Shortclips AI Editor</Link>}
        title={p.title}
        actions={<Badge tone={st.tone}>{st.label}</Badge>}
      />
      {/* Nieuwe status of versie = verse weergave (voortgang, fouten, preview). */}
      <EditorView key={`${p.status}-${p.planVersion}-${p.updatedAt.getTime()}`} data={editor} />
    </div>
  );
}
