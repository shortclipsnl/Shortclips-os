import type { Metadata } from "next";
import Link from "next/link";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { contentCalendar } from "@/db/schema";
import { requireInternal } from "@/server/auth/context";
import { syncCalendarIfStale } from "@/server/jobs/calendar-sync";
import { listCalendar, monthGrid, type CalendarItem } from "@/server/calendar";
import { listClients } from "@/server/clients";
import { SharePlanningButton } from "./share-planning";
import { Badge, Card, ClientLogo, EmptyState, PageHeader } from "@/components/ui";
import { formatDateFull, periodLabel } from "@/lib/format";
import { PLATFORM, PUBLICATION_STATUS } from "@/lib/statuses";
import { cn } from "@/lib/cn";
import { Planner } from "./planner";
import { CalDateCell, CalStatusCell } from "./calendar-cells";
import { ContentChip, CaptionToggle } from "./content-items";
import { CalendarClientFilter } from "./client-filter";

export const metadata: Metadata = { title: "Contentplanning" };
export const dynamic = "force-dynamic";

const WEEKDAYS = ["ma", "di", "wo", "do", "vr", "za", "zo"];

// Of Shortclips voor een klant post, is nu een instelbare vlag per klant
// (clients.weHandlePosting), niet langer een hardcoded lijst. Klanten die zelf
// posten horen niet in de contentplanning en krijgen geen inplannen/publiceren-
// signalen bij Kwaliteit & Aandachtspunten.
const postsContent = (x?: { weHandlePosting?: boolean } | null) => !x || x.weHandlePosting !== false;

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{
    maand?: string;
    klant?: string;
    status?: string;
    platform?: string;
    weergave?: string;
  }>;
}) {
  const viewer = await requireInternal();
  // Google Agenda op de achtergrond verversen als de laatste sync >1u geleden is.
  await syncCalendarIfStale();
  const canWriteCal = viewer.permissions.has("calendar:write");
  const params = await searchParams;

  const now = new Date();
  const period = params.maand ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [year, month] = period.split("-").map(Number);

  const weeks = monthGrid(year!, month!);
  const from = weeks[0]![0]!;
  const to = weeks[weeks.length - 1]![6]!;

  // De huidige week (ma–zo) — altijd de échte week van vandaag, los van welke
  // maand je bekijkt. In UTC, net als de rest van de datums op deze pagina.
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = (base.getUTCDay() + 6) % 7; // 0 = maandag
  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate() - dow + i);
    return d.toISOString().slice(0, 10);
  });
  const weekSet = new Set(weekDates);

  const [rawItems, rawClientList, rawWeekItems] = await Promise.all([
    listCalendar(viewer, {
      from,
      to,
      clientSlug: params.klant,
      status: params.status,
      platform: params.platform,
    }),
    listClients(viewer),
    listCalendar(viewer, {
      from: weekDates[0]!,
      to: weekDates[6]!,
      clientSlug: params.klant,
      status: params.status,
      platform: params.platform,
    }),
  ]);
  // Klanten waar we niet voor posten eruit filteren.
  const items = rawItems.filter((i) => postsContent(i));
  const clientList = rawClientList.filter((c) => postsContent(c));
  // Klanten die zelf posten — ter verduidelijking op de planning (ze staan er
  // bewust niet in; instelbaar per klant op de klantpagina).
  const selfPostingClients = rawClientList
    .filter((c) => c.weHandlePosting === false && c.status === "active")
    .map((c) => c.name);
  const weekItems = rawWeekItems.filter((i) => postsContent(i));
  const weekByDay = new Map<string, CalendarItem[]>();
  for (const item of weekItems) {
    const list = weekByDay.get(item.scheduledOn) ?? [];
    list.push(item);
    weekByDay.set(item.scheduledOn, list);
  }

  // Alle klanten waarvoor we posten als filter — op naam gesorteerd, zodat er
  // nooit klanten ontbreken (niet langer een handmatige lijst).
  const chipClients = clientList
    .filter((c) => c.status === "active")
    .sort((a, b) => a.name.localeCompare(b.name, "nl"));

  const canWrite = viewer.permissions.has("calendar:write");

  // Geselecteerde klant → "Goedkeuren en delen met klant": tel de nog niet
  // gedeelde conceptitems, zodat de medewerker de planning kan vrijgeven.
  const selectedClient = params.klant ? clientList.find((c) => c.slug === params.klant) ?? null : null;
  let unsharedCount = 0;
  if (selectedClient && canWrite) {
    const [row] = await db
      .select({ n: sql<number>`count(*)` })
      .from(contentCalendar)
      .where(and(eq(contentCalendar.clientId, selectedClient.id), isNull(contentCalendar.deletedAt), eq(contentCalendar.clientApproved, false), inArray(contentCalendar.status, ["ready", "scheduled"])));
    unsharedCount = Number(row?.n ?? 0);
  }

  const asPlanner = params.weergave === "planner";
  const plannerTo = new Date();
  plannerTo.setDate(plannerTo.getDate() + 120);
  const plannerItems = (asPlanner
    ? await listCalendar(viewer, {
        from: new Date().toISOString().slice(0, 10),
        to: plannerTo.toISOString().slice(0, 10),
        clientSlug: params.klant,
      })
    : []
  ).filter((i) => postsContent(i));

  const byDay = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const list = byDay.get(item.scheduledOn) ?? [];
    list.push(item);
    byDay.set(item.scheduledOn, list);
  }

  const prev = new Date(Date.UTC(year!, month! - 2, 1));
  const next = new Date(Date.UTC(year!, month!, 1));
  const fmt = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

  function withParam(key: string, value?: string) {
    const qs = new URLSearchParams();
    if (params.maand) qs.set("maand", params.maand);
    if (params.klant) qs.set("klant", params.klant);
    if (params.status) qs.set("status", params.status);
    if (params.platform) qs.set("platform", params.platform);
    if (params.weergave) qs.set("weergave", params.weergave);
    if (value) qs.set(key, value);
    else qs.delete(key);
    return qs.toString() ? `/calendar?${qs}` : "/calendar";
  }

  const today = new Date().toISOString().slice(0, 10);
  const asList = params.weergave === "lijst";

  // CalendarItem → het lichte item dat ContentChip verwacht.
  const toChipItem = (i: CalendarItem) => ({
    id: i.id,
    title: i.title,
    caption: i.caption,
    clientName: i.clientName,
    clientSlug: i.clientSlug,
    clientLogo: i.clientLogo,
    clientColor: i.clientColor,
    scheduledOn: i.scheduledOn,
    scheduledAt: i.scheduledAt,
    contentType: i.contentType,
    platforms: (i.platforms as string[]) ?? [],
    deliverableId: i.deliverableId,
  });

  const dLabel = (d: string) => {
    const [y, m, day] = d.split("-").map(Number);
    return new Date(y!, (m ?? 1) - 1, day).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
  };
  const weekRange = `${dLabel(weekDates[0]!)} – ${dLabel(weekDates[6]!)}`;

  // Scheidingsbalk onder "Deze week": maakt duidelijk dat de rest van de
  // planning over de weken die nog komen gaat. Extra ruimte boven de balk.
  const aankomendeBar = (
    <div className="mt-8 mb-2 flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] bg-[var(--color-indigo-ink)] px-4 py-2.5 text-white">
      <span className="text-sm font-bold tracking-tight">Aankomende weken</span>
      <span className="text-xs text-white/80">
        {periodLabel(period)} · {items.length} {items.length === 1 ? "item" : "items"}
      </span>
    </div>
  );

  return (
    <div className="mx-auto max-w-[1500px]">
      <PageHeader
        title="Contentplanning"
        description={`${items.length} items in ${periodLabel(period)}`}
        actions={
          <div className="flex items-center gap-2">
            {canWrite ? (
              <Link href="/calendar/plannen" className="rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--color-indigo-soft)]">
                Automatisch plannen
              </Link>
            ) : null}
            <Link href={withParam("maand", fmt(prev))} className="sc-card px-3 py-1.5 text-sm hover:bg-[var(--color-surface-sunken)]">
              ←
            </Link>
            <Link href={withParam("maand", fmt(next))} className="sc-card px-3 py-1.5 text-sm hover:bg-[var(--color-surface-sunken)]">
              →
            </Link>
            <Link
              href={withParam("weergave", asList ? undefined : "lijst")}
              className="sc-card px-3 py-1.5 text-sm hover:bg-[var(--color-surface-sunken)]"
            >
              {asList ? "Kalender" : "Lijst"}
            </Link>
            {canWrite ? (
              <Link
                href={withParam("weergave", asPlanner ? undefined : "planner")}
                className={cn(
                  "px-3 py-1.5 text-sm",
                  asPlanner
                    ? "rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] font-medium text-white"
                    : "sc-card hover:bg-[var(--color-surface-sunken)]",
                )}
              >
                Planner bewerken
              </Link>
            ) : null}
          </div>
        }
      />

      {/* Klanten die zelf posten: staan bewust niet in de planning. Instelbaar
          per klant op de klantpagina (Content plaatsen). */}
      {selfPostingClients.length > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 text-xs text-[var(--color-ink-muted)]">
          <span className="rounded-full bg-[var(--color-warn-soft)] px-2 py-0.5 font-semibold text-[#8a5300]">Klant plaatst zelf</span>
          <span>Niet in de planning (wij posten hier niet): {selfPostingClients.join(", ")}.</span>
        </div>
      ) : null}

      {/* Filters — klant achter een knop (standaard ingeklapt → overzichtelijk),
          platforms eronder met een label. */}
      <CalendarClientFilter
        allHref={withParam("klant", undefined)}
        allActive={!params.klant}
        clients={chipClients.map((c) => ({ slug: c.slug, name: c.name, logoUrl: c.logoUrl, color: c.color, href: withParam("klant", c.slug), active: params.klant === c.slug }))}
        selected={(() => {
          const c = chipClients.find((x) => x.slug === params.klant);
          return c ? { slug: c.slug, name: c.name, logoUrl: c.logoUrl, color: c.color, href: withParam("klant", c.slug), active: true } : null;
        })()}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="mr-1 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Filter per platform</span>
        <Link href={withParam("platform", undefined)} className={chip(!params.platform)}>Alle platformen</Link>
        {Object.entries(PLATFORM).map(([key, p]) => (
          <Link key={key} href={withParam("platform", params.platform === key ? undefined : key)} className={chip(params.platform === key)}>
            <span className="mr-1.5 inline-block size-2 rounded-full align-middle" style={{ background: p.color }} />
            {p.label}
          </Link>
        ))}
      </div>

      {/* Goedkeuren en delen met de klant (alleen als er één klant gefilterd is). */}
      {selectedClient && canWrite ? (
        <SharePlanningButton clientId={selectedClient.id} clientName={selectedClient.name} unshared={unsharedCount} />
      ) : null}

      {/* Vaste postmomenten. */}
      <div className="mb-4 inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--color-info-soft)]/60 px-3 py-1.5 text-xs text-[var(--color-ink)]">
        <span className="size-2 rounded-full bg-[var(--color-info)]" />
        We posten dagelijks tussen <strong>14:30 en 17:00 uur</strong>.
      </div>

      {/* Deze week — altijd bovenaan en groen gemarkeerd, zodat je in één
          oogopslag ziet wat er deze week de deur uit moet. */}
      {!asPlanner ? (
        <section className="mb-6">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] bg-[var(--color-good)] px-4 py-2.5 text-white">
            <span className="text-sm font-bold tracking-tight">Deze week</span>
            <span className="text-xs text-white/85">{weekRange} · {weekItems.length} {weekItems.length === 1 ? "item" : "items"}</span>
          </div>
          <Card padded={false} className="overflow-hidden ring-1 ring-[var(--color-good)]/30">
            <div className="grid grid-cols-7">
              {weekDates.map((date, i) => {
                const dayItems = weekByDay.get(date) ?? [];
                const isToday = date === today;
                return (
                  <div
                    key={date}
                    className={cn(
                      "min-h-24 border-r border-b border-[var(--color-line)] p-1.5 last:border-r-0",
                      isToday ? "bg-[var(--color-good-soft)]/50" : "bg-[var(--color-good-soft)]/15",
                    )}
                  >
                    <div className="mb-1 flex items-center justify-between px-1">
                      <span className={cn("text-2xs font-semibold uppercase tracking-wide", isToday ? "text-[var(--color-good)]" : "text-[var(--color-ink-faint)]")}>
                        {WEEKDAYS[i]} {Number(date.slice(8, 10))}
                        {isToday ? <span className="ml-1 rounded bg-[var(--color-good)] px-1 py-px text-[9px] font-bold text-white">vandaag</span> : null}
                      </span>
                      {dayItems.length > 0 ? <span className="text-2xs text-[var(--color-ink-faint)]">{dayItems.length}</span> : null}
                    </div>
                    {/* Alle posts van die dag onder elkaar — niets wegvouwen,
                        zodat je in één oogopslag ziet wat er écht online moet. */}
                    <div className="space-y-1">
                      {dayItems.map((it) => (
                        <ContentChip key={it.id} color={it.clientColor ?? "var(--color-brand-500)"} item={toChipItem(it)} today={isToday} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </section>
      ) : null}

      {asPlanner ? (
        <Planner
          items={plannerItems.map((i) => ({
            id: i.id,
            title: i.title,
            scheduledOn: i.scheduledOn,
            status: i.status,
            platforms: (i.platforms as string[]) ?? [],
            clientName: i.clientName,
            clientColor: i.clientColor,
          }))}
          clients={clientList
            .filter((c) => c.status === "active")
            .map((c) => ({ id: c.id, name: c.name }))}
        />
      ) : asList ? (
        <>
        {aankomendeBar}
        <Card padded={false}>
          {items.length === 0 ? (
            <EmptyState title="Niets gepland in deze periode" />
          ) : (
            <ul className="divide-y divide-[var(--color-line)]">
              {items.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-5 py-3">
                  <span className="w-32 shrink-0">
                    {canWriteCal ? (
                      <CalDateCell id={i.id} scheduledOn={i.scheduledOn} />
                    ) : (
                      <span className="text-sm text-[var(--color-ink-muted)]">{formatDateFull(i.scheduledOn)}</span>
                    )}
                  </span>
                  <ClientLogo name={i.clientName} logoUrl={i.clientLogo} color={i.clientColor} size={26} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{i.title}</span>
                    <span className="block truncate text-xs text-[var(--color-ink-muted)]">
                      {i.clientName}
                      {i.scheduledAt ? ` · ${i.scheduledAt.slice(0, 5)}` : ""}
                      {i.contentType ? ` · ${i.contentType}` : ""}
                    </span>
                  </span>
                  <span className="flex gap-1">
                    {(i.platforms as string[]).map((p) => (
                      <span key={p} title={PLATFORM[p]?.label} className="size-2 rounded-full" style={{ background: PLATFORM[p]?.color ?? "#999" }} />
                    ))}
                  </span>
                  <CaptionToggle
                    item={{
                      id: i.id,
                      title: i.title,
                      caption: i.caption,
                      clientName: i.clientName,
                      clientSlug: i.clientSlug,
                      clientLogo: i.clientLogo,
                      clientColor: i.clientColor,
                      scheduledOn: i.scheduledOn,
                      scheduledAt: i.scheduledAt,
                      contentType: i.contentType,
                      platforms: (i.platforms as string[]) ?? [],
                      deliverableId: i.deliverableId,
                    }}
                  />
                  {canWriteCal ? (
                    <CalStatusCell id={i.id} status={i.status} />
                  ) : (
                    <Badge tone={PUBLICATION_STATUS[i.status]?.tone ?? "neutral"}>
                      {PUBLICATION_STATUS[i.status]?.label ?? i.status}
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
        </>
      ) : (
        <>
        {aankomendeBar}
        {items.length === 0 ? (
          <div className="mb-3 rounded-[var(--radius-md)] border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface-sunken)]/50 px-4 py-3 text-sm text-[var(--color-ink-muted)]">
            Niets gepland in deze maand. Plan content in via{" "}
            <Link href="/calendar/plannen" className="font-medium text-[var(--color-brand-600)] hover:underline">
              Contentplanning plannen
            </Link>
            .
          </div>
        ) : null}
        <Card padded={false} className="overflow-hidden">
          <div className="grid grid-cols-7 border-b border-[var(--color-line)] bg-[var(--color-surface-sunken)]">
            {WEEKDAYS.map((d) => (
              <div key={d} className="px-3 py-2 text-2xs font-semibold tracking-wide text-[var(--color-ink-faint)] uppercase">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {weeks.flat().map((date) => {
              const inMonth = Number(date.slice(5, 7)) === month;
              const inThisWeek = weekSet.has(date);
              const dayItems = byDay.get(date) ?? [];
              // Achtergrond met duidelijke voorrang: vandaag > deze week > buiten maand.
              const bg = date === today
                ? "bg-[var(--color-good-soft)]/55"
                : inThisWeek
                  ? "bg-[var(--color-good-soft)]/20"
                  : !inMonth
                    ? "bg-[var(--color-surface-sunken)]/60"
                    : "";
              return (
                <div
                  key={date}
                  className={cn(
                    "min-h-28 border-r border-b border-[var(--color-line)] p-1.5 last:border-r-0",
                    bg,
                    inThisWeek && "ring-1 ring-inset ring-[var(--color-good)]/30",
                  )}
                >
                  <div className="mb-1 flex items-center justify-between px-1">
                    <span
                      className={cn(
                        "text-xs tabular-nums",
                        date === today
                          ? "font-bold text-[var(--color-brand-600)]"
                          : inMonth
                            ? "text-[var(--color-ink-muted)]"
                            : "text-[var(--color-ink-faint)]",
                      )}
                    >
                      {Number(date.slice(8, 10))}
                    </span>
                    {dayItems.length > 3 ? (
                      <span className="text-2xs text-[var(--color-ink-faint)]">
                        +{dayItems.length - 3}
                      </span>
                    ) : null}
                  </div>
                  <div className="space-y-1">
                    {dayItems.slice(0, 3).map((i) => (
                      <ContentChip
                        key={i.id}
                        color={i.clientColor ?? "var(--color-brand-500)"}
                        today={date === today}
                        item={{
                          id: i.id,
                          title: i.title,
                          caption: i.caption,
                          clientName: i.clientName,
                          clientSlug: i.clientSlug,
                          clientLogo: i.clientLogo,
                          clientColor: i.clientColor,
                          scheduledOn: i.scheduledOn,
                          scheduledAt: i.scheduledAt,
                          contentType: i.contentType,
                          platforms: (i.platforms as string[]) ?? [],
                          deliverableId: i.deliverableId,
                        }}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
        </>
      )}

      <div className="mt-4 flex flex-wrap gap-3 text-xs text-[var(--color-ink-muted)]">
        {Object.entries(PUBLICATION_STATUS).map(([key, s]) => (
          <span key={key} className="inline-flex items-center gap-1.5">
            <Badge tone={s.tone}>{s.label}</Badge>
          </span>
        ))}
      </div>
    </div>
  );
}

function chip(active: boolean): string {
  const base = "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium";
  return active
    ? `${base} bg-[var(--color-indigo-ink)] text-white`
    : `${base} border border-[var(--color-line-strong)] bg-[var(--color-surface)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]`;
}
