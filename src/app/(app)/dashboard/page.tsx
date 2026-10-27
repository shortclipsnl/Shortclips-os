import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal, isOwner } from "@/server/auth/context";
import { getDashboard } from "@/server/dashboard";
import { getMyDay } from "@/server/my-day";
import { listUpcomingMeetings } from "@/server/meetings";
import { listCalendar } from "@/server/calendar";
import { activeClientsMissingCoordinator } from "@/server/clients";
import { editorCapacityMap } from "@/server/metrics";
import { periodLabel } from "@/lib/format";
import { Compass } from "lucide-react";
import { GuidelineNote, LinkButton, TeamAvatar } from "@/components/ui";
import { EditorDashboard } from "./editor-view";
import { TodayView } from "./today-view";
import { WeekPlanning, type WeekUpload } from "./week-planning";
import { PostingReminder, type TodayPost } from "./posting-reminder";
import { getMorningOverview } from "@/server/morning-overview";
import { MorningOverviewCard } from "./morning-overview";

export const metadata: Metadata = { title: "Vandaag" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const viewer = await requireInternal();

  // Editors krijgen een eigen, smaller dashboard met uitsluitend hun werk.
  if (viewer.isEditorOnly) return <EditorDashboard viewer={viewer} />;

  // Venster voor de weekplanning (dekt ook het weekend → kómende werkweek).
  const contentFrom = new Date().toISOString().slice(0, 10);
  const contentToD = new Date();
  contentToD.setDate(contentToD.getDate() + 14);
  const contentTo = contentToD.toISOString().slice(0, 10);

  const [data, myDay, capMap, meetings, contentItems, morning] = await Promise.all([
    getDashboard(viewer),
    getMyDay(viewer),
    editorCapacityMap(),
    listUpcomingMeetings(7),
    listCalendar(viewer, { from: contentFrom, to: contentTo }),
    getMorningOverview(viewer),
  ]);
  const missingCoord = isOwner(viewer) ? await activeClientsMissingCoordinator() : { count: 0, names: [] };

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
  const hour = new Date().getHours();
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

      {/* Gebundeld ochtendoverzicht: verlopen deadlines, acties en aandachtspunten. */}
      <MorningOverviewCard data={morning} />

      {/* Rol-gericht: maximaal drie blokken met concrete acties. */}
      <TodayView viewer={viewer} data={data} myDay={myDay} capMap={capMap} />

      {/* Weekplanning: opnames en meetings die eraan komen. */}
      <WeekPlanning shoots={weekShoots} meetings={meetings} uploads={uploads} />

      {/* Dagelijkse postherinnering (rechtsonder, met pingetje om 14:00). */}
      <PostingReminder posts={todaysPosts} />
    </div>
  );
}
