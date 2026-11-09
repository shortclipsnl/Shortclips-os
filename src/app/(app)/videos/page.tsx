import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { requireInternal, isOwner, canManageOperations } from "@/server/auth/context";
import { assignMissingEditorsIfStale, mergeDuplicateShootsIfStale } from "@/server/jobs/calendar-sync";
import { isCoreStaff } from "@/server/core-staff";
import { canManageFeedbackRounds } from "@/server/feedback-rounds";
import { getVideoHighlights, listEditorOptions, listVideos } from "@/server/videos";
import { listEditingProjects } from "@/server/editing-board";
import { listEditorBoard } from "@/server/editor-board";
import { isBoardEditor } from "@/server/edit-board-editors";
import { listClients } from "@/server/clients";
import { WorkloadSection } from "../editing/workload-section";
import { Card, PageHeader } from "@/components/ui";
import { EditorBoardTable } from "./editor-board-table";
import { AutofillEditorsButton } from "./autofill-editors";
import { KlantberichtButton } from "./klantbericht-button";
import { getKlantbericht } from "@/server/klantbericht";
import { ClientStatusTabs } from "@/components/client-status-tabs";
import { parseClientStatusFilter } from "@/lib/client-status";

export const metadata: Metadata = { title: "Editing" };
export const dynamic = "force-dynamic";

