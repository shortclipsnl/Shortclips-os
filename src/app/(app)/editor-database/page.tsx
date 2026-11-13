import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireInternal } from "@/server/auth/context";
import { canUseEditorDatabase } from "@/server/editor-database-access";
import { listEditorHistory, listEditorProfiles } from "@/server/editor-database";
import { EditorDatabase } from "./editor-database-ui";

export const metadata: Metadata = { title: "Editor database" };
export const dynamic = "force-dynamic";

/**
 * Editor database: actieve, back up, potentiële en niet geschikte editors op
 * één plek. Alleen voor de eigenaar en het vaste kantoorteam; voor iedereen
 * anders bestaat deze pagina niet.
 */
export default async function EditorDatabasePage({ searchParams }: { searchParams: Promise<{ spoed?: string; editor?: string }> }) {
  const viewer = await requireInternal();
  if (!canUseEditorDatabase(viewer)) notFound();
  const params = await searchParams;
  const profiles = await listEditorProfiles();
  const history = await listEditorHistory(profiles.map((p) => p.id));

  return (
    <div className="mx-auto max-w-[1500px]">
      <Link href="/videos" className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
        <ArrowLeft className="size-3.5" /> Terug naar Editing
      </Link>
      <EditorDatabase profiles={profiles} history={history} initialSpoed={params.spoed === "1"} initialOpenId={params.editor ?? null} />
    </div>
  );
}
