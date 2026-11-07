import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal, isOwner, canManageOperations, viewerForUser } from "@/server/auth/context";
import { portalAccessReport } from "@/server/jobs/portal-access";
import { getDashboard } from "@/server/dashboard";
import { listUpcomingMeetings } from "@/server/meetings";
import { listCalendar } from "@/server/calendar";
import { activeClientsMissingCoordinator } from "@/server/clients";
import { periodLabel } from "@/lib/format";
import { Compass } from "lucide-react";
import { GuidelineNote, LinkButton, TeamAvatar } from "@/components/ui";
import { EditorDashboard } from "./editor-view";
import { WeekPlanning, type WeekUpload } from "./week-planning";
import { PostingReminder, type TodayPost } from "./posting-reminder";
import { getWorkOverview } from "@/server/werkoverzicht";
import { listAttentionTeam } from "@/server/attention";
import { syncScriptingTasksIfStale } from "@/server/scripting-tasks";
import { Dagstart } from "./dagstart";

export const metadata: Metadata = { title: "Vandaag" };
export const dynamic = "force-dynamic";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ persoon?: string }> }) {
  const viewer = await requireInternal();
  const persoonParam = (await searchParams).persoon;

  // Editors krijgen een eigen, smaller dashboard met uitsluitend hun werk.
  if (viewer.isEditorOnly) return <EditorDashboard viewer={viewer} />;

  // Venster voor de weekplanning (dekt ook het weekend → kómende werkweek).
  const contentFrom = new Date().toISOString().slice(0, 10);
  const contentToD = new Date();
  contentToD.setDate(contentToD.getDate() + 14);
  const contentTo = contentToD.toISOString().slice(0, 10);

  // Scriptingtaken bijwerken vóór de dagstart (anders verschijnen ze pas na een
  // bezoek aan de Takenpagina).
  await syncScriptingTasksIfStale().catch(() => undefined);

  // Eigenaar en operationeel beheer kunnen de dagstart van een collega bekijken.
  const canViewOthers = canManageOperations(viewer);
  const target = canViewOthers && persoonParam && persoonParam !== viewer.id ? await viewerForUser(persoonParam) : null;
  const subject = target ?? viewer;

  const [data, meetings, contentItems, work, team] = await Promise.all([
    getDashboard(viewer),
    listUpcomingMeetings(7),
    listCalendar(viewer, { from: contentFrom, to: contentTo }),
    getWorkOverview(subject, { trusted: Boolean(target) }),
    canViewOthers ? listAttentionTeam() : Promise.resolve([]),
  ]);
  const missingCoord = isOwner(viewer) ? await activeClientsMissingCoordinator() : { count: 0, names: [] };
  // Operationeel beheer (eigenaar + operationeel beheerder): snelkoppelingen +
  // aandachtspunt "klanten zonder portaallogin".
  const showOps = canManageOperations(viewer);
  const opsMissingPortal = showOps ? (await portalAccessReport()).missingPortal.length : 0;

  // Opnames binnen de komende 7 dagen voor de weekplanning.
  const weekEnd = new Date();
  weekEnd.setDate(weekEnd.getDate() + 7);
  const weekShoots = data.shoots.filter((s) => new Date(s.scheduledOn) <= weekEnd);

  // Content die deze/komende week gepost wordt — als "uploads" per dag.
  const uploads: WeekUpload[] = contentItems.map((c) => ({
    id: c.id,
    scheduledOn: c.scheduledOn,
    scheduledAt: c.scheduledAt,
    title: c.title,
    clientName: c.clientName,
    clientSlug: c.clientSlug,
    clientColor: c.clientColor,
    clientLogo: null,
  }));

  // Posts die vandaag online moeten (nog niet gepubliceerd) — voor de
  // dagelijkse postherinnering rechtsonder.
  const todaysPosts: TodayPost[] = contentItems
    .filter((c) => c.scheduledOn === contentFrom && c.status !== "published")
    .map((c) => ({ id: c.id, title: c.title, clientName: c.clientName, at: c.scheduledAt }));

  const firstName = viewer.fullName.split(" ")[0];
  const hour = Number(new Date().toLocaleString("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: "Europe/Amsterdam" }));
  const greeting = hour < 6 ? "Goedenacht" : hour < 12 ? "Goedemorgen" : hour < 18 ? "Goedemiddag" : "Goedenavond";

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      {/* Kop */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* Eigen profielfoto links van de begroeting — zo is direct duidelijk
              dat je op je eigen pagina zit. */}
          <TeamAvatar name={viewer.fullName} avatarUrl={viewer.avatarUrl} size={48} />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              {greeting}, {firstName}
            </h1>
            <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
              {periodLabel(data.period)} · {data.clients.active} actieve klanten · {data.videos.open} video&apos;s in productie
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <LinkButton href="/videos" variant="secondary" size="sm">
            Video pipeline
          </LinkButton>
          <LinkButton href="/clients" size="sm">
            Klanten
          </LinkButton>
        </div>
      </div>

      {/* Blokkerend: actieve klanten zonder verantwoordelijke (alleen eigenaar). */}
      {missingCoord.count > 0 ? (
        <Link href="/clients" className="block rounded-[var(--radius-lg)] border border-[var(--color-bad)]/30 bg-[var(--color-bad-soft)] px-4 py-3 text-sm hover:brightness-[0.99]">
          <strong className="font-semibold text-[#a3271c]">
            {missingCoord.count} actieve klant{missingCoord.count === 1 ? "" : "en"} zonder verantwoordelijke.
          </strong>{" "}
          <span className="text-[var(--color-ink-muted)]">
            Wijs een Content Creative toe — {missingCoord.names.slice(0, 6).join(", ")}
            {missingCoord.names.length > 6 ? "…" : ""}.
          </span>
        </Link>
      ) : null}

      {/* Operationeel aandachtspunt (eigenaar + operationeel beheerder). Het
          klantbeheer zelf staat in het menu onder Beheer. */}
      {showOps && opsMissingPortal > 0 ? (
        <Link href="/klantenbeheer?tab=portalen" className="block rounded-[var(--radius-lg)] border border-[var(--color-warn)]/30 bg-[var(--color-surface)] px-4 py-3 text-sm hover:brightness-[0.99]">
          <strong className="font-semibold text-[var(--color-warn)]">
            {opsMissingPortal} actieve klant{opsMissingPortal === 1 ? "" : "en"} zonder portaallogin.
          </strong>{" "}
          <span className="text-[var(--color-ink-muted)]">Maak de logins aan in Klantbeheer →</span>
        </Link>
      ) : null}

      {/* Bekijk als: eigenaar/operationeel beheer ziet de dagstart van elk kernteamlid. */}
      {canViewOthers && team.length ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-[var(--color-ink-muted)]">Dagstart van:</span>
          {team.map((m) => {
            const active = m.id === subject.id;
            return (
              <Link
                key={m.id}
                href={m.id === viewer.id ? "/dashboard" : `/dashboard?persoon=${m.id}`}
                className={`rounded-full border px-3 py-1 ${active ? "border-[var(--color-indigo-ink)] bg-[var(--color-indigo-ink)] text-white" : "border-[var(--color-line)] hover:bg-[var(--color-surface-muted,#f4f5f8)]"}`}
              >
                {m.name}{m.id === viewer.id ? " (jij)" : ""}
              </Link>
            );
          })}
        </div>
      ) : null}

      {/* Dagstart: vandaag en deze week, per soort werk. Eén bron voor alles. */}
      <Dagstart
        personName={work.person.fullName}
        isSelf={subject.id === viewer.id}
        refDay={work.refDay}
        isWeekend={work.isWeekend}
        weekEnd={work.weekEnd}
        today={work.today}
        week={work.week}
        undated={work.undated}
        waiting={work.waiting}
        laterCount={work.laterCount}
        counts={work.counts}
      />

      {/* Weekplanning: opnames en meetings die eraan komen. */}
      <WeekPlanning shoots={weekShoots} meetings={meetings} uploads={uploads} />

      {/* Korte werkrichtlijn: zelfstandigheid, eigenaarschap en eerst zelf
          oplossen. Compact en standaard dicht — één klik open. */}
      <GuidelineNote
        title="Zo werken we — zelfstandigheid & eigenaarschap"
        icon={<Compass className="size-4" />}
        tone="good"
        items={[
          <><strong className="font-semibold text-[var(--color-ink)]">Eigenaarschap:</strong> je maakt je werk áf — van start tot oplevering, inclusief de kwaliteit.</>,
          <><strong className="font-semibold text-[var(--color-ink)]">Eerst zelf oplossen:</strong> loop je vast? Zoek eerst zelf een oplossing (kennisbank, eerdere projecten, een collega) voordat je het doorschuift.</>,
          <><strong className="font-semibold text-[var(--color-ink)]">Denk mee:</strong> zie je iets beter kunnen? Pak het op of meld het — wacht niet af.</>,
          <><strong className="font-semibold text-[var(--color-ink)]">Bewaak afspraken:</strong> deadlines, klantafspraken en kwaliteit houd je zelf in de gaten.</>,
        ]}
        footer="Vragen mag altijd — kom waar het kan met een voorstel erbij in plaats van alleen de vraag."
      />

      {/* Dagelijkse postherinnering (rechtsonder, met pingetje om 14:00). */}
      <PostingReminder posts={todaysPosts} />
    </div>
  );
}
