import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ClipboardList } from "lucide-react";
import { requireInternal, isOwner } from "@/server/auth/context";
import { assignMissingEditors } from "@/server/jobs/calendar-sync";
import { isCoreStaff } from "@/server/core-staff";
import { getVideoHighlights, listEditorOptions, listVideos } from "@/server/videos";
import { listEditingProjects } from "@/server/editing-board";
import { listEditorBoard } from "@/server/editor-board";
import { isBoardEditor } from "@/server/edit-board-editors";
import { listClients } from "@/server/clients";
import { WorkloadSection } from "../editing/workload-section";
import { Card, PageHeader } from "@/components/ui";
import { EditorBoardTable } from "./editor-board-table";
import { AutofillEditorsButton } from "./autofill-editors";

export const metadata: Metadata = { title: "Editing" };
export const dynamic = "force-dynamic";

export default async function VideosPage({
  searchParams,
}: {
  searchParams: Promise<{ weergave?: string; filter?: string; status?: string; klant?: string; editor?: string }>;
}) {
  const viewer = await requireInternal();
  const params = await searchParams;

  // Editors zien een board op basis van hún video's (deliverables) — niet op
  // opnames. Veel video's komen via Monday binnen zonder opname, dus het
  // opname-board zou leeg blijven. Dit toont de editor precies zijn eigen werk.
  if (viewer.isEditorOnly) {
    const videos = await listEditorBoard(viewer);
    return (
      <div className="mx-auto max-w-[1500px]">
        <PageHeader title="Editing" description={`${videos.length} video's van jou`} />
        <section className="mb-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] bg-[var(--color-indigo-ink)] px-4 py-2.5 text-white">
            <h2 className="text-sm font-bold tracking-tight">Jouw edit-projecten</h2>
            <span className="text-xs text-white/80">Per fase · deadline, aantal shorts, downloadlink en script</span>
          </div>
          {/* Korte uitleg bovenaan — editors hoeven niets in te vullen; ze
              openen alleen het materiaal en het script en bewaken de deadline. */}
          <p className="mb-3 rounded-[var(--radius-md)] border border-[var(--color-brand-500)]/30 bg-[var(--color-brand-50)] px-4 py-3 text-sm leading-relaxed text-[var(--color-ink)]">
            Hieronder staan de projecten die <strong>binnenkort beschikbaar</strong> komen en de projecten die nu <strong>in edit</strong> staan.
            Klik op <strong>Download</strong> voor het beeldmateriaal en op <strong>Script</strong> voor het script — die kun je meteen openen.
            Check goed je <strong>interne deadline</strong> (de eerste versie, 7 werkdagen na de opname), plan ze in je eigen agenda en zorg dat je op tijd oplevert.
            Vragen of kom je ergens niet uit? Neem contact op met je contactpersoon bij ShortClips.
          </p>
          {videos.length > 0 ? (
            <EditorBoardTable videos={videos} editors={[]} canEdit={false} canAssign={false} showTabs={false} editorView />
          ) : (
            <p className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-6 text-center text-sm text-[var(--color-ink-muted)]">
              Je hebt op dit moment geen video&apos;s toegewezen gekregen.
            </p>
          )}
        </section>
      </div>
    );
  }

  const preset = params.filter && params.filter !== "alles"
    ? (params.filter as "te-laat" | "bij-klant" | "mijn-werk" | "actief")
    : params.filter === "alles"
      ? undefined
      : "actief";

  // Opnames/opleveringen zonder editor automatisch aan de vaste editor van de
  // klant koppelen, zodat het board klopt en editors hun projecten in de
  // planning hebben. Idempotent; alleen het kantoorteam triggert dit.
  await assignMissingEditors().catch(() => {});

  const [rows, highlights, editors, editingProjects, clientList] = await Promise.all([
    listVideos(viewer, {
      preset,
      status: params.status,
      clientSlug: params.klant,
      editorId: params.editor,
    }),
    getVideoHighlights(viewer),
    listEditorOptions(),
    listEditingProjects(viewer),
    listClients(viewer),
  ]);
  const canEdit = viewer.permissions.has("videos:write");
  const canAssign = viewer.permissions.has("videos:assign");
  // Edit-boards zijn alleen voor de vaste editors: Quinn, Noah, Sam, Senna, Fabian.
  const boardEditors = editors.filter((e) => isBoardEditor(e.fullName));
  // Editors (freelance) zien alleen hun eigen editbord met de fases — niet de
  // deadlinebewaking, aandachtsblokken of de werkvoorraad/tarieven eronder.
  const editorView = viewer.isEditorOnly;
  const owner = isOwner(viewer);
  // Het volledige editing-board (alle editors, per fase) is voor het kantoorteam:
  // de eigenaar én de vaste kernmedewerkers (Milou, Jiska, Rutger). Zij zien
  // precies hetzelfde overzicht als Jarno.
  const showAllBoard = owner || isCoreStaff(viewer.email);
  // Alle editing-opdrachten (video's) over alle editors — het volledige beeld,
  // gegroepeerd per fase met de editor erbij.
  const allEditorVideos = showAllBoard ? await listEditorBoard(viewer, { allEditors: true }) : [];

  return (
    <div className="mx-auto max-w-[1500px]">
      <PageHeader
        title="Editing"
        description={`${editingProjects.length} projecten · ${rows.length} video's in productie`}
        actions={
          viewer.permissions.has("ai:read") ? (
            <Link
              href="/ai/briefing"
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
              title="Maak een editingbriefing voor de editors"
            >
              <ClipboardList className="size-4" /> Editing briefing maken
            </Link>
          ) : undefined
        }
      />

      {showAllBoard ? (
        <section className="mb-6">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] bg-[var(--color-indigo-ink)] px-4 py-2.5 text-white">
            <h2 className="text-sm font-bold tracking-tight">Alle editing-opdrachten</h2>
            <div className="flex flex-wrap items-center gap-3">
              {canAssign ? <AutofillEditorsButton /> : null}
              <span className="text-xs text-white/80">{allEditorVideos.length} video&apos;s · per fase, met editor, deadline, downloadlink en script</span>
            </div>
          </div>
          {allEditorVideos.length > 0 ? (
            <EditorBoardTable
              videos={allEditorVideos}
              editors={boardEditors.map((e) => ({ id: e.id, fullName: e.fullName }))}
              canEdit={canEdit}
              canAssign={canAssign}
            />
          ) : (
            <p className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-6 text-center text-sm text-[var(--color-ink-muted)]">
              Nog geen editing-opdrachten. Zodra er een opname in de Google Agenda staat, verschijnt die hier automatisch.
            </p>
          )}
        </section>
      ) : null}

      {/* Alles hieronder is voor coördinatie/beheer — editors zien dit niet. */}
      {editorView ? null : (
      <>
      {/* Aandachtsblokken: automatisch uit de fase + deadline. */}
      {highlights.late > 0 || highlights.atClient > 0 ? (
        <Card className="mb-4 border-[var(--color-bad)]/25 bg-[var(--color-bad-soft)]/40">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-[var(--color-bad)]" strokeWidth={1.75} />
            <div className="text-sm">
              <p className="font-semibold">Vraagt nu aandacht</p>
              <ul className="mt-1 space-y-0.5 text-[var(--color-ink-muted)]">
                {highlights.late > 0 ? (
                  <li>
                    <Link href="/videos?filter=te-laat" className="font-medium text-[var(--color-bad)] hover:underline">
                      {highlights.late} video&apos;s over de deadline
                    </Link>{" "}
                    — moeten met voorrang afgerond worden.
                  </li>
                ) : null}
                {highlights.atClient > 0 ? (
                  <li>
                    <Link href="/videos?filter=bij-klant" className="font-medium text-[var(--color-ink)] hover:underline">
                      {highlights.atClient} video&apos;s wachten op klantfeedback
                    </Link>
                    {highlights.oldestAtClientDays > 0 ? ` — langst wachtende: ${highlights.oldestAtClientDays} dagen.` : "."}
                  </li>
                ) : null}
              </ul>
            </div>
          </div>
        </Card>
      ) : null}

      <div className="mb-5 grid gap-3 lg:grid-cols-3">
        <DrillCard title="Te laat" count={highlights.late} accent="var(--color-bad)" href="/videos?filter=te-laat" solid
          items={highlights.lateList.map((v) => ({ id: v.id, primary: v.clientName, secondary: v.title, meta: `${Number(v.days)} d te laat` }))} empty="Niets te laat" />
        <DrillCard title="Wacht op klant" count={highlights.atClient} accent="var(--color-warn)" href="/videos?filter=bij-klant" solid
          items={highlights.atClientList.map((v) => ({ id: v.id, primary: v.clientName, secondary: v.title, meta: `${Number(v.days)} d geen reactie` }))} empty="Niets bij de klant" />
        <DrillCard title="Wacht op editor" count={highlights.awaitingEditor} accent="var(--color-info)" href="/videos?status=awaiting_editor"
          items={highlights.awaitingEditorList.map((v) => ({ id: v.id, primary: v.editorName ?? "Geen editor", secondary: v.title, meta: `${Number(v.days)} d bij editor` }))} empty="Niets bij een editor" />
      </div>

      {/* Editorbelasting & tarieven — samengevoegd vanuit de oude /editing-pagina. */}
      <WorkloadSection viewer={viewer} />
      </>
      )}
    </div>
  );
}

