"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  CalendarRange,
  FileText,
  Handshake,
  LayoutDashboard,
  MoreHorizontal,
  UserRound,
  Video,
  X,
} from "lucide-react";

const ITEMS = [
  { href: "/portal", label: "Dashboard", icon: LayoutDashboard },
  { href: "/portal/agenda", label: "Agenda", icon: CalendarDays },
  { href: "/portal/videos", label: "Video's", icon: Video },
  { href: "/portal/scripts", label: "Scripts", icon: FileText },
  { href: "/portal/planning", label: "Contentplanning", icon: CalendarRange },
  { href: "/portal/resultaten", label: "Resultaten", icon: BarChart3 },
  { href: "/portal/samenwerking", label: "Samenwerking", icon: Handshake },
  { href: "/portal/werkwijze", label: "Werkwijze", icon: BookOpen },
  { href: "/portal/contact", label: "Contact", icon: UserRound },
];

/** De vaste tabs onderin op mobiel; de rest zit onder "Meer". */
const PRIMARY = ["/portal", "/portal/videos", "/portal/agenda", "/portal/resultaten"];

function useIsActive() {
  const pathname = usePathname();
  return (href: string) =>
    href === "/portal" ? pathname === "/portal" : pathname.startsWith(href);
}

const ACTIVE_SIDEBAR =
  "bg-gradient-to-br from-[#19a8ff] to-[#1b5fe0] text-white shadow-[0_10px_26px_-10px_rgba(25,168,250,0.7)]";

/** Verticale navigatie voor desktop (in de zijbalk). */
export function PortalNav() {
  const isActive = useIsActive();
  return (
    <nav aria-label="Portaalnavigatie" className="hidden lg:flex lg:flex-col lg:gap-0.5">
      {ITEMS.map(({ href, label, icon: Icon }) => {
        const active = isActive(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={[
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active ? ACTIVE_SIDEBAR : "text-[var(--color-ink-muted)] hover:bg-white/5 hover:text-[var(--color-ink)]",
            ].join(" ")}
          >
            <Icon className="size-4 shrink-0" strokeWidth={1.75} />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/** Bottom-tab-bar voor mobiel: vier vaste tabs + een "Meer"-vel. */
export function PortalMobileNav() {
  const isActive = useIsActive();
  const [moreOpen, setMoreOpen] = useState(false);

  const primary = PRIMARY.map((h) => ITEMS.find((i) => i.href === h)!);
  const overflow = ITEMS.filter((i) => !PRIMARY.includes(i.href));
  const overflowActive = overflow.some((i) => isActive(i.href));

  return (
    <>
      <nav
        aria-label="Portaalnavigatie"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[rgba(5,6,29,0.92)] pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
      >
        <div className="mx-auto flex max-w-[1240px] items-stretch justify-around px-1">
          {primary.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors ${
                  active ? "text-[#4bc4ff]" : "text-[var(--color-ink-muted)]"
                }`}
              >
                <Icon className="size-[22px]" strokeWidth={active ? 2.1 : 1.75} />
                <span className="leading-none">{label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-expanded={moreOpen}
            className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors ${
              overflowActive ? "text-[#4bc4ff]" : "text-[var(--color-ink-muted)]"
            }`}
          >
            <MoreHorizontal className="size-[22px]" strokeWidth={1.9} />
            <span className="leading-none">Meer</span>
          </button>
        </div>
      </nav>

      {moreOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Meer navigatie">
          <button
            type="button"
            aria-label="Sluiten"
            className="absolute inset-0 bg-black/55"
            onClick={() => setMoreOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-3xl border-t border-white/10 bg-[#0a0c26] p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-sm font-semibold text-[var(--color-ink)]">Meer</span>
              <button type="button" onClick={() => setMoreOpen(false)} aria-label="Sluiten">
                <X className="size-5 text-[var(--color-ink-muted)]" />
              </button>
            </div>
            <div className="flex flex-col gap-1">
              {overflow.map(({ href, label, icon: Icon }) => {
                const active = isActive(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setMoreOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors ${
                      active ? ACTIVE_SIDEBAR : "text-[var(--color-ink)] hover:bg-white/5"
                    }`}
                  >
                    <Icon className="size-5 shrink-0" strokeWidth={1.75} />
                    {label}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
