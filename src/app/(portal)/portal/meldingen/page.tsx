import type { Metadata } from "next";
import Link from "next/link";
import { Bell, ChevronRight, Settings } from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { getPortalNotifications } from "@/server/client-app";
import { safePortalHref } from "@/lib/push-rules";
import { formatDateTime } from "@/lib/format";
import { Card, EmptyState } from "@/components/ui";
import { MarkReadOnView } from "@/components/portal-app/mark-read";

export const metadata: Metadata = { title: "Meldingen" };
export const dynamic = "force-dynamic";

/** Meldingencentrum: alles wat Shortclips de klant heeft laten weten. */
export default async function PortalMeldingenPage() {
  const viewer = await requirePortal();
  const items = await getPortalNotifications(viewer);
  const unread = items.filter((i) => !i.readAt).length;

  return (
    <div className="max-w-[720px]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[var(--color-ink)]">Meldingen</h1>
          <p className="mt-0.5 text-sm text-[var(--color-ink-muted)]">
            {unread > 0 ? `${unread} nieuw` : "Je bent helemaal bij"}
          </p>
        </div>
        <Link
          href="/portal/account#meldingen"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
        >
          <Settings className="size-4" /> Instellingen
        </Link>
      </div>

      {unread > 0 ? <MarkReadOnView /> : null}

      <Card padded={false}>
        {items.length === 0 ? (
          <EmptyState
            icon={<Bell className="size-6" />}
            title="Nog geen meldingen"
            description="Hier verschijnt een seintje zodra er video's, scripts of resultaten voor je klaarstaan."
          />
        ) : (
          <ul className="divide-y divide-[var(--color-line)]">
            {items.map((n) => (
              <li key={n.id}>
                <Link
                  href={safePortalHref(n.href)}
                  className="flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-[var(--color-surface-sunken)]"
                >
                  <span
                    aria-hidden
                    className={`mt-1.5 size-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-[var(--sc-accent)]"}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm ${n.readAt ? "font-medium" : "font-semibold"} text-[var(--color-ink)]`}>
                      {n.title}
                    </span>
                    {n.body ? <span className="mt-0.5 block text-sm text-[var(--color-ink-muted)]">{n.body}</span> : null}
                    <span className="mt-1 block text-xs text-[var(--color-ink-faint)]">{formatDateTime(n.createdAt)}</span>
                  </span>
                  <ChevronRight className="mt-1 size-4 shrink-0 text-[var(--color-ink-faint)]" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
