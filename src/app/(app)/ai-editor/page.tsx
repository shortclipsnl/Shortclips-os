import type { Metadata } from "next";
import Link from "next/link";
import { Clapperboard, Palette } from "lucide-react";
import { requirePermission } from "@/server/auth/context";
import { getOrCreateActiveStyle, listProjects, staleQueuedCount } from "@/server/ai-editor/queries";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Table } from "@/components/ui";
import { NewProject } from "./new-project";
import { PROJECT_STATUS, euro } from "./labels";

export const metadata: Metadata = { title: "Shortclips AI Editor" };
export const dynamic = "force-dynamic";

export default async function AiEditorPage() {
  const viewer = await requirePermission("ai_editor:read");
  const canRun = viewer.permissions.has("ai_editor:run");
  const canStyle = viewer.permissions.has("ai_editor:style");
  const [style, projects, stale] = await Promise.all([getOrCreateActiveStyle(viewer.id), listProjects(), staleQueuedCount()]);

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        title="Shortclips AI Editor"
        description="Ruwe camerabeelden erin, een complete advertentie in de Shortclips Ads Style eruit. Voor onze eigen advertenties."
        actions={canStyle ? <LinkButton href="/ai-editor/stijl" variant="secondary"><Palette className="size-4" /> Stijlbeheer</LinkButton> : null}
      />

      <div className="mb-5 rounded-[var(--radius-md)] border border-[var(--color-brand-500)]/30 bg-[var(--color-brand-50)] px-4 py-3.5 text-sm leading-relaxed text-[var(--color-ink)]">
        <p className="mb-1 font-semibold">Zo werkt het</p>
        <ol className="ml-4 list-decimal space-y-0.5 text-[var(--color-ink-muted)]">
          <li>Maak een nieuwe video en voeg alle ruwe camerabestanden van de opnamedag toe (upload of Google Drive-map). Plak het script erbij als je dat hebt.</li>
          <li>Klik op <strong className="text-[var(--color-ink)]">Genereer advertentievideo</strong>. De AI kiest de beste takes, knipt versprekingen en pauzes weg, zet ondertitels en kaarten, gradeert en mixt het geluid.</li>
          <li>Bekijk de preview, geef eventueel feedback in gewone taal en download de definitieve export.</li>
        </ol>
        <p className="mt-2 text-xs text-[var(--color-ink-faint)]">Actief profiel: {style.name} v{style.version}. De AI verzint geen tekst: alles komt uit wat er gezegd is en uit het script.</p>
      </div>

      {stale ? (
        <div className="mb-5 rounded-[var(--radius-sm)] bg-[var(--color-warn-soft)] px-3 py-2 text-sm text-[#8a5300]">
          {stale} verwerking(en) staan al een tijd in de wachtrij. Waarschijnlijk draait de verwerk-server niet (npm run ai-editor:worker, zie docs/AI-EDITOR.md).
        </div>
      ) : null}

      {canRun ? <NewProject /> : null}

      <Card padded={false}>
        {projects.length === 0 ? (
          <div className="p-6"><EmptyState icon={<Clapperboard className="size-5" />} title="Nog geen video's" description="Maak hierboven je eerste advertentie." /></div>
        ) : (
          <Table head={<>
            <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--color-ink-muted)]">Video</th>
            <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--color-ink-muted)]">Status</th>
            <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--color-ink-muted)]">Versie</th>
            <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--color-ink-muted)]">Kosten</th>
            <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--color-ink-muted)]">Bijgewerkt</th>
          </>}>
            {projects.map((p) => {
              const st = PROJECT_STATUS[p.status] ?? PROJECT_STATUS.draft;
              const costs = (p.costs ?? {}) as { totalCents?: number };
              return (
                <tr key={p.id} className="hover:bg-[var(--color-surface-sunken)]">
                  <td className="px-4 py-3 text-sm">
                    <Link href={`/ai-editor/${p.id}`} className="font-medium text-[var(--color-ink)] hover:underline">{p.title}</Link>
                    <div className="text-2xs text-[var(--color-ink-faint)]">{p.author ?? ""}</div>
                  </td>
                  <td className="px-4 py-3 text-sm"><Badge tone={st.tone}>{st.label}</Badge>{p.status === "processing" || p.status === "queued" ? <span className="ml-2 text-2xs text-[var(--color-ink-faint)]">{p.phase} {p.progress}%</span> : null}</td>
                  <td className="px-4 py-3 text-sm text-[var(--color-ink-muted)]">{p.planVersion ? `v${p.planVersion}` : "-"}</td>
                  <td className="px-4 py-3 text-sm text-[var(--color-ink-muted)]">{costs.totalCents != null ? euro(costs.totalCents) : "-"}</td>
                  <td className="px-4 py-3 text-sm text-[var(--color-ink-muted)]">{new Date(p.updatedAt).toLocaleString("nl-NL", { dateStyle: "short", timeStyle: "short" })}</td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </div>
  );
}
