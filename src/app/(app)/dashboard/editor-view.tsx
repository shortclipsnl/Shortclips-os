import Link from "next/link";
import { AlertTriangle, FileText, Film, CheckCircle2, Clock } from "lucide-react";
import { getEditorDashboard } from "@/server/editor-dashboard";
import { listEditorBoard } from "@/server/editor-board";
import type { Viewer } from "@/server/auth/context";
import { Card, CardHeader, ClientLogo, EmptyState, Stat } from "@/components/ui";
import { pct, plural, relativeDays } from "@/lib/format";
import { isFirstVersionPending } from "@/lib/edit-deadline";
import { EDIT_PHASE_META } from "@/lib/statuses";

/**
 * Dashboard voor editors: zo compact mogelijk. Alleen wat ze echt moeten weten —
 * wat komt eraan, hun video's op deadlinevolgorde en hun eigen cijfers. Downloaden
 * en het script openen doen ze op de Editing-pagina.
 *
 * Bron is bewust hetzelfde board als de Editing-pagina (`listEditorBoard`), zodat
 * Vandaag en Editing exact hetzelfde verhaal vertellen. Overal geldt de INTERNE
 * deadline (eerste versie = opname + 7 werkdagen), niet de ruimere klantdeadline.
 */
export async function EditorDashboard({ viewer }: { viewer: Viewer }) {
  const [data, board] = await Promise.all([getEditorDashboard(viewer), listEditorBoard(viewer)]);
  const firstName = viewer.fullName.split(" ")[0];
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });

  // Alles wat nog niet is afgerond staat op het bord; op volgorde van de interne
  // deadline (eerste versie), het meest urgente bovenaan.
  const active = board
    .filter((v) => v.phase !== "afgerond")
    .sort((a, b) => (a.editorDueOn ?? "9999").localeCompare(b.editorDueOn ?? "9999"));

  // Tellers op basis van de INTERNE deadline, alleen voor de eerste versie
  // (daarna is die versie al opgeleverd en geldt de klant-/revisieklok).
  const overdue = active.filter((v) => v.editorOverdue).length;
  const todayOrEarlier = active.filter(
    (v) => isFirstVersionPending(v.status) && v.editorDueOn && v.editorDueOn <= today,
  ).length;

  return (
    <div className="mx-auto max-w-[1100px] space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Hoi {firstName}</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          {active.length === 0
            ? "Je hebt op dit moment geen openstaand editwerk."
            : `${plural(active.length, "video", "video's")} op je bord${
                todayOrEarlier > 0 ? `, waarvan ${todayOrEarlier} vandaag of eerder af moeten (eerste versie)` : ""
              }.`}
        </p>
      </div>

      {overdue > 0 ? (
        <div className="flex items-start gap-3 rounded-[var(--radius-lg)] border border-[var(--color-bad)]/25 bg-[var(--color-bad-soft)] px-4 py-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-[var(--color-bad)]" strokeWidth={2} />
          <p className="text-sm text-[#a3271c]">
            <strong className="font-semibold text-[var(--color-ink)]">
              {plural(overdue, "eerste versie staat", "eerste versies staan")} over de interne deadline.
            </strong>{" "}
            Lukt het niet op tijd? Geef dat door aan je projectcoördinator.
          </p>
        </div>
      ) : null}

      {/* Wat komt er aan — in één oogopslag wat er op je bord staat en wat te laat is. */}
      <div>
        <h2 className="mb-2 text-sm font-bold tracking-tight">Wat komt er aan</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Nu op je bord" value={active.length} tone="info" icon={<Film />} emphasis />
          <Stat label="Vandaag of eerder af" value={todayOrEarlier} tone={todayOrEarlier > 0 ? "warn" : "good"} icon={<Clock />} emphasis={todayOrEarlier > 0} />
          <Stat label="Over interne deadline" value={overdue} tone={overdue > 0 ? "bad" : "good"} icon={<AlertTriangle />} emphasis={overdue > 0} />
        </div>
      </div>

      {/* Jouw video's — compact, op volgorde van de interne deadline. Zelfde set
          als de Editing-pagina. Downloaden en het script openen doe je daar. */}
      <Card padded={false}>
        <div className="p-5 pb-3">
          <CardHeader
            title="Jouw video's"
            subtitle="Op volgorde van je interne deadline (eerste versie, 7 werkdagen na de opname). Klik een video aan voor de download en het script."
          />
        </div>
        {active.length === 0 ? (
          <EmptyState
            title="Niets op je bord"
            description="Zodra er een video aan je wordt toegewezen, verschijnt die hier."
          />
        ) : (
          <ul className="divide-y divide-[var(--color-line)]">
            {active.map((v) => {
              const phaseMeta = EDIT_PHASE_META[v.phase];
              const needsEditor = phaseMeta.waitOn === "Editor";
              return (
                <li key={v.id}>
                  <Link href={`/videos/${v.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-[var(--color-surface-2)]">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <ClientLogo name={v.clientName} logoUrl={v.clientLogo} color={v.clientColor} size={22} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{v.title}</span>
                        <span className="block truncate text-xs text-[var(--color-ink-muted)]">
                          {v.clientName} · <span style={{ color: phaseMeta.color }} className="font-medium">{phaseMeta.label}</span>
                        </span>
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-0.5">
                      {v.editorDueOn ? (
                        <span className={`text-xs font-semibold ${v.editorOverdue ? "text-[var(--color-bad)]" : needsEditor ? "text-[var(--color-warn)]" : "text-[var(--color-ink-muted)]"}`}>
                          {relativeDays(v.editorDueOn)}
                        </span>
                      ) : null}
                      {needsEditor ? <span className="text-2xs font-medium text-[var(--color-ink-faint)]">jouw actie</span> : null}
                    </span>
                  </Link>
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
            label="Deadline gehaald"
            value={data.stats.onTimeRate !== null ? pct(data.stats.onTimeRate, 0) : "–"}
            hint="doel 95%"
            tone={data.stats.onTimeRate === null ? "neutral" : data.stats.onTimeRate >= 95 ? "good" : "warn"}
            icon={<Clock />}
          />
          <Stat
            label="Interne correcties"
            value={data.stats.internalCorrectionRate !== null ? pct(data.stats.internalCorrectionRate, 0) : "–"}
            hint="doel onder 5%"
            tone={data.stats.internalCorrectionRate === null ? "neutral" : data.stats.internalCorrectionRate < 5 ? "good" : "warn"}
            icon={<AlertTriangle />}
          />
        </div>
      </div>
    </div>
  );
}

