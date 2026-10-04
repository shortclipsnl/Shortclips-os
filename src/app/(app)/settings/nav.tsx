"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export function SettingsNav({
  items,
}: {
  items: Array<{ href: string; label: string }>;
}) {
  const pathname = usePathname();
  return (
    <nav className="-mx-1 overflow-x-auto border-b border-[var(--color-line)]">
      <div className="flex min-w-max gap-1 px-1">
        {items.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors",
                active
                  ? "border-[var(--color-brand-500)] text-[var(--color-ink)]"
                  : "border-transparent text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