function DrillCard({
  title,
  count,
  accent,
  href,
  items,
  empty,
  solid = false,
}: {
  title: string;
  count: number;
  accent: string;
  href: string;
  items: { id: string; primary: string; secondary: string; meta?: string }[];
  empty: string;
  solid?: boolean;
}) {
  const active = count > 0;
  // "solid" vult de hele balk met de accentkleur (bijv. te laat = rood, wacht op
  // klant = oranje) zodat het meteen opvalt.
  const fullColor = solid && active;
  return (
    <div
      className="overflow-hidden rounded-[var(--radius-lg)] border bg-[var(--color-surface)]"
      style={{ borderColor: active ? `color-mix(in srgb, ${accent} 35%, var(--color-line))` : "var(--color-line)" }}
    >
      <Link
        href={href}
        className="flex items-center justify-between gap-2 px-4 py-2.5 transition-[filter] hover:brightness-[0.97]"
        style={{
          background: fullColor ? accent : active ? `color-mix(in srgb, ${accent} 13%, var(--color-surface))` : "var(--color-surface-sunken)",
          color: fullColor ? "#fff" : active ? accent : "var(--color-ink-muted)",
          borderBottom: `2px solid ${active ? accent : "var(--color-line)"}`,
        }}
      >
        <span className="text-sm font-bold">{title}</span>
        <span className="text-2xl font-bold tabular-nums">{count}</span>
      </Link>
      {items.length === 0 ? (
        <p className="px-4 py-3 text-xs text-[var(--color-ink-faint)]">{empty}</p>
      ) : (
        <ul className="divide-y divide-[var(--color-line)]">
          {items.map((it) => (
            <li key={it.id}>
              <Link href={`/videos/${it.id}`} className="block px-4 py-2 hover:bg-[var(--color-surface-2)]">
                <span className="flex items-center justify-between gap-2" style={{ borderLeft: `3px solid ${accent}`, paddingLeft: 8 }}>
                  <span className="truncate text-sm font-medium">{it.primary}</span>
                  {it.meta ? <span className="shrink-0 text-xs font-semibold" style={{ color: accent }}>{it.meta}</span> : null}
                </span>
                <span className="mt-0.5 block truncate pl-[11px] text-xs text-[var(--color-ink-muted)]">{it.secondary}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
