"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  CalendarDays,
  CalendarRange,
  FileText,
  LayoutDashboard,
  UserRound,
  Video,
} from "lucide-react";

const ITEMS = [
  { href: "/portal", label: "Dashboard", icon: LayoutDashboard },
  { href: "/portal/agenda", label: "Agenda", icon: CalendarDays },
  { href: "/portal/videos", label: "Video's", icon: Video },
  { href: "/portal/scripts", label: "Scripts", icon: FileText },
  { href: "/portal/planning", label: "Contentplanning", icon: CalendarRange },
  { href: "/portal/resultaten", label: "Resultaten", icon: BarChart3 },
  { href: "/portal/contact", label: "Contact", icon: UserRound },
];

export function PortalNav() {
  const pathname = usePathname();

  function isActive(href: string): boolean {
    if (href === "/portal") return pathname === "/portal";
    return pathname.startsWith(href);
  }

  return (
    <nav
      aria-label="Portaalnavigatie"
      className="flex gap-1 overflow-x-auto lg:flex-col lg:gap-0.5 lg:overflow-visible"
    >
      {ITEMS.map(({ href, label, icon: Icon }) => {
        const active = isActive(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={[
              "flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-[var(--color-brand-600)] text-white"
                : "text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]",
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
