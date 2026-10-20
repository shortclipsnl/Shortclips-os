import Link from "next/link";
import { AlertTriangle, FileText, Film, CheckCircle2, Clock } from "lucide-react";
import { getEditorDashboard } from "@/server/editor-dashboard";
import type { Viewer } from "@/server/auth/context";
import { Card, CardHeader, ClientLogo, EmptyState, Stat } from "@/components/ui";
import { pct, plural, relativeDays } from "@/lib/format";

/**
 * Dashboard voor editors: zo compact mogelijk. Alleen wat ze echt moeten weten —
 * wat komt eraan, hun video's op deadlinevolgorde en hun eigen cijfers. Downloaden
 * en het script openen doen ze op de Editing-pagina.
 */
export async function EditorDashboard({ viewer }: { viewer: Viewer }) {
  const data = await getEditorDashboard(viewer);
  const firstName = viewer.fullName.split(" ")[0];

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

      {/* Jouw video's — compact, op deadlinevolgorde. Alleen klant, titel en
          deadline; downloaden en het script openen doe je op de Editing-pagina. */}
      <Card padded={false}>
        <div className="p-5 pb-3">
          <CardHeader
            title="Jouw video's"
            subtitle="Op volgorde van deadline. Klik een video aan voor de download en het script."
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
              const overdue = v.dueOn && v.dueOn < new Date().toISOString().slice(0, 10);
              return (
                <li key={v.id}>
                  <Link href={`/videos/${v.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-[var(--color-surface-2)]">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <ClientLogo name={v.clientName} logoUrl={v.clientLogo} color={v.clientColor} size={22} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{v.title}</span>
                        <span className="block truncate text-xs text-[var(--color-ink-muted)]">{v.clientName}</span>
                      </span>
                    </span>
                    {v.dueOn ? (
                      <span className={`shrink-0 text-xs font-semibold ${overdue ? "text-[var(--color-bad)]" : "text-[var(--color-ink-muted)]"}`}>
                        {relativeDays(v.dueOn)}
                      </span>
                    ) : null}
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

