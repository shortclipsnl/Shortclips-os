import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AlertTriangle, Download } from "lucide-react";
import { Card, CardHeader, EmptyState, LinkButton, PageHeader, Table } from "@/components/ui";
import { requireInternal, canManageClients } from "@/server/auth/context";
import { getEmergencySnapshot } from "@/server/emergency";

export const metadata: Metadata = { title: "Noodprocedure" };
export const dynamic = "force-dynamic";

function fmtDate(d: string) {
  try { return new Date(d + "T00:00:00").toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "long" }); }
  catch { return d; }
}

export default async function NoodprocedurePage() {
  const viewer = await requireInternal();
  if (!canManageClients(viewer)) notFound();
  const snap = await getEmergencySnapshot();

  return (
    <div className="mx-auto max-w-[1000px]">
      <PageHeader
        title="Noodprocedure"
        description="Kritieke operationele informatie om door te werken als het portaal tijdelijk uitvalt: komende opnames, lopende deadlines, verantwoordelijken en directe links naar bestanden."
        actions={
          <LinkButton href="/api/noodprocedure/pdf" variant="primary">
            <Download className="size-4" /> Download als PDF
          </LinkButton>
        }
      />

      {/* Noodinstructies */}
      <Card className="mb-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-warn-soft)] text-[var(--color-warn)]">
            <AlertTriangle className="size-4" />
          </span>
          <div className="text-sm leading-relaxed">
            <h2 className="mb-1 text-base font-bold text-[var(--color-ink)]">Wat te doen als het portaal uitvalt</h2>
            <ol className="list-decimal space-y-1 pl-5 text-[var(--color-ink-muted)]">
              <li><strong className="text-[var(--color-ink)]">Werk verder met dit overzicht</strong> (of de PDF): komende opnames, deadlines, verantwoordelijken en bestandslinks staan hieronder.</li>
              <li><strong className="text-[var(--color-ink)]">Bestanden</strong> staan in Google Drive en Frame.io — bereikbaar via de links hieronder, los van het portaal.</li>
              <li><strong className="text-[var(--color-ink)]">Stem onderling af</strong> via de telefoonnummers/e-mailadressen in de teamlijst; de coördinator per klant bewaakt de voortgang.</li>
              <li><strong className="text-[var(--color-ink)]">Gegevensherstel:</strong> er draait elke nacht een database-back-up naar Google Drive plus een losse versleutelde back-up via GitHub Actions. Bij dataverlies: neem contact op met de eigenaar.</li>
              <li>Deze noodexport wordt <strong className="text-[var(--color-ink)]">elke nacht automatisch als PDF in Google Drive gezet</strong>, zodat er altijd een recente versie beschikbaar is — ook als de app niet bereikbaar is.</li>
            </ol>
          </div>
        </div>
      </Card>

      {/* Komende opnames */}
      <Card padded={false} className="mb-5">
        <CardHeader title="Komende opnames (3 weken)" className="p-5 pb-2" />
        {snap.shoots.length === 0 ? (
          <EmptyState title="Geen opnames gepland" description="Er staan geen opnames in de komende drie weken." />
        ) : (
          <Table head={<><th className="sc-th">Wanneer</th><th className="sc-th">Klant / opname</th><th className="sc-th">Locatie</th><th className="sc-th">Verantwoordelijk</th><th className="sc-th">Bestanden</th></>}>
            {snap.shoots.map((s, i) => (
              <tr key={i}>
                <td className="sc-td"><span className="font-semibold">{fmtDate(s.date)}</span>{s.time ? <span className="block text-2xs text-[var(--color-ink-faint)]">{String(s.time).slice(0, 5)}</span> : null}</td>
                <td className="sc-td">{s.client ?? "—"}<span className="block text-2xs text-[var(--color-ink-faint)]">{s.title}</span></td>
                <td className="sc-td text-[var(--color-ink-muted)]">{s.location ?? "—"}</td>
                <td className="sc-td">{s.videographer ?? "—"}<span className="block text-2xs text-[var(--color-ink-faint)]">co: {s.coordinator ?? "—"}</span></td>
                <td className="sc-td">{s.driveUrl ? <a href={s.driveUrl} target="_blank" rel="noopener" className="text-[var(--color-brand-700)] hover:underline">Drive-map</a> : <span className="text-[var(--color-ink-faint)]">—</span>}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* Per klant */}
      <h2 className="mb-2 text-sm font-bold tracking-tight text-[var(--color-ink)]">Per klant — verantwoordelijken, deadlines &amp; bestanden</h2>
      <div className="mb-5 space-y-3">
        {snap.clients.length === 0 ? (
          <Card><EmptyState title="Geen actieve klanten" description="" /></Card>
        ) : snap.clients.map((c) => (
          <Card key={c.slug} padded={false}>
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--color-line)] p-4 pb-2.5">
              <span className="text-sm font-bold text-[var(--color-ink)]">{c.name}</span>
              <span className="text-xs text-[var(--color-ink-muted)]">
                Coördinator: <strong className="text-[var(--color-ink)]">{c.coordinator ?? "—"}</strong> · Videograaf: <strong className="text-[var(--color-ink)]">{c.videographer ?? "—"}</strong>
                {c.nextShoot ? <> · Volgende opname: <strong className="text-[var(--color-ink)]">{fmtDate(c.nextShoot.date)}</strong>{c.nextShoot.location ? ` (${c.nextShoot.location})` : ""}</> : null}
              </span>
            </div>
            {c.deliverables.length === 0 ? (
              <p className="px-4 py-3 text-xs text-[var(--color-ink-faint)]">Geen lopende opleveringen.</p>
            ) : (
              <Table head={<><th className="sc-th">Video</th><th className="sc-th">Status</th><th className="sc-th">Deadline</th><th className="sc-th">Editor</th><th className="sc-th">Bestanden</th></>}>
                {c.deliverables.map((d, i) => (
                  <tr key={i}>
                    <td className="sc-td">{d.title}</td>
                    <td className="sc-td text-[var(--color-ink-muted)]">{d.statusLabel}</td>
                    <td className="sc-td">{d.dueOn ? fmtDate(d.dueOn) : <span className="text-[var(--color-ink-faint)]">—</span>}</td>
                    <td className="sc-td">{d.editor ?? "—"}</td>
                    <td className="sc-td text-xs">
                      {d.links.length ? d.links.map((l, j) => (
                        <span key={j}>{j > 0 ? " · " : ""}<a href={l.url} target="_blank" rel="noopener" className="text-[var(--color-brand-700)] hover:underline">{l.label}</a></span>
                      )) : <span className="text-[var(--color-ink-faint)]">—</span>}
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        ))}
      </div>

      {/* Team */}
      <Card padded={false}>
        <CardHeader title="Team — contactgegevens" className="p-5 pb-2" />
        <Table head={<><th className="sc-th">Naam</th><th className="sc-th">Rol</th><th className="sc-th">Telefoon</th><th className="sc-th">E-mail</th></>}>
          {snap.team.map((t, i) => (
            <tr key={i}>
              <td className="sc-td font-medium">{t.fullName}</td>
              <td className="sc-td text-[var(--color-ink-muted)]">{t.roleLabel}</td>
              <td className="sc-td tabular-nums">{t.phone ?? "—"}</td>
              <td className="sc-td text-[var(--color-ink-muted)]">{t.email}</td>
            </tr>
          ))}
        </Table>
      </Card>

      <p className="mt-4 text-xs text-[var(--color-ink-muted)]">
        Dit overzicht is een momentopname uit de eigen database. De PDF-versie wordt elke nacht automatisch in Google Drive bewaard zodat hij ook bij uitval van het portaal beschikbaar is.
      </p>
    </div>
  );
}
