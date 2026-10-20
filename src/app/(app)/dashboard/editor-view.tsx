import Link from "next/link";
import { AlertTriangle, ExternalLink, FileText, Folder, Film, CheckCircle2, Clock } from "lucide-react";
import { getEditorDashboard } from "@/server/editor-dashboard";
import { listEditingProjects } from "@/server/editing-board";
import type { Viewer } from "@/server/auth/context";
import { Card, CardHeader, ClientLogo, EmptyState, Stat } from "@/components/ui";
import { daysSince, pct, plural, relativeDays } from "@/lib/format";
import { stageOverdue, type VideoStage } from "@/lib/statuses";
import { EditingProjects } from "../videos/editing-projects";
import { EditorStatusControl } from "./editor-status";

/**
 * Dashboard voor editors: alleen eigen werk, met alles wat nodig is om te
 * beginnen — script, materiaal, briefing en openstaande feedback.
 */
export async function EditorDashboard({ viewer }: { viewer: Viewer }) {
  const [data, editingProjects] = await Promise.all([getEditorDashboard(viewer), listEditingProjects(viewer)]);
  const firstName = viewer.fullName.split(" ")[0];
  const canEdit = viewer.permissions.has("videos:write");

  const todayList = data.queue.filter(
    (v) => v.dueOn && v.dueOn <= new Date().toISOString().slice(0, 10),
  );

  return (
    <div className="mx-auto max-w-[1100px] space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Hoi {firstName}</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          {data.queue.length === 0
            ? "Je hebt op dit moment geen openstaand editwerk."
            : `${plural(data.queue.length, "video", "video's")} toegewezen${
                todayList.length > 0 ? `, waarvan ${todayList.length} vandaag of eerder af moeten` : ""
              }.`}
        </p>
      </div>

      {data.overdue > 0 ? (
        <div className="flex items-start gap-3 rounded-[var(--radius-lg)] border border-[var(--color-bad)]/25 bg-[var(--color-bad-soft)] px-4 py-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-[var(--color-bad)]" strokeWidth={2} />
          <p className="text-sm text-[#a3271c]">
            <strong className="font-semibold text-[var(--color-ink)]">
              {plural(data.overdue, "video staat", "video's staan")} over de deadline.
            </strong>{" "}
            Lukt het niet op tijd? Geef dat door aan je projectcoördinator.
          </p>
        </div>
      ) : null}

      {/* Wat komt er aan — in één oogopslag wat er op je bord staat en wat te laat is. */}
      <div>
        <h2 className="mb-2 text-sm font-bold tracking-tight">Wat komt er aan</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Nu op je bord" value={data.queue.length} tone="info" icon={<Film />} emphasis />
          <Stat label="Vandaag of eerder af" value={todayList.length} tone={todayList.length > 0 ? "warn" : "good"} icon={<Clock />} emphasis={todayList.length > 0} />
          <Stat label="Over deadline" value={data.overdue} tone={data.overdue > 0 ? "bad" : "good"} icon={<AlertTriangle />} emphasis={data.overdue > 0} />
        </div>
      </div>

      {editingProjects.length > 0 ? (
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] bg-[var(--color-indigo-ink)] px-4 py-2.5 text-white">
            <h2 className="text-sm font-bold tracking-tight">Jouw editing-projecten</h2>
            <span className="text-xs text-white/80">14 werkdagen tot oplevering · download &amp; script per project</span>
          </div>
          <p className="mb-3 rounded-[var(--radius-md)] border border-[var(--color-brand-500)]/30 bg-[var(--color-brand-50)] px-4 py-2.5 text-sm leading-relaxed text-[var(--color-ink)]">
            <strong>Dit zijn jouw projecten.</strong> Houd goed rekening met de <strong>deadlines</strong> — de batterij loopt vanaf de opnamedag.
            Per project vind je de <strong>download-link</strong> van het beeldmateriaal en het <strong>script</strong>. Zet je project telkens in de juiste
            <strong> fase</strong>: binnenkort beschikbaar → in edit → interne review → feedback klant → feedback klant verwerken → afgerond.
          </p>
          <EditingProjects projects={editingProjects} editors={[]} canEdit={canEdit} canAssign={false} lockedEditor />
        </div>
      ) : null}

      <Card padded={false}>
        <div className="p-5 pb-3">
          <CardHeader
            title="Jouw werk"
            subtitle="Op volgorde van deadline. Werk je status bij, en klik door voor script, materiaal en feedback."
          />
        </div>
        {data.queue.length === 0 ? (
          <EmptyState
            title="Niets toegewezen"
            description="Zodra er een video aan je wordt toegewezen, verschijnt die hier."
          />
        ) : (
          <ul className="divide-y divide-[var(--color-line)]">
            {data.queue.map((v) => {
              const days = daysSince(v.statusChangedAt);
              const late = stageOverdue(v.status, days);
              const overdue = v.dueOn && v.dueOn < new Date().toISOString().slice(0, 10);
              return (
                <li key={v.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <Link href={`/videos/${v.id}`} className="font-medium hover:underline">
                        {v.title}
                      </Link>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-ink-muted)]">
                        <span className="inline-flex items-center gap-1.5">
                          <ClientLogo name={v.clientName} logoUrl={v.clientLogo} color={v.clientColor} size={16} />
                          {v.clientName}
                        </span>
                        <span>· versie {v.currentVersion}</span>
                        <span className={late ? "font-medium text-[var(--color-warn)]" : undefined}>
                          · {days} dagen in deze stap
                        </span>
                        {v.clientRevisionRounds > 0 ? (
                          <span>· {plural(v.clientRevisionRounds, "klantrevisie", "klantrevisies")}</span>
                        ) : null}
                      </p>
                      {v.briefing ? (
                        <p className="mt-2 rounded-[var(--radius-sm)] bg-[var(--color-surface-sunken)] px-3 py-2 text-sm text-[var(--color-ink-muted)]">
                          {v.briefing}
                        </p>
                      ) : null}
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                        {v.scriptId ? (
                          <Link
                            href={`/scripts/${v.scriptId}`}
                            className="inline-flex items-center gap-1 text-[var(--color-brand-600)] hover:underline"
                          >
                            <FileText className="size-3.5" /> Script
                          </Link>
                        ) : null}
                        {v.driveFolderId ? (
                          <a
                            href={`https://drive.google.com/drive/folders/${v.driveFolderId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[var(--color-brand-600)] hover:underline"
                          >
                            <Folder className="size-3.5" /> Materiaal
                          </a>
                        ) : null}
                        {v.frameUrl ? (
                          <a
                            href={v.frameUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[var(--color-brand-600)] hover:underline"
                          >
                            <ExternalLink className="size-3.5" /> Frame.io
                          </a>
                        ) : null}
                        {Number(v.openComments) > 0 ? (
                          <span className="text-[var(--color-warn)]">
                            {plural(Number(v.openComments), "openstaande opmerking", "openstaande opmerkingen")}
                          </span>
                        ) : null}
                      </div>
                      {(() => {
                        const missing: string[] = [];
                        if (!v.scriptId) missing.push("script");
                        if (!v.driveFolderId) missing.push("materiaal");
                        if (!v.frameUrl) missing.push("Frame.io");
                        return missing.length > 0 ? (
                          <p className="mt-2 inline-flex items-center gap-1 text-2xs font-medium text-[var(--color-warn)]">
                            <AlertTriangle className="size-3" /> Nog koppelen vóór start: {missing.join(" · ")}
                          </p>
                        ) : (
                          <p className="mt-2 inline-flex items-center gap-1 text-2xs font-medium text-[var(--color-good)]">
                            <CheckCircle2 className="size-3" /> Script, materiaal en Frame.io beschikbaar
                          </p>
                        );
                      })()}
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <EditorStatusControl videoId={v.id} status={v.status} />
                      {v.dueOn ? (
                        <span
                          className={
                            overdue
                              ? "text-xs font-medium text-[var(--color-bad)]"
                              : "text-xs text-[var(--color-ink-muted)]"
                          }
                        >
                          {relativeDays(v.dueOn)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {data.branding.length > 0 ? (
        <Card padded={false}>
          <div className="p-5 pb-3">
            <CardHeader title="Huisstijl & referenties" subtitle="Richtlijnen en merkmateriaal per klant — uit Drive en de klantkennis." />
          </div>
          <ul className="divide-y divide-[var(--color-line)]">
            {data.branding.map((b) => (
              <li key={b.clientId} className="px-5 py-3">
                <Link href={`/clients/${b.clientSlug}?tab=kennis`} className="text-sm font-medium hover:underline">{b.clientName}</Link>
                {b.notes.length > 0 ? (
                  <ul className="mt-1.5 space-y-1">
                    {b.notes.slice(0, 4).map((n, i) => (
                      <li key={i} className="text-xs text-[var(--color-ink-muted)]"><span className="font-medium text-[var(--color-ink)]">{n.title}:</span> {n.body.slice(0, 140)}</li>
                    ))}
                  </ul>
                ) : null}
                {b.files.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {b.files.slice(0, 8).map((f, i) => (
                      <a key={i} href={f.url ?? "#"} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-full bg-[var(--color-surface-2)] px-2.5 py-1 text-2xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
                        <FileText className="size-3" /> {f.name}
                      </a>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* Jouw cijfers — groot en duidelijk. Rechtstreeks uit de pipeline. */}
      <div>
        <h2 className="mb-2 text-sm font-bold tracking-tight">Jouw cijfers</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Totaal opgeleverd" value={data.stats.delivered} tone="good" icon={<CheckCircle2 />} />
          <Stat label="Nu in bewerking" value={data.stats.inProgress} tone="info" icon={<Film />} />
          <Stat
            label="Op tijd geleverd"
            value={data.stats.onTimeRate !== null ? pct(data.stats.onTimeRate, 0) : "–"}
            hint={data.stats.withDeadline > 0 ? `over ${plural(data.stats.withDeadline, "video", "video's")} met deadline` : "nog geen deadline-video's"}
            tone={data.stats.onTimeRate !== null && data.stats.onTimeRate >= 80 ? "good" : "neutral"}
            icon={<Clock />}
          />
          <Stat
            label="Gem. klantrevisies"
            value={data.stats.avgClientRevisions?.toFixed(1) ?? "–"}
            hint="per video"
            tone="neutral"
          />
        </div>
      </div>
    </div>
  );
}

