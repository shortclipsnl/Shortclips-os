"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { matchNavHref, type NavItem } from "./nav-config";

/**
 * Tabbladen bovenaan een pagina voor onderdelen die bij elkaar horen maar geen
 * eigen menu-item hebben (zie `section` in nav-config), bijv. Resultaten |
 * AI Maandrapportages | Video Intelligence. Krijgt alleen items die de
 * gebruiker mag zien; toont niets als er maar één tab overblijft.
 */
export function SectionTabs({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const activeHref = matchNavHref(items, pathname);
  if (!activeHref) return null;
  const active = items.find((i) => i.href === activeHref);
  if (!active) return null;
  const parentHref = active.section ?? active.href;
  const tabs = items.filter((i) => i.href === parentHref || i.section === parentHref);
  if (tabs.length < 2) return null;

  return (
    <div className="mx-auto mb-6 max-w-[1400px] border-b border-[var(--color-line)]">
      <nav className="-mb-px flex gap-1 overflow-x-auto" aria-label="Onderdelen">
        {tabs.map((t) => {
          const on = t.href === activeHref;
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={on ? "page" : undefined}
              className={cn(
                "whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                on
                  ? "border-[var(--color-ink)] text-[var(--color-ink)]"
                  : "border-transparent text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]",
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
