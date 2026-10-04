import type { Metadata } from "next";
import Link from "next/link";
import {
  desc,
  eq,
} from "drizzle-orm";
import { db } from "@/db/client";
import { clients, notifications } from "@/db/schema";
import { requireInternal } from "@/server/auth/context";
import { Avatar, Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { MarkAllRead } from "./mark-read";

export const metadata: Metadata = { title: "Meldingen" };
export const dynamic = "force-dynamic";

const LEVEL_TONE = {
  info: "info",
  success: "good",
  warning: "warn",
  critical: "bad",
} as const;

export default async function NotificationsPage() {
  const viewer = await requireInternal();

  const rows = await db
    .select({
      id: notifications.id,
      type: notifications.type,
      level: notifications.level,
      title: notifications.title,
      body: notifications.body,
      href: notifications.href,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
      clientName: clients.name,
      clientSlug: clients.slug,
      clientColor: clients.color,
    })
    .from(notifications)
    .leftJoin(clients, eq(clients.id, notifications.clientId))
    .where(eq(notifications.userId, viewer.id))
    .orderBy(desc(notifications.createdAt))
    .limit(100);

  const unread = rows.filter((r) => !r.readAt);

  return (
    <div className="mx-auto max-w-[900px]">
      <PageHeader
        title="Meldingen"
        description={`${unread.length} ongelezen van ${rows.length}`}
        actions={unread.length > 0 ? <MarkAllRead /> : undefined}
      />

      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState
            title="Geen meldingen"
            description="Je krijgt hier bericht bij nieuwe feedback, naderende deadlines en signalen die aandacht vragen."
          />
        ) : (
          <ul className="divide-y divide-[var(--color-line)]">
            {rows.map((n) => {
              const content = (
                <span className="flex items-start gap-3 px-5 py-4">
                  {!n.readAt ? (
                    <span className="mt-1.5 size-2 shrink-0 rounded-full bg-[var(--color-brand-500)]" />
                  ) : (
                    <span className="mt-1.5 size-2 shrink-0" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className={n.readAt ? "text-sm" : "text-sm font-semibold"}>
                        {n.title}
                      </span>
                      <Badge tone={LEVEL_TONE[n.level] ?? "neutral"}>{n.level}</Badge>
                    </span>
                    {n.body ? (
                      <span className="mt-0.5 block text-sm text-[var(--color-ink-muted)]">
                        {n.body}
                      </span>
                    ) : null}
                    <span className="mt-1 flex items-center gap-2 text-xs text-[var(--color-ink-faint)]">
                      {n.clientName ? (
                        <span className="inline-flex items-center gap-1">
                          <Avatar name={n.clientName} color={n.clientColor} size={14} />
                          {n.clientName}
                        </span>
                      ) : null}
                      <span>{formatDateTime(n.createdAt)}</span>
                    </span>
                  </span>
                </span>
              );

              return (
                <li key={n.id}>
                  {n.href ? (
                    <Link href={n.href} className="sc-row-link block">
                      {content}
                    </Link>
                  ) : (
                    content
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
