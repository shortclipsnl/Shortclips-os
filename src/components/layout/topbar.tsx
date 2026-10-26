import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, notifications } from "@/db/schema";
import type { Viewer } from "@/server/auth/context";
import { Avatar } from "@/components/ui";
import { GlobalSearch } from "./global-search";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";
import { NotificationBell, type BellNotification } from "./notification-bell";

export async function Topbar({ viewer }: { viewer: Viewer }) {
  // Recente meldingen voor de bel-dropdown (klikbaar → direct naar de melding).
  const rows = await db
    .select({
      id: notifications.id,
      title: notifications.title,
      body: notifications.body,
      href: notifications.href,
      level: notifications.level,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
      clientName: clients.name,
    })
    .from(notifications)
    .leftJoin(clients, eq(clients.id, notifications.clientId))
    .where(eq(notifications.userId, viewer.id))
    .orderBy(desc(notifications.createdAt))
    .limit(12);

  const items: BellNotification[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    href: r.href,
    level: r.level as BellNotification["level"],
    read: r.readAt != null,
    createdAt: (r.createdAt as Date).toISOString(),
    clientName: r.clientName ?? null,
  }));
  const unread = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.userId, viewer.id), isNull(notifications.readAt)))
    .limit(50);
  const unreadCount = unread.length;

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center gap-4 border-b border-[var(--color-line)] bg-[var(--color-canvas)]/85 px-5 backdrop-blur">
      <div className="flex-1">
        <GlobalSearch />
      </div>

      <ThemeToggle />

      <NotificationBell items={items} unreadCount={unreadCount} />

      <UserMenu
        name={viewer.fullName}
        email={viewer.email}
        role={viewer.primaryRole}
      >
        <Avatar name={viewer.fullName} size={32} />
      </UserMenu>
    </header>
  );
}
