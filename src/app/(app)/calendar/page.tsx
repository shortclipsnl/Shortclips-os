import type { Metadata } from "next";
import Link from "next/link";
import { requireInternal } from "@/server/auth/context";
import { listCalendar, monthGrid, type CalendarItem } from "@/server/calendar";
import { listClients } from "@/server/clients";
import { Avatar, Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { formatDateFull, periodLabel } from "@/lib/format";
import { PLATFORM, PUBLICATION_STATUS } from "@/lib/statuses";
import { cn } from "@/lib/cn";
import { Planner } from "./planner";

export const metadata: Metadata = { title: "Planning" };
export const dynamic = "force-dynamic";

const WEEKDAYS = ["ma", "di", "wo", "do", "vr", "za", "zo"];

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
  const params = await searchParams;

  const now = new Date();
  const period = params.maand ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [year, month] = period.split("-").map(Number);

  const weeks = monthGrid(year!, month!);
  const from = weeks[0]![0]!;
  const to = weeks[weeks.length - 1]![6]!;

  const [items, clientList] = await Promise.all([
    listCalendar(viewer, {
      from,
      to,
      clientSlug: params.klant,
      status: params.status,
      platform: params.platform,
    }),
    listClients(viewer),
  ]);

  const canWrite = viewer.permissions.has("calendar:write");
  const asPlanner = params.weergave === "planner";
  const plannerTo = new Date();
  plannerTo.setDate(plannerTo.getDate() + 120);
  const plannerItems = asPlanner
    ? await listCalendar(viewer, {
        from: new Date().toISOString().slice(0, 10),
        to: plannerTo.toISOString().slice(0, 10),
        clientSlug: params.klant,
      })
    : [];

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

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href={withParam("klant", undefined)} className={chip(!params.klant)}>
          Alle klanten
        </Link>
        {clientList.slice(0, 8).map((c) => (
          <Link key={c.id} href={withParam("klant", c.slug)} className={chip(params.klant === c.slug)}>
            {c.name}
          </Link>
        ))}
        <span className="mx-1 h-4 w-px bg-[var(--color-line-strong)]" />
        {Object.entries(PLATFORM).map(([key, p]) => (
          <Link key={key} href={withParam("platform", params.platform === key ? undefined : key)} className={chip(params.platform === key)}>
            <span className="mr-1.5 inline-block size-2 rounded-full align-middle" style={{ background: p.color }} />
            {p.label}
          </Link>
        ))}
      </div>

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
        <Card padded={false}>
          {items.length === 0 ? (
            <EmptyState title="Niets gepland in deze periode" />
          ) : (
            <ul className="divide-y divide-[var(--color-line)]">
              {items.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-5 py-3">
                  <span className="w-28 shrink-0 text-sm text-[var(--color-ink-muted)]">
                    {formatDateFull(i.scheduledOn)}
                  </span>
                  <Avatar name={i.clientName} color={i.clientColor} size={22} />
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
                  <Badge tone={PUBLICATION_STATUS[i.status]?.tone ?? "neutral"}>
                    {PUBLICATION_STATUS[i.status]?.label ?? i.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : (
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
              const dayItems = byDay.get(date) ?? [];
              return (
                <div
                  key={date}
                  className={cn(
                    "min-h-28 border-r border-b border-[var(--color-line)] p-1.5 last:border-r-0",
                    !inMonth && "bg-[var(--color-surface-sunken)]/60",
                    date === today && "bg-[var(--color-info-soft)]/40",
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
                      <Link
                        key={i.id}
                        href={i.deliverableId ? `/videos/${i.deliverableId}` : `/clients/${i.clientSlug}?tab=planning`}
                        className="block rounded-[4px] border-l-2 bg-[var(--color-surface-sunken)] px-1.5 py-1 hover:bg-[var(--color-neutral-soft)]"
                        style={{ borderLeftColor: i.clientColor ?? "var(--color-brand-500)" }}
                        title={`${i.clientName} — ${i.title}`}
                      >
                        <span className="block truncate text-2xs leading-tight font-medium">
                          {i.title}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1">
                          {(i.platforms as string[]).slice(0, 3).map((p) => (
                            <span key={p} className="size-1.5 rounded-full" style={{ background: PLATFORM[p]?.color ?? "#999" }} />
                          ))}
                          <span className="truncate text-2xs text-[var(--color-ink-faint)]">
                            {i.clientName}
                          </span>
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
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
  return active
    ? "rounded-full bg-[var(--color-indigo-ink)] px-3 py-1.5 text-xs font-medium text-white"
    : "rounded-full border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]";
}
