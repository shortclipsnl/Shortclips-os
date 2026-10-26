"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Bell, Check, Loader2 } from "lucide-react";
import { markAllRead, markNotificationRead } from "@/server/actions/notifications";

export type BellNotification = {
  id: string;
  title: string;
  body: string | null;
  href: string | null;
  level: "info" | "success" | "warning" | "critical";
  read: boolean;
  createdAt: string;
  clientName: string | null;
};

const ACCENT: Record<BellNotification["level"], string> = {
  info: "var(--color-info)",
  success: "var(--color-good)",
  warning: "var(--color-warn)",
  critical: "var(--color-bad)",
};

function ago(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  const m = Math.round(diff / 60000);
  if (m < 1) return "zojuist";
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} uur`;
  const d = Math.round(h / 24);
  return `${d} dag${d === 1 ? "" : "en"}`;
}

/**
 * Meldingsbel met dropdown: toont de recente meldingen van de ingelogde
 * medewerker. Op een melding klikken markeert die als gelezen en gaat direct
 * naar het bijbehorende scherm (de href van de melding).
 */
export function NotificationBell({ items, unreadCount }: { items: BellNotification[]; unreadCount: number }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  function openNotification(n: BellNotification) {
    setOpen(false);
    void markNotificationRead(n.id).catch(() => {});
    if (n.href) router.push(n.href);
    else router.refresh();
  }

  function allRead() {
    start(async () => {
      await markAllRead();
      router.refresh();
    });
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-[var(--radius-sm)] p-2 text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-ink)]"
        aria-label={`Meldingen${unreadCount ? ` (${unreadCount} ongelezen)` : ""}`}
        aria-expanded={open}
      >
        <Bell className="size-5" strokeWidth={1.75} />
        {unreadCount > 0 ? (
          <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-[var(--color-bad)] text-[9px] font-bold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-50 mt-2 w-[360px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[var(--shadow-pop)]">
          <div className="flex items-center justify-between gap-2 border-b border-[var(--color-line)] px-4 py-2.5">
            <span className="text-sm font-semibold">Meldingen</span>
            {unreadCount > 0 ? (
              <button type="button" onClick={allRead} disabled={pending} className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Alles gelezen
              </button>
            ) : null}
          </div>

          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-[var(--color-ink-muted)]">Geen meldingen.</p>
          ) : (
            <ul className="max-h-[min(70vh,440px)] divide-y divide-[var(--color-line)] overflow-y-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => openNotification(n)}
                    className={`flex w-full items-start gap-2.5 px-4 py-3 text-left transition-colors hover:bg-[var(--color-surface-sunken)] ${n.read ? "" : "bg-[var(--color-brand-50)]/40"}`}
                  >
                    <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: n.read ? "transparent" : ACCENT[n.level] }} />
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm ${n.read ? "" : "font-semibold"}`}>{n.title}</span>
                      {n.body ? <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--color-ink-muted)]">{n.body}</span> : null}
                      <span className="mt-1 flex items-center gap-2 text-2xs text-[var(--color-ink-faint)]">
                        {n.clientName ? <span className="font-medium">{n.clientName}</span> : null}
                        <span>{ago(n.createdAt)} geleden</span>
                        {n.href ? <span className="font-semibold text-[var(--color-brand-600)]">· Bekijken →</span> : null}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <Link href="/notifications" onClick={() => setOpen(false)} className="block border-t border-[var(--color-line)] px-4 py-2.5 text-center text-xs font-semibold text-[var(--color-brand-600)] hover:bg-[var(--color-surface-sunken)]">
            Alle meldingen
          </Link>
        </div>
      ) : null}
    </div>
  );
}