export default async function VideosPage({
  searchParams,
}: {
  searchParams: Promise<{ weergave?: string; filter?: string; status?: string; klant?: string; klanten?: string; editor?: string }>;
}) {
  const viewer = await requireInternal();
  const params = await searchParams;

  // Editors zien een board op basis van hún video's (deliverables) — niet op
  // opnames. Veel video's komen binnen zonder opname, dus het
  // opname-board zou leeg blijven. Dit toont de editor precies zijn eigen werk.
  if (viewer.isEditorOnly) {
    const all = await listEditorBoard(viewer);
    // Klantstatus komt live uit het centrale klantenbeheer. Standaard alleen
    // actieve klanten; niet actieve klanten staan apart achter een filter.
    const klantFilter = params.klanten === "niet-actief" ? "niet-actief" : params.klanten === "alle" ? "alle" : "actief";
    const inactiveCount = all.filter((v) => !v.clientActive).length;
    const videos = klantFilter === "alle" ? all : all.filter((v) => (klantFilter === "actief" ? v.clientActive : !v.clientActive));
    const tab = (key: string, label: string, n: number) => (
      <Link
        key={key}
        href={key === "actief" ? "/videos" : `/videos?klanten=${key}`}
        className={`rounded-full px-3 py-1 text-xs font-semibold ${klantFilter === key ? "bg-[var(--color-ink)] text-white" : "bg-[var(--color-surface)] text-[var(--color-ink-muted)] ring-1 ring-[var(--color-line)] hover:text-[var(--color-ink)]"}`}
      >
        {label} <span className="tabular-nums opacity-70">{n}</span>
      </Link>
    );
    return (
      <div className="mx-auto max-w-[1500px]">
        <PageHeader title="Editing" description={`${videos.length} video's van jou`} />
        <section className="mb-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] bg-[var(--color-indigo-ink)] px-4 py-2.5 text-white">
            <h2 className="text-sm font-bold tracking-tight">Jouw edit-projecten</h2>
            <span className="text-xs text-white/80">Per fase · editor deadline, aantal shorts, downloadlink en script</span>
          </div>
          {/* Korte uitleg: editors bekijken en downloaden; het materiaal zelf
              beheert Team Shortclips (technisch afgedwongen op de server). */}
          <p className="mb-3 rounded-[var(--radius-md)] border border-[var(--color-brand-500)]/30 bg-[var(--color-brand-50)] px-4 py-3 text-sm leading-relaxed text-[var(--color-ink)]">
            Hieronder staan de projecten die <strong>binnenkort beschikbaar</strong> komen en de projecten die nu <strong>in edit</strong> staan.
            Open het <strong>Download</strong>-materiaal, het <strong>Script</strong> en de <strong>Editor briefing</strong>. Deze worden aangeleverd en beheerd door Team Shortclips.
            Houd je <strong>editor deadline</strong> aan; met de agendalink op Vandaag staan je deadlines automatisch in je eigen agenda.
            Klopt er iets niet of mis je iets? Neem contact op met je contactpersoon bij Shortclips.
          </p>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {tab("actief", "Actieve klanten", all.length - inactiveCount)}
            {tab("niet-actief", "Niet actieve klanten", inactiveCount)}
            {tab("alle", "Alle", all.length)}
          </div>
          {videos.length > 0 ? (
            <EditorBoardTable videos={videos} editors={[]} canEdit={false} canAssign={false} canEditFiles={false} showTabs={false} editorView />
          ) : (
            <p className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-6 text-center text-sm text-[var(--color-ink-muted)]">
              {klantFilter === "niet-actief" ? "Je hebt geen opdrachten bij niet actieve klanten." : "Je hebt op dit moment geen video's toegewezen gekregen."}
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
  await assignMissingEditorsIfStale();
  // Dubbele opnamedagen (zelfde klant + datum, uit meerdere agenda's) opruimen,
  // zodat het editing-board niet dubbel/driedubbel volloopt. Draait ná de response.
  await mergeDuplicateShootsIfStale();

  // Centrale klantstatus: standaard alleen actieve klanten, met filter.
  const klantenFilter = parseClientStatusFilter(params.klanten);
  const [rows, highlights, editors, editingProjects, clientList] = await Promise.all([
    listVideos(viewer, {
      preset,
      status: params.status,
      clientSlug: params.klant,
      editorId: params.editor,
      klanten: klantenFilter,
    }),
    getVideoHighlights(viewer),
    listEditorOptions(),
    listEditingProjects(viewer, { klanten: klantenFilter }),
    listClients(viewer),
  ]);
  const canEdit = viewer.permissions.has("videos:write");
  // Editor wijzigen: iedereen met videos:assign én het vaste kantoorteam (Milou,
  // Jiska, Rutger) — zij sturen de editing net als de eigenaar aan.
  const canAssign = viewer.permissions.has("videos:assign") || isCoreStaff(viewer.email);
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
  // Feedbackrondes: alleen voor het kernteam (Jarno, Milou, Jiska, Rutger).
  const showFeedbackRounds = canManageFeedbackRounds(viewer);
  const allEditorVideos = showAllBoard
    ? (await listEditorBoard(viewer, { allEditors: true, withFeedbackRounds: showFeedbackRounds })).filter((v) =>
        klantenFilter === "alle" ? true : klantenFilter === "actief" ? v.clientActive : !v.clientActive)
    : [];
  // "Kopieer klantbericht": zichtbaar zodra er eerste versies klaarstaan om naar de
  // klant te sturen (fase Interne review of Feedback klant).
  const readyForClient = allEditorVideos.some((v) => v.phase === "interne_controle" || v.phase === "bij_klant");
  const klantbericht = readyForClient ? await getKlantbericht() : null;

  return (
    <div className="mx-auto max-w-[1500px]">
      <PageHeader
        title="Editing"
        description={`${editingProjects.length} projecten · ${rows.length} video's in productie`}
      />
      <div className="mb-4">
        <ClientStatusTabs basePath="/videos" current={klantenFilter} params={{ filter: params.filter, status: params.status, klant: params.klant, editor: params.editor, weergave: params.weergave }} />
      </div>

      {showAllBoard ? (
        <section className="mb-6">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] bg-[var(--color-indigo-ink)] px-4 py-2.5 text-white">
            <h2 className="text-sm font-bold tracking-tight">Alle editing-opdrachten</h2>
            <div className="flex flex-wrap items-center gap-3">
              {klantbericht ? <KlantberichtButton text={klantbericht} canManage={canManageOperations(viewer)} /> : null}
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
              canEditFiles={showAllBoard}
              viewerId={viewer.id}
              showFeedbackRounds={showFeedbackRounds}
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
