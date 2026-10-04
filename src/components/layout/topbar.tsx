import Link from "next/link";
import { Bell } from "lucide-react";
import {
  and,
  eq,
  isNull,
} from "drizzle-orm";
import { db } from "@/db/client";
import { notifications } from "@/db/schema";
import type { Viewer } from "@/server/auth/context";
import { Avatar } from "@/components/ui";
import { GlobalSearch } from "./global-search";
import { UserMenu } from "./user-menu";

export async function Topbar({ viewer }: { viewer: Viewer }) {
  const unread = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.userId, viewer.id), isNull(notifications.readAt)))
    .limit(50);

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center gap-4 border-b border-[var(--color-line)] bg-[var(--color-canvas)]/85 px-5 backdrop-blur">
      <div className="flex-1">
        <GlobalSearch />
      </div>

      <Link
        href="/notifications"
        className="relative rounded-[var(--radius-sm)] p-2 text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-ink)]"
        aria-label={`Meldingen${unread.length ? ` (${unread.length} ongelezen)` : ""}`}
      >
        <Bell className="size-5" strokeWidth={1.75} />
        {unread.length > 0 ? (
          <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-[var(--color-bad)] text-[9px] font-bold text-white">
            {unread.length > 9 ? "9+" : unread.length}
          </span>
        ) : null}
      </Link>

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
