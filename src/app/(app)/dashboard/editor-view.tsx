import Link from "next/link";
import { AlertTriangle, FileText, Film, CheckCircle2, Clock } from "lucide-react";
import { getEditorDashboard } from "@/server/editor-dashboard";
import { listEditorBoard, type EditorBoardVideo } from "@/server/editor-board";
import type { Viewer } from "@/server/auth/context";
import { Card, CardHeader, ClientLogo, EmptyState, Stat, TeamAvatar } from "@/components/ui";
import { pct, plural, relativeDays } from "@/lib/format";
import { isFirstVersionPending } from "@/lib/edit-deadline";
import { EDIT_PHASE_META } from "@/lib/statuses";
import { AvailabilityBox } from "./availability-box";

/** "2026-10" → "oktober 2026". */
function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, 1).toLocaleDateString("nl-NL", { month: "long", year: "numeric" });
}

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

  // Werk dat nu klaarstaat vs. video's die binnenkort beschikbaar komen (nog te
  // plannen / wachten op beeld). Zo kan de editor vooruit plannen.
  const binnenkort = active.filter((v) => v.phase === "te_plannen");
  const jouwVideos = active.filter((v) => v.phase !== "te_plannen");

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

      {/* Warm, persoonlijk welkomstbericht met wat uitleg over het board. */}
      <div className="rounded-[var(--radius-lg)] border border-[var(--color-brand-500)]/25 bg-[var(--color-brand-50)] px-4 py-3 text-sm leading-relaxed text-[var(--color-ink)]">
        Hé {firstName}, fijn dat je onze editor bent! 🎬 Hieronder zie je je video&apos;s met hun opleverdata en interne
        deadlines (de eerste versie, 7 werkdagen na de opname). Kijk ook even bij{" "}
        <strong>Binnenkort beschikbaar</strong> — zo kun je je planning vast afstemmen en weten we zeker dat alles
        realistisch en op tijd wordt opgeleverd.
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

      {/* Jouw video's en Binnenkort beschikbaar naast elkaar: links wat nu
          klaarstaat, rechts wat eraan komt. Zelfde set als de Editing-pagina. */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card padded={false}>
          <div className="p-5 pb-3">
            <CardHeader
              title="Jouw video's"
              subtitle="Op volgorde van je interne deadline (eerste versie, 7 werkdagen na de opname). Klik een video aan voor de download en het script."
            />
          </div>
          {jouwVideos.length === 0 ? (
            <EmptyState
              title="Niets in bewerking"
              description="Zodra een video klaarstaat om te editen, verschijnt die hier."
            />
          ) : (
            <ul className="divide-y divide-[var(--color-line)]">
              {jouwVideos.map((v) => <VideoRow key={v.id} v={v} />)}
            </ul>
          )}
        </Card>

        {/* Binnenkort beschikbaar — nog in te plannen of wachten op beeld. */}
        <Card padded={false}>
          <div className="p-5 pb-3">
            <CardHeader
              title="Binnenkort beschikbaar"
              subtitle="Deze video's komen er binnenkort aan. Houd er vast rekening mee in je planning, zodat alles realistisch en op tijd wordt opgeleverd."
            />
          </div>
          {binnenkort.length === 0 ? (
            <EmptyState title="Niets op de planning" description="Zodra er een nieuwe opname of klus aankomt, zie je die hier." />
          ) : (
            <ul className="divide-y divide-[var(--color-line)]">
              {binnenkort.map((v) => <VideoRow key={v.id} v={v} />)}
            </ul>
          )}
        </Card>
      </div>

      {/* Maandoverzicht van opgeleverde projecten — zodat duidelijk is wat er
          per maand is afgerond. */}
      {data.deliveredByMonth.length > 0 ? (
        <Card padded={false}>
          <div className="p-5 pb-3">
            <CardHeader title="Opgeleverd" subtitle="Je afgeronde projecten per maand." />
          </div>
          <div className="divide-y divide-[var(--color-line)]">
            {data.deliveredByMonth.map((m) => (
              <div key={m.month} className="px-5 py-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold capitalize">{monthLabel(m.month)}</span>
                  <span className="rounded-full bg-[var(--color-good-soft)] px-2.5 py-0.5 text-2xs font-bold text-[#1d6b4c]">{plural(m.count, "video", "video's")} opgeleverd</span>
                </div>
                <ul className="grid gap-1.5">
                  {m.items.map((it) => (
                    <li key={it.id}>
                      <Link href={`/videos/${it.id}`} className="flex items-center gap-2 text-sm hover:underline">
                        <ClientLogo name={it.clientName} logoUrl={it.clientLogo} color={it.clientColor} size={18} />
                        <span className="min-w-0 truncate font-medium">{it.title}</span>
                        <span className="shrink-0 text-xs text-[var(--color-ink-muted)]">{it.clientName}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {/* Beschikbaarheid: zelf aangeven wanneer je niet beschikbaar bent. */}
      <AvailabilityBox note={data.availabilityNote} />

      {/* Contactpersonen bij ShortClips — Milou links, Jiska rechts. Allebei via
          WhatsApp bereikbaar (of via de WhatsApp-groep). Met vaste vrije dag,
          zodat de editor weet met wie hij op welke dag rekening moet houden. */}
      {data.contacts.length > 0 ? (
        <Card>
          <CardHeader
            title="Jouw contactpersonen bij ShortClips"
            subtitle="Vragen over een video of je planning? Bereik Milou of Jiska via WhatsApp — of stel je vraag in de WhatsApp-groep. Houd rekening met wie wanneer vrij is."
          />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {data.contacts.map((c) => {
              const digits = (c.phone ?? "").replace(/[^\d]/g, "");
              return (
                <div key={c.id} className="flex items-center gap-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] p-3">
                  <TeamAvatar name={c.fullName} avatarUrl={c.avatarUrl} size={44} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{c.fullName}</div>
                    <div className="text-xs text-[var(--color-ink-muted)]">Projectcoördinator</div>
                    {c.offDay ? (
                      <div className="mt-0.5 text-2xs font-medium text-[var(--color-warn)]">Werkt niet op {c.offDay}</div>
                    ) : null}
                    {c.phone ? (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {digits ? (
                          <a href={`https://wa.me/${digits}`} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center rounded-full bg-[var(--color-good-soft)] px-2.5 py-1 text-2xs font-semibold text-[#1d6b4c] hover:brightness-95">
                            WhatsApp
                          </a>
                        ) : null}
                        <a href={`tel:${c.phone.replace(/\s/g, "")}`}
                          className="inline-flex items-center rounded-full bg-[var(--color-surface)] px-2.5 py-1 text-2xs font-semibold text-[var(--color-ink)] ring-1 ring-[var(--color-line)] hover:brightness-95">
                          {c.phone}
                        </a>
                      </div>
                    ) : (
                      <div className="mt-1 text-2xs text-[var(--color-ink-muted)]">Telefoonnummer nog niet bekend</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

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

/** Eén video-regel op het editor-dashboard: klant, titel, fase en de interne
 *  deadline. Gedeeld door "Jouw video's" en "Binnenkort beschikbaar". */
function VideoRow({ v }: { v: EditorBoardVideo }) {
  const phaseMeta = EDIT_PHASE_META[v.phase];
  const needsEditor = phaseMeta.waitOn === "Editor";
  return (
    <li>
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
}

