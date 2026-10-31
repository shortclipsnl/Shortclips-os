import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/server/auth/context";
import { getOrCreateActiveStyle, listAssets, listReferences, listStyleVersions } from "@/server/ai-editor/queries";
import { STYLE_PROVENANCE } from "@/server/ai-editor/style-profile";
import { PageHeader } from "@/components/ui";
import { StyleManager } from "./style-manager";

export const metadata: Metadata = { title: "Stijlbeheer · AI Editor" };
export const dynamic = "force-dynamic";

export default async function StijlbeheerPage() {
  const viewer = await requirePermission("ai_editor:style");
  const [active, versions, refs, assets] = await Promise.all([getOrCreateActiveStyle(viewer.id), listStyleVersions(), listReferences(), listAssets()]);
  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        breadcrumb={<Link href="/ai-editor" className="text-xs text-[var(--color-ink-muted)] hover:underline">← Shortclips AI Editor</Link>}
        title="Stijlbeheer"
        description="Het montageprofiel Shortclips Ads Style: één keer goed vastleggen, daarna altijd gebruiken. Elke wijziging is een nieuwe versie die je kunt terugzetten."
      />
      <StyleManager
        active={{ id: active.id, version: active.version, config: active.config }}
        versions={versions.map((v) => ({ id: v.id, version: v.version, isActive: v.isActive, note: v.note, createdAt: v.createdAt.toISOString(), author: v.author }))}
        references={refs.map((r) => ({ id: r.id, title: r.title, status: r.status, error: r.error, measurements: (r.measurements ?? null) as Record<string, unknown> | null, proposal: (r.proposal ?? []) as Array<{ path: string; label: string; current: number; proposed: number; reason: string }>, fromProject: Boolean(r.fromProjectId), createdAt: r.createdAt.toISOString() }))}
        assets={assets.map((a) => ({ id: a.id, kind: a.kind, name: a.name, isActive: a.isActive, matchProfile: a.matchProfile }))}
        provenance={STYLE_PROVENANCE}
      />
    </div>
  );
}
